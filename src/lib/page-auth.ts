import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { canAnyWithRole, type Permission } from "@/lib/rbac";

/** Для серверных страниц: требует авторизации и хотя бы одного из прав; иначе редирект. */
export async function requireUser(perms: Permission[] = []): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (perms.length && !canAnyWithRole(user, perms)) redirect("/tickets?denied=1");
  return user;
}
