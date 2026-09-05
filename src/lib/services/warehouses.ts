import { db } from "@/db";
import { warehouses, teams, vehicles, vehicleAssignments, stockBalances, equipmentUnits, stockReservations, systemRowTombstones, type Warehouse } from "@/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { conflict, notFound } from "@/lib/api";
import { nextCode, resolveCode } from "@/lib/codes";

/**
 * Мультисклад.
 *
 * Запас бригады физически лежит в её автомобиле, поэтому складом является машина:
 * для каждого автомобиля автоматически заводится склад вида «vehicle». Бригада
 * работает с тем складом-автомобилем, который за ней закреплён в данный момент
 * (`vehicle_assignments.released_at is null`). Если машины нет — нет и склада бригады.
 *
 * Следствие модели: при передаче автомобиля другой бригаде запас едет вместе с ним —
 * так же, как в жизни. Место хранения (Loc) — склад (warehouseId) либо, для старых
 * данных, бригада (teamId).
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
  // Коды генерируются, поэтому единственность базовых складов определяем по виду,
  // а не по коду: иначе каждый вызов заводил бы новый «Центральный склад».
  const [transitDeleted] = await db.select({ id: systemRowTombstones.id }).from(systemRowTombstones).where(and(eq(systemRowTombstones.tableName, "warehouses"), eq(systemRowTombstones.sysKey, "transit")));
  for (const base of [
    { kind: "central" as const, name: "Центральный склад", sortOrder: 10 },
    { kind: "transit" as const, name: "Транзитный склад", sortOrder: 20 },
  ]) {
    if (base.kind === "transit" && transitDeleted) continue; // удалён пользователем — не воссоздаём
    const [exists] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.kind, base.kind)).limit(1);
    if (!exists) await db.insert(warehouses).values({ ...base, code: await nextCode("warehouses"), isSystem: true });
  }

  // Склад-автомобиль для каждой машины
  const missing = await db
    .select({ id: vehicles.id, model: vehicles.model, plateNumber: vehicles.plateNumber, isActive: vehicles.isActive })
    .from(vehicles)
    .leftJoin(warehouses, eq(warehouses.vehicleId, vehicles.id))
    .where(isNull(warehouses.id));
  for (const v of missing) {
    await db
      .insert(warehouses)
      .values({
        code: await nextCode("warehouses"),
        name: vehicleWarehouseName(v),
        kind: "vehicle",
        vehicleId: v.id,
        isSystem: true,
        isActive: v.isActive,
        sortOrder: 1000 + v.id,
      })
      // Уникальность склада обеспечивает сама машина, а не код: коды теперь генерируются
      .onConflictDoNothing({ target: warehouses.vehicleId });
  }
  // Название и активность склада следуют за автомобилем
  await db.execute(sql`
    update warehouses w
       set name = v.model || ' · ' || v.plate_number, is_active = v.is_active
      from vehicles v
     where w.vehicle_id = v.id and w.kind = 'vehicle'
       and (w.name <> v.model || ' · ' || v.plate_number or w.is_active <> v.is_active)`);

  await migrateTeamWarehouses();

  const central = await getCentralWarehouse();
  await db.execute(sql`update stock_balances set warehouse_id = ${central.id} where location_type = 'warehouse' and warehouse_id = 0`);
  await db.execute(sql`update stock_reservations set warehouse_id = ${central.id} where location_type = 'warehouse' and warehouse_id = 0`);
  await db.execute(sql`update equipment_units set warehouse_id = ${central.id} where location_type = 'warehouse' and warehouse_id is null`);
  ensured = Date.now();
}

export function vehicleWarehouseName(v: { model: string; plateNumber: string }) {
  return `${v.model} · ${v.plateNumber}`;
}

/**
 * Переносит запас со старых складов-бригад в склад-автомобиль этой бригады.
 * Бригады без машины остаются на прежнем складе, пока автомобиль не закрепят, —
 * так ничего не теряется. Идемпотентно.
 */
async function migrateTeamWarehouses() {
  const legacy = await db
    .select({ id: warehouses.id, teamId: warehouses.teamId })
    .from(warehouses)
    .where(and(eq(warehouses.kind, "team"), sql`${warehouses.teamId} is not null`));
  if (!legacy.length) return;

  for (const w of legacy) {
    const teamId = w.teamId!;
    const van = await activeVehicleWarehouse(teamId);
    if (!van) continue; // бригаде ещё не выдан автомобиль — переносить некуда

    await db.transaction(async (tx) => {
      // Количественные остатки: складываем с тем, что уже лежит в машине
      await tx.execute(sql`
        insert into stock_balances (catalog_item_id, location_type, team_id, warehouse_id, quantity)
        select catalog_item_id, 'warehouse', 0, ${van.id}, quantity
          from stock_balances where location_type = 'team' and team_id = ${teamId}
        on conflict (catalog_item_id, location_type, team_id, warehouse_id)
        do update set quantity = stock_balances.quantity + excluded.quantity, updated_at = now()`);
      await tx.execute(sql`delete from stock_balances where location_type = 'team' and team_id = ${teamId}`);

      // Серийные единицы переезжают в машину, оставаясь «у бригады»
      await tx.execute(sql`
        update equipment_units set location_type = 'warehouse', warehouse_id = ${van.id}, updated_at = now()
         where location_type = 'team' and team_id = ${teamId}`);

      // Активные резервы
      await tx.execute(sql`
        update stock_reservations set location_type = 'warehouse', warehouse_id = ${van.id}, team_id = 0
         where location_type = 'team' and team_id = ${teamId} and status = 'active'`);

      // Старый склад бригады больше не используется, но остаётся в истории документов
      await tx.execute(sql`update warehouses set is_active = false where id = ${w.id}`);
    });
  }
}

/**
 * Склад автомобиля, закреплённого за бригадой сейчас (или null, если машины нет).
 * Склад создаётся по требованию: полагаться на пакетный ensureWarehouses() нельзя —
 * он throttled, и только что заведённая машина осталась бы без склада на минуту.
 */
async function activeVehicleWarehouse(teamId: number): Promise<Warehouse | null> {
  const [a] = await db
    .select({ vehicleId: vehicleAssignments.vehicleId })
    .from(vehicleAssignments)
    .where(and(eq(vehicleAssignments.teamId, teamId), isNull(vehicleAssignments.releasedAt)))
    .orderBy(asc(vehicleAssignments.assignedAt))
    .limit(1);
  if (!a) return null;
  return vehicleWarehouse(a.vehicleId);
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
    // В складе-автомобиле единицы числятся «у бригады» (at_team) — их тоже считаем
    .where(and(eq(equipmentUnits.locationType, "warehouse"), sql`${equipmentUnits.status} in ('in_warehouse','at_team','reserved')`))
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

/** Место хранения по складу. Склад-автомобиль адресуется как обычный склад;
 *  «бригадное» место осталось только у старых складов вида team. */
export function locOf(w: Pick<Warehouse, "id" | "kind" | "teamId">): Loc {
  return w.kind === "team" && w.teamId ? locTeam(w.teamId) : locWarehouse(w.id);
}

export async function locById(warehouseId: number): Promise<Loc> {
  return locOf(await getWarehouse(warehouseId));
}

/**
 * Склад бригады — это склад закреплённого за ней автомобиля.
 * Если машины нет, склада тоже нет: запас бригады физически негде хранить.
 */
export async function teamWarehouse(teamId: number): Promise<Warehouse> {
  await ensureWarehouses();
  const van = await activeVehicleWarehouse(teamId);
  if (van) return van;

  // Старый склад бригады (до перехода на склады-автомобили) — пока автомобиль не выдан
  const [legacy] = await db.select().from(warehouses).where(and(eq(warehouses.teamId, teamId), eq(warehouses.kind, "team")));
  if (legacy) return legacy;

  const [t] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
  if (!t) throw notFound("Бригада не найдена");
  throw conflict(`Бригаде «${t.name}» не закреплён автомобиль — склада у неё нет. Закрепите машину в карточке бригады.`);
}

/** То же, но без исключения: null, если бригаде не закреплён автомобиль. */
export async function teamWarehouseOrNull(teamId: number): Promise<Warehouse | null> {
  await ensureWarehouses();
  const van = await activeVehicleWarehouse(teamId);
  if (van) return van;
  const [legacy] = await db.select().from(warehouses).where(and(eq(warehouses.teamId, teamId), eq(warehouses.kind, "team")));
  return legacy ?? null;
}

/** Склад-автомобиль по машине (создаётся, если его ещё нет). */
export async function vehicleWarehouse(vehicleId: number): Promise<Warehouse> {
  const [w] = await db.select().from(warehouses).where(eq(warehouses.vehicleId, vehicleId));
  if (w) return w;
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!v) throw notFound("Автомобиль не найден");
  const [created] = await db
    .insert(warehouses)
    .values({ code: await nextCode("warehouses"), name: vehicleWarehouseName(v), kind: "vehicle", vehicleId: v.id, isSystem: true, isActive: v.isActive, sortOrder: 1000 + v.id })
    .onConflictDoNothing({ target: warehouses.vehicleId })
    .returning();
  return created ?? (await db.select().from(warehouses).where(eq(warehouses.vehicleId, vehicleId)))[0];
}

/** Бригада, за которой сейчас закреплён автомобиль этого склада (для отметки «у бригады»). */
export async function teamOfWarehouse(warehouseId: number): Promise<number | null> {
  const [row] = await db
    .select({ teamId: vehicleAssignments.teamId })
    .from(warehouses)
    .innerJoin(vehicleAssignments, and(eq(vehicleAssignments.vehicleId, warehouses.vehicleId), isNull(vehicleAssignments.releasedAt)))
    .where(eq(warehouses.id, warehouseId))
    .limit(1);
  return row?.teamId ?? null;
}

/**
 * Синхронизирует отметку «у бригады» для содержимого склада-автомобиля.
 * Вызывается после закрепления или открепления машины: запас остаётся в машине,
 * но начинает числиться за новой бригадой (или ни за кем, если машина свободна).
 */
export async function syncVehicleHolder(vehicleId: number) {
  const van = await vehicleWarehouse(vehicleId);
  if (!van) return;
  const [a] = await db
    .select({ teamId: vehicleAssignments.teamId })
    .from(vehicleAssignments)
    .where(and(eq(vehicleAssignments.vehicleId, vehicleId), isNull(vehicleAssignments.releasedAt)))
    .limit(1);
  const teamId = a?.teamId ?? null;
  await db.execute(sql`
    update equipment_units
       set team_id = ${teamId},
           status = case when status in ('in_warehouse','at_team')
                         then ${teamId === null ? "in_warehouse" : "at_team"}::unit_status
                         else status end,
           updated_at = now()
     where location_type = 'warehouse' and warehouse_id = ${van.id}`);
}

export async function createWarehouse(input: { code?: string | null; name: string; kind?: "central" | "transit" | "vehicle" | "team" | "other"; address?: string | null; sortOrder?: number; isActive?: boolean }) {
  const code = await resolveCode("warehouses", input.code);
  // Склады-автомобили заводятся автоматически по автопарку, вручную — только обычные
  const kind = ["team", "central", "vehicle"].includes(input.kind ?? "") ? "other" : (input.kind ?? "other");
  const [row] = await db.insert(warehouses).values({ ...input, code, kind, isSystem: false }).returning();
  return row;
}

export async function updateWarehouse(id: number, patch: { code?: string; name?: string; kind?: "central" | "transit" | "vehicle" | "team" | "other"; address?: string | null; sortOrder?: number; isActive?: boolean }) {
  const w = await getWarehouse(id);
  if (patch.code && patch.code !== w.code) {
    const [exists] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.code, patch.code));
    if (exists) throw conflict(`Код склада «${patch.code}» уже занят`);
  }
  const set = { ...patch };
  delete set.code; // код генерируется системой и не меняется
  // Вид системных складов (центральный, склад-автомобиль, старый склад бригады) не меняется
  if (["team", "central", "vehicle"].includes(w.kind)) delete set.kind;
  else if (["team", "central", "vehicle"].includes(set.kind ?? "")) set.kind = "other";
  // Имя склада-автомобиля ведётся автопарком
  if (w.kind === "vehicle") delete set.name;
  const [row] = await db.update(warehouses).set(set).where(eq(warehouses.id, id)).returning();
  return row;
}

export async function deleteWarehouse(id: number) {
  const w = await getWarehouse(id);
  if (w.kind === "central") throw conflict("Центральный склад — место хранения по умолчанию, он не удаляется. Его можно переименовать.");
  if (w.kind === "vehicle") throw conflict("Склад-автомобиль ведётся автопарком и удаляется вместе с автомобилем.");
  const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(stockBalances).where(and(eq(stockBalances.warehouseId, id), sql`${stockBalances.quantity} > 0`));
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(equipmentUnits).where(and(eq(equipmentUnits.warehouseId, id), sql`${equipmentUnits.status} in ('in_warehouse','reserved')`));
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(stockReservations).where(and(eq(stockReservations.warehouseId, id), eq(stockReservations.status, "active")));
  if (b.n + u.n + r.n > 0) throw conflict("На складе есть остатки или резервы. Сначала переместите их на другой склад.");
  // Транзитный склад создаётся автоматически — запоминаем, что пользователь его удалил
  if (w.kind === "transit") await db.insert(systemRowTombstones).values({ tableName: "warehouses", sysKey: "transit" }).onConflictDoNothing();
  await db.delete(warehouses).where(eq(warehouses.id, id));
}
