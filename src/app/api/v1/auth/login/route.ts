import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fail, ok, parseBody, ApiError } from "@/lib/api";
import { verifyPassword, signToken, setSessionCookie, loadSessionUser } from "@/lib/auth";
import { loginSchema } from "@/lib/validators";
import { clearLoginAttempts, loginBlockedFor, registerFailedLogin, LOGIN_LIMITS } from "@/lib/login-guard";
import { recordAudit } from "@/lib/services/audit";

function clientIp(req: Request) {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
}

/**
 * Вход. Неудачные попытки считаются и после нескольких подряд вход временно
 * блокируется: без этого пароль подбирается перебором, а журнал заполняется мусором.
 * И удачные, и неудачные попытки попадают в журнал действий — это след для разбора
 * инцидентов.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  let email = "";
  try {
    const parsed = await parseBody(req, loginSchema);
    email = parsed.email;

    const wait = loginBlockedFor(email, ip);
    if (wait > 0) {
      throw new ApiError(429, "TOO_MANY_ATTEMPTS", `Слишком много попыток входа. Повторите через ${Math.ceil(wait / 60)} мин.`);
    }

    const [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u || !u.isActive || !(await verifyPassword(parsed.password, u.passwordHash))) {
      registerFailedLogin(email, ip);
      await recordAudit({
        action: "denied",
        entity: "session",
        summary: `Неудачная попытка входа: ${email}`,
        method: "POST",
        path: "/api/v1/auth/login",
        status: 401,
        details: { email, осталосьПопыток: LOGIN_LIMITS.MAX_ATTEMPTS },
        ip,
      });
      throw new ApiError(401, "INVALID_CREDENTIALS", "Неверный email или пароль");
    }

    const user = await loadSessionUser(u.id);
    if (!user) throw new ApiError(403, "ROLE_DISABLED", "Роль учётной записи отключена — обратитесь к администратору");

    clearLoginAttempts(email, ip);
    const token = await signToken(u.id);
    await setSessionCookie(token);
    await recordAudit({ user, action: "login", entity: "session", summary: "Вошёл в систему", method: "POST", path: "/api/v1/auth/login", status: 200, ip });
    return ok({ token, user });
  } catch (e) {
    return fail(e);
  }
}
