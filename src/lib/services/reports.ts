import { db } from "@/db";
import {
  tickets,
  ticketTypes,
  ticketPriorities,
  ticketWorks,
  users,
  roles,
  teamMembers,
  teams,
  stockTransactions,
  catalogItems,
  clients,
  equipmentUnits,
  stockBalances,
  warehouses,
  vehicles,
  vehicleAssignments,
} from "@/db/schema";
import { and, eq, sql, desc, asc, isNull, gte, lte } from "drizzle-orm";

export async function dashboardSummary() {
  const byStatus = await db
    .select({ status: tickets.status, count: sql<number>`count(*)::int` })
    .from(tickets)
    .groupBy(tickets.status);
  const [overdue] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(sql`${tickets.dueAt} < now()`, sql`${tickets.status} not in ('done','closed','cancelled')`));
  const [today] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(sql`${tickets.scheduledStart}::date = current_date`);

  // SLA: время реакции (до взятия в работу), время решения и доля заявок в срок.
  const [sla] = await db
    .select({
      avgCompletionHours: sql<number | null>`round(avg(extract(epoch from (${tickets.completedAt} - ${tickets.createdAt}))/3600) filter (where ${tickets.completedAt} is not null)::numeric, 1)`,
      avgReactionHours: sql<number | null>`round(avg(extract(epoch from (${tickets.startedAt} - ${tickets.createdAt}))/3600) filter (where ${tickets.startedAt} is not null)::numeric, 1)`,
      avgResolutionHours: sql<number | null>`round(avg(extract(epoch from (${tickets.completedAt} - ${tickets.startedAt}))/3600) filter (where ${tickets.completedAt} is not null and ${tickets.startedAt} is not null)::numeric, 1)`,
      completed: sql<number>`count(*) filter (where ${tickets.completedAt} is not null)::int`,
      onTime: sql<number>`count(*) filter (where ${tickets.completedAt} is not null and (${tickets.dueAt} is null or ${tickets.completedAt} <= ${tickets.dueAt}))::int`,
    })
    .from(tickets);

  const byType = await db
    .select({ name: ticketTypes.name, count: sql<number>`count(*)::int` })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
    .groupBy(ticketTypes.id, ticketTypes.name, ticketTypes.sortOrder)
    .orderBy(asc(ticketTypes.sortOrder));

  const byPriority = await db
    .select({ name: ticketPriorities.name, colorClass: ticketPriorities.colorClass, count: sql<number>`count(*)::int` })
    .from(tickets)
    .innerJoin(ticketPriorities, eq(ticketPriorities.id, tickets.priorityId))
    .groupBy(ticketPriorities.id, ticketPriorities.name, ticketPriorities.colorClass, ticketPriorities.sortOrder)
    .orderBy(asc(ticketPriorities.sortOrder));

  const completed = sla?.completed ?? 0;
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    byType,
    byPriority,
    overdue: overdue?.count ?? 0,
    scheduledToday: today?.count ?? 0,
    avgCompletionHours: sla?.avgCompletionHours ?? null,
    avgReactionHours: sla?.avgReactionHours ?? null,
    avgResolutionHours: sla?.avgResolutionHours ?? null,
    onTimeRate: completed > 0 ? Math.round(((sla?.onTime ?? 0) / completed) * 100) : null,
  };
}

/** Загрузка и эффективность сотрудников (монтажников). */
export async function employeeWorkload(from?: Date, to?: Date) {
  const range = [];
  if (from) range.push(gte(tickets.createdAt, from));
  if (to) range.push(lte(tickets.createdAt, to));
  // Полевой персонал определяется признаком роли, а не зашитым кодом «technician».
  const techs = await db
    .select({ id: users.id, fullName: users.fullName, teamId: teamMembers.teamId, teamName: teams.name })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(teamMembers, and(eq(teamMembers.userId, users.id), isNull(teamMembers.leftAt)))
    .leftJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(roles.isFieldStaff, true), eq(users.isActive, true)));

  const works = await db
    .select({
      performedBy: ticketWorks.performedBy,
      works: sql<number>`count(*)::int`,
      minutes: sql<number>`coalesce(sum(${ticketWorks.durationMinutes}),0)::int`,
      ticketsTouched: sql<number>`count(distinct ${ticketWorks.ticketId})::int`,
    })
    .from(ticketWorks)
    .groupBy(ticketWorks.performedBy);

  const teamStats = await db
    .select({
      teamId: tickets.teamId,
      active: sql<number>`count(*) filter (where ${tickets.status} in ('assigned','scheduled','in_progress','on_hold'))::int`,
      done: sql<number>`count(*) filter (where ${tickets.status} in ('done','closed'))::int`,
      overdue: sql<number>`count(*) filter (where ${tickets.dueAt} < now() and ${tickets.status} not in ('done','closed','cancelled'))::int`,
      avgHours: sql<number | null>`round(avg(extract(epoch from (${tickets.completedAt} - ${tickets.startedAt}))/3600)::numeric,1)`,
    })
    .from(tickets)
    .where(range.length ? and(...range) : undefined)
    .groupBy(tickets.teamId);

  const wmap = new Map(works.map((w) => [w.performedBy, w]));
  const tmap = new Map(teamStats.map((t) => [t.teamId, t]));
  return techs.map((t) => {
    const w = wmap.get(t.id);
    const ts = t.teamId ? tmap.get(t.teamId) : undefined;
    return {
      ...t,
      works: w?.works ?? 0,
      minutes: w?.minutes ?? 0,
      ticketsTouched: w?.ticketsTouched ?? 0,
      teamActiveTickets: ts?.active ?? 0,
      teamDoneTickets: ts?.done ?? 0,
      teamOverdue: ts?.overdue ?? 0,
      teamAvgHours: ts?.avgHours ?? null,
    };
  });
}

/** Расход (установка) оборудования в разрезе бригада → клиент → заявка. */
export async function inventoryConsumption(f: { teamId?: number; clientId?: number; from?: Date; to?: Date } = {}) {
  const conds = [eq(stockTransactions.type, "install")];
  if (f.teamId) conds.push(eq(stockTransactions.teamId, f.teamId));
  if (f.clientId) conds.push(eq(stockTransactions.clientId, f.clientId));
  if (f.from) conds.push(gte(stockTransactions.createdAt, f.from));
  if (f.to) conds.push(lte(stockTransactions.createdAt, f.to));
  return db
    .select({
      teamId: stockTransactions.teamId,
      teamName: teams.name,
      clientId: stockTransactions.clientId,
      clientName: clients.name,
      ticketId: stockTransactions.ticketId,
      ticketNumber: tickets.number,
      catalogItemId: stockTransactions.catalogItemId,
      sku: catalogItems.sku,
      itemName: catalogItems.name,
      unit: catalogItems.unit,
      quantity: sql<string>`sum(${stockTransactions.quantity})`,
      units: sql<number>`count(${stockTransactions.unitId})::int`,
    })
    .from(stockTransactions)
    .innerJoin(catalogItems, eq(catalogItems.id, stockTransactions.catalogItemId))
    .leftJoin(teams, eq(teams.id, stockTransactions.teamId))
    .leftJoin(clients, eq(clients.id, stockTransactions.clientId))
    .leftJoin(tickets, eq(tickets.id, stockTransactions.ticketId))
    .where(and(...conds))
    .groupBy(
      stockTransactions.teamId,
      teams.name,
      stockTransactions.clientId,
      clients.name,
      stockTransactions.ticketId,
      tickets.number,
      stockTransactions.catalogItemId,
      catalogItems.sku,
      catalogItems.name,
      catalogItems.unit,
    )
    .orderBy(teams.name, clients.name, desc(tickets.number));
}

/** Сводка по остаткам всех бригад (что выдано и не установлено). */
export async function teamsStockSummary() {
  // Запас бригады лежит в закреплённом за ней автомобиле, поэтому остатки
  // считаем по складу-автомобилю, а не по «складу бригады».
  const vans = await db
    .select({
      teamId: vehicleAssignments.teamId,
      warehouseId: warehouses.id,
      vehicleName: sql<string>`${vehicles.model} || ' · ' || ${vehicles.plateNumber}`,
    })
    .from(vehicleAssignments)
    .innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId))
    .innerJoin(warehouses, eq(warehouses.vehicleId, vehicles.id))
    .where(isNull(vehicleAssignments.releasedAt));
  const vanByTeam = new Map(vans.map((v) => [v.teamId, v]));

  const qty = await db
    .select({ warehouseId: stockBalances.warehouseId, items: sql<number>`count(*) filter (where ${stockBalances.quantity} > 0)::int` })
    .from(stockBalances)
    .where(eq(stockBalances.locationType, "warehouse"))
    .groupBy(stockBalances.warehouseId);
  const qByWarehouse = new Map(qty.map((q) => [q.warehouseId, q.items]));

  const units = await db
    .select({
      teamId: equipmentUnits.teamId,
      atTeam: sql<number>`count(*) filter (where ${equipmentUnits.status}='at_team')::int`,
      reserved: sql<number>`count(*) filter (where ${equipmentUnits.status}='reserved')::int`,
    })
    .from(equipmentUnits)
    .where(sql`${equipmentUnits.teamId} is not null and ${equipmentUnits.status} in ('at_team','reserved')`)
    .groupBy(equipmentUnits.teamId);
  const umap = new Map(units.map((u) => [u.teamId, u]));

  const allTeams = await db.select().from(teams).where(eq(teams.isActive, true));
  return allTeams.map((t) => {
    const van = vanByTeam.get(t.id);
    return {
      teamId: t.id,
      teamName: t.name,
      vehicleName: van?.vehicleName ?? null,
      warehouseId: van?.warehouseId ?? null,
      materialItems: van ? (qByWarehouse.get(van.warehouseId) ?? 0) : 0,
      unitsAtTeam: umap.get(t.id)?.atTeam ?? 0,
      unitsReserved: umap.get(t.id)?.reserved ?? 0,
    };
  });
}


/** Отчёт по клиентам: заявки, установленное оборудование. */
export async function clientsReport() {
  return db
    .select({
      clientId: clients.id,
      clientName: clients.name,
      tickets: sql<number>`count(distinct ${tickets.id})::int`,
      open: sql<number>`count(distinct ${tickets.id}) filter (where ${tickets.status} not in ('done','closed','cancelled'))::int`,
      installedUnits: sql<number>`(select count(*) from equipment_units eu join sites s on s.id = eu.site_id where s.client_id = ${clients.id} and eu.status='installed')::int`,
      sites: sql<number>`(select count(*) from sites s where s.client_id = ${clients.id})::int`,
    })
    .from(clients)
    .leftJoin(tickets, eq(tickets.clientId, clients.id))
    .groupBy(clients.id, clients.name)
    .orderBy(clients.name);
}
