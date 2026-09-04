import { db } from "@/db";
import { nextCode } from "@/lib/codes";
import { users, teamMembers, teams, roles } from "@/db/schema";
import { and, eq, isNull, asc } from "drizzle-orm";
import { ok, withAuth, parseBody, conflict } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { userCreateSchema } from "@/lib/validators";

export const GET = withAuth(async () => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phone: users.phone,
      roleId: users.roleId,
      roleName: roles.name,
      roleCode: roles.code,
      isFieldStaff: roles.isFieldStaff,
      clientId: users.clientId,
      isActive: users.isActive,
      teamId: teamMembers.teamId,
      teamName: teams.name,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(teamMembers, and(eq(teamMembers.userId, users.id), isNull(teamMembers.leftAt)))
    .leftJoin(teams, eq(teams.id, teamMembers.teamId))
    .orderBy(asc(users.fullName));
  return ok(rows);
}, ["users.manage", "teams.read"]);

export const POST = withAuth(async (req) => {
  const b = await parseBody(req, userCreateSchema);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, b.email));
  if (exists) throw conflict("Пользователь с таким email уже существует");
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, b.roleId));
  if (!role) throw conflict("Указанная роль не найдена");

  const [u] = await db
    .insert(users)
    .values({
      code: await nextCode("users"),
      email: b.email,
      passwordHash: await hashPassword(b.password),
      fullName: b.fullName,
      phone: b.phone,
      roleId: b.roleId,
      clientId: b.clientId ?? null,
    })
    .returning({ id: users.id, email: users.email, fullName: users.fullName, roleId: users.roleId });
  return ok(u, { status: 201 });
}, ["users.manage"]);
