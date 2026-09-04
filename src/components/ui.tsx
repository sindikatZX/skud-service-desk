import type { ReactNode } from "react";
import Link from "next/link";
import { STATUS_COLORS, STATUS_LABELS, UNIT_STATUS_COLORS, UNIT_STATUS_LABELS } from "@/lib/labels";

export function Card({ title, children, className = "", action }: { title?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_COLORS[status] ?? "bg-slate-100"}`}>{STATUS_LABELS[status] ?? status}</span>;
}
export function UnitStatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${UNIT_STATUS_COLORS[status] ?? "bg-slate-100"}`}>{UNIT_STATUS_LABELS[status] ?? status}</span>;
}
export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "rose" | "indigo" }) {
  const map = { slate: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800", rose: "bg-rose-100 text-rose-800", indigo: "bg-indigo-100 text-indigo-800" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${map[tone]}`}>{children}</span>;
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const inner = (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{inner}</Link> : inner;
}

export function Table({ head, children, empty, emptyText = "Нет данных" }: { head: ReactNode[]; children: ReactNode; empty?: boolean; emptyText?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto overscroll-x-contain sm:mx-0 [-webkit-overflow-scrolling:touch]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-white">
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium first:pl-4 sm:first:pl-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty ? (
            <tr><td colSpan={head.length} className="px-3 py-6 text-center text-slate-400">{emptyText}</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}
export function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top first:pl-4 sm:first:pl-3 ${className}`}>{children}</td>;
}

export const inputCls = "w-full min-h-[2.5rem] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50";
const btnBase = "inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btnCls = `${btnBase} bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800`;
export const btnSecondaryCls = `${btnBase} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100`;
export const btnDangerCls = `${btnBase} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 active:bg-rose-100`;

/** Плавающая кнопка действия для мобильных (над нижней навигацией). Скрыта на desktop. */
export function Fab({ href, label, icon = "+" }: { href: string; label: string; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="fixed right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-indigo-600 pl-4 pr-5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 active:bg-indigo-700 lg:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)" }}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

/** Горизонтальная лента чипов-фильтров (ссылки). На мобильных прокручивается, на desktop переносится. */
export function Chips({ items }: { items: { href: string; label: string; active?: boolean; count?: number; tone?: "rose" | "amber" }[] }) {
  return (
    <div className="no-scrollbar snap-chips -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {items.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
            c.active ? "border-indigo-600 bg-indigo-600 text-white" : c.tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-700" : c.tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700 active:bg-slate-100"
          }`}
        >
          {c.label}
          {c.count != null && <span className={`rounded-full px-1.5 text-[10px] ${c.active ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{c.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Empty({ text = "Нет данных" }: { text?: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">{text}</div>;
}
