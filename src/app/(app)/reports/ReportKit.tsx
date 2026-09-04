"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { btnCls, btnSecondaryCls, inputCls } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * Общие элементы конфигурируемых отчётов: панель действий (печать / CSV / сброс),
 * сортируемые заголовки (переключают ?sort=&dir=) и шапка печатной формы.
 * Печать идёт через системный диалог печати браузера («мастер печати»): на странице
 * скрывается всё, кроме области .print-area, и показывается шапка .print-only.
 */

export function ReportToolbar({ csvHref, resetHref, canExport, rows }: { csvHref: string; resetHref: string; canExport: boolean; rows: number }) {
  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <span className="mr-auto text-xs text-slate-500">Строк: {rows}</span>
      {canExport && (
        <>
          <button type="button" className={btnSecondaryCls} onClick={() => window.print()} title="Открыть мастер печати браузера"><Icon name="print" size={16} /> Печать</button>
          <a href={csvHref} className={btnSecondaryCls} download><Icon name="download" size={16} /> CSV</a>
        </>
      )}
      <Link href={resetHref} className="text-sm text-slate-500 hover:underline">Сбросить</Link>
    </div>
  );
}

/** Заголовок колонки с сортировкой: клик переключает поле и направление. */
export function SortTh({ field, children, current, dir, className = "" }: { field: string; children: ReactNode; current?: string; dir?: string; className?: string }) {
  const sp = useSearchParams();
  const active = current === field;
  const nextDir = active && dir === "asc" ? "desc" : "asc";
  const p = new URLSearchParams(sp.toString());
  p.set("sort", field); p.set("dir", nextDir);
  return (
    <th className={`px-3 py-2 font-medium ${className}`}>
      <Link href={`?${p.toString()}`} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-indigo-700 ${active ? "text-indigo-700" : ""}`}>
        {children}
        <span className="text-[10px]">{active ? (dir === "asc" ? "▲" : "▼") : <span className="no-print text-slate-300">↕</span>}</span>
      </Link>
    </th>
  );
}

/** Шапка печатной формы: заголовок, период, параметры отбора, дата формирования, исполнитель. */
export function PrintHeader({ title, period, filters, user }: { title: string; period: string; filters: { label: string; value: string }[]; user: string }) {
  return (
    <div className="print-only mb-4">
      <div className="text-lg font-bold">СКУД•Сервис — {title}</div>
      <div className="text-sm">Период: {period}</div>
      {filters.filter((f) => f.value).length > 0 && (
        <div className="mt-1 text-xs text-slate-700">
          {filters.filter((f) => f.value).map((f) => <div key={f.label}><span className="font-medium">{f.label}:</span> {f.value}</div>)}
        </div>
      )}
      <div className="mt-1 text-xs text-slate-500">Сформировано {new Date().toLocaleString("ru-RU")} · {user}</div>
    </div>
  );
}

export function PrintFooter() {
  return (
    <div className="print-only mt-8 grid grid-cols-2 gap-8 text-xs">
      <div>Составил: ____________________ / ____________________</div>
      <div>Проверил: ____________________ / ____________________</div>
    </div>
  );
}

/** Селект с множественным выбором и подсказкой (Ctrl/⌘ для нескольких). */
type Opt = { value: number | string; label: string } | { id: number; name: string };
const optOf = (o: Opt) => ("value" in o ? o : { value: o.id, label: o.name });

export function MultiSelect({ name, options: raw, selected, label, size = 5 }: { name: string; options: Opt[]; selected: (number | string)[]; label: string; size?: number }) {
  const options = raw.map(optOf);
  return (
    <label className="block text-sm">
      <span className="mb-1 flex items-center justify-between font-medium text-slate-700">
        {label}
        <span className="text-[10px] font-normal text-slate-400">Ctrl/⌘ — несколько</span>
      </span>
      <select name={name} multiple size={size} defaultValue={selected.map(String)} className={`${inputCls} min-h-0 py-1`}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Сериализация выбранных значений multiple-select в CSV параметр. */
export function ReportForm({ children, action }: { children: ReactNode; action: string }) {
  const router = useRouter();
  return (
    <form
      className="no-print grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const p = new URLSearchParams();
        const multi = new Map<string, string[]>();
        for (const [k, v] of fd.entries()) {
          if (typeof v !== "string") continue;
          if (k.endsWith("[]")) { const key = k.slice(0, -2); multi.set(key, [...(multi.get(key) ?? []), v]); }
          else if (v !== "") p.set(k, v);
        }
        for (const [k, vs] of multi) if (vs.length) p.set(k, vs.join(","));
        router.push(`${action}?${p.toString()}`);
      }}
    >
      {children}
      <div className="flex items-end gap-2">
        <button className={btnCls}>Сформировать</button>
      </div>
    </form>
  );
}
