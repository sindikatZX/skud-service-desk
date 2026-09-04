import { db } from "@/db";
import {
  catalogItems,
  catalogCategories,
  equipmentUnits,
  stockBalances,
  stockReservations,
  stockTransactions,
  ticketMaterials,
  tickets,
  teams,
  users,
  clients,
  sites,
} from "@/db/schema";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { badRequest, conflict, notFound } from "@/lib/api";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Loc = "warehouse" | "team" | "site";

const WAREHOUSE = 0;

async function getItem(tx: Tx, id: number) {
  const [item] = await tx.select().from(catalogItems).where(eq(catalogItems.id, id));
  if (!item) throw notFound("Номенклатура не найдена");
  return item;
}

/** Единица блокируется на время операции: параллельные отгрузка/резерв не разъедутся. */
async function getUnit(tx: Tx, id: number) {
  const [u] = await tx.select().from(equipmentUnits).where(eq(equipmentUnits.id, id)).for("update");
  if (!u) throw notFound("Единица оборудования не найдена");
  return u;
}

async function getTicket(tx: Tx, id: number) {
  const [t] = await tx.select().from(tickets).where(eq(tickets.id, id));
  if (!t) throw notFound("Заявка не найдена");
  return t;
}

/**
 * Изменение количественного остатка. Строка остатка сначала гарантированно создаётся,
 * затем блокируется (SELECT … FOR UPDATE): две параллельные выдачи одной позиции
 * не могут прочитать одно и то же значение и увести остаток в минус.
 */
async function adjustBalance(tx: Tx, catalogItemId: number, locationType: Loc, teamId: number, delta: number) {
  await tx
    .insert(stockBalances)
    .values({ catalogItemId, locationType, teamId, quantity: "0" })
    .onConflictDoNothing({ target: [stockBalances.catalogItemId, stockBalances.locationType, stockBalances.teamId] });

  const [row] = await tx
    .select()
    .from(stockBalances)
    .where(
      and(
        eq(stockBalances.catalogItemId, catalogItemId),
        eq(stockBalances.locationType, locationType),
        eq(stockBalances.teamId, teamId),
      ),
    )
    .for("update");

  const current = Number(row.quantity);
  const next = current + delta;
  if (next < -1e-9) throw conflict(`Недостаточно остатка: доступно ${current}, требуется ${-delta}`);
  await tx
    .update(stockBalances)
    .set({ quantity: String(next), updatedAt: new Date() })
    .where(eq(stockBalances.id, row.id));
}

type TxInsert = typeof stockTransactions.$inferInsert;
async function logTx(tx: Tx, v: TxInsert) {
  const [row] = await tx.insert(stockTransactions).values(v).returning();
  return row;
}

// ─────────────── ОПЕРАЦИИ ───────────────

/** Поступление на центральный склад от поставщика. */
export async function receive(input: {
  catalogItemId: number;
  quantity?: number;
  units?: { serialNumber: string; macAddress?: string | null }[];
  actorId: number;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    const item = await getItem(tx, input.catalogItemId);
    if (item.isSerialized) {
      const list = input.units ?? [];
      if (!list.length) throw badRequest("Для серийного оборудования укажите серийные номера");
      const created = [];
      for (const u of list) {
        const sn = u.serialNumber.trim();
        if (!sn) throw badRequest("Пустой серийный номер");
        const [unit] = await tx
          .insert(equipmentUnits)
          .values({
            catalogItemId: item.id,
            serialNumber: sn,
            macAddress: u.macAddress || null,
            status: "in_warehouse",
            locationType: "warehouse",
          })
          .returning();
        await logTx(tx, {
          type: "receive",
          catalogItemId: item.id,
          unitId: unit.id,
          quantity: "1",
          toLocationType: "warehouse",
          actorId: input.actorId,
          note: input.note,
        });
        created.push(unit);
      }
      return { units: created };
    }
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw badRequest("Количество должно быть > 0");
    await adjustBalance(tx, item.id, "warehouse", WAREHOUSE, qty);
    const t = await logTx(tx, {
      type: "receive",
      catalogItemId: item.id,
      quantity: String(qty),
      toLocationType: "warehouse",
      actorId: input.actorId,
      note: input.note,
    });
    return { transaction: t };
  });
}

/** Отгрузка со склада бригаде. */
export async function issueToTeam(input: {
  catalogItemId?: number;
  unitId?: number;
  teamId: number;
  quantity?: number;
  actorId: number;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, input.teamId));
    if (!team) throw notFound("Бригада не найдена");
    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      if (unit.status !== "in_warehouse") throw conflict("Единица не находится на складе");
      await tx
        .update(equipmentUnits)
        .set({ status: "at_team", locationType: "team", teamId: team.id, updatedAt: new Date() })
        .where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, {
        type: "issue_to_team",
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        fromLocationType: "warehouse",
        toLocationType: "team",
        toTeamId: team.id,
        teamId: team.id,
        actorId: input.actorId,
        note: input.note,
      });
    }
    const item = await getItem(tx, Number(input.catalogItemId));
    if (item.isSerialized) throw badRequest("Для серийного оборудования укажите unitId");
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw badRequest("Количество должно быть > 0");
    await adjustBalance(tx, item.id, "warehouse", WAREHOUSE, -qty);
    await adjustBalance(tx, item.id, "team", team.id, qty);
    return logTx(tx, {
      type: "issue_to_team",
      catalogItemId: item.id,
      quantity: String(qty),
      fromLocationType: "warehouse",
      toLocationType: "team",
      toTeamId: team.id,
      teamId: team.id,
      actorId: input.actorId,
      note: input.note,
    });
  });
}

/** Возврат от бригады на склад. */
export async function returnToWarehouse(input: {
  catalogItemId?: number;
  unitId?: number;
  teamId: number;
  quantity?: number;
  actorId: number;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      if (unit.status !== "at_team") throw conflict("Вернуть можно только единицу в статусе «у бригады» (снимите резерв)");
      await tx
        .update(equipmentUnits)
        .set({ status: "in_warehouse", locationType: "warehouse", teamId: null, updatedAt: new Date() })
        .where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, {
        type: "return_to_warehouse",
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        fromLocationType: "team",
        fromTeamId: unit.teamId,
        toLocationType: "warehouse",
        teamId: unit.teamId,
        actorId: input.actorId,
        note: input.note,
      });
    }
    const item = await getItem(tx, Number(input.catalogItemId));
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw badRequest("Количество должно быть > 0");
    await adjustBalance(tx, item.id, "team", input.teamId, -qty);
    await adjustBalance(tx, item.id, "warehouse", WAREHOUSE, qty);
    return logTx(tx, {
      type: "return_to_warehouse",
      catalogItemId: item.id,
      quantity: String(qty),
      fromLocationType: "team",
      fromTeamId: input.teamId,
      toLocationType: "warehouse",
      teamId: input.teamId,
      actorId: input.actorId,
      note: input.note,
    });
  });
}

/** Резервирование под заявку из остатков бригады заявки (или со склада). */
export async function reserve(input: {
  ticketId: number;
  catalogItemId?: number;
  unitId?: number;
  quantity?: number;
  fromWarehouse?: boolean;
  actorId: number;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    const ticket = await getTicket(tx, input.ticketId);
    if (["closed", "cancelled", "done"].includes(ticket.status)) throw conflict("Заявка завершена");
    const locType: Loc = input.fromWarehouse ? "warehouse" : "team";
    const locTeam = input.fromWarehouse ? WAREHOUSE : ticket.teamId;
    if (locType === "team" && !locTeam) throw conflict("Заявке не назначена бригада — резерв из остатков бригады невозможен");

    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      const okState =
        (locType === "team" && unit.status === "at_team" && unit.teamId === locTeam) ||
        (locType === "warehouse" && unit.status === "in_warehouse");
      if (!okState) throw conflict("Единица недоступна для резерва из указанного места");
      await tx
        .update(equipmentUnits)
        .set({ status: "reserved", ticketId: ticket.id, updatedAt: new Date() })
        .where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, {
        type: "reserve",
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        fromLocationType: locType,
        fromTeamId: locTeam ?? undefined,
        teamId: ticket.teamId,
        ticketId: ticket.id,
        clientId: ticket.clientId,
        siteId: ticket.siteId,
        actorId: input.actorId,
        note: input.note,
      });
    }
    const item = await getItem(tx, Number(input.catalogItemId));
    if (item.isSerialized) throw badRequest("Для серийного оборудования укажите unitId");
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw badRequest("Количество должно быть > 0");
    await adjustBalance(tx, item.id, locType, locTeam ?? WAREHOUSE, -qty);
    await tx.insert(stockReservations).values({
      catalogItemId: item.id,
      ticketId: ticket.id,
      locationType: locType,
      teamId: locTeam ?? WAREHOUSE,
      quantity: String(qty),
      createdBy: input.actorId,
    });
    return logTx(tx, {
      type: "reserve",
      catalogItemId: item.id,
      quantity: String(qty),
      fromLocationType: locType,
      fromTeamId: locTeam ?? undefined,
      teamId: ticket.teamId,
      ticketId: ticket.id,
      clientId: ticket.clientId,
      siteId: ticket.siteId,
      actorId: input.actorId,
      note: input.note,
    });
  });
}

/** Снятие резерва. */
export async function unreserve(input: { reservationId?: number; unitId?: number; actorId: number }) {
  return db.transaction(async (tx) => {
    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      if (unit.status !== "reserved") throw conflict("Единица не зарезервирована");
      const backStatus = unit.teamId ? "at_team" : "in_warehouse";
      const ticket = unit.ticketId ? await getTicket(tx, unit.ticketId) : null;
      await tx
        .update(equipmentUnits)
        .set({ status: backStatus, ticketId: null, updatedAt: new Date() })
        .where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, {
        type: "unreserve",
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        toLocationType: unit.teamId ? "team" : "warehouse",
        toTeamId: unit.teamId,
        teamId: unit.teamId,
        ticketId: unit.ticketId,
        clientId: ticket?.clientId,
        siteId: ticket?.siteId,
        actorId: input.actorId,
      });
    }
    const [r] = await tx.select().from(stockReservations).where(eq(stockReservations.id, Number(input.reservationId)));
    if (!r) throw notFound("Резерв не найден");
    if (r.status !== "active") throw conflict("Резерв уже неактивен");
    const ticket = await getTicket(tx, r.ticketId);
    await tx.update(stockReservations).set({ status: "cancelled" }).where(eq(stockReservations.id, r.id));
    await adjustBalance(tx, r.catalogItemId, r.locationType, r.teamId, Number(r.quantity));
    return logTx(tx, {
      type: "unreserve",
      catalogItemId: r.catalogItemId,
      quantity: r.quantity,
      toLocationType: r.locationType,
      toTeamId: r.teamId,
      teamId: ticket.teamId,
      ticketId: ticket.id,
      clientId: ticket.clientId,
      siteId: ticket.siteId,
      actorId: input.actorId,
    });
  });
}

/**
 * Установка на объекте в рамках заявки. Списывает: сначала активный резерв, затем свободные остатки бригады.
 * Для серийной единицы — из статуса reserved (под эту заявку) или at_team (бригада заявки).
 */
export async function install(input: {
  ticketId: number;
  catalogItemId?: number;
  unitId?: number;
  quantity?: number;
  actorId: number;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    const ticket = await getTicket(tx, input.ticketId);
    if (["closed", "cancelled"].includes(ticket.status)) throw conflict("Заявка закрыта");
    if (!ticket.teamId) throw conflict("Заявке не назначена бригада");

    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      const fromReserve = unit.status === "reserved" && unit.ticketId === ticket.id;
      const fromTeam = unit.status === "at_team" && unit.teamId === ticket.teamId;
      if (!fromReserve && !fromTeam) throw conflict("Единица не числится за бригадой заявки и не зарезервирована под неё");
      await tx
        .update(equipmentUnits)
        .set({
          status: "installed",
          locationType: "site",
          siteId: ticket.siteId,
          ticketId: ticket.id,
          installedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(equipmentUnits.id, unit.id));
      await tx.insert(ticketMaterials).values({
        ticketId: ticket.id,
        siteId: ticket.siteId,
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        installedBy: input.actorId,
        note: input.note,
      });
      return logTx(tx, {
        type: "install",
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        fromLocationType: unit.teamId ? "team" : "warehouse",
        fromTeamId: unit.teamId,
        toLocationType: "site",
        teamId: ticket.teamId,
        ticketId: ticket.id,
        clientId: ticket.clientId,
        siteId: ticket.siteId,
        actorId: input.actorId,
        note: input.note,
      });
    }

    const item = await getItem(tx, Number(input.catalogItemId));
    if (item.isSerialized) throw badRequest("Для серийного оборудования укажите unitId");
    let remaining = Number(input.quantity);
    if (!(remaining > 0)) throw badRequest("Количество должно быть > 0");

    // 1) закрываем активные резервы этой заявки
    const reservations = await tx
      .select()
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.ticketId, ticket.id),
          eq(stockReservations.catalogItemId, item.id),
          eq(stockReservations.status, "active"),
        ),
      );
    for (const r of reservations) {
      if (remaining <= 0) break;
      const rq = Number(r.quantity);
      if (rq <= remaining) {
        await tx.update(stockReservations).set({ status: "consumed" }).where(eq(stockReservations.id, r.id));
        remaining -= rq;
      } else {
        // частичное использование: уменьшаем резерв
        await tx
          .update(stockReservations)
          .set({ quantity: String(rq - remaining) })
          .where(eq(stockReservations.id, r.id));
        remaining = 0;
      }
    }
    // 2) остаток — из свободных остатков бригады
    if (remaining > 0) await adjustBalance(tx, item.id, "team", ticket.teamId, -remaining);

    const qty = Number(input.quantity);
    await tx.insert(ticketMaterials).values({
      ticketId: ticket.id,
      siteId: ticket.siteId,
      catalogItemId: item.id,
      quantity: String(qty),
      installedBy: input.actorId,
      note: input.note,
    });
    return logTx(tx, {
      type: "install",
      catalogItemId: item.id,
      quantity: String(qty),
      fromLocationType: "team",
      fromTeamId: ticket.teamId,
      toLocationType: "site",
      teamId: ticket.teamId,
      ticketId: ticket.id,
      clientId: ticket.clientId,
      siteId: ticket.siteId,
      actorId: input.actorId,
      note: input.note,
    });
  });
}

/** Списание (брак/утеря) со склада или от бригады. */
export async function writeOff(input: {
  catalogItemId?: number;
  unitId?: number;
  teamId?: number;
  quantity?: number;
  actorId: number;
  note?: string;
}) {
  return db.transaction(async (tx) => {
    if (input.unitId) {
      const unit = await getUnit(tx, input.unitId);
      if (!["in_warehouse", "at_team"].includes(unit.status)) throw conflict("Списать можно только свободную единицу");
      await tx
        .update(equipmentUnits)
        .set({ status: "written_off", updatedAt: new Date() })
        .where(eq(equipmentUnits.id, unit.id));
      return logTx(tx, {
        type: "write_off",
        catalogItemId: unit.catalogItemId,
        unitId: unit.id,
        quantity: "1",
        fromLocationType: unit.locationType,
        fromTeamId: unit.teamId,
        teamId: unit.teamId,
        actorId: input.actorId,
        note: input.note,
      });
    }
    const item = await getItem(tx, Number(input.catalogItemId));
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw badRequest("Количество должно быть > 0");
    const teamId = input.teamId ?? WAREHOUSE;
    await adjustBalance(tx, item.id, teamId ? "team" : "warehouse", teamId, -qty);
    return logTx(tx, {
      type: "write_off",
      catalogItemId: item.id,
      quantity: String(qty),
      fromLocationType: teamId ? "team" : "warehouse",
      fromTeamId: teamId || undefined,
      teamId: teamId || undefined,
      actorId: input.actorId,
      note: input.note,
    });
  });
}

// ─────────────── ЗАПРОСЫ ───────────────

/** Остатки по месту хранения: количественные + серийные единицы + активные резервы. */
export async function getStock(locationType: "warehouse" | "team", teamId = 0) {
  const balances = await db
    .select({
      catalogItemId: stockBalances.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      unit: catalogItems.unit,
      category: catalogCategories.name,
      quantity: stockBalances.quantity,
    })
    .from(stockBalances)
    .innerJoin(catalogItems, eq(catalogItems.id, stockBalances.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .where(and(eq(stockBalances.locationType, locationType), eq(stockBalances.teamId, teamId)))
    .orderBy(catalogItems.name);

  const unitStatus = locationType === "warehouse" ? "in_warehouse" : "at_team";
  const unitWhere =
    locationType === "warehouse"
      ? inArray(equipmentUnits.status, ["in_warehouse", "reserved"])
      : and(eq(equipmentUnits.teamId, teamId), inArray(equipmentUnits.status, ["at_team", "reserved"]));
  const unitsRaw = await db
    .select({
      id: equipmentUnits.id,
      catalogItemId: equipmentUnits.catalogItemId,
      sku: catalogItems.sku,
      name: catalogItems.name,
      category: catalogCategories.name,
      serialNumber: equipmentUnits.serialNumber,
      macAddress: equipmentUnits.macAddress,
      status: equipmentUnits.status,
      ticketId: equipmentUnits.ticketId,
      teamId: equipmentUnits.teamId,
    })
    .from(equipmentUnits)
    .innerJoin(catalogItems, eq(catalogItems.id, equipmentUnits.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .where(unitWhere)
    .orderBy(catalogItems.name, equipmentUnits.serialNumber);
  // для склада: reserved-единицы без бригады
  const units = locationType === "warehouse" ? unitsRaw.filter((u) => u.status === unitStatus || !u.teamId) : unitsRaw;

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
    .where(
      and(
        eq(stockReservations.locationType, locationType),
        eq(stockReservations.teamId, teamId),
        eq(stockReservations.status, "active"),
      ),
    );

  return { balances: balances.filter((b) => Number(b.quantity) > 0), units, reservations };
}

/** Полная история движения серийной единицы. */
export async function getUnitHistory(unitId: number) {
  const [unit] = await db
    .select({
      id: equipmentUnits.id,
      serialNumber: equipmentUnits.serialNumber,
      macAddress: equipmentUnits.macAddress,
      status: equipmentUnits.status,
      locationType: equipmentUnits.locationType,
      teamId: equipmentUnits.teamId,
      teamName: teams.name,
      siteId: equipmentUnits.siteId,
      siteName: sites.name,
      siteAddress: sites.address,
      clientName: clients.name,
      ticketId: equipmentUnits.ticketId,
      installedAt: equipmentUnits.installedAt,
      createdAt: equipmentUnits.createdAt,
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
    .leftJoin(sites, eq(sites.id, equipmentUnits.siteId))
    .leftJoin(clients, eq(clients.id, sites.clientId))
    .where(eq(equipmentUnits.id, unitId));
  if (!unit) return null;
  const history = await listTransactions({ unitId });
  return { unit, history };
}

export async function listTransactions(filter: {
  unitId?: number;
  ticketId?: number;
  teamId?: number;
  clientId?: number;
  catalogItemId?: number;
  type?: string;
  limit?: number;
}) {
  const conds = [];
  if (filter.unitId) conds.push(eq(stockTransactions.unitId, filter.unitId));
  if (filter.ticketId) conds.push(eq(stockTransactions.ticketId, filter.ticketId));
  if (filter.teamId) conds.push(eq(stockTransactions.teamId, filter.teamId));
  if (filter.clientId) conds.push(eq(stockTransactions.clientId, filter.clientId));
  if (filter.catalogItemId) conds.push(eq(stockTransactions.catalogItemId, filter.catalogItemId));
  if (filter.type) conds.push(eq(stockTransactions.type, filter.type as TxInsert["type"]));
  const toTeam = sql<string | null>`(select name from teams where id = ${stockTransactions.toTeamId})`;
  const fromTeam = sql<string | null>`(select name from teams where id = ${stockTransactions.fromTeamId})`;
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
    .leftJoin(teams, eq(teams.id, stockTransactions.teamId))
    .leftJoin(tickets, eq(tickets.id, stockTransactions.ticketId))
    .leftJoin(clients, eq(clients.id, stockTransactions.clientId))
    .leftJoin(sites, eq(sites.id, stockTransactions.siteId))
    .leftJoin(users, eq(users.id, stockTransactions.actorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockTransactions.createdAt), desc(stockTransactions.id))
    .limit(filter.limit ?? 300);
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
