import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { canWithRole, type Permission } from "@/lib/rbac";
import { AuditContext, describe, recordAudit } from "@/lib/services/audit";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, "BAD_REQUEST", msg, details);
export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Требуется аутентификация");
export const forbidden = (msg = "Недостаточно прав") => new ApiError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Не найдено") => new ApiError(404, "NOT_FOUND", msg);
export const conflict = (msg: string) => new ApiError(409, "CONFLICT", msg);

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status },
    );
  }
  console.error(err);
  // Непредвиденную ошибку наружу не пересказываем: текст драйвера БД выдаёт имена
  // таблиц и колонок. Разработчику она видна в логе, пользователю — нейтральный текст.
  const message =
    process.env.NODE_ENV === "production"
      ? "Внутренняя ошибка. Обратитесь к администратору."
      : err instanceof Error
        ? err.message
        : "Внутренняя ошибка";
  return NextResponse.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
}

/**
 * Запрос пришёл со «своей» страницы?
 *
 * Cookie сессии помечена SameSite=lax, поэтому чужой сайт не отправит её POST-ом.
 * Проверка Origin — второй рубеж на случай, если браузер старый или установка
 * работает за прокси, переписывающим правила cookie. Запросы без Origin (мобильный
 * клиент с токеном, curl) не отклоняем: у них нет неявной аутентификации cookie.
 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const from = new URL(origin);
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return !host || from.host === host;
  } catch {
    return false;
  }
}

/**
 * Контекст роута Next: второй аргумент обязателен — на этом настаивает проверка
 * типов маршрутов (`ParamCheck<RouteContext>`). У статических роутов `params`
 * приходит пустым объектом, поэтому читаем его защищённо.
 */
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: { user: SessionUser; params: Record<string, string>; audit: AuditContext }) => Promise<Response>;

/** Методы, меняющие данные: только они попадают в журнал действий. */
const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** IP клиента с учётом обратного прокси. */
function clientIp(req: Request) {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
}

/**
 * Обёртка для роутов: аутентификация, проверка права и запись в журнал действий.
 *
 * Журнал ведётся здесь, а не в сервисах: слой API видит каждый изменяющий запрос,
 * поэтому ни одно действие не остаётся незаписанным просто потому, что кто-то забыл
 * добавить вызов. Обработчик может уточнить запись через `ctx.audit.set(...)`.
 */
export function withAuth(handler: Handler, perms: Permission[] = []) {
  return async (req: Request, ctx: Ctx) => {
    const audit = new AuditContext();
    let user: SessionUser | null = null;
    const mutating = MUTATING.has(req.method);
    try {
      if (mutating && !sameOrigin(req)) throw new ApiError(403, "CROSS_ORIGIN", "Запрос отклонён: источник не совпадает с адресом системы");
      const current = await getCurrentUser();
      if (!current) throw unauthorized();
      user = current; // сохраняем для ветки ошибки: там нужен исполнитель для журнала
      if (perms.length && !perms.some((p) => canWithRole(current, p))) throw forbidden();
      const params = (await ctx?.params) ?? {};
      // Тело читаем до обработчика: после него поток уже вычитан
      const body = mutating ? await bodyForAudit(req) : undefined;
      const res = await handler(req, { user: current, params, audit });
      if (mutating && res.ok) await writeAudit(req, current, audit, res.status, undefined, body);
      return res;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      // Отказы по правам тоже интересны: это след попытки сделать лишнее
      if (mutating && user && status === 403) await writeAudit(req, user, audit, status, "denied");
      return fail(e);
    }
  };
}

/**
 * Тело запроса для журнала: что именно прислал пользователь.
 *
 * Читаем копию, чтобы обработчик получил поток нетронутым, и только у небольших
 * JSON-запросов: у выгрузок и вложений тело весит мегабайты, а журналу от него
 * пользы нет. Пароли и вложения вычищаются позже, при записи (sanitize).
 */
const AUDIT_BODY_LIMIT = 64 * 1024;
async function bodyForAudit(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return undefined;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > AUDIT_BODY_LIMIT) return undefined;
  try {
    const text = await req.clone().text();
    if (!text || text.length > AUDIT_BODY_LIMIT) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function writeAudit(req: Request, user: SessionUser, audit: AuditContext, status: number, force?: "denied", body?: unknown) {
  const url = new URL(req.url);
  const base = describe(req.method, url.pathname);
  const extra = audit.value;
  await recordAudit({
    user,
    action: force ?? extra.action ?? base.action,
    entity: extra.entity ?? base.entity,
    entityId: extra.entityId ?? base.entityId,
    entityLabel: extra.entityLabel ?? null,
    summary: force === "denied" ? `Отказано в доступе: ${extra.summary ?? base.summary}` : (extra.summary ?? base.summary),
    method: req.method,
    path: url.pathname + (url.search || ""),
    status,
    // Обработчик знает больше — его подробности важнее сырого тела запроса
    details: extra.details ?? (body === undefined ? undefined : { запрос: body }),
    ip: clientIp(req),
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw badRequest("Некорректный JSON");
  }
}

/** Разбирает и валидирует тело запроса по zod-схеме. Ошибки — читаемым списком полей. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const raw = await readJson(req);
  const res = schema.safeParse(raw);
  if (!res.success) throw badRequest(formatIssues(res.error.issues), res.error.issues);
  return res.data;
}

/** Разбирает и валидирует query-параметры по zod-схеме. */
export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const res = schema.safeParse(params);
  if (!res.success) throw badRequest(formatIssues(res.error.issues), res.error.issues);
  return res.data;
}

/** Валидирует id из пути (/tickets/[id]). */
export function parseId(params: Record<string, string>, key = "id"): number {
  const n = Number(params[key]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Некорректный ${key} в адресе запроса`);
  return n;
}

type Issue = { path: PropertyKey[]; message: string };
function formatIssues(issues: Issue[]): string {
  return issues
    .map((i) => {
      const path = i.path.map(String).join(".");
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join("; ");
}
