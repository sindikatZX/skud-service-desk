"use client";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/v1${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({ ok: false, error: { code: "PARSE", message: "Ошибка ответа сервера" } }))) as ApiResult<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}
