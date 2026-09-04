"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Field, inputCls, btnCls, btnSecondaryCls } from "@/components/ui";

export type QF = {
  name: string;
  label: string;
  type?: "text" | "number" | "email" | "password" | "select" | "textarea" | "checkbox" | "datetime-local";
  required?: boolean;
  options?: { value: string | number; label: string }[];
  placeholder?: string;
  defaultValue?: string | number | boolean;
  step?: string;
  hint?: string;
  /** приводить значение к числу (для select с id) */
  numeric?: boolean;
};

type Props = {
  title?: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  fields: QF[];
  submitLabel?: string;
  /** дополнительные поля, добавляемые в тело запроса */
  extra?: Record<string, unknown>;
  onDone?: "refresh" | ((data: unknown) => void);
  collapsible?: boolean;
  compact?: boolean;
  children?: ReactNode;
  variant?: "primary" | "secondary";
};

export function QuickForm({ title, endpoint, method = "POST", fields, submitLabel = "Сохранить", extra, onDone = "refresh", collapsible, compact, children, variant = "primary" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(!collapsible);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    let data: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.type === "checkbox") data[f.name] = fd.get(f.name) === "on";
      else {
        const v = fd.get(f.name);
        data[f.name] = v === "" || v === null ? undefined : f.type === "number" || f.numeric ? Number(v) : String(v);
      }
    }
    if (extra) data = { ...data, ...extra };
    setBusy(true); setMsg(null);
    try {
      const res = await api(endpoint, { method, json: data });
      setMsg({ ok: true, text: "Готово" });
      form.reset();
      if (onDone === "refresh") router.refresh(); else onDone(res);
      if (collapsible) setOpen(false);
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
    finally { setBusy(false); }
  }

  if (collapsible && !open) return <button onClick={() => setOpen(true)} className={variant === "primary" ? btnCls : btnSecondaryCls}>{title ?? submitLabel}</button>;

  return (
    <form onSubmit={submit} className={`rounded-2xl border border-slate-200 bg-white ${compact ? "p-3" : "p-4"} shadow-sm`}>
      {title && <div className="mb-3 text-sm font-semibold text-slate-800">{title}</div>}
      <div className={`grid gap-3 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2"}`}>
        {fields.map((f) => (
          <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            {f.type === "checkbox" ? (
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name={f.name} defaultChecked={Boolean(f.defaultValue)} className="h-4 w-4" />{f.label}</label>
            ) : (
              <Field label={f.label} hint={f.hint}>
                {f.type === "select" ? (
                  <select name={f.name} className={inputCls} required={f.required} defaultValue={f.defaultValue as string | number | undefined}>
                    {!f.required && <option value="">—</option>}
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea name={f.name} className={inputCls} rows={2} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue as string | undefined} />
                ) : (
                  <input name={f.name} type={f.type ?? "text"} step={f.step} className={inputCls} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue as string | number | undefined} />
                )}
              </Field>
            )}
          </div>
        ))}
      </div>
      {children}
      {msg && <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
      <div className="mt-3 flex gap-2">
        <button className={btnCls} disabled={busy}>{busy ? "…" : submitLabel}</button>
        {collapsible && <button type="button" className={btnSecondaryCls} onClick={() => setOpen(false)}>Отмена</button>}
      </div>
    </form>
  );
}

/** Кнопка одиночного действия (POST/PATCH/DELETE) с подтверждением. Ошибка показывается рядом, без alert(). */
export function ActionButton({ endpoint, method = "POST", json, label, confirm: c, className }: { endpoint: string; method?: "POST" | "PATCH" | "DELETE"; json?: unknown; label: string; confirm?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={busy} className={className ?? "min-h-[2rem] text-xs text-indigo-600 hover:underline disabled:opacity-50"} onClick={async () => {
        if (c && !window.confirm(c)) return;
        setBusy(true); setErr(null);
        try { await api(endpoint, { method, json }); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "…" : label}</button>
      {err && (
        <span role="alert" className="max-w-xs rounded-lg bg-rose-50 px-2 py-1 text-[11px] leading-snug text-rose-700">
          {err} <button type="button" className="ml-1 underline" onClick={() => setErr(null)}>скрыть</button>
        </span>
      )}
    </span>
  );
}
