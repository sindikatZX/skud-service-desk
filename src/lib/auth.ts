import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { users, teamMembers, roles, type RoleScope } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { isPermission, type Permission } from "@/lib/rbac";

const COOKIE_NAME = "fsm_session";
const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me-in-production");
const SESSION_TTL_SEC = 60 * 60 * 24 * 14; // 14 дней

export type SessionUser = {
  id: number;
  email: string;
  fullName: string;
  roleId: number;
  /** Код роли — для отображения и совместимости; проверки прав идут через permissions. */
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
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.sub ? Number(payload.sub) : null;
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

export async function loadSessionUser(userId: number): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      clientId: users.clientId,
      roleId: roles.id,
      roleCode: roles.code,
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
    role: row.roleCode,
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
  const uid = await verifyToken(token);
  if (!uid) return null;
  return loadSessionUser(uid);
}
