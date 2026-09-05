import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { badRequest } from "@/lib/api";

/**
 * Оформление приложения (по образцу «Тема оформления» в Nextcloud):
 * название, слоган, основной цвет и логотип. Хранится в app_settings под ключом
 * `branding`; логотип — data-URL небольшого изображения (до ~400 КБ), поэтому
 * отдельного файлового хранилища не требуется, а резервная копия БД включает и его.
 */

export type Branding = {
  appName: string;
  tagline: string;
  /** Основной цвет интерфейса, hex #rrggbb. */
  primaryColor: string;
  /** Логотип (data:image/...;base64,...) или null — стандартная иконка. */
  logoDataUrl: string | null;
  /** Фон страницы входа: цвет-градиент из основного цвета либо своя картинка. */
  loginBgDataUrl: string | null;
  updatedAt: string | null;
};

export const DEFAULT_BRANDING: Branding = {
  appName: "СКУД•Сервис",
  tagline: "Service Desk / FSM",
  primaryColor: "#4f46e5",
  logoDataUrl: null,
  loginBgDataUrl: null,
  updatedAt: null,
};

/** Готовые цветовые схемы (как палитра в настройках темы Nextcloud). */
export const COLOR_PRESETS: { name: string; color: string }[] = [
  { name: "Индиго (по умолчанию)", color: "#4f46e5" },
  { name: "Nextcloud синий", color: "#0082c9" },
  { name: "Бирюзовый", color: "#0d9488" },
  { name: "Зелёный", color: "#16a34a" },
  { name: "Оранжевый", color: "#ea580c" },
  { name: "Красный", color: "#dc2626" },
  { name: "Фиолетовый", color: "#7c3aed" },
  { name: "Графит", color: "#334155" },
];

const KEY = "branding";
const MAX_IMAGE_BYTES = 400 * 1024;
const IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;

let cache: { value: Branding; at: number } | null = null;

export function invalidateBrandingCache() {
  cache = null;
}

/** Текущее оформление; при недоступной БД — значения по умолчанию (страница входа не должна падать). */
export async function getBranding(): Promise<Branding> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const v = (row?.value ?? {}) as Partial<Branding>;
    const value: Branding = {
      ...DEFAULT_BRANDING,
      ...v,
      appName: v.appName?.trim() || DEFAULT_BRANDING.appName,
      primaryColor: isHex(v.primaryColor) ? v.primaryColor! : DEFAULT_BRANDING.primaryColor,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
    cache = { value, at: Date.now() };
    return value;
  } catch {
    return DEFAULT_BRANDING;
  }
}

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

function checkImage(v: string | null | undefined, label: string) {
  if (v == null || v === "") return null;
  if (!IMAGE_RE.test(v)) throw badRequest(`${label}: ожидается изображение PNG, JPEG, WebP, GIF или SVG`);
  if (v.length > MAX_IMAGE_BYTES * 1.37) throw badRequest(`${label}: файл больше ${Math.round(MAX_IMAGE_BYTES / 1024)} КБ — уменьшите изображение`);
  return v;
}

export async function updateBranding(
  patch: { appName?: string; tagline?: string; primaryColor?: string; logoDataUrl?: string | null; loginBgDataUrl?: string | null },
  userId?: number,
) {
  const current = await getBranding();
  const next: Omit<Branding, "updatedAt"> = {
    appName: (patch.appName ?? current.appName).trim().slice(0, 60) || DEFAULT_BRANDING.appName,
    tagline: (patch.tagline ?? current.tagline).trim().slice(0, 120),
    primaryColor: patch.primaryColor ? (isHex(patch.primaryColor) ? patch.primaryColor.toLowerCase() : DEFAULT_BRANDING.primaryColor) : current.primaryColor,
    logoDataUrl: patch.logoDataUrl === undefined ? current.logoDataUrl : checkImage(patch.logoDataUrl, "Логотип"),
    loginBgDataUrl: patch.loginBgDataUrl === undefined ? current.loginBgDataUrl : checkImage(patch.loginBgDataUrl, "Фон страницы входа"),
  };
  await db
    .insert(appSettings)
    .values({ key: KEY, value: next, updatedAt: new Date(), updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date(), updatedBy: userId ?? null } });
  invalidateBrandingCache();
  return getBranding();
}

export async function resetBranding() {
  await db.delete(appSettings).where(eq(appSettings.key, KEY));
  invalidateBrandingCache();
  return getBranding();
}

/** Разбор data-URL в байты и MIME для отдачи логотипа как файла (favicon, manifest). */
export function dataUrlToBuffer(dataUrl: string): { mime: string; data: Buffer } | null {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], data: Buffer.from(m[2].replace(/\s/g, ""), "base64") };
}
