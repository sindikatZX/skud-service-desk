import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, conflict, forbidden } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { profileUpdateSchema } from "@/lib/validators";

export const GET = withAuth(async (_req, { user }) => ok({ user, permissions: user.permissions }));

/**
 * Самостоятельное изменение учётной записи: ФИО, телефон, логин (email), пароль.
 * Роль, клиент и активность здесь не меняются — это делает администратор.
 * Смена логина и пароля требует подтверждения текущим паролем.
 */
export const PATCH = withAuth(async (req, { user }) => {
  const b = await parseBody(req, profileUpdateSchema);
  const [me] = await db.select().from(users).where(eq(users.id, user.id));
  if (!me) throw forbidden();
  const set: Partial<typeof users.$inferInsert> = {};
  if (b.fullName !== undefined) set.fullName = b.fullName;
  if (b.phone !== undefined) set.phone = b.phone;
  if (b.email !== undefined && b.email !== me.email) {
    if (!(await verifyPassword(b.currentPassword ?? "", me.passwordHash))) throw forbidden("Неверный текущий пароль");
    const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, b.email));
    if (dup && dup.id !== me.id) throw conflict("Этот логин уже занят");
    set.email = b.email;
  }
  if (b.newPassword) {
    if (!(await verifyPassword(b.currentPassword ?? "", me.passwordHash))) throw forbidden("Неверный текущий пароль");
    set.passwordHash = await hashPassword(b.newPassword);
  }
  if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, user.id));
  const [fresh] = await db.select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, user.id));
  return ok(fresh);
});
