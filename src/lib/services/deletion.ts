import { db } from "@/db";
import {
  clients,
  sites,
  users,
  teams,
  teamMembers,
  vehicles,
  vehicleAssignments,
  catalogItems,
  equipmentUnits,
  stockBalances,
  stockReservations,
  stockTransactions,
  tickets,
  ticketMaterials,
  ticketWorks,
  ticketComments,
  ticketStatusHistory,
  roles,
} from "@/db/schema";
import { and, eq, sql, inArray, ne, isNull, gt, type SQL } from "drizzle-orm";
import { conflict, forbidden, notFound } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * Удаление справочных и учётных записей.
 *
 * Правило: ошибиться при вводе можно, поэтому удалять разрешено — но только
 * то, что не разрушит историю. Если на запись ссылаются документы (заявки,
 * складские операции, установленное оборудование), удаление блокируется с
 * перечислением конкретных помех, а пользователю предлагается деактивация.
 */

type Blocker = { label: string; count: number };

async function countOf(table: PgTable, where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where);
  return row?.n ?? 0;
}

/** Собирает счётчики помех одним пакетом запросов. */
async function blockersOf(defs: { label: string; table: PgTable; where: SQL | undefined }[]): Promise<Blocker[]> {
  const counts = await Promise.all(defs.map((d) => countOf(d.table, d.where)));
  return defs.map((d, i) => ({ label: d.label, count: counts[i] })).filter((b) => b.count > 0);
}

function assertFree(entity: string, blockers: Blocker[], hint = "Деактивируйте запись, чтобы скрыть её из списков, сохранив историю.") {
  if (!blockers.length) return;
  const list = blockers.map((b) => `${b.label}: ${b.count}`).join(", ");
  throw conflict(`Нельзя удалить — на запись ссылаются: ${list}. ${hint}`);
}

async function mustExist<T>(rows: T[], message: string): Promise<T> {
  if (!rows.length) throw notFound(message);
  return rows[0];
}

// ─────────────────────────── КЛИЕНТЫ И ОБЪЕКТЫ ───────────────────────────

export async function deleteClient(id: number) {
  await mustExist(await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)), "Клиент не найден");
  assertFree(
    "клиента",
    await blockersOf([
      { label: "заявки", table: tickets, where: eq(tickets.clientId, id) },
      { label: "объекты", table: sites, where: eq(sites.clientId, id) },
      { label: "складские операции", table: stockTransactions, where: eq(stockTransactions.clientId, id) },
      { label: "учётные записи портала", table: users, where: eq(users.clientId, id) },
    ]),
  );
  await db.delete(clients).where(eq(clients.id, id));
}

export async function deleteSite(id: number) {
  await mustExist(await db.select({ id: sites.id }).from(sites).where(eq(sites.id, id)), "Объект не найден");
  assertFree(
    "объект",
    await blockersOf([
      { label: "заявки", table: tickets, where: eq(tickets.siteId, id) },
      { label: "установленное оборудование", table: ticketMaterials, where: eq(ticketMaterials.siteId, id) },
      { label: "числящееся на объекте оборудование", table: equipmentUnits, where: eq(equipmentUnits.siteId, id) },
    ]),
  );
  await db.delete(sites).where(eq(sites.id, id));
}

// ─────────────────────────── СОТРУДНИКИ ───────────────────────────

export async function deleteUser(actor: SessionUser, id: number) {
  const target = await mustExist(
    await db.select({ id: users.id, roleId: users.roleId }).from(users).where(eq(users.id, id)),
    "Сотрудник не найден",
  );
  if (actor.id === id) throw forbidden("Нельзя удалить собственную учётную запись");

  // Защита от блокировки системы: последний активный администратор не удаляется.
  const adminRoleIds = (
    await db
      .select({ id: roles.id })
      .from(roles)
      .where(sql`'users.manage' = any(${roles.permissions})`)
  ).map((r) => r.id);
  if (adminRoleIds.includes(target.roleId)) {
    const others = await countOf(
      users,
      and(inArray(users.roleId, adminRoleIds), eq(users.isActive, true), ne(users.id, id)),
    );
    if (others === 0) throw conflict("Это последний администратор — удаление заблокировало бы доступ к системе");
  }

  assertFree(
    "сотрудника",
    await blockersOf([
      { label: "складские операции", table: stockTransactions, where: eq(stockTransactions.actorId, id) },
      { label: "резервы", table: stockReservations, where: eq(stockReservations.createdBy, id) },
    ]),
    "Деактивируйте сотрудника — он исчезнет из списков, а история операций останется.",
  );

  // Членство в бригадах удаляется каскадом; авторство в заявках/чате обнуляется.
  await db.delete(users).where(eq(users.id, id));
}

// ─────────────────────────── БРИГАДЫ И ТЕХНИКА ───────────────────────────

export async function deleteTeam(id: number) {
  await mustExist(await db.select({ id: teams.id }).from(teams).where(eq(teams.id, id)), "Бригада не найдена");
  assertFree(
    "бригаду",
    await blockersOf([
      { label: "заявки", table: tickets, where: eq(tickets.teamId, id) },
      { label: "оборудование на руках", table: equipmentUnits, where: eq(equipmentUnits.teamId, id) },
      {
        label: "остатки материалов",
        table: stockBalances,
        where: and(eq(stockBalances.teamId, id), eq(stockBalances.locationType, "team"), gt(stockBalances.quantity, "0")),
      },
      {
        label: "активные резервы",
        table: stockReservations,
        where: and(eq(stockReservations.teamId, id), eq(stockReservations.status, "active")),
      },
      { label: "складские операции", table: stockTransactions, where: eq(stockTransactions.teamId, id) },
    ]),
    "Верните оборудование на склад и переназначьте заявки, либо деактивируйте бригаду.",
  );
  // Состав и закрепление техники удаляются каскадом.
  await db.delete(teams).where(eq(teams.id, id));
}

export async function deleteVehicle(id: number) {
  await mustExist(await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, id)), "Автомобиль не найден");
  const active = await countOf(vehicleAssignments, and(eq(vehicleAssignments.vehicleId, id), isNull(vehicleAssignments.releasedAt)));
  if (active > 0) throw conflict("Автомобиль закреплён за бригадой — сначала открепите его");
  await db.delete(vehicles).where(eq(vehicles.id, id));
}

export async function removeTeamMember(teamId: number, userId: number) {
  const res = await db
    .update(teamMembers)
    .set({ leftAt: new Date() })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId), isNull(teamMembers.leftAt)))
    .returning({ id: teamMembers.id });
  if (!res.length) throw notFound("Сотрудник не состоит в этой бригаде");
}

// ─────────────────────────── НОМЕНКЛАТУРА И ОБОРУДОВАНИЕ ───────────────────────────

export async function deleteCatalogItem(id: number) {
  await mustExist(await db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.id, id)), "Позиция не найдена");
  assertFree(
    "позицию номенклатуры",
    await blockersOf([
      { label: "серийные единицы", table: equipmentUnits, where: eq(equipmentUnits.catalogItemId, id) },
      { label: "складские операции", table: stockTransactions, where: eq(stockTransactions.catalogItemId, id) },
      { label: "установленное оборудование", table: ticketMaterials, where: eq(ticketMaterials.catalogItemId, id) },
      { label: "резервы", table: stockReservations, where: eq(stockReservations.catalogItemId, id) },
      {
        label: "ненулевые остатки",
        table: stockBalances,
        where: and(eq(stockBalances.catalogItemId, id), gt(stockBalances.quantity, "0")),
      },
    ]),
  );
  // Нулевые остатки — техническая запись, удаляем вместе с позицией.
  await db.transaction(async (tx) => {
    await tx.delete(stockBalances).where(eq(stockBalances.catalogItemId, id));
    await tx.delete(catalogItems).where(eq(catalogItems.id, id));
  });
}

/**
 * Удаление серийной единицы. Разрешено, только пока она не установлена на объекте:
 * это исправление ошибки ввода при приёмке, а не переписывание истории обслуживания.
 * Вместе с единицей удаляются её складские проводки.
 */
export async function deleteEquipmentUnit(id: number) {
  const unit = await mustExist(
    await db.select({ id: equipmentUnits.id, status: equipmentUnits.status }).from(equipmentUnits).where(eq(equipmentUnits.id, id)),
    "Единица оборудования не найдена",
  );
  if (unit.status === "installed") throw conflict("Единица установлена на объекте — удаление исказит историю обслуживания");
  if (unit.status === "reserved") throw conflict("Единица зарезервирована под заявку — сначала снимите резерв");
  const installed = await countOf(ticketMaterials, eq(ticketMaterials.unitId, id));
  if (installed > 0) throw conflict("Единица числится в актах установки — удаление невозможно");

  await db.transaction(async (tx) => {
    await tx.delete(stockTransactions).where(eq(stockTransactions.unitId, id));
    await tx.delete(equipmentUnits).where(eq(equipmentUnits.id, id));
  });
}

// ─────────────────────────── ЗАЯВКИ ───────────────────────────

/**
 * Удаление заявки. История статусов, работы и чат удаляются каскадом,
 * но заявка со складскими движениями (резерв/установка) не удаляется —
 * иначе остатки разойдутся с журналом.
 */
export async function deleteTicket(id: number) {
  await mustExist(await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id)), "Заявка не найдена");
  assertFree(
    "заявку",
    await blockersOf([
      { label: "установленное оборудование", table: ticketMaterials, where: eq(ticketMaterials.ticketId, id) },
      {
        label: "активные резервы",
        table: stockReservations,
        where: and(eq(stockReservations.ticketId, id), eq(stockReservations.status, "active")),
      },
      {
        label: "зарезервированные единицы",
        table: equipmentUnits,
        where: and(eq(equipmentUnits.ticketId, id), eq(equipmentUnits.status, "reserved")),
      },
      { label: "складские операции", table: stockTransactions, where: eq(stockTransactions.ticketId, id) },
    ]),
    "Снимите резервы и оформите возврат оборудования, либо отмените заявку вместо удаления.",
  );
  await db.transaction(async (tx) => {
    // Явно, хотя часть таблиц удалилась бы каскадом — порядок делает намерение читаемым.
    await tx.delete(ticketComments).where(eq(ticketComments.ticketId, id));
    await tx.delete(ticketWorks).where(eq(ticketWorks.ticketId, id));
    await tx.delete(ticketStatusHistory).where(eq(ticketStatusHistory.ticketId, id));
    await tx.delete(tickets).where(eq(tickets.id, id));
  });
}
