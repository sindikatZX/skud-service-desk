import { db } from "@/db";
import {
  catalogItems,
  catalogCategories,
  equipmentUnits,
  stockBalances,
  stockReservations,
  stockTransactions,
  stockDocuments,
  stockDocumentLines,
  ticketMaterials,
  tickets,
  teams,
  users,
  clients,
  sites,
  warehouses,
  type StockDocType,
} from "@/db/schema";
import { and, eq, desc, sql, inArray, gte, lte, or, ilike } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@/lib/api";
import { DOC_PREFIX } from "@/lib/labels";
import { ensureWarehouses, getCentralWarehouse, locById, locOf, locTeam, locWarehouse, sameLoc, teamWarehouse, type Loc } from "@/lib/services/warehouses";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Dbx = Tx | typeof db;

async function getItem(tx: Dbx, id: number) {
  const [item] = await tx.select().from(catalogItems).where(eq(catalogItems.id, id));
  if (!item) throw notFound("Номенклатура не найдена");
  return item;
}

/** Единица блокируется на время операции: параллельные перемещение/резерв не разъедутся. */
async function getUnit(tx: Tx, id: number) {
  const [u] = await tx.select().from(equipmentUnits).where(eq(equipmentUnits.id, id)).for("update");
  if (!u) throw notFound("Единица оборудования не найдена");
  return u;
}

async function getTicket(tx: Dbx, id: number) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, id));
  if (!t) throw notFound("Заявка не найдена");
  return t;
}

/** Место хранения серийной единицы по её полям. */
function unitLoc(u: { locationType: string; warehouseId: number | null; teamId: number | null }): Loc | null {
  if (u.locationType === "team" && u.teamId) return locTeam(u.teamId);
  if (u.locationType === "warehouse") return locWarehouse(u.warehouseId ?? 0);
  return null;
}

/**
 * Изменение количественного остатка. Строка остатка сначала гарантированно создаётся,
 * затем блокируется (SELECT … FOR UPDATE): две параллельные выдачи одной позиции
 * не могут прочитать одно и то же значение и увести остаток в минус.
 */
async function adjustBalance(tx: Tx, catalogItemId: number, loc: Loc, delta: number) {
  await tx
    .insert(stockBalances)
    .values({ catalogItemId, locationType: loc.type, teamId: loc.teamId, warehouseId: loc.warehouseId, quantity: "0" })
    .onConflictDoNothing({ target: [stockBalances.catalogItemId, stockBalances.locationType, stockBalances.teamId, stockBalances.warehouseId] });

  const [row] = await tx
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.catalogItemId, catalogItemId),
        eq(stockBalances.locationType, loc.type),
        eq(stockBalances.teamId, loc.teamId),
        eq(stockBalances.warehouseId, loc.warehouseId),
      ),
    )
    .for("update");

  const current = Number(row.quantity);
  const next = current + delta;
  if (next < -1e-9) throw conflict(`Недостаточно остатка: доступно ${current}, требуется ${-delta}`);
  await tx.update(stockBalances).set({ quantity: String(next), updatedAt: new Date() }).where(eq(stockBalances.id, row.id));
}

type TxInsert = typeof stockTransactions.$inferInsert;
async function logTx(tx: Tx, v: TxInsert) {
  const [row] = await tx.insert(stockTransactions).values(v).returning();
  return row;
}

const locFields = (from: Loc | null, to: Loc | null): Partial<TxInsert> => ({
  fromLocationType: from?.type,
  fromTeamId: from?.type === "team" ? from.teamId : undefined,
  fromWarehouseId: from?.type === "warehouse" ? from.warehouseId : undefined,
  toLocationType: to?.type,
  toTeamId: to?.type === "team" ? to.teamId : undefined,
  toWarehouseId: to?.type === "warehouse" ? to.warehouseId : undefined,
});

/** Поля единицы для места хранения. */
const unitPlace = (loc: Loc) =>
  loc.type === "team"
    ? { status: "at_team" as const, locationType: "team" as const, teamId: loc.teamId, warehouseId: null }
    : { status: "in_warehouse" as const, locationType: "warehouse" as const, teamId: null, warehouseId: loc.warehouseId };

// ─────────────── ДОКУМЕНТЫ ───────────────

/** Следующий номер документа по типу: ПН-000001, ПМ-000001, СП-000001. */
async function nextDocNumber(tx: Tx, type: StockDocType) {
  const prefix = DOC_PREFIX[type];
  const res = await tx.execute(
    sql`select coalesce(max(nullif(regexp_replace(number, '[^0-9]', '', 'g'), '')::bigint), 0) as n from stock_documents where type = ${type} and number like ${prefix + "-%"}`,
  );
  const r = (res.rows?.[0] ?? {}) as { n?: string | number };
  const n = Number(r.n ?? 0) + 1;
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

export type DocLineInput = {
  catalogItemId?: number | null;
  quantity?: number;
  /** Серийные номера для приёмки серийного оборудования. */
  units?: { serialNumber: string; macAddress?: string | null }[];
  /** Существующие серийные единицы (перемещение/списание). */
  unitIds?: number[];
  price?: number | null;
  note?: string | null;
};

async function createDoc(
  tx: Tx,
  input: {
    type: StockDocType;
    number?: string | null;
    externalNumber?: string | null;
    docDate?: Date | null;
    fromWarehouseId?: number | null;
    toWarehouseId?: number | null;
    supplier?: string | null;
    note?: string | null;
    actorId: number;
  },
) {
  const number = input.number?.trim() || (await nextDocNumber(tx, input.type));
  const [dup] = await tx.select({ id: stockDocuments.id }).from(stockDocuments).where(and(eq(stockDocuments.type, input.type), eq(stockDocuments.number, number)));
  if (dup) throw conflict(`Документ с номером ${number} уже есть`);
  const [doc] = await tx
    .insert(stockDocuments)
    .values({
      type: input.type,
      number,
      externalNumber: input.externalNumber ?? null,
      docDate: input.docDate ?? new Date(),
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      supplier: input.supplier ?? null,
      note: input.note ?? null,
      actorId: input.actorId,
    })
    .returning();
  return doc;
}

async function finalizeDoc(tx: Tx, docId: number, linesCount: number, totalQuantity: number) {
  await tx.update(stockDocuments).set({ linesCount, totalQuantity: String(totalQuantity) }).where(eq(stockDocuments.id, docId));
  const [doc] = await tx.select().from(stockDocuments).where(eq(stockDocuments.id, docId));
  return doc;
}

/**
 * Поступление (партия): несколько позиций на указанный склад одним документом.
 * Серийные позиции — со списком S/N, количественные — с количеством.
 */
export async function receiveDocument(input: {
  toWarehouseId?: number;
  number?: string | null;
  externalNumber?: string | null;
  docDate?: Date | null;
  supplier?: string | null;
  note?: string | null;
  lines: DocLineInput[];
  actorId: number;
}) {
  await ensureWarehouses();
  if (!input.lines?.length) throw badRequest("Добавьте хотя бы одну позицию");
  const toWh = input.toWarehouseId ? await locById(input.toWarehouseId) : locOf(await getCentralWarehouse());
  const toWarehouseId = input.toWarehouseId ?? (await getCentralWarehouse()).id;
  return db.transaction(async (tx) => {
    const doc = await createDoc(tx, { type: "receipt", number: input.number, externalNumber: input.externalNumber, docDate: input.docDate, toWarehouseId, supplier: input.supplier, note: input.note, actorId: input.actorId });
    let total = 0;
    let lineNo = 0;
    const createdUnits: (typeof equipmentUnits.$inferSelect)[] = [];
    for (const line of input.lines) {
      const item = await getItem(tx, Number(line.catalogItemId));
      lineNo++;
      if (item.isSerialized) {
        const list = line.units ?? [];
        if (!list.length) throw badRequest(`«${item.name}»: для серийного оборудования укажите серийные номера`);
        for (const u of list) {
          const sn = u.serialNumber.trim();
          if (!sn) throw badRequest("Пустой серийный номер");
          const [unit] = await tx
            .insert(equipmentUnits)
            .values({ catalogItemId: item.id, serialNumber: sn, macAddress: u.macAddress || null, ...unitPlace(toWh), receiptDocumentId: doc.id })
            .returning();
          await logTx(tx, { type: "receive", catalogItemId: item.id, unitId: unit.id, quantity: "1", ...locFields(null, toWh), teamId: toWh.type === "team" ? toWh.teamId : undefined, documentId: doc.id, actorId: input.actorId, note: input.note ?? undefined });
          createdUnits.push(unit);
        }
        await tx.insert(stockDocumentLines).values({ documentId: doc.id, lineNo, catalogItemId: item.id, quantity: String(list.length), serialNumbers: list.map((u) => u.serialNumber.trim()), price: line.price != null ? String(line.price) : null, note: line.note ?? null });
        total += list.length;
      } else {
        const qty = Number(line.quantity);
        if (!(qty > 0)) throw badRequest(`«${item.name}»: количество должно быть > 0`);
        await adjustBalance(tx, item.id, toWh, qty);
        await logTx(tx, { type: "receive", catalogItemId: item.id, quantity: String(qty), ...locFields(null, toWh), teamId: toWh.type === "team" ? toWh.teamId : undefined, documentId: doc.id, actorId: input.actorId, note: input.note ?? undefined });
        await tx.insert(stockDocumentLines).values({ documentId: doc.id, lineNo, catalogItemId: item.id, quantity: String(qty), price: line.price != null ? String(line.price) : null, note: line.note ?? null });
        total += qty;
      }
    }
    const final = await finalizeDoc(tx, doc.id, lineNo, total);
    return { document: final, units: createdUnits };
  });
}

/** Перемещение единицы между местами хранения (внутри транзакции). */
async function moveUnit(tx: Tx, unitId: number, from: Loc, to: Loc) {
  const unit = await getUnit(tx, unitId);
  const cur = unitLoc(unit);
  if (!["in_warehouse", "at_team"].includes(unit.status) || !cur) throw conflict(`Единица ${unit.serialNumber} недоступна для перемещения (${unit.status})`);
  if (!sameLoc(cur, from)) throw conflict(`Единица ${unit.serialNumber} не находится на исходном складе`);
  await tx.update(equipmentUnits).set({ ...unitPlace(to), updatedAt: new Date() }).where(eq(equipmentUnits.id, unit.id));
  return unit;
}

/**
 * Перемещение между складами (в т.ч. на склад бригады и обратно) — документ с номером и датой.
 * Строки: серийные единицы (unitIds) или количество материала.
 */
export async function transferDocument(input: {
  fromWarehouseId: number;
  toWarehouseId: number;
  number?: string | null;
  docDate?: Date | null;
  note?: string | null;
  lines: DocLineInput[];
  actorId: number;
}) {
  await ensureWarehouses();
  if (!input.lines?.length) throw badRequest("Добавьте хотя бы одну позицию");
  if (input.fromWarehouseId === input.toWarehouseId) throw badRequest("Склад-отправитель и склад-получатель совпадают");
  const from = await locById(input.fromWarehouseId);
  const to = await locById(input.toWarehouseId);
  const teamId = to.type === "team" ? to.teamId : from.type === "team" ? from.teamId : undefined;
  return db.transaction(async (tx) => {
    const doc = await createDoc(tx, { type: "transfer", number: input.number, docDate: input.docDate, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, note: input.note, actorId: input.actorId });
    let total = 0;
    let lineNo = 0;
    for (const line of input.lines) {
      if (line.unitIds?.length) {
        const serials: string[] = [];
        let itemId = line.catalogItemId ?? 0;
        for (const uid of line.unitIds) {
          const unit = await moveUnit(tx, uid, from, to);
          itemId = unit.catalogItemId;
          serials.push(unit.serialNumber);
          await logTx(tx, { type: "transfer", catalogItemId: unit.catalogItemId, unitId: unit.id, quantity: "1", ...locFields(from, to), teamId, documentId: doc.id, actorId: input.actorId, note: input.note ?? undefined });
        }
        lineNo++;
        await tx.insert(stockDocumentLines).values({ documentId: doc.id, lineNo, catalogItemId: itemId, quantity: String(serials.length), serialNumbers: serials, note: line.note ?? null });
        total += serials.length;
        continue;
      }
      const item = await getItem(tx, Number(line.catalogItemId));
      if (item.isSerialized) throw badRequest(`«${item.name}»: выберите конкретные серийные единицы`);
      const qty = Number(line.quantity);
      if (!(qty > 0)) throw badRequest(`«${item.name}»: количество должно быть > 0`);
      await adjustBalance(tx, item.id, from, -qty);
      await adjustBalance(tx, item.id, to, qty);
      await logTx(tx, { type: "transfer", catalogItemId: item.id, quantity: String(qty), ...locFields(from, to), teamId, documentId: doc.id, actorId: input.actorId, note: input.note ?? undefined });
      lineNo++;
      await tx.insert(stockDocumentLines).values({ documentId: doc.id, lineNo, catalogItemId: item.id, quantity: String(qty), note: line.note ?? null });
      total += qty;
    }
    return { document: await finalizeDoc(tx, doc.id, lineNo, total) };
  });
}

/** Списание (брак/утеря) со склада — документ с номером и датой. */
export async function writeOffDocument(input: {
  fromWarehouseId?: number;
  number?: string | null;
  docDate?: Date | null;
  note?: string | null;
  lines: DocLineInput[];
  actorId: number;
}) {
  await ensureWarehouses();
  if (!input.lines?.length) throw badRequest("Добавьте хотя бы одну позицию");
  const fromWarehouseId = input.fromWarehouseId ?? (await getCentralWarehouse()).id;
  const from = await locById(fromWarehouseId);
  return db.transaction(async (tx) => {
    const doc = await createDoc(tx, { type: "writeoff", number: input.number, docDate: input.docDate, fromWarehouseId, note: input.note, actorId: input.actorId });
    let total = 0;
    let lineNo = 0;
    for (const line of input.lines) {
      if (line.unitIds?.length) {
        const serials: string[] = [];
        let itemId = line.catalogItemId ?? 0;
        for (const uid of line.unitIds) {
          const unit = await getUnit(tx, uid);
          const cur = unitLoc(unit);
          if (!["in_warehouse", "at_team"].includes(unit.status) || !cur) throw conflict(`Списать можно только свободную единицу (${unit.serialNumber})`);
          if (!sameLoc(cur, from)) throw conflict(`Единица ${unit.serialNumber} не находится на выбранном складе`);
          await tx.update(equipmentUnits).set({ status: "written_off", updatedAt: new Date() }).where(eq(equipmentUnits.id, unit.id));
          itemId = unit.catalogItemId;
          serials.push(unit.serialNumber);
          await logTx(tx, { type: "write_off", catalogItemId: unit.catalogItemId, unitId: unit.id, quantity: "1", ...locFields(from, null), teamId: unit.teamId, documentId: doc.id, actorId: input.actorId, note: input.note ?? undefined });
        }
        lineNo++;
        await tx.insert(stockDocumentLines).values({ documentId: doc.id, lineNo, catalogItemId: itemId, quantity: String(serials.length), serialNumbers: serials, note: line.note ?? null });
        total += serials.length;
        continue;
      }
      const item = await getItem(tx, Number(line.catalogItemId));
      const qty = Number(line.quantity);
      if (!(qty > 0)) throw badRequest(`«${item.name}»: количество должно быть > 0`);
      await adjustBalance(tx, item.id, from, -qty);
      await logTx(tx, { type: "write_off", catalogItemId: item.id, quantity: String(qty), ...locFields(from, null), teamId: from.type === "team" ? from.teamId : undefined, documentId: doc.id, actorId: input.actorId, note: input.note ?? undefined });
      lineNo++;
      await tx.insert(stockDocumentLines).values({ documentId: doc.id, lineNo, catalogItemId: item.id, quantity: String(qty), note: line.note ?? null });
      total += qty;
    }
    return { document: await finalizeDoc(tx, doc.id, lineNo, total) };
  });
}

// ─────────────── СОВМЕСТИМЫЕ ОБЁРТКИ (сид, старые роуты) ───────────────

/** Поступление одной позиции на центральный склад (одна строка документа). */
export async function receive(input: { catalogItemId: number; quantity?: number; units?: { serialNumber: string; macAddress?: string | null }[]; actorId: number; note?: string; toWarehouseId?: number }) {
  const r = await receiveDocument({ toWarehouseId: input.toWarehouseId, note: input.note, actorId: input.actorId, lines: [{ catalogItemId: input.catalogItemId, quantity: input.quantity, units: input.units }] });
  return { units: r.units, document: r.document };
}

/** Отгрузка бригаде = перемещение с центрального склада на склад бригады. */
export async function issueToTeam(input: { catalogItemId?: number; unitId?: number; teamId: number; quantity?: number; actorId: number; note?: string; fromWarehouseId?: number }) {
  const from = input.fromWarehouseId ?? (await getCentralWarehouse()).id;
  const to = (await teamWarehouse(input.teamId)).id;
  return transferDocument({ fromWarehouseId: from, toWarehouseId: to, note: input.note, actorId: input.actorId, lines: [input.unitId ? { unitIds: [input.unitId] } : { catalogItemId: input.catalogItemId, quantity: input.quantity }] });
}

/** Возврат от бригады = перемещение со склада бригады на центральный склад. */
export async function returnToWarehouse(input: { catalogItemId?: number; unitId?: number; teamId: number; quantity?: number; actorId: number; note?: string; toWarehouseId?: number }) {
  const from = (await teamWarehouse(input.teamId)).id;
  const to = input.toWarehouseId ?? (await getCentralWarehouse()).id;
  return transferDocument({ fromWarehouseId: from, toWarehouseId: to, note: input.note, actorId: input.actorId, lines: [input.unitId ? { unitIds: [input.unitId] } : { catalogItemId: input.catalogItemId, quantity: input.quantity }] });
}

/** Списание одной позиции (со склада или от бригады). */
export async function writeOff(input: { catalogItemId?: number; unitId?: number; teamId?: number; warehouseId?: number; quantity?: number; actorId: number; note?: string }) {
  let fromWarehouseId = input.warehouseId;
  if (!fromWarehouseId && input.teamId) fromWarehouseId = (await teamWarehouse(input.teamId)).id;
  if (!fromWarehouseId && input.unitId) {
    const [u] = await db.select().from(equipmentUnits).where(eq(equipmentUnits.id, input.unitId));
    if (u?.locationType === "team" && u.teamId) fromWarehouseId = (await teamWarehouse(u.teamId)).id;
    else if (u?.warehouseId) fromWarehouseId = u.warehouseId;
  }
  return writeOffDocument({ fromWarehouseId, note: input.note, actorId: input.actorId, lines: [input.unitId ? { unitIds: [input.unitId] } : { catalogItemId: input.catalogItemId, quantity: input.quantity }] });
}

// ─────────────── РЕЗЕРВ / УСТАНОВКА ───────────────

/** Резервирование под заявку из остатков бригады заявки (или со склада). */
export async function reserve(input: { ticketId: number; catalogItemId?: number; unitId?: number; quantity?: number; fromWarehouse?: boolean; warehouseId?: number; actorId: number; note?: string }) {
  await ensureWarehouses();
  const central = await getCentralWarehouse();
  return db.transaction(async (tx) => {
    const ticket = await getTicket(tx, input.ticketId);
    if (["closed", "cancelled", "done"].includes(ticket.status)) throw conflict("Заявка завершена");
    let loc: Loc;
    if (input.fromWarehouse || input.warehouseId) loc = locWarehouse(input.warehouseId ?? central.id);
    else {
      if (!ticket.teamId) throw conflict("Заявке не назначена бригада — резерв из остатков бригады невозможен");
      loc = locTeam(ticket.teamId);
    }

    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      const cur = unitLoc(unit);
      const okState = cur && sameLoc(cur, loc) && ["at_team", "in_warehouse"].includes(unit.status);
      if (!okState) throw conflict("Единица недоступна для резерва из указанного места");
      await tx.update(equipmentUnits).set({ status: "reserved", ticketId: ticket.id, updatedAt: new Date() }).where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, { type: "reserve", catalogItemId: unit.catalogItemId, unitId: unit.id, quantity: "1", ...locFields(loc, null), teamId: ticket.teamId, ticketId: ticket.id, clientId: ticket.clientId, siteId: ticket.siteId, actorId: input.actorId, note: input.note });
    }
    const item = await getItem(tx, Number(input.catalogItemId));
    if (item.isSerialized) throw badRequest("Для серийного оборудования укажите unitId");
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw badRequest("Количество должно быть > 0");
    await adjustBalance(tx, item.id, loc, -qty);
    await tx.insert(stockReservations).values({ catalogItemId: item.id, ticketId: ticket.id, locationType: loc.type, teamId: loc.teamId, warehouseId: loc.warehouseId, quantity: String(qty), createdBy: input.actorId });
    return logTx(tx, { type: "reserve", catalogItemId: item.id, quantity: String(qty), ...locFields(loc, null), teamId: ticket.teamId, ticketId: ticket.id, clientId: ticket.clientId, siteId: ticket.siteId, actorId: input.actorId, note: input.note });
  });
}

/** Снятие резерва. */
export async function unreserve(input: { reservationId?: number; unitId?: number; actorId: number }) {
  return db.transaction(async (tx) => {
    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      if (unit.status !== "reserved") throw conflict("Единица не зарезервирована");
      const back = unitLoc(unit) ?? locWarehouse((await getCentralWarehouse()).id);
      const ticket = unit.ticketId ? await getTicket(tx, unit.ticketId) : null;
      await tx.update(equipmentUnits).set({ ...unitPlace(back), ticketId: null, updatedAt: new Date() }).where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, { type: "unreserve", catalogItemId: unit.catalogItemId, unitId: unit.id, quantity: "1", ...locFields(null, back), teamId: unit.teamId, ticketId: unit.ticketId, clientId: ticket?.clientId, siteId: ticket?.siteId, actorId: input.actorId });
    }
    const [r] = await tx.select().from(stockReservations).where(eq(stockReservations.id, Number(input.reservationId)));
    if (!r) throw notFound("Резерв не найден");
    if (r.status !== "active") throw conflict("Резерв уже неактивен");
    const ticket = await getTicket(tx, r.ticketId);
    const loc: Loc = r.locationType === "team" ? locTeam(r.teamId) : locWarehouse(r.warehouseId);
    await tx.update(stockReservations).set({ status: "cancelled" }).where(eq(stockReservations.id, r.id));
    await adjustBalance(tx, r.catalogItemId, loc, Number(r.quantity));
    return logTx(tx, { type: "unreserve", catalogItemId: r.catalogItemId, quantity: r.quantity, ...locFields(null, loc), teamId: ticket.teamId, ticketId: ticket.id, clientId: ticket.clientId, siteId: ticket.siteId, actorId: input.actorId });
  });
}

/**
 * Установка на объекте в рамках заявки. Списывает: сначала активный резерв, затем свободные остатки бригады.
 * Для серийной единицы — из статуса reserved (под эту заявку) или at_team (бригада заявки).
 */
export async function install(input: { ticketId: number; catalogItemId?: number; unitId?: number; quantity?: number; actorId: number; note?: string }) {
  return db.transaction(async (tx) => {
    const ticket = await getTicket(tx, input.ticketId);
    if (["closed", "cancelled"].includes(ticket.status)) throw conflict("Заявка закрыта");
    if (!ticket.teamId) throw conflict("Заявке не назначена бригада");
    const teamLoc = locTeam(ticket.teamId);

    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      const fromReserve = unit.status === "reserved" && unit.ticketId === ticket.id;
      const fromTeam = unit.status === "at_team" && unit.teamId === ticket.teamId;
      if (!fromReserve && !fromTeam) throw conflict("Единица не числится за бригадой заявки и не зарезервирована под неё");
      const from = unitLoc(unit) ?? teamLoc;
      await tx
        .update(equipmentUnits)
        .set({ status: "installed", locationType: "site", siteId: ticket.siteId, ticketId: ticket.id, installedAt: new Date(), updatedAt: new Date() })
        .where(eq(equipmentUnits.id, unit.id));
      await tx.insert(ticketMaterials).values({ ticketId: ticket.id, siteId: ticket.siteId, catalogItemId: unit.catalogItemId, unitId: unit.id, quantity: "1", installedBy: input.actorId, note: input.note });
      return logTx(tx, { type: "install", catalogItemId: unit.catalogItemId, unitId: unit.id, quantity: "1", ...locFields(from, null), toLocationType: "site", teamId: ticket.teamId, ticketId: ticket.id, clientId: ticket.clientId, siteId: ticket.siteId, actorId: input.actorId, note: input.note });
    }

    const item = await getItem(tx, Number(input.catalogItemId));
    if (item.isSerialized) throw badRequest("Для серийного оборудования укажите unitId");
    let remaining = Number(input.quantity);
    if (!(remaining > 0)) throw badRequest("Количество должно быть > 0");

    const reservations = await tx
      .select()
      .from(stockReservations)
      .where(and(eq(stockReservations.ticketId, ticket.id), eq(stockReservations.catalogItemId, item.id), eq(stockReservations.status, "active")));
    for (const r of reservations) {
      if (remaining <= 0) break;
      const rq = Number(r.quantity);
      if (rq <= remaining) {
        await tx.update(stockReservations).set({ status: "consumed" }).where(eq(stockReservations.id, r.id));
        remaining -= rq;
      } else {
        await tx.update(stockReservations).set({ quantity: String(rq - remaining) }).where(eq(stockReservations.id, r.id));
        remaining = 0;
      }
    }
    if (remaining > 0) await adjustBalance(tx, item.id, teamLoc, -remaining);

    const qty = Number(input.quantity);
    await tx.insert(ticketMaterials).values({ ticketId: ticket.id, siteId: ticket.siteId, catalogItemId: item.id, quantity: String(qty), installedBy: input.actorId, note: input.note });
    return logTx(tx, { type: "install", catalogItemId: item.id, quantity: String(qty), ...locFields(teamLoc, null), toLocationType: "site", teamId: ticket.teamId, ticketId: ticket.id, clientId: ticket.clientId, siteId: ticket.siteId, actorId: input.actorId, note: input.note });
  });
}

// ─────────────── ЗАПРОСЫ ───────────────

/**
 * Остатки по месту хранения: количественные + серийные единицы + активные резервы.
 * getStock("warehouse", warehouseId) — склад (0 = центральный); getStock("team", teamId) — бригада.
 */
export async function getStock(locationType: "warehouse" | "team", id = 0) {
  await ensureWarehouses();
  const loc: Loc = locationType === "team" ? locTeam(id) : locWarehouse(id || (await getCentralWarehouse()).id);
  return getStockAt(loc);
}

/** Остатки склада из справочника (склад бригады → остатки бригады). */
export async function getStockByWarehouse(warehouseId: number) {
  await ensureWarehouses();
  return getStockAt(await locById(warehouseId));
}

export async function getStockAt(loc: Loc) {
  const balances = await db
    .select({
      catalogItemId: stockBalances.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      unit: catalogItems.unit,
      category: catalogCategories.name,
      categoryId: catalogItems.categoryId,
      quantity: stockBalances.quantity,
    })
    .from(stockBalances)
    .innerJoin(catalogItems, eq(catalogItems.id, stockBalances.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .where(and(eq(stockBalances.locationType, loc.type), eq(stockBalances.teamId, loc.teamId), eq(stockBalances.warehouseId, loc.warehouseId), sql`${stockBalances.quantity} <> 0`))
    .orderBy(catalogItems.name);

  const unitWhere =
    loc.type === "warehouse"
      ? and(eq(equipmentUnits.locationType, "warehouse"), eq(equipmentUnits.warehouseId, loc.warehouseId), inArray(equipmentUnits.status, ["in_warehouse", "reserved"]))
      : and(eq(equipmentUnits.teamId, loc.teamId), inArray(equipmentUnits.status, ["at_team", "reserved"]));
  const units = await db
    .select({
      id: equipmentUnits.id,
      catalogItemId: equipmentUnits.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      category: catalogCategories.name,
      categoryId: catalogItems.categoryId,
      serialNumber: equipmentUnits.serialNumber,
      macAddress: equipmentUnits.macAddress,
      status: equipmentUnits.status,
      ticketId: equipmentUnits.ticketId,
      teamId: equipmentUnits.teamId,
      receiptDocumentId: equipmentUnits.receiptDocumentId,
      receiptNumber: stockDocuments.number,
      receiptDate: stockDocuments.docDate,
    })
    .from(equipmentUnits)
    .innerJoin(catalogItems, eq(catalogItems.id, equipmentUnits.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .leftJoin(stockDocuments, eq(stockDocuments.id, equipmentUnits.receiptDocumentId))
    .where(unitWhere)
    .orderBy(catalogItems.name, equipmentUnits.serialNumber);

  const reservations = await db
    .select({
      id: stockReservations.id,
      catalogItemId: stockReservations.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      unit: catalogItems.unit,
      quantity: stockReservations.quantity,
      ticketId: stockReservations.ticketId,
      ticketNumber: tickets.number,
      ticketTitle: tickets.title,
    })
    .from(stockReservations)
    .innerJoin(catalogItems, eq(catalogItems.id, stockReservations.catalogItemId))
    .innerJoin(tickets, eq(tickets.id, stockReservations.ticketId))
    .where(and(eq(stockReservations.locationType, loc.type), eq(stockReservations.teamId, loc.teamId), eq(stockReservations.warehouseId, loc.warehouseId), eq(stockReservations.status, "active")));

  return { loc, balances, units, reservations };
}

/** Сводка остатков по всем складам: позиций материалов и серийных единиц. */
export async function warehousesSummary() {
  await ensureWarehouses();
  const whs = await db.select().from(warehouses).where(eq(warehouses.isActive, true)).orderBy(warehouses.sortOrder, warehouses.name);
  const bal = await db
    .select({ lt: stockBalances.locationType, teamId: stockBalances.teamId, whId: stockBalances.warehouseId, n: sql<number>`count(*)::int`, q: sql<string>`coalesce(sum(${stockBalances.quantity}),0)` })
    .from(stockBalances)
    .where(sql`${stockBalances.quantity} > 0`)
    .groupBy(stockBalances.locationType, stockBalances.teamId, stockBalances.warehouseId);
  const un = await db
    .select({ lt: equipmentUnits.locationType, teamId: equipmentUnits.teamId, whId: equipmentUnits.warehouseId, status: equipmentUnits.status, n: sql<number>`count(*)::int` })
    .from(equipmentUnits)
    .where(inArray(equipmentUnits.status, ["in_warehouse", "at_team", "reserved"]))
    .groupBy(equipmentUnits.locationType, equipmentUnits.teamId, equipmentUnits.warehouseId, equipmentUnits.status);
  return whs.map((w) => {
    const isTeam = w.kind === "team" && w.teamId;
    const b = bal.filter((r) => (isTeam ? r.lt === "team" && r.teamId === w.teamId : r.lt === "warehouse" && r.whId === w.id));
    const u = un.filter((r) => (isTeam ? r.lt === "team" && r.teamId === w.teamId : r.lt === "warehouse" && r.whId === w.id));
    return {
      ...w,
      materialItems: b.reduce((a, r) => a + r.n, 0),
      unitsFree: u.filter((r) => r.status !== "reserved").reduce((a, r) => a + r.n, 0),
      unitsReserved: u.filter((r) => r.status === "reserved").reduce((a, r) => a + r.n, 0),
    };
  });
}

/** Остатки по всем местам для «Номенклатуры»: позиция → суммарно на складах / у бригад. */
export async function itemAvailability() {
  const rows = await db
    .select({ catalogItemId: stockBalances.catalogItemId, lt: stockBalances.locationType, q: sql<string>`coalesce(sum(${stockBalances.quantity}),0)` })
    .from(stockBalances)
    .groupBy(stockBalances.catalogItemId, stockBalances.locationType);
  const units = await db
    .select({ catalogItemId: equipmentUnits.catalogItemId, status: equipmentUnits.status, n: sql<number>`count(*)::int` })
    .from(equipmentUnits)
    .groupBy(equipmentUnits.catalogItemId, equipmentUnits.status);
  const map = new Map<number, { qtyWarehouse: number; qtyTeams: number; unitsWarehouse: number; unitsTeam: number; unitsInstalled: number }>();
  const get = (id: number) => {
    let v = map.get(id);
    if (!v) map.set(id, (v = { qtyWarehouse: 0, qtyTeams: 0, unitsWarehouse: 0, unitsTeam: 0, unitsInstalled: 0 }));
    return v;
  };
  for (const r of rows) {
    if (r.lt === "warehouse") get(r.catalogItemId).qtyWarehouse += Number(r.q);
    else if (r.lt === "team") get(r.catalogItemId).qtyTeams += Number(r.q);
  }
  for (const u of units) {
    const v = get(u.catalogItemId);
    if (u.status === "in_warehouse") v.unitsWarehouse += u.n;
    else if (u.status === "at_team" || u.status === "reserved") v.unitsTeam += u.n;
    else if (u.status === "installed") v.unitsInstalled += u.n;
  }
  return map;
}

export const getUnitHistory = (unitId: number) => getUnitDetails(unitId);

export async function getUnitDetails(unitId: number) {
  const [unit] = await db
    .select({
      id: equipmentUnits.id,
      serialNumber: equipmentUnits.serialNumber,
      macAddress: equipmentUnits.macAddress,
      status: equipmentUnits.status,
      locationType: equipmentUnits.locationType,
      warehouseId: equipmentUnits.warehouseId,
      warehouseName: warehouses.name,
      teamId: equipmentUnits.teamId,
      teamName: teams.name,
      siteId: equipmentUnits.siteId,
      siteName: sites.name,
      siteAddress: sites.address,
      clientName: clients.name,
      ticketId: equipmentUnits.ticketId,
      installedAt: equipmentUnits.installedAt,
      createdAt: equipmentUnits.createdAt,
      notes: equipmentUnits.notes,
      receiptDocumentId: equipmentUnits.receiptDocumentId,
      receiptNumber: stockDocuments.number,
      receiptDate: stockDocuments.docDate,
      catalogItemId: catalogItems.id,
      sku: catalogItems.sku,
      name: catalogItems.name,
      category: catalogCategories.name,
      manufacturer: catalogItems.manufacturer,
    })
    .from(equipmentUnits)
    .innerJoin(catalogItems, eq(catalogItems.id, equipmentUnits.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .leftJoin(teams, eq(teams.id, equipmentUnits.teamId))
    .leftJoin(warehouses, eq(warehouses.id, equipmentUnits.warehouseId))
    .leftJoin(sites, eq(sites.id, equipmentUnits.siteId))
    .leftJoin(clients, eq(clients.id, sites.clientId))
    .leftJoin(stockDocuments, eq(stockDocuments.id, equipmentUnits.receiptDocumentId))
    .where(eq(equipmentUnits.id, unitId));
  if (!unit) return null;
  const history = await listTransactions({ unitId });
  return { unit, history };
}

export async function listTransactions(filter: { unitId?: number; ticketId?: number; teamId?: number; clientId?: number; catalogItemId?: number; warehouseId?: number; documentId?: number; type?: string; limit?: number }) {
  const conds = [];
  if (filter.unitId) conds.push(eq(stockTransactions.unitId, filter.unitId));
  if (filter.ticketId) conds.push(eq(stockTransactions.ticketId, filter.ticketId));
  if (filter.teamId) conds.push(eq(stockTransactions.teamId, filter.teamId));
  if (filter.clientId) conds.push(eq(stockTransactions.clientId, filter.clientId));
  if (filter.catalogItemId) conds.push(eq(stockTransactions.catalogItemId, filter.catalogItemId));
  if (filter.documentId) conds.push(eq(stockTransactions.documentId, filter.documentId));
  if (filter.warehouseId) conds.push(or(eq(stockTransactions.fromWarehouseId, filter.warehouseId), eq(stockTransactions.toWarehouseId, filter.warehouseId))!);
  if (filter.type) conds.push(eq(stockTransactions.type, filter.type as TxInsert["type"]));
  const toTeam = sql<string | null>`(select name from teams where id = ${stockTransactions.toTeamId})`;
  const fromTeam = sql<string | null>`(select name from teams where id = ${stockTransactions.fromTeamId})`;
  const toWh = sql<string | null>`(select name from warehouses where id = ${stockTransactions.toWarehouseId})`;
  const fromWh = sql<string | null>`(select name from warehouses where id = ${stockTransactions.fromWarehouseId})`;
  return db
    .select({
      id: stockTransactions.id,
      type: stockTransactions.type,
      quantity: stockTransactions.quantity,
      createdAt: stockTransactions.createdAt,
      note: stockTransactions.note,
      catalogItemId: stockTransactions.catalogItemId,
      sku: catalogItems.sku,
      itemName: catalogItems.name,
      unit: catalogItems.unit,
      unitId: stockTransactions.unitId,
      serialNumber: equipmentUnits.serialNumber,
      fromLocationType: stockTransactions.fromLocationType,
      toLocationType: stockTransactions.toLocationType,
      fromTeamName: fromTeam,
      toTeamName: toTeam,
      fromWarehouseName: fromWh,
      toWarehouseName: toWh,
      documentId: stockTransactions.documentId,
      documentNumber: stockDocuments.number,
      documentType: stockDocuments.type,
      teamId: stockTransactions.teamId,
      teamName: teams.name,
      ticketId: stockTransactions.ticketId,
      ticketNumber: tickets.number,
      clientId: stockTransactions.clientId,
      clientName: clients.name,
      siteId: stockTransactions.siteId,
      siteName: sites.name,
      actorId: stockTransactions.actorId,
      actorName: users.fullName,
    })
    .from(stockTransactions)
    .innerJoin(catalogItems, eq(catalogItems.id, stockTransactions.catalogItemId))
    .leftJoin(equipmentUnits, eq(equipmentUnits.id, stockTransactions.unitId))
    .leftJoin(stockDocuments, eq(stockDocuments.id, stockTransactions.documentId))
    .leftJoin(teams, eq(teams.id, stockTransactions.teamId))
    .leftJoin(tickets, eq(tickets.id, stockTransactions.ticketId))
    .leftJoin(clients, eq(clients.id, stockTransactions.clientId))
    .leftJoin(sites, eq(sites.id, stockTransactions.siteId))
    .leftJoin(users, eq(users.id, stockTransactions.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockTransactions.createdAt), desc(stockTransactions.id))
    .limit(filter.limit ?? 300);
}

/** Журнал складских документов с фильтрами по типу, складу, периоду и номеру. */
export async function listDocuments(filter: { type?: string; warehouseId?: number; from?: Date | null; to?: Date | null; q?: string; limit?: number } = {}) {
  const conds = [];
  if (filter.type) conds.push(eq(stockDocuments.type, filter.type as StockDocType));
  if (filter.warehouseId) conds.push(or(eq(stockDocuments.fromWarehouseId, filter.warehouseId), eq(stockDocuments.toWarehouseId, filter.warehouseId))!);
  if (filter.from) conds.push(gte(stockDocuments.docDate, filter.from));
  if (filter.to) conds.push(lte(stockDocuments.docDate, filter.to));
  if (filter.q) conds.push(or(ilike(stockDocuments.number, `%${filter.q}%`), ilike(stockDocuments.externalNumber, `%${filter.q}%`), ilike(stockDocuments.supplier, `%${filter.q}%`))!);
  const fromWh = sql<string | null>`(select name from warehouses where id = ${stockDocuments.fromWarehouseId})`;
  const toWh = sql<string | null>`(select name from warehouses where id = ${stockDocuments.toWarehouseId})`;
  return db
    .select({
      id: stockDocuments.id,
      type: stockDocuments.type,
      number: stockDocuments.number,
      externalNumber: stockDocuments.externalNumber,
      docDate: stockDocuments.docDate,
      fromWarehouseId: stockDocuments.fromWarehouseId,
      toWarehouseId: stockDocuments.toWarehouseId,
      fromWarehouseName: fromWh,
      toWarehouseName: toWh,
      supplier: stockDocuments.supplier,
      note: stockDocuments.note,
      linesCount: stockDocuments.linesCount,
      totalQuantity: stockDocuments.totalQuantity,
      actorName: users.fullName,
      createdAt: stockDocuments.createdAt,
    })
    .from(stockDocuments)
    .leftJoin(users, eq(users.id, stockDocuments.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockDocuments.docDate), desc(stockDocuments.id))
    .limit(filter.limit ?? 300);
}

export async function getDocument(id: number) {
  const [doc] = await listDocuments({ limit: 1 }).then(() => db.select().from(stockDocuments).where(eq(stockDocuments.id, id)));
  if (!doc) return null;
  const [fromWh] = doc.fromWarehouseId ? await db.select().from(warehouses).where(eq(warehouses.id, doc.fromWarehouseId)) : [null];
  const [toWh] = doc.toWarehouseId ? await db.select().from(warehouses).where(eq(warehouses.id, doc.toWarehouseId)) : [null];
  const [actor] = doc.actorId ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, doc.actorId)) : [null];
  const lines = await db
    .select({
      id: stockDocumentLines.id,
      lineNo: stockDocumentLines.lineNo,
      catalogItemId: stockDocumentLines.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      unit: catalogItems.unit,
      isSerialized: catalogItems.isSerialized,
      quantity: stockDocumentLines.quantity,
      serialNumbers: stockDocumentLines.serialNumbers,
      price: stockDocumentLines.price,
      note: stockDocumentLines.note,
    })
    .from(stockDocumentLines)
    .innerJoin(catalogItems, eq(catalogItems.id, stockDocumentLines.catalogItemId))
    .where(eq(stockDocumentLines.documentId, id))
    .orderBy(stockDocumentLines.lineNo);
  const transactions = await listTransactions({ documentId: id, limit: 1000 });
  return { doc: { ...doc, fromWarehouseName: fromWh?.name ?? null, toWarehouseName: toWh?.name ?? null, actorName: actor?.fullName ?? null }, lines, transactions };
}

/** Оборудование, установленное на объекте. */
export async function getSiteEquipment(siteId: number) {
  return db
    .select({
      id: ticketMaterials.id,
      catalogItemId: ticketMaterials.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      category: catalogCategories.name,
      unit: catalogItems.unit,
      quantity: ticketMaterials.quantity,
      unitId: ticketMaterials.unitId,
      serialNumber: equipmentUnits.serialNumber,
      macAddress: equipmentUnits.macAddress,
      unitStatus: equipmentUnits.status,
      ticketId: ticketMaterials.ticketId,
      ticketNumber: tickets.number,
      installedAt: ticketMaterials.installedAt,
      installedBy: users.fullName,
    })
    .from(ticketMaterials)
    .innerJoin(catalogItems, eq(catalogItems.id, ticketMaterials.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .leftJoin(equipmentUnits, eq(equipmentUnits.id, ticketMaterials.unitId))
    .innerJoin(tickets, eq(tickets.id, ticketMaterials.ticketId))
    .leftJoin(users, eq(users.id, ticketMaterials.installedBy))
    .where(eq(ticketMaterials.siteId, siteId))
    .orderBy(desc(ticketMaterials.installedAt));
}

/** Материалы/оборудование, установленные по заявке. */
export async function getTicketMaterials(ticketId: number) {
  return db
    .select({
      id: ticketMaterials.id,
      catalogItemId: ticketMaterials.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      unit: catalogItems.unit,
      quantity: ticketMaterials.quantity,
      unitId: ticketMaterials.unitId,
      serialNumber: equipmentUnits.serialNumber,
      installedAt: ticketMaterials.installedAt,
      installedBy: users.fullName,
      note: ticketMaterials.note,
    })
    .from(ticketMaterials)
    .innerJoin(catalogItems, eq(catalogItems.id, ticketMaterials.catalogItemId))
    .leftJoin(equipmentUnits, eq(equipmentUnits.id, ticketMaterials.unitId))
    .leftJoin(users, eq(users.id, ticketMaterials.installedBy))
    .where(eq(ticketMaterials.ticketId, ticketId))
    .orderBy(desc(ticketMaterials.installedAt));
}

/** Активные резервы заявки (количественные + серийные). */
export async function getTicketReservations(ticketId: number) {
  const qty = await db
    .select({
      id: stockReservations.id,
      catalogItemId: stockReservations.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      unit: catalogItems.unit,
      quantity: stockReservations.quantity,
      locationType: stockReservations.locationType,
    })
    .from(stockReservations)
    .innerJoin(catalogItems, eq(catalogItems.id, stockReservations.catalogItemId))
    .where(and(eq(stockReservations.ticketId, ticketId), eq(stockReservations.status, "active")));
  const units = await db
    .select({
      id: equipmentUnits.id,
      catalogItemId: equipmentUnits.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      serialNumber: equipmentUnits.serialNumber,
      locationType: equipmentUnits.locationType,
    })
    .from(equipmentUnits)
    .innerJoin(catalogItems, eq(catalogItems.id, equipmentUnits.catalogItemId))
    .where(and(eq(equipmentUnits.ticketId, ticketId), eq(equipmentUnits.status, "reserved")));
  return { quantities: qty, units };
}
