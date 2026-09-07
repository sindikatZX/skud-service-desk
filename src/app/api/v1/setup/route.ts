import { ok, withAuth, parseBody } from "@/lib/api";
import { getInstallation, saveInstallation } from "@/lib/services/setup";
import { updateBranding } from "@/lib/services/branding";
import { setupSchema } from "@/lib/validators";
import { MODULE_BY_ID, type ModuleId } from "@/lib/modules";

/** Текущая конфигурация установки: состав модулей и назначение системы. */
export const GET = withAuth(async () => ok(await getInstallation()));

/**
 * Сохранение настройки установки. Название системы хранится в оформлении
 * (оно же уходит в манифест PWA), остальное — в конфигурации установки.
 */
export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, setupSchema);
  if (b.appName) await updateBranding({ appName: b.appName }, user.id);
  // Неизвестные идентификаторы модулей отбрасываем: список модулей задаёт код, а не запрос
  const enabledModules = b.enabledModules?.filter((id): id is ModuleId => MODULE_BY_ID.has(id as ModuleId));
  const installation = await saveInstallation(
    { preset: b.preset, enabledModules, labels: b.labels, configured: b.configured },
    user.id,
  );
  return ok(installation);
}, ["admin.maintenance", "users.manage"]);
