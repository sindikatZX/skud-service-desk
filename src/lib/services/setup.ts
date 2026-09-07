import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { CORE_MODULES, MODULES, PRESETS, withDependencies, type ModuleId } from "@/lib/modules";

/**
 * Конфигурация установки: чем занимается система и какие модули включены.
 *
 * Код у всех заказчиков один, различается конфигурация — так одна и та же система
 * работает и как сервис-деск, и как складской учёт, и как запись клиентов в салон.
 * Настройка выполняется мастером `/setup` при первом запуске и меняется позже
 * в разделе «Администрирование».
 */

const KEY = "installation";

export type Installation = {
  /** Настройка пройдена: до этого приложение ведёт администратора в мастер. */
  configured: boolean;
  /** Род занятий: определяет стартовый набор модулей и подписи разделов. */
  preset: string;
  enabledModules: ModuleId[];
  /** Переименования разделов: путь → название. */
  labels: Record<string, string>;
  configuredAt: string | null;
};

export const DEFAULT_INSTALLATION: Installation = {
  configured: false,
  preset: "service",
  // До настройки доступно всё: свежая установка не должна выглядеть сломанной
  enabledModules: MODULES.map((m) => m.id),
  labels: {},
  configuredAt: null,
};

let cache: { value: Installation; at: number } | null = null;
export function invalidateInstallationCache() {
  cache = null;
}

export async function getInstallation(): Promise<Installation> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const v = (row?.value ?? {}) as Partial<Installation>;
    const value: Installation = {
      ...DEFAULT_INSTALLATION,
      ...v,
      enabledModules: v.enabledModules?.length ? withDependencies(v.enabledModules) : DEFAULT_INSTALLATION.enabledModules,
      labels: v.labels ?? {},
      configuredAt: row?.updatedAt?.toISOString() ?? null,
    };
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // База может быть ещё не готова — приложение не должно падать на старте
    return DEFAULT_INSTALLATION;
  }
}

export async function saveInstallation(
  input: { preset?: string; enabledModules?: ModuleId[]; labels?: Record<string, string>; configured?: boolean },
  userId?: number,
) {
  const current = await getInstallation();
  const next: Omit<Installation, "configuredAt"> = {
    configured: input.configured ?? current.configured,
    preset: input.preset ?? current.preset,
    enabledModules: withDependencies(input.enabledModules ?? current.enabledModules),
    labels: input.labels ?? current.labels,
  };
  await db
    .insert(appSettings)
    .values({ key: KEY, value: next, updatedAt: new Date(), updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date(), updatedBy: userId ?? null } });
  invalidateInstallationCache();
  return getInstallation();
}

/** Заготовка по роду занятий: набор модулей и подписи разделов. */
export function presetById(id: string) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function isModuleEnabled(inst: Installation, id: ModuleId) {
  return CORE_MODULES.includes(id) || inst.enabledModules.includes(id);
}
