/**
 * Сборка CSV для скачивания: UTF-8 с BOM (Excel открывает кириллицу без вопросов),
 * разделитель «;» (русская локаль Excel), перевод строки CRLF.
 */
export type CsvCell = string | number | boolean | Date | null | undefined;

export function csvEscape(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (v instanceof Date) s = v.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  else if (typeof v === "boolean") s = v ? "1" : "0";
  else if (typeof v === "number") s = Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
  else s = v;
  // Защита от формул при открытии в Excel (телефоны вида +7… не трогаем)
  if (/^[=@]/.test(s) || /^[+\-]\s*[=(A-Za-zА-Яа-я]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(csvEscape).join(";"), ...rows.map((r) => r.map(csvEscape).join(";"))];
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

/** Числовое значение в CSV: запятая как десятичный разделитель, без лишних нулей. */
export function csvNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "")).replace(".", ",");
}

export function csvResponse(csv: string, fileName: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

/** Имя файла с датой: report-2025-01-31.csv */
export function datedName(base: string, ext = "csv") {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${base}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
