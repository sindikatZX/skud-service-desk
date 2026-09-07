import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { canAnyWithRole, type Permission } from "@/lib/rbac";
import { getInstallation, isModuleEnabled } from "@/lib/services/setup";
import type { ModuleId } from "@/lib/modules";

/** Для серверных страниц: требует авторизации и хотя бы одного из прав; иначе редирект. */
export async function requireUser(perms: Permission[] = []): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (perms.length && !canAnyWithRole(user, perms)) redirect("/tickets?denied=1");
  return user;
}

/**
 * Требует включённого модуля. Раздел выключенного модуля не должен открываться
 * даже по прямой ссылке: пользователя возвращаем на главную, а администратору
 * понятно, что модуль отключён в настройке системы.
 */
export async function requireModule(id: ModuleId) {
  const installation = await getInstallation();
  if (!isModuleEnabled(installation, id)) redirect("/?module=off");
  return installation;
}
