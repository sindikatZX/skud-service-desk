import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, ok, parseBody, ApiError } from "@/lib/api";
import { verifyPassword, signToken, setSessionCookie, loadSessionUser } from "@/lib/auth";
import { loginSchema } from "@/lib/validators";

export async function POST(req: Request) {
  try {
    const { email, password } = await parseBody(req, loginSchema);
    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u || !u.isActive || !(await verifyPassword(password, u.passwordHash)))
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверный email или пароль");
    const user = await loadSessionUser(u.id);
    if (!user) throw new ApiError(403, "ROLE_DISABLED", "Роль учётной записи отключена — обратитесь к администратору");
    const token = await signToken(u.id);
    await setSessionCookie(token);
    return ok({ token, user });
  } catch (e) {
    return fail(e);
  }
}
