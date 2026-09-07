import type { ReactNode } from "react";
import Link from "next/link";
import { SortLink } from "@/components/SortLink";

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

/**
 * Бейдж, управляемый словарями подписей и цветов. Сам примитив ничего не знает о
 * предметной области: конкретные статусы (заявок, складских единиц, записей будущих
 * модулей) описываются в доменном слое и передаются сюда.
 */
export function MappedBadge({ value, labels, colors, fallback = "bg-slate-100 text-slate-700" }: { value: string; labels?: Record<string, string>; colors?: Record<string, string>; fallback?: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${colors?.[value] ?? fallback}`}>
      {labels?.[value] ?? value}
    </span>
  );
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

/* ─────────────── ТАБЛИЦЫ ───────────────
 * Один визуальный язык для всех таблиц приложения. Раскладка описывается колонками,
 * а не разметкой: модулю (складскому, сервисному, любому будущему) достаточно описать
 * колонки — отступы, выравнивание, поведение на узком экране и пустое состояние
 * приходят из общих токенов и одинаковы везде.
 */

export type Align = "left" | "right" | "center";

const alignCls: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };

/** Классы ячейки заголовка. Выравнивание заголовка всегда совпадает с ячейками колонки. */
export function thCls(align: Align = "left", extra = "") {
  return `px-3 py-2 font-medium first:pl-4 sm:first:pl-3 ${alignCls[align]} ${extra}`;
}

/**
 * Классы ячейки данных. `numeric` включает моноширинные цифры и выравнивание вправо:
 * числа в колонке должны сравниваться взглядом по разрядам.
 */
export function tdCls({ align, numeric, dense, extra = "" }: { align?: Align; numeric?: boolean; dense?: boolean; extra?: string } = {}) {
  const a = align ?? (numeric ? "right" : "left");
  return `px-3 ${dense ? "py-1.5" : "py-2"} align-top first:pl-4 sm:first:pl-3 ${alignCls[a]} ${numeric ? "tabular-nums" : ""} ${extra}`;
}

/** Заголовок колонки: строка либо описание с выравниванием. */
export type Head = ReactNode | { label: ReactNode; align?: Align; className?: string };

function headParts(h: Head): { label: ReactNode; align: Align; className: string } {
  if (h && typeof h === "object" && "label" in (h as object)) {
    const o = h as { label: ReactNode; align?: Align; className?: string };
    return { label: o.label, align: o.align ?? "left", className: o.className ?? "" };
  }
  return { label: h as ReactNode, align: "left", className: "" };
}

/**
 * Простая таблица: заголовки + произвольные строки.
 * Подходит, когда строки нестандартные (группировки, итоги); для обычных списков
 * берите DataTable — он описывается колонками и меньше поводов разойтись в оформлении.
 */
export function Table({
  head,
  headRow,
  colSpan,
  children,
  empty,
  emptyText = "Нет данных",
  footer,
  dense,
  maxHeight,
}: {
  head?: Head[];
  /** Готовая строка заголовков — когда нужны свои ячейки (например, сортируемые). */
  headRow?: ReactNode;
  /** Число колонок для пустого состояния, если заголовки заданы через headRow. */
  colSpan?: number;
  children: ReactNode;
  empty?: boolean;
  emptyText?: string;
  /** Строки итогов; получают оформление подвала. */
  footer?: ReactNode;
  dense?: boolean;
  /** Ограничение высоты со скроллом внутри (длинные рабочие списки). */
  maxHeight?: string;
}) {
  const span = colSpan ?? head?.length ?? 1;
  return (
    <div
      className={`-mx-4 overflow-x-auto overscroll-x-contain sm:mx-0 [-webkit-overflow-scrolling:touch] ${maxHeight ? "overflow-y-auto" : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-white">
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {headRow ??
              (head ?? []).map((h, i) => {
                const { label, align, className } = headParts(h);
                return <th key={i} className={thCls(align, className)} scope="col">{label}</th>;
              })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty ? (
            <tr><td colSpan={span} className={`px-3 ${dense ? "py-6" : "py-8"} text-center text-slate-400`}>{emptyText}</td></tr>
          ) : children}
        </tbody>
        {footer && <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Td({ children, className = "", align, numeric, dense, colSpan }: { children?: ReactNode; className?: string; align?: Align; numeric?: boolean; dense?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={tdCls({ align, numeric, dense, extra: className })}>{children}</td>;
}

/**
 * Компактная сводка «показатель → значение»: маленькие блоки на дашбордах и в отчётах.
 * Это не таблица данных — здесь нет сортировки, скролла и заголовков колонок, поэтому
 * примитив отдельный: так сводки не начинают жить по правилам больших таблиц.
 */
export function SummaryList({
  title,
  rows,
  emptyText = "Нет данных",
}: {
  title?: ReactNode;
  rows: { key: string; label: ReactNode; value: ReactNode }[];
  emptyText?: string;
}) {
  return (
    <div className="min-w-0">
      {title && <div className="mb-1 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>}
      {rows.length ? (
        <dl className="text-xs">
          {rows.map((r) => (
            <div key={r.key} className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
              <dt className="min-w-0 truncate text-slate-600">{r.label}</dt>
              <dd className="shrink-0 tabular-nums font-medium text-slate-900">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="py-2 text-xs text-slate-400">{emptyText}</p>
      )}
    </div>
  );
}

/** Описание колонки: заголовок, выравнивание и способ получить содержимое ячейки. */
export type Column<T> = {
  key: string;
  header: ReactNode;
  /** Поле сортировки; включает кликабельный заголовок (нужен sort у таблицы). */
  sort?: string;
  align?: Align;
  /** Числовая колонка: моноширинные цифры, выравнивание вправо. */
  numeric?: boolean;
  className?: string;
  headClassName?: string;
  cell: (row: T, index: number) => ReactNode;
};

/**
 * Таблица, описанная колонками. Единственное место, где задаётся раскладка списка,
 * поэтому все списки в приложении выглядят одинаково, а модуль описывает только данные.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyText = "Нет данных",
  dense,
  footer,
  sort,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  emptyText?: string;
  dense?: boolean;
  footer?: ReactNode;
  /** Текущая сортировка; без неё заголовки не кликабельны. */
  sort?: { field?: string; dir?: string };
  rowClassName?: (row: T, index: number) => string;
}) {
  const head: Head[] = columns.map((c) => ({
    label: c.sort && sort ? <SortLink field={c.sort} current={sort.field} dir={sort.dir}>{c.header}</SortLink> : c.header,
    align: c.align ?? (c.numeric ? "right" : "left"),
    className: c.headClassName,
  }));
  return (
    <Table head={head} empty={!rows.length} emptyText={emptyText} footer={footer} dense={dense}>
      {rows.map((row, i) => (
        <tr key={rowKey(row, i)} className={`hover:bg-slate-50 ${rowClassName?.(row, i) ?? ""}`}>
          {columns.map((c) => (
            <Td key={c.key} align={c.align} numeric={c.numeric} dense={dense} className={c.className}>
              {c.cell(row, i)}
            </Td>
          ))}
        </tr>
      ))}
    </Table>
  );
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

/**
 * Кнопки панели отбора. Вынесены отдельно от btnCls, потому что применение фильтра —
 * действие повторяемое и вспомогательное: основной акцент (индиго) остаётся за
 * созданием записи, иначе на странице конкурируют две «главные» кнопки.
 * Один стиль на все панели — раньше каждая страница описывала кнопки по-своему.
 */
export const btnFilterCls =
  "inline-flex min-h-[2.5rem] items-center justify-center rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50";
export const btnFilterResetCls =
  "inline-flex min-h-[2.5rem] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/**
 * Единый выбор периода: подпись «Период», под ней «с [дата] по [дата]» в одну строку.
 *
 * Поля намеренно тянутся (`flex-1 min-w-0`), а не имеют фиксированной ширины: в узкой
 * колонке фильтра они сжимаются, но остаются в строке. Раньше при фиксированной ширине
 * пара полей не помещалась и переносилась — один и тот же отбор выглядел то строкой,
 * то столбиком на разных экранах.
 *
 * Контролу нужно не меньше ~280 px: иначе «дд.мм.гггг» с иконкой календаря не помещается
 * и обрезается. В многоколоночных сетках отдавайте ему две колонки через `className`.
 */
export function PeriodFields({
  from,
  to,
  label = "Период",
  names = { from: "from", to: "to" },
  className = "",
}: {
  from?: string;
  to?: string;
  label?: string;
  names?: { from: string; to: string };
  className?: string;
}) {
  return (
    <div className={`text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-xs text-slate-500">с</span>
        <input type="date" name={names.from} defaultValue={from ?? ""} aria-label={`${label}: с`} className={`${inputCls} min-w-0 flex-1 px-2`} />
        <span className="shrink-0 text-xs text-slate-500">по</span>
        <input type="date" name={names.to} defaultValue={to ?? ""} aria-label={`${label}: по`} className={`${inputCls} min-w-0 flex-1 px-2`} />
      </div>
    </div>
  );
}

/**
 * Результат отправки формы или действия: успех или ошибка. Раньше эта разметка была
 * скопирована в каждой форме, и сообщения отличались отступами и цветом.
 */
export function FormMessage({ ok, children, onHide }: { ok: boolean; children: ReactNode; onHide?: () => void }) {
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`rounded-xl px-3 py-2 text-sm ${ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}
    >
      {children}
      {onHide && (
        <button type="button" className="ml-2 underline opacity-80 hover:opacity-100" onClick={onHide}>
          скрыть
        </button>
      )}
    </div>
  );
}

/** Ряд кнопок формы: основное действие слева, отмена рядом. */
export function FormActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}

export function Empty({ text = "Нет данных" }: { text?: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">{text}</div>;
}
