import { db } from "@/db";
import { teamMembers, users, roles } from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ok, withAuth, parseBody, parseQuery, parseId, conflict } from "@/lib/api";
import { teamMemberSchema, teamMemberRemoveSchema } from "@/lib/validators";
import { removeTeamMember } from "@/lib/services/deletion";

/** Добавить сотрудника в бригаду (макс. 3 активных участника; сотрудник может быть только в одной бригаде). */
export const POST = withAuth(async (req, { params }) => {
  const teamId = parseId(params);
  const b = await parseBody(req, teamMemberSchema);

  const [member] = await db
    .select({ id: users.id, isFieldStaff: roles.isFieldStaff, isActive: users.isActive })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, b.userId));
  if (!member) throw conflict("Сотрудник не найден");
  if (!member.isActive) throw conflict("Сотрудник деактивирован");
  if (!member.isFieldStaff) throw conflict("Роль сотрудника не предполагает работу в бригаде");

  const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), isNull(teamMembers.leftAt)));
  if (cnt >= 3) throw conflict("В бригаде уже 3 участника");

  await db.update(teamMembers).set({ leftAt: new Date() }).where(and(eq(teamMembers.userId, b.userId), isNull(teamMembers.leftAt)));
  const [m] = await db.insert(teamMembers).values({ teamId, userId: b.userId, isLead: b.isLead ?? false }).returning();
  return ok(m, { status: 201 });
}, ["teams.manage"]);

/** Вывести сотрудника из бригады (сохраняем историю). */
export const DELETE = withAuth(async (req, { params }) => {
  const { userId } = parseQuery(req, teamMemberRemoveSchema);
  await removeTeamMember(parseId(params), userId);
  return ok({ removed: true });
}, ["teams.manage"]);
