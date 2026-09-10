import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { users, teamMembers, roles, type RoleScope } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { isPermission, type Permission } from "@/lib/rbac";

const COOKIE_NAME = "fsm_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 дней

/**
 * Ключ подписи сессий.
 *
 * В рабочей установке он обязателен: со значением по умолчанию любой, кто знает
 * исходный код, подписал бы себе токен администратора. Поэтому в production при
 * отсутствии (или слишком коротком) AUTH_SECRET приложение отказывается выдавать
 * и проверять сессии — молча работать с известным ключом опаснее, чем не работать.
 * В разработке остаётся запасной ключ, чтобы не мешать запуску.
 */
const MIN_SECRET_LENGTH = 32;
const DEV_SECRET = "dev-secret-change-me-in-production";
function sessionSecret() {
  const raw = process.env.AUTH_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && (raw.length < MIN_SECRET_LENGTH || raw === DEV_SECRET)) {
    throw new Error(`AUTH_SECRET не задан или короче ${MIN_SECRET_LENGTH} символов — вход отключён. Задайте случайную строку в переменных окружения.`);
  }
  return new TextEncoder().encode(raw || DEV_SECRET);
}

export type SessionUser = {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
  /** Системный ключ роли (admin, technician…) либо её код; проверки прав идут через permissions. */
  role: string;
  roleName: string;
  scope: RoleScope;
  isFieldStaff: boolean;
  permissions: Permission[];
  clientId: number | null;
  teamId: number | null;
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function signToken(userId: number) {
  const secret = sessionSecret();
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret);
}

/** Идентификатор пользователя и момент выдачи токена (нужен для отзыва старых сессий). */
export async function verifyToken(token: string): Promise<{ userId: number; issuedAt: number } | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (!payload.sub) return null;
    return { userId: Number(payload.sub), issuedAt: (payload.iat ?? 0) * 1000 };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function loadSessionUser(userId: number, issuedAt?: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      passwordChangedAt: users.passwordChangedAt,
      clientId: users.clientId,
      roleId: roles.id,
      roleCode: roles.code,
      roleKey: roles.sysKey,
      roleName: roles.name,
      scope: roles.scope,
      isFieldStaff: roles.isFieldStaff,
      roleActive: roles.isActive,
      permissions: roles.permissions,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId))
    .limit(1);
  // Отключённая роль лишает доступа так же, как отключённый пользователь.
  if (!row || !row.isActive || !row.roleActive) return null;
  // Смена пароля обрывает ранее выданные сессии: иначе украденный токен жил бы
  // до истечения срока, даже когда владелец уже сменил пароль
  if (issuedAt !== undefined && row.passwordChangedAt && issuedAt < row.passwordChangedAt.getTime()) return null;
  const [tm] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, row.id), isNull(teamMembers.leftAt)))
    .limit(1);
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    roleId: row.roleId,
    role: row.roleKey ?? row.roleCode,
    roleName: row.roleName,
    scope: row.scope,
    isFieldStaff: row.isFieldStaff,
    permissions: row.permissions.filter(isPermission),
    clientId: row.clientId,
    teamId: tm?.teamId ?? null,
  };
}

/** Текущий пользователь: из cookie или из заголовка Authorization: Bearer (для мобильных клиентов). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  let token: string | undefined;
  try {
    const h = await headers();
    const auth = h.get("authorization");
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  } catch {}
  if (!token) {
    const c = await cookies();
    token = c.get(COOKIE_NAME)?.value;
  }
  if (!token) return null;
  const claims = await verifyToken(token);
  if (!claims) return null;
  return loadSessionUser(claims.userId, claims.issuedAt);
}
