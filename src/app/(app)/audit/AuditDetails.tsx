"use client";

import { useState } from "react";

/**
 * Подробности записи журнала: разворачиваются по требованию.
 *
 * Показываем не сырой JSON, а пары «поле — значение»: ключи в записи уже
 * названы по-русски, а списки позиций разворачиваем построчно, чтобы «что
 * именно списали» читалось без расшифровки.
 */
export function AuditDetails({ details }: { details: unknown }) {
  const [open, setOpen] = useState(false);
  if (!details || typeof details !== "object") return null;
  const entries = Object.entries(details as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return null;

  return (
    <div className="mt-0.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-[11px] text-indigo-600 hover:underline">
        {open ? "скрыть подробности" : "подробности"}
      </button>
      {open && (
        <dl className="mt-1 space-y-0.5 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-medium text-slate-500">{k}:</dt>
              <dd className="min-w-0 break-words">
                {Array.isArray(v) ? <ul className="space-y-0.5">{v.map((x, i) => <li key={i}>{fmt(x)}</li>)}</ul> : fmt(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
