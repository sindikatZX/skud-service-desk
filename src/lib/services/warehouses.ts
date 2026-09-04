import { db } from "@/db";
import { warehouses, teams, stockBalances, equipmentUnits, stockReservations, type Warehouse } from "@/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { conflict, notFound } from "@/lib/api";
import { nextCode, resolveCode } from "@/lib/codes";

/**
 * Мультисклад. Место хранения (Loc) — либо склад (warehouseId), либо бригада (teamId).
 * Для каждой бригады автоматически заводится склад вида «team»: в интерфейсе это
 * обычный склад «Бригада 1», а в остатках — location_type = team / team_id.
 */
export type Loc = { type: "warehouse"; warehouseId: number; teamId: 0 } | { type: "team"; warehouseId: 0; teamId: number };

export const locWarehouse = (warehouseId: number): Loc => ({ type: "warehouse", warehouseId, teamId: 0 });
export const locTeam = (teamId: number): Loc => ({ type: "team", warehouseId: 0, teamId });
export const sameLoc = (a: Loc, b: Loc) => a.type === b.type && a.warehouseId === b.warehouseId && a.teamId === b.teamId;

let ensured = 0;

/**
 * Гарантирует базовую структуру складов и переносит остатки старого формата
 * (склад без warehouse_id) на центральный склад. Идемпотентно, дёшево, вызывается
 * перед складскими операциями; повторно в течение минуты не выполняется.
 */
export async function ensureWarehouses(force = false) {
  if (!force && Date.now() - ensured < 60_000) return;
  const kinds = new Set((await db.select({ kind: warehouses.kind }).from(warehouses)).map((w) => w.kind));
  if (!kinds.has("central")) await db.insert(warehouses).values({ code: await nextCode("warehouses"), name: "Центральный склад", kind: "central", isSystem: true, sortOrder: 10 });
  if (!kinds.has("transit")) await db.insert(warehouses).values({ code: await nextCode("warehouses"), name: "Транзитный склад", kind: "transit", isSystem: true, sortOrder: 20 });

  // Склады бригад
  const missing = await db
    .select({ id: teams.id, name: teams.name, isActive: teams.isActive })
    .from(teams)
    .leftJoin(warehouses, eq(warehouses.teamId, teams.id))
    .where(isNull(warehouses.id));
  for (const t of missing) {
    await db
      .insert(warehouses)
      .values({ code: await nextCode("warehouses"), name: t.name, kind: "team", teamId: t.id, isSystem: true, isActive: t.isActive, sortOrder: 1000 + t.id })
      .onConflictDoNothing({ target: warehouses.teamId });
  }
  // Имя склада бригады следует за именем бригады
  await db.execute(sql`update warehouses w set name = t.name, is_active = t.is_active from teams t where w.team_id = t.id and w.kind = 'team' and (w.name <> t.name or w.is_active <> t.is_active)`);

  const central = await getCentralWarehouse();
  await db.execute(sql`update stock_balances set warehouse_id = ${central.id} where location_type = 'warehouse' and warehouse_id = 0`);
  await db.execute(sql`update stock_reservations set warehouse_id = ${central.id} where location_type = 'warehouse' and warehouse_id = 0`);
  await db.execute(sql`update equipment_units set warehouse_id = ${central.id} where location_type = 'warehouse' and warehouse_id is null`);
  ensured = Date.now();
}

export async function getCentralWarehouse(): Promise<Warehouse> {
  const [w] = await db.select().from(warehouses).where(eq(warehouses.kind, "central")).orderBy(asc(warehouses.id)).limit(1);
  if (w) return w;
  const [created] = await db.insert(warehouses).values({ code: await nextCode("warehouses"), name: "Центральный склад", kind: "central", isSystem: true, sortOrder: 10 }).returning();
  return created;
}

export async function listWarehouses(opts: { includeInactive?: boolean } = {}) {
  const rows = await db
    .select()
    .from(warehouses)
    .where(opts.includeInactive ? undefined : eq(warehouses.isActive, true))
    .orderBy(asc(warehouses.sortOrder), asc(warehouses.name));
  return rows;
}

/** Справочник складов с числом позиций/единиц (для страницы справочника). */
export async function listWarehousesWithUsage() {
  const rows = await listWarehouses({ includeInactive: true });
  const bal = await db
    .select({ key: stockBalances.warehouseId, count: sql<number>`count(*)::int` })
    .from(stockBalances)
    .where(and(eq(stockBalances.locationType, "warehouse"), sql`${stockBalances.quantity} > 0`))
    .groupBy(stockBalances.warehouseId);
  const teamBal = await db
    .select({ key: stockBalances.teamId, count: sql<number>`count(*)::int` })
    .from(stockBalances)
    .where(and(eq(stockBalances.locationType, "team"), sql`${stockBalances.quantity} > 0`))
    .groupBy(stockBalances.teamId);
  const units = await db
    .select({ key: equipmentUnits.warehouseId, count: sql<number>`count(*)::int` })
    .from(equipmentUnits)
    .where(and(eq(equipmentUnits.locationType, "warehouse"), sql`${equipmentUnits.status} in ('in_warehouse','reserved')`))
    .groupBy(equipmentUnits.warehouseId);
  const teamUnits = await db
    .select({ key: equipmentUnits.teamId, count: sql<number>`count(*)::int` })
    .from(equipmentUnits)
    .where(sql`${equipmentUnits.status} in ('at_team','reserved') and ${equipmentUnits.teamId} is not null`)
    .groupBy(equipmentUnits.teamId);
  const b = new Map(bal.map((r) => [r.key, r.count]));
  const tb = new Map(teamBal.map((r) => [r.key, r.count]));
  const u = new Map(units.map((r) => [r.key, r.count]));
  const tu = new Map(teamUnits.map((r) => [r.key, r.count]));
  return rows.map((w) => ({
    ...w,
    usedBy: w.teamId ? (tb.get(w.teamId) ?? 0) + (tu.get(w.teamId) ?? 0) : (b.get(w.id) ?? 0) + (u.get(w.id) ?? 0),
  }));
}

export async function getWarehouse(id: number) {
  const [w] = await db.select().from(warehouses).where(eq(warehouses.id, id));
  if (!w) throw notFound("Склад не найден");
  return w;
}

/** Место хранения по складу: склад бригады → остатки бригады. */
export function locOf(w: Pick<Warehouse, "id" | "kind" | "teamId">): Loc {
  return w.kind === "team" && w.teamId ? locTeam(w.teamId) : locWarehouse(w.id);
}

export async function locById(warehouseId: number): Promise<Loc> {
  return locOf(await getWarehouse(warehouseId));
}

/** Склад бригады (создаётся, если ещё нет). */
export async function teamWarehouse(teamId: number) {
  const [w] = await db.select().from(warehouses).where(eq(warehouses.teamId, teamId));
  if (w) return w;
  const [t] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!t) throw notFound("Бригада не найдена");
  const [created] = await db
    .insert(warehouses)
    .values({ code: await nextCode("warehouses"), name: t.name, kind: "team", teamId: t.id, isSystem: true, sortOrder: 1000 + t.id })
    .onConflictDoNothing({ target: warehouses.teamId })
    .returning();
  return created ?? (await db.select().from(warehouses).where(eq(warehouses.teamId, teamId)))[0];
}

export async function createWarehouse(input: { code?: string | null; name: string; kind?: "central" | "transit" | "team" | "other"; address?: string | null; sortOrder?: number; isActive?: boolean }) {
  const code = await resolveCode("warehouses", input.code);
  const kind = input.kind === "team" || input.kind === "central" ? "other" : (input.kind ?? "other");
  const [row] = await db.insert(warehouses).values({ ...input, code, kind, isSystem: false }).returning();
  return row;
}

export async function updateWarehouse(id: number, patch: { code?: string; name?: string; kind?: "central" | "transit" | "team" | "other"; address?: string | null; sortOrder?: number; isActive?: boolean }) {
  const w = await getWarehouse(id);
  if (patch.code && patch.code !== w.code) {
    const [exists] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, patch.code));
    if (exists) throw conflict(`Код склада «${patch.code}» уже занят`);
  }
  const set = { ...patch };
  delete set.code; // код генерируется системой и не меняется
  if (w.kind === "team" || w.kind === "central") delete set.kind; // вид системных складов не меняется
  else if (set.kind === "team" || set.kind === "central") set.kind = "other";
  const [row] = await db.update(warehouses).set(set).where(eq(warehouses.id, id)).returning();
  return row;
}

export async function deleteWarehouse(id: number) {
  const w = await getWarehouse(id);
  if (w.isSystem) throw conflict("Системный склад (центральный, транзитный, склады бригад) не удаляется — его можно отключить.");
  const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(stockBalances).where(and(eq(stockBalances.warehouseId, id), sql`${stockBalances.quantity} > 0`));
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(equipmentUnits).where(and(eq(equipmentUnits.warehouseId, id), sql`${equipmentUnits.status} in ('in_warehouse','reserved')`));
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(stockReservations).where(and(eq(stockReservations.warehouseId, id), eq(stockReservations.status, "active")));
  if (b.n + u.n + r.n > 0) throw conflict("На складе есть остатки или резервы. Сначала переместите их на другой склад.");
  await db.delete(warehouses).where(eq(warehouses.id, id));
}
