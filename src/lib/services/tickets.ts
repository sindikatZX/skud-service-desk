import { db } from "@/db";
import {
  tickets,
  ticketStatusHistory,
  ticketWorks,
  ticketTypes,
  ticketPriorities,
  clients,
  sites,
  teams,
  users,
  teamMembers,
  type TicketStatus,
} from "@/db/schema";
import { and, eq, desc, inArray, sql, isNull, or, lt, notInArray, asc } from "drizzle-orm";
import { conflict, forbidden, notFound } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";

/** Допустимые переходы статусов (см. docs/07-business-processes.md). */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["assigned", "cancelled"],
  assigned: ["scheduled", "in_progress", "new", "cancelled"],
  scheduled: ["in_progress", "assigned", "on_hold", "cancelled"],
  in_progress: ["done", "on_hold", "cancelled"],
  on_hold: ["in_progress", "scheduled", "cancelled"],
  done: ["closed", "in_progress"],
  closed: [],
  cancelled: ["new"],
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Новая",
  assigned: "Назначена",
  scheduled: "Запланирована",
  in_progress: "В работе",
  on_hold: "Приостановлена",
  done: "Выполнена",
  closed: "Закрыта",
  cancelled: "Отменена",
};

/** Какое право нужно для перехода в статус. */
const TRANSITION_PERMS: Partial<Record<TicketStatus, (u: SessionUser) => boolean>> = {
  assigned: (u) => can(u, "tickets.assign"),
  scheduled: (u) => can(u, "tickets.schedule"),
  new: (u) => can(u, "tickets.assign"),
  in_progress: (u) => can(u, "tickets.work") || can(u, "tickets.assign"),
  on_hold: (u) => can(u, "tickets.work") || can(u, "tickets.assign"),
  done: (u) => can(u, "tickets.work") || can(u, "tickets.close"),
  closed: (u) => can(u, "tickets.close"),
  cancelled: (u) => can(u, "tickets.cancel"),
};

const baseSelect = {
  id: tickets.id,
  number: tickets.number,
  title: tickets.title,
  description: tickets.description,
  typeId: tickets.typeId,
  typeName: ticketTypes.name,
  typeCode: ticketTypes.code,
  priorityId: tickets.priorityId,
  priorityName: ticketPriorities.name,
  priorityCode: ticketPriorities.code,
  priorityColor: ticketPriorities.colorClass,
  status: tickets.status,
  clientId: tickets.clientId,
  clientName: clients.name,
  siteId: tickets.siteId,
  siteName: sites.name,
  siteAddress: sites.address,
  teamId: tickets.teamId,
  teamName: teams.name,
  dispatcherId: tickets.dispatcherId,
  dispatcherName: users.fullName,
  scheduledStart: tickets.scheduledStart,
  scheduledEnd: tickets.scheduledEnd,
  dueAt: tickets.dueAt,
  startedAt: tickets.startedAt,
  completedAt: tickets.completedAt,
  closedAt: tickets.closedAt,
  resultNote: tickets.resultNote,
  createdBy: tickets.createdBy,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
};

function baseQuery() {
  return db
    .select(baseSelect)
    .from(tickets)
    .innerJoin(clients, eq(clients.id, tickets.clientId))
    .innerJoin(sites, eq(sites.id, tickets.siteId))
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.typeId))
    .innerJoin(ticketPriorities, eq(ticketPriorities.id, tickets.priorityId))
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .leftJoin(users, eq(users.id, tickets.dispatcherId));
}

/** Ограничение видимости заявок по области данных роли. */
export function scopeFor(user: SessionUser) {
  if (can(user, "tickets.read.all")) return undefined;
  if (user.scope === "team") return user.teamId ? eq(tickets.teamId, user.teamId) : sql`false`;
  if (user.scope === "client") return user.clientId ? eq(tickets.clientId, user.clientId) : sql`false`;
  return sql`false`;
}

export async function listTickets(
  user: SessionUser,
  f: { status?: string; teamId?: number; clientId?: number; siteId?: number; q?: string; overdue?: boolean; limit?: number } = {},
) {
  const conds = [];
  const scope = scopeFor(user);
  if (scope) conds.push(scope);
  if (f.status) {
    const list = f.status.split(",") as TicketStatus[];
    conds.push(inArray(tickets.status, list));
  }
  if (f.teamId) conds.push(eq(tickets.teamId, f.teamId));
  if (f.clientId) conds.push(eq(tickets.clientId, f.clientId));
  if (f.siteId) conds.push(eq(tickets.siteId, f.siteId));
  if (f.q) conds.push(or(sql`${tickets.title} ilike ${"%" + f.q + "%"}`, sql`${tickets.number} ilike ${"%" + f.q + "%"}`));
  if (f.overdue) conds.push(and(lt(tickets.dueAt, new Date()), notInArray(tickets.status, ["done", "closed", "cancelled"])));
  return baseQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(tickets.createdAt))
    .limit(f.limit ?? 200);
}

export async function getTicket(user: SessionUser, id: number) {
  const scope = scopeFor(user);
  const [t] = await baseQuery().where(scope ? and(eq(tickets.id, id), scope) : eq(tickets.id, id));
  if (!t) throw notFound("Заявка не найдена");
  return t;
}

export async function getTicketDetails(user: SessionUser, id: number) {
  const ticket = await getTicket(user, id);
  const [history, works, members] = await Promise.all([
    db
      .select({
        id: ticketStatusHistory.id,
        fromStatus: ticketStatusHistory.fromStatus,
        toStatus: ticketStatusHistory.toStatus,
        comment: ticketStatusHistory.comment,
        createdAt: ticketStatusHistory.createdAt,
        actorName: users.fullName,
      })
      .from(ticketStatusHistory)
      .leftJoin(users, eq(users.id, ticketStatusHistory.actorId))
      .where(eq(ticketStatusHistory.ticketId, id))
      .orderBy(desc(ticketStatusHistory.createdAt)),
    db
      .select({
        id: ticketWorks.id,
        description: ticketWorks.description,
        quantity: ticketWorks.quantity,
        unit: ticketWorks.unit,
        durationMinutes: ticketWorks.durationMinutes,
        performerName: users.fullName,
        createdAt: ticketWorks.createdAt,
      })
      .from(ticketWorks)
      .leftJoin(users, eq(users.id, ticketWorks.performedBy))
      .where(eq(ticketWorks.ticketId, id))
      .orderBy(desc(ticketWorks.createdAt)),
    ticket.teamId
      ? db
          .select({ id: users.id, fullName: users.fullName, isLead: teamMembers.isLead })
          .from(teamMembers)
          .innerJoin(users, eq(users.id, teamMembers.userId))
          .where(and(eq(teamMembers.teamId, ticket.teamId), isNull(teamMembers.leftAt)))
      : Promise.resolve([]),
  ]);
  return { ticket, history, works, teamMembers: members, allowedTransitions: allowedFor(user, ticket.status) };
}

export function allowedFor(user: SessionUser, status: TicketStatus): TicketStatus[] {
  return TRANSITIONS[status].filter((s) => TRANSITION_PERMS[s]?.(user) ?? false);
}

/** Срок по умолчанию из SLA приоритета, если пользователь не задал его вручную. */
async function dueFromPriority(priorityId: number): Promise<Date | null> {
  const [p] = await db.select({ slaHours: ticketPriorities.slaHours }).from(ticketPriorities).where(eq(ticketPriorities.id, priorityId));
  if (!p?.slaHours) return null;
  return new Date(Date.now() + p.slaHours * 3600_000);
}

export async function createTicket(
  user: SessionUser,
  input: {
    clientId: number;
    siteId: number;
    title: string;
    description?: string | null;
    typeId: number;
    priorityId: number;
    dueAt?: Date | null;
    teamId?: number | null;
    scheduledStart?: Date | null;
    scheduledEnd?: Date | null;
  },
) {
  if (user.scope === "client" && user.clientId !== input.clientId) throw forbidden("Клиент может создавать заявки только для себя");
  const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId));
  if (!site || site.clientId !== input.clientId) throw conflict("Объект не принадлежит клиенту");

  const dueAt = input.dueAt ?? (await dueFromPriority(input.priorityId));

  return db.transaction(async (tx) => {
    const status: TicketStatus = input.teamId ? (input.scheduledStart ? "scheduled" : "assigned") : "new";
    const [t] = await tx
      .insert(tickets)
      .values({
        clientId: input.clientId,
        siteId: input.siteId,
        title: input.title,
        description: input.description ?? null,
        typeId: input.typeId,
        priorityId: input.priorityId,
        dueAt,
        teamId: input.teamId ?? null,
        scheduledStart: input.scheduledStart ?? null,
        scheduledEnd: input.scheduledEnd ?? null,
        dispatcherId: can(user, "tickets.assign") ? user.id : null,
        status,
        createdBy: user.id,
      })
      .returning();
    const number = `ЗК-${new Date().getFullYear()}-${String(t.id).padStart(5, "0")}`;
    await tx.update(tickets).set({ number }).where(eq(tickets.id, t.id));
    await tx.insert(ticketStatusHistory).values({ ticketId: t.id, fromStatus: null, toStatus: "new", actorId: user.id, comment: "Заявка создана" });
    if (status !== "new")
      await tx.insert(ticketStatusHistory).values({ ticketId: t.id, fromStatus: "new", toStatus: status, actorId: user.id, comment: "Назначена при создании" });
    return { ...t, number };
  });
}

export async function updateTicket(
  user: SessionUser,
  id: number,
  patch: Partial<{
    title: string;
    description: string | null;
    typeId: number;
    priorityId: number;
    dueAt: Date | null;
    teamId: number | null;
    dispatcherId: number | null;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    resultNote: string | null;
  }>,
) {
  const t = await getTicket(user, id);
  const canAssign = can(user, "tickets.assign");
  const set: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
  if (canAssign) {
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.typeId !== undefined) set.typeId = patch.typeId;
    if (patch.priorityId !== undefined) set.priorityId = patch.priorityId;
    if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
    if (patch.teamId !== undefined) set.teamId = patch.teamId;
    if (patch.dispatcherId !== undefined) set.dispatcherId = patch.dispatcherId;
    if (patch.scheduledStart !== undefined) set.scheduledStart = patch.scheduledStart;
    if (patch.scheduledEnd !== undefined) set.scheduledEnd = patch.scheduledEnd;
  }
  if (patch.resultNote !== undefined && (canAssign || can(user, "tickets.work"))) set.resultNote = patch.resultNote;

  return db.transaction(async (tx) => {
    await tx.update(tickets).set(set).where(eq(tickets.id, id));
    // автопереходы при назначении/планировании
    if (canAssign) {
      if (patch.teamId && t.status === "new") {
        await tx.update(tickets).set({ status: "assigned" }).where(eq(tickets.id, id));
        await tx.insert(ticketStatusHistory).values({ ticketId: id, fromStatus: "new", toStatus: "assigned", actorId: user.id, comment: "Назначена бригада" });
      } else if (patch.teamId && t.teamId !== patch.teamId) {
        await tx.insert(ticketStatusHistory).values({ ticketId: id, fromStatus: t.status, toStatus: t.status, actorId: user.id, comment: "Переназначена бригада" });
      }
      const teamAfter = patch.teamId !== undefined ? patch.teamId : t.teamId;
      if (patch.scheduledStart && teamAfter && ["new", "assigned"].includes(t.status)) {
        await tx.update(tickets).set({ status: "scheduled" }).where(eq(tickets.id, id));
        await tx.insert(ticketStatusHistory).values({ ticketId: id, fromStatus: t.status === "new" ? "assigned" : t.status, toStatus: "scheduled", actorId: user.id, comment: "Запланирован выезд" });
      }
    }
    const [res] = await tx.select().from(tickets).where(eq(tickets.id, id));
    return res;
  });
}

/**
 * Смена статуса. Строка заявки блокируется внутри транзакции (SELECT … FOR UPDATE),
 * поэтому два одновременных перехода не могут разойтись с историей статусов.
 */
export async function changeStatus(user: SessionUser, id: number, to: TicketStatus, comment?: string | null) {
  await getTicket(user, id); // проверка доступа по области видимости роли
  if (!(TRANSITION_PERMS[to]?.(user) ?? false)) throw forbidden("Ваша роль не может выполнить этот переход");

  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, id)).for("update");
    if (!t) throw notFound("Заявка не найдена");
    // Проверки выполняются уже под блокировкой — на актуальном статусе.
    if (!TRANSITIONS[t.status].includes(to)) throw conflict(`Переход ${STATUS_LABELS[t.status]} → ${STATUS_LABELS[to]} недопустим`);
    if (["assigned", "scheduled", "in_progress"].includes(to) && !t.teamId) throw conflict("Сначала назначьте бригаду");
    if (user.scope === "team" && t.teamId !== user.teamId) throw forbidden("Заявка не назначена вашей бригаде");

    const now = new Date();
    const set: Partial<typeof tickets.$inferInsert> = { status: to, updatedAt: now };
    if (to === "in_progress" && !t.startedAt) set.startedAt = now;
    if (to === "done") set.completedAt = now;
    if (to === "closed") set.closedAt = now;
    if (to === "done" && comment) set.resultNote = comment;

    await tx.update(tickets).set(set).where(eq(tickets.id, id));
    await tx.insert(ticketStatusHistory).values({ ticketId: id, fromStatus: t.status, toStatus: to, actorId: user.id, comment });
    const [res] = await tx.select().from(tickets).where(eq(tickets.id, id));
    return res;
  });
}

export async function addWork(
  user: SessionUser,
  ticketId: number,
  input: { description: string; quantity?: number; unit?: string; durationMinutes?: number | null; performedBy?: number | null },
) {
  const t = await getTicket(user, ticketId);
  if (["closed", "cancelled"].includes(t.status)) throw conflict("Заявка закрыта");
  if (user.scope === "team" && t.teamId !== user.teamId) throw forbidden();
  const [w] = await db
    .insert(ticketWorks)
    .values({
      ticketId,
      description: input.description,
      quantity: String(input.quantity ?? 1),
      unit: input.unit ?? "шт",
      durationMinutes: input.durationMinutes ?? null,
      performedBy: input.performedBy ?? user.id,
    })
    .returning();
  return w;
}

/** История обслуживания объекта/клиента. */
export async function serviceHistory(user: SessionUser, f: { clientId?: number; siteId?: number }) {
  return listTickets(user, { clientId: f.clientId, siteId: f.siteId, limit: 500 });
}

/** Сотрудники, которых можно назначить исполнителем работ (полевой персонал). */
export async function fieldStaff() {
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.fullName));
}
