export const STATUS_LABELS: Record<string, string> = {
  new: "Новая", assigned: "Назначена", scheduled: "Запланирована", in_progress: "В работе",
  on_hold: "Приостановлена", done: "Выполнена", closed: "Закрыта", cancelled: "Отменена",
};
export const STATUS_COLORS: Record<string, string> = {
  new: "bg-sky-100 text-sky-800", assigned: "bg-indigo-100 text-indigo-800", scheduled: "bg-violet-100 text-violet-800",
  in_progress: "bg-amber-100 text-amber-800", on_hold: "bg-slate-200 text-slate-700", done: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-100 text-slate-600", cancelled: "bg-rose-100 text-rose-800",
};
// Названия типов работ, приоритетов, категорий, единиц измерения и ролей живут
// в справочниках БД (таблицы ticket_types, ticket_priorities, catalog_categories,
// measure_units, roles) и приходят вместе с данными — здесь их больше нет.

export const UNIT_STATUS_LABELS: Record<string, string> = {
  in_warehouse: "На складе", at_team: "У бригады", reserved: "Зарезервировано", installed: "Установлено", written_off: "Списано",
};
export const UNIT_STATUS_COLORS: Record<string, string> = {
  in_warehouse: "bg-slate-100 text-slate-700", at_team: "bg-indigo-100 text-indigo-800", reserved: "bg-amber-100 text-amber-800",
  installed: "bg-emerald-100 text-emerald-800", written_off: "bg-rose-100 text-rose-800",
};
export const TX_LABELS: Record<string, string> = {
  receive: "Поступление", issue_to_team: "Отгрузка бригаде", return_to_warehouse: "Возврат на склад", reserve: "Резерв",
  unreserve: "Снятие резерва", install: "Установка", write_off: "Списание", transfer: "Перемещение",
};
export const DOC_TYPE_LABELS: Record<string, string> = { receipt: "Поступление", transfer: "Перемещение", writeoff: "Списание" };
export const DOC_PREFIX: Record<string, string> = { receipt: "ПН", transfer: "ПМ", writeoff: "СП" };
export const WAREHOUSE_KIND_LABELS: Record<string, string> = { central: "Центральный", transit: "Транзитный", team: "Склад бригады", other: "Прочий" };
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}
export const LOC_LABELS: Record<string, string> = { warehouse: "Склад", team: "Бригада", site: "Объект" };

export function fmtDate(d: Date | string | null | undefined, withTime = true) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("ru-RU", withTime ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function fmtQty(q: string | number | null | undefined) {
  if (q === null || q === undefined) return "—";
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
export function toLocalInput(d: Date | string | null | undefined) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}`;
}
