import { db } from "@/db";
import { users, roles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound, conflict } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { userUpdateSchema } from "@/lib/validators";
import { deleteUser } from "@/lib/services/deletion";

export const PATCH = withAuth(async (req, { params }) => {
  const id = parseId(params);
  const b = await parseBody(req, userUpdateSchema);
  const set: Partial<typeof users.$inferInsert> = {};
  if (b.fullName !== undefined) set.fullName = b.fullName;
  if (b.phone !== undefined) set.phone = b.phone;
  if (b.isActive !== undefined) set.isActive = b.isActive;
  if (b.clientId !== undefined) set.clientId = b.clientId ?? null;
  if (b.password) set.passwordHash = await hashPassword(b.password);
  if (b.roleId !== undefined) {
    const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, b.roleId));
    if (!role) throw conflict("Указанная роль не найдена");
    set.roleId = b.roleId;
  }
  const [u] = await db
    .update(users)
    .set(set)
    .where(eq(users.id, id))
    .returning({ id: users.id, fullName: users.fullName, roleId: users.roleId, isActive: users.isActive });
  if (!u) throw notFound("Сотрудник не найден");
  return ok(u);
}, ["users.manage"]);

export const DELETE = withAuth(async (_req, { user, params }) => {
  await deleteUser(user, parseId(params));
  return ok({ deleted: true });
}, ["users.manage"]);
