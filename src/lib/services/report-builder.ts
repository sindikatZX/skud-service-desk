import { db } from "@/db";
import {
  catalogItems, catalogCategories, warehouses, stockTransactions, equipmentUnits, stockDocuments, teams, tickets, clients, sites, users,
  ticketWorks, ticketTypes,
} from "@/db/schema";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getCentralWarehouse } from "@/lib/services/warehouses";
import { TX_LABELS } from "@/lib/labels";
import { buildCsv, csvNum, type CsvCell } from "@/lib/csv";

/**
 * Конфигурируемые отчёты: остатки, движение товаров, работы (что/где сделали).
 * Каждый отчёт возвращает строки + итоги и умеет отдавать CSV (те же колонки).
 * Цены попадают в отчёты только при canPrices (администратор).
 */

export type Period = { from?: Date | null; to?: Date | null };

export function parsePeriod(from?: string, to?: string): Period {
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to.length <= 10 ? `${to}T23:59:59.999` : to) : null;
  return { from: f && !Number.isNaN(f.getTime()) ? f : null, to: t && !Number.isNaN(t.getTime()) ? t : null };
}

export const fmtD = (d: Date | null | undefined, withTime = true) =>
  d ? d.toLocaleString("ru-RU", withTime ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

/** Заголовок периода для печатных форм. */
export function periodLabel(p: Period) {
  if (p.from && p.to) return `с ${fmtD(p.from, false)} по ${fmtD(p.to, false)}`;
  if (p.from) return `с ${fmtD(p.from, false)}`;
  if (p.to) return `по ${fmtD(p.to, false)}`;
  return "за весь период";
}

// ─────────────────────────── ОСТАТКИ ───────────────────────────

export type StockRow = {
  warehouseId: number;
  warehouseName: string;
  itemId: number;
  code: string;
  sku: string;
  name: string;
  unit: string;
  category: string;
  isSerialized: boolean;
  opening: number;
  income: number;
  outcome: number;
  closing: number;
  price: number | null;
  closingSum: number | null;
};

export type StockReport = {
  rows: StockRow[];
  totals: { warehouseId: number; warehouseName: string; items: number; opening: number; income: number; outcome: number; closing: number; closingSum: number | null }[];
  period: Period;
  warehouses: { id: number; name: string }[];
};

export async function stockReport(input: {
  warehouseIds: number[];
  period: Period;
  q?: string;
  categoryId?: number;
  onlyNonZero?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
  canPrices: boolean;
}): Promise<StockReport> {
  const central = await getCentralWarehouse();
  const whsAll = await db.select().from(warehouses).orderBy(asc(warehouses.sortOrder), asc(warehouses.name));
  const selected = input.warehouseIds.length ? whsAll.filter((w) => input.warehouseIds.includes(w.id)) : whsAll.filter((w) => w.isActive);
  const from = input.period.from ?? new Date(0);
  const to = input.period.to ?? new Date("2999-01-01");

  // Движения по обеим сторонам операции: направление +1 (приход в место) / −1 (расход из места),
  // корзина периода: 0 — до начала, 1 — внутри, 2 — после.
  const res = await db.execute(sql`
    select catalog_item_id as item_id, loc_type, loc_id, dir, bucket, sum(quantity)::numeric as q from (
      select t.catalog_item_id,
        case when t.to_location_type = 'warehouse' then 'w' when t.to_location_type = 'team' then 't' end as loc_type,
        case when t.to_location_type = 'warehouse' then coalesce(t.to_warehouse_id, ${central.id}) else t.to_team_id end as loc_id,
        1 as dir,
        case when t.created_at < ${from} then 0 when t.created_at <= ${to} then 1 else 2 end as bucket,
        t.quantity
      from stock_transactions t where t.type not in ('reserve','unreserve') and t.to_location_type is not null
      union all
      select t.catalog_item_id,
        case when t.from_location_type = 'warehouse' then 'w' when t.from_location_type = 'team' then 't' end as loc_type,
        case when t.from_location_type = 'warehouse' then coalesce(t.from_warehouse_id, ${central.id}) else t.from_team_id end as loc_id,
        -1 as dir,
        case when t.created_at < ${from} then 0 when t.created_at <= ${to} then 1 else 2 end as bucket,
        t.quantity
      from stock_transactions t where t.type not in ('reserve','unreserve') and t.from_location_type is not null
    ) x where loc_type is not null and loc_id is not null
    group by 1,2,3,4,5`);
  type Agg = { item_id: number; loc_type: "w" | "t"; loc_id: number; dir: number; bucket: number; q: string };
  const aggs = res.rows as Agg[];

  const items = await db
    .select({ id: catalogItems.id, code: catalogItems.code, sku: catalogItems.sku, name: catalogItems.name, unit: catalogItems.unit, isSerialized: catalogItems.isSerialized, price: catalogItems.price, categoryId: catalogItems.categoryId, category: catalogCategories.name })
    .from(catalogItems)
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId));
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const ql = (input.q ?? "").trim().toLowerCase();

  const rows: StockRow[] = [];
  for (const w of selected) {
    const locType = w.kind === "team" && w.teamId ? "t" : "w";
    const locId = locType === "t" ? w.teamId! : w.id;
    const perItem = new Map<number, { opening: number; income: number; outcome: number }>();
    for (const a of aggs) {
      if (a.loc_type !== locType || Number(a.loc_id) !== locId) continue;
      let v = perItem.get(a.item_id);
      if (!v) perItem.set(a.item_id, (v = { opening: 0, income: 0, outcome: 0 }));
      const q = Number(a.q) * Number(a.dir);
      if (Number(a.bucket) === 0) v.opening += q;
      else if (Number(a.bucket) === 1) {
        if (Number(a.dir) > 0) v.income += Number(a.q);
        else v.outcome += Number(a.q);
      }
    }
    for (const [itemId, v] of perItem) {
      const it = itemMap.get(itemId);
      if (!it) continue;
      if (input.categoryId && it.categoryId !== input.categoryId) continue;
      if (ql && !`${it.name} ${it.sku} ${it.code}`.toLowerCase().includes(ql)) continue;
      const closing = round3(v.opening + v.income - v.outcome);
      if (input.onlyNonZero !== false && Math.abs(v.opening) < 1e-9 && Math.abs(v.income) < 1e-9 && Math.abs(v.outcome) < 1e-9 && Math.abs(closing) < 1e-9) continue;
      const price = input.canPrices && it.price != null ? Number(it.price) : null;
      rows.push({
        warehouseId: w.id, warehouseName: w.name, itemId, code: it.code, sku: it.sku, name: it.name, unit: it.unit, category: it.category, isSerialized: it.isSerialized,
        opening: round3(v.opening), income: round3(v.income), outcome: round3(v.outcome), closing,
        price, closingSum: price != null ? Math.round(price * closing * 100) / 100 : null,
      });
    }
  }

  const key = input.sort ?? "name";
  const dir = input.dir ?? "asc";
  const cmp = (a: StockRow, b: StockRow) => {
    const va = a[key as keyof StockRow] as string | number; const vb = b[key as keyof StockRow] as string | number;
    const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""), "ru");
    return dir === "asc" ? r : -r;
  };
  rows.sort((a, b) => (a.warehouseName.localeCompare(b.warehouseName, "ru") || cmp(a, b)));
  if (key === "warehouse") rows.sort((a, b) => (dir === "asc" ? 1 : -1) * a.warehouseName.localeCompare(b.warehouseName, "ru"));

  const totals = selected.map((w) => {
    const rs = rows.filter((r) => r.warehouseId === w.id);
    return {
      warehouseId: w.id, warehouseName: w.name, items: rs.length,
      opening: round3(rs.reduce((s, r) => s + r.opening, 0)), income: round3(rs.reduce((s, r) => s + r.income, 0)),
      outcome: round3(rs.reduce((s, r) => s + r.outcome, 0)), closing: round3(rs.reduce((s, r) => s + r.closing, 0)),
      closingSum: input.canPrices ? Math.round(rs.reduce((s, r) => s + (r.closingSum ?? 0), 0) * 100) / 100 : null,
    };
  });
  return { rows, totals, period: input.period, warehouses: selected.map((w) => ({ id: w.id, name: w.name })) };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function stockCsv(rep: StockReport, canPrices: boolean) {
  const headers = ["Склад", "Код", "Артикул", "Наименование", "Категория", "Ед.", "Нач. остаток", "Приход", "Расход", "Кон. остаток", ...(canPrices ? ["Цена", "Сумма остатка"] : [])];
  const rows: CsvCell[][] = rep.rows.map((r) => [r.warehouseName, r.code, r.sku, r.name, r.category, r.unit, csvNum(r.opening), csvNum(r.income), csvNum(r.outcome), csvNum(r.closing), ...(canPrices ? [csvNum(r.price), csvNum(r.closingSum)] : [])]);
  for (const t of rep.totals) rows.push([`ИТОГО: ${t.warehouseName}`, "", "", `${t.items} поз.`, "", "", csvNum(t.opening), csvNum(t.income), csvNum(t.outcome), csvNum(t.closing), ...(canPrices ? ["", csvNum(t.closingSum)] : [])]);
  return buildCsv(headers, rows);
}

// ─────────────────────────── ДВИЖЕНИЕ ТОВАРОВ ───────────────────────────

export const MOVEMENT_TYPES = ["receive", "install", "transfer", "write_off", "issue_to_team", "return_to_warehouse"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export type MovementRow = {
  id: number;
  date: Date;
  type: string;
  typeLabel: string;
  itemId: number;
  code: string;
  sku: string;
  name: string;
  unit: string;
  serialNumber: string | null;
  quantity: number;
  from: string;
  to: string;
  document: string;
  documentId: number | null;
  ticketNumber: string | null;
  ticketId: number | null;
  clientName: string | null;
  siteName: string | null;
  actor: string | null;
  note: string | null;
  price: number | null;
  sum: number | null;
};

export async function movementsReport(input: {
  types: string[];
  period: Period;
  itemIds: number[];
  q?: string;
  warehouseIds: number[];
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
  canPrices: boolean;
}) {
  const central = await getCentralWarehouse();
  const conds: SQL[] = [sql`${stockTransactions.type} not in ('reserve','unreserve')`];
  const types = input.types.filter((t) => (MOVEMENT_TYPES as readonly string[]).includes(t));
  if (types.length) conds.push(inArray(stockTransactions.type, types as MovementType[]));
  if (input.period.from) conds.push(gte(stockTransactions.createdAt, input.period.from));
  if (input.period.to) conds.push(lte(stockTransactions.createdAt, input.period.to));
  if (input.itemIds.length) conds.push(inArray(stockTransactions.catalogItemId, input.itemIds));
  if (input.q?.trim()) conds.push(or(ilike(catalogItems.name, `%${input.q.trim()}%`), ilike(catalogItems.sku, `%${input.q.trim()}%`), ilike(catalogItems.code, `%${input.q.trim()}%`))!);
  if (input.warehouseIds.length) {
    const whs = await db.select().from(warehouses).where(inArray(warehouses.id, input.warehouseIds));
    const whIds = whs.filter((w) => w.kind !== "team").map((w) => w.id);
    const teamIds = whs.filter((w) => w.kind === "team" && w.teamId).map((w) => w.teamId!);
    const parts: SQL[] = [];
    if (whIds.length) {
      parts.push(sql`(${stockTransactions.toLocationType} = 'warehouse' and coalesce(${stockTransactions.toWarehouseId}, ${central.id}) in (${sql.join(whIds.map((i) => sql`${i}`), sql`, `)}))`);
      parts.push(sql`(${stockTransactions.fromLocationType} = 'warehouse' and coalesce(${stockTransactions.fromWarehouseId}, ${central.id}) in (${sql.join(whIds.map((i) => sql`${i}`), sql`, `)}))`);
    }
    if (teamIds.length) {
      parts.push(sql`(${stockTransactions.toLocationType} = 'team' and ${stockTransactions.toTeamId} in (${sql.join(teamIds.map((i) => sql`${i}`), sql`, `)}))`);
      parts.push(sql`(${stockTransactions.fromLocationType} = 'team' and ${stockTransactions.fromTeamId} in (${sql.join(teamIds.map((i) => sql`${i}`), sql`, `)}))`);
    }
    if (parts.length) conds.push(or(...parts)!);
    else conds.push(sql`false`);
  }
  const toTeam = sql<string | null>`(select name from teams where id = ${stockTransactions.toTeamId})`;
  const fromTeam = sql<string | null>`(select name from teams where id = ${stockTransactions.fromTeamId})`;
  const toWh = sql<string | null>`(select name from warehouses where id = coalesce(${stockTransactions.toWarehouseId}, ${central.id}))`;
  const fromWh = sql<string | null>`(select name from warehouses where id = coalesce(${stockTransactions.fromWarehouseId}, ${central.id}))`;
  const sortMap: Record<string, SQL | AnyPgColumn> = {
    date: stockTransactions.createdAt, type: stockTransactions.type, item: catalogItems.name, sku: catalogItems.sku, quantity: stockTransactions.quantity,
    from: sql`coalesce(${fromWh}, ${fromTeam})`, to: sql`coalesce(${toWh}, ${toTeam})`, document: stockDocuments.number, actor: users.fullName,
  };
  const col = sortMap[input.sort ?? "date"] ?? stockTransactions.createdAt;
  const ord = (input.dir ?? "desc") === "asc" ? asc(col) : desc(col);
  const list = await db
    .select({
      id: stockTransactions.id, date: stockTransactions.createdAt, type: stockTransactions.type, quantity: stockTransactions.quantity, note: stockTransactions.note,
      itemId: stockTransactions.catalogItemId, code: catalogItems.code, sku: catalogItems.sku, name: catalogItems.name, unit: catalogItems.unit, price: catalogItems.price,
      serialNumber: equipmentUnits.serialNumber,
      fromLocationType: stockTransactions.fromLocationType, toLocationType: stockTransactions.toLocationType,
      fromTeamName: fromTeam, toTeamName: toTeam, fromWarehouseName: fromWh, toWarehouseName: toWh,
      documentId: stockTransactions.documentId, documentNumber: stockDocuments.number,
      ticketId: stockTransactions.ticketId, ticketNumber: tickets.number,
      clientName: clients.name, siteName: sites.name, actor: users.fullName,
    })
    .from(stockTransactions)
    .innerJoin(catalogItems, eq(catalogItems.id, stockTransactions.catalogItemId))
    .leftJoin(equipmentUnits, eq(equipmentUnits.id, stockTransactions.unitId))
    .leftJoin(stockDocuments, eq(stockDocuments.id, stockTransactions.documentId))
    .leftJoin(tickets, eq(tickets.id, stockTransactions.ticketId))
    .leftJoin(clients, eq(clients.id, stockTransactions.clientId))
    .leftJoin(sites, eq(sites.id, stockTransactions.siteId))
    .leftJoin(users, eq(users.id, stockTransactions.actorId))
    .where(and(...conds))
    .orderBy(ord, desc(stockTransactions.id))
    .limit(input.limit ?? 5000);
  const place = (lt: string | null, wh: string | null, team: string | null, siteName: string | null, type: string) => {
    if (lt === "warehouse") return wh ?? "Склад";
    if (lt === "team") return team ? `Бригада: ${team}` : "Бригада";
    if (lt === "site") return siteName ? `Объект: ${siteName}` : "Объект";
    if (type === "receive") return "Поставщик";
    if (type === "write_off") return "Списание";
    if (type === "install") return siteName ? `Объект: ${siteName}` : "Объект";
    return "—";
  };
  const rows: MovementRow[] = list.map((r) => {
    const price = input.canPrices && r.price != null ? Number(r.price) : null;
    const quantity = Number(r.quantity);
    return {
      id: r.id, date: r.date, type: r.type, typeLabel: TX_LABELS[r.type] ?? r.type, itemId: r.itemId, code: r.code, sku: r.sku, name: r.name, unit: r.unit,
      serialNumber: r.serialNumber, quantity,
      from: r.fromLocationType ? place(r.fromLocationType, r.fromWarehouseName, r.fromTeamName, r.siteName, r.type) : place(null, null, null, r.siteName, r.type),
      to: r.toLocationType ? place(r.toLocationType, r.toWarehouseName, r.toTeamName, r.siteName, r.type) : place(null, null, null, r.siteName, r.type),
      document: r.documentNumber ?? "", documentId: r.documentId, ticketNumber: r.ticketNumber, ticketId: r.ticketId, clientName: r.clientName, siteName: r.siteName,
      actor: r.actor, note: r.note, price, sum: price != null ? Math.round(price * quantity * 100) / 100 : null,
    };
  });
  const byType = MOVEMENT_TYPES.map((t) => ({ type: t, label: TX_LABELS[t] ?? t, count: rows.filter((r) => r.type === t).length, quantity: round3(rows.filter((r) => r.type === t).reduce((s, r) => s + r.quantity, 0)) })).filter((x) => x.count);
  return { rows, byType, period: input.period };
}

export function movementsCsv(rep: Awaited<ReturnType<typeof movementsReport>>, canPrices: boolean) {
  const headers = ["Дата", "Операция", "Код", "Артикул", "Наименование", "S/N", "Кол-во", "Ед.", "Откуда", "Куда", "Документ", "Заявка", "Клиент", "Объект", "Исполнитель", "Примечание", ...(canPrices ? ["Цена", "Сумма"] : [])];
  const rows: CsvCell[][] = rep.rows.map((r) => [fmtD(r.date), r.typeLabel, r.code, r.sku, r.name, r.serialNumber, csvNum(r.quantity), r.unit, r.from, r.to, r.document, r.ticketNumber, r.clientName, r.siteName, r.actor, r.note, ...(canPrices ? [csvNum(r.price), csvNum(r.sum)] : [])]);
  return buildCsv(headers, rows);
}

// ─────────────────────────── РАБОТЫ ───────────────────────────

export type WorkRow = {
  id: number;
  date: Date;
  work: string;
  quantity: number;
  unit: string;
  minutes: number | null;
  ticketId: number;
  ticketNumber: string;
  ticketTitle: string;
  type: string;
  clientId: number;
  client: string;
  siteId: number;
  site: string;
  address: string;
  teamId: number | null;
  team: string | null;
  performer: string | null;
};

export async function worksReport(input: {
  period: Period;
  typeIds: number[];
  q?: string;
  siteIds: number[];
  clientIds: number[];
  teamIds: number[];
  performerIds: number[];
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
}) {
  const conds: SQL[] = [];
  if (input.period.from) conds.push(gte(ticketWorks.createdAt, input.period.from));
  if (input.period.to) conds.push(lte(ticketWorks.createdAt, input.period.to));
  if (input.typeIds.length) conds.push(inArray(tickets.typeId, input.typeIds));
  if (input.q?.trim()) conds.push(ilike(ticketWorks.description, `%${input.q.trim()}%`));
  if (input.siteIds.length) conds.push(inArray(tickets.siteId, input.siteIds));
  if (input.clientIds.length) conds.push(inArray(tickets.clientId, input.clientIds));
  if (input.teamIds.length) conds.push(inArray(tickets.teamId, input.teamIds));
  if (input.performerIds.length) conds.push(inArray(ticketWorks.performedBy, input.performerIds));
  const sortMap: Record<string, SQL | AnyPgColumn> = {
    date: ticketWorks.createdAt, work: ticketWorks.description, quantity: ticketWorks.quantity, minutes: ticketWorks.durationMinutes, ticket: tickets.number,
    type: ticketTypes.name, client: clients.name, site: sites.name, team: teams.name, performer: users.fullName,
  };
  const col = sortMap[input.sort ?? "date"] ?? ticketWorks.createdAt;
  const ord = (input.dir ?? "desc") === "asc" ? asc(col) : desc(col);
  const list = await db
    .select({
      id: ticketWorks.id, date: ticketWorks.createdAt, work: ticketWorks.description, quantity: ticketWorks.quantity, unit: ticketWorks.unit, minutes: ticketWorks.durationMinutes,
      ticketId: tickets.id, ticketNumber: tickets.number, ticketTitle: tickets.title, type: ticketTypes.name,
      clientId: clients.id, client: clients.name, siteId: sites.id, site: sites.name, address: sites.address,
      teamId: tickets.teamId, team: teams.name, performer: users.fullName,
    })
    .from(ticketWorks)
    .innerJoin(tickets, eq(tickets.id, ticketWorks.ticketId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
    .innerJoin(clients, eq(clients.id, tickets.clientId))
    .innerJoin(sites, eq(sites.id, tickets.siteId))
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .leftJoin(users, eq(users.id, ticketWorks.performedBy))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(ord, desc(ticketWorks.id))
    .limit(input.limit ?? 5000);
  const rows: WorkRow[] = list.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  const group = <K extends string>(key: (r: WorkRow) => K, label: (r: WorkRow) => string) => {
    const m = new Map<K, { key: K; label: string; count: number; quantity: number; minutes: number; tickets: Set<number> }>();
    for (const r of rows) {
      const k = key(r);
      let v = m.get(k);
      if (!v) m.set(k, (v = { key: k, label: label(r), count: 0, quantity: 0, minutes: 0, tickets: new Set() }));
      v.count++; v.quantity += r.quantity; v.minutes += r.minutes ?? 0; v.tickets.add(r.ticketId);
    }
    return [...m.values()].map((v) => ({ ...v, quantity: round3(v.quantity), tickets: v.tickets.size })).sort((a, b) => b.count - a.count);
  };
  return {
    rows,
    byWork: group((r) => r.work.toLowerCase().trim(), (r) => r.work),
    bySite: group((r) => `${r.siteId}`, (r) => `${r.client} — ${r.site}`),
    byTeam: group((r) => `${r.teamId ?? 0}`, (r) => r.team ?? "Без бригады"),
    byType: group((r) => r.type, (r) => r.type),
    totals: { works: rows.length, quantity: round3(rows.reduce((s, r) => s + r.quantity, 0)), minutes: rows.reduce((s, r) => s + (r.minutes ?? 0), 0), tickets: new Set(rows.map((r) => r.ticketId)).size },
    period: input.period,
  };
}

export function worksCsv(rep: Awaited<ReturnType<typeof worksReport>>, mode: "what" | "where") {
  const headers = mode === "what"
    ? ["Дата", "Работа", "Кол-во", "Ед.", "Минут", "Тип работ", "Заявка", "Тема заявки", "Исполнитель", "Бригада", "Клиент", "Объект"]
    : ["Дата", "Клиент", "Объект", "Адрес", "Бригада", "Тип работ", "Работа", "Кол-во", "Ед.", "Минут", "Заявка", "Исполнитель"];
  const rows: CsvCell[][] = rep.rows.map((r) => mode === "what"
    ? [fmtD(r.date), r.work, csvNum(r.quantity), r.unit, r.minutes, r.type, r.ticketNumber, r.ticketTitle, r.performer, r.team, r.client, r.site]
    : [fmtD(r.date), r.client, r.site, r.address, r.team, r.type, r.work, csvNum(r.quantity), r.unit, r.minutes, r.ticketNumber, r.performer]);
  return buildCsv(headers, rows);
}
