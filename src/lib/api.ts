import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { can, type Permission } from "@/lib/rbac";

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
  const message = err instanceof Error ? err.message : "Внутренняя ошибка";
  return NextResponse.json({ ok: false, error: { code: "INTERNAL", message } }, { status: 500 });
}

/**
 * Контекст роута Next: второй аргумент обязателен — на этом настаивает проверка
 * типов маршрутов (`ParamCheck<RouteContext>`). У статических роутов `params`
 * приходит пустым объектом, поэтому читаем его защищённо.
 */
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: { user: SessionUser; params: Record<string, string> }) => Promise<Response>;

/** Обёртка для роутов: аутентификация + проверка права (любого из списка). */
export function withAuth(handler: Handler, perms: Permission[] = []) {
  return async (req: Request, ctx: Ctx) => {
    try {
      const user = await getCurrentUser();
      if (!user) throw unauthorized();
      if (perms.length && !perms.some((p) => can(user, p))) throw forbidden();
      const params = (await ctx?.params) ?? {};
      return await handler(req, { user, params });
    } catch (e) {
      return fail(e);
    }
  };
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
