"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Field, inputCls, btnCls, btnSecondaryCls } from "@/components/ui";

type Tpl = { entity: string; title: string; description: string; fields: { key: string; label: string; required?: boolean; aliases: string[]; hint?: string }[] };
type Result = { created: number; updated: number; skipped: number; total: number; errors: { row: number; message: string }[]; extra?: Record<string, number> };

/** Разбор CSV с кавычками; разделитель определяется по первой строке (; , или таб). */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]?.d ?? ";";
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((c) => c.trim() !== "")) out.push(row); }
  if (!out.length) return { headers: [], rows: [] };
  const headers = out[0].map((h, i) => (h.trim().replace(/^\ufeff/, "") || `Колонка ${i + 1}`));
  const rows = out.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

/** Декодирование файла: UTF-8 (BOM/валидный) → иначе windows-1251 (типичная выгрузка 1С 7.7). */
async function decodeFile(file: File, forced?: string): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (forced) return new TextDecoder(forced).decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_"'«».\-]/g, "").replace(/ё/g, "е");

type Props = {
  entity: string;
  /** Дополнительные параметры импорта (например, склад для остатков). */
  options?: { key: string; label: string; choices: { value: string | number; label: string }[]; hint?: string }[];
  onDone?: () => void;
  compact?: boolean;
};

/** Универсальный импорт CSV по шаблону: файл → сопоставление колонок → предпросмотр → загрузка. */
export function CsvImport({ entity, options = [], onDone, compact }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(!compact);
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (open && !tpl) api<Tpl>(`/import/${entity}`).then(setTpl).catch((e) => setErr((e as Error).message));
  }, [open, tpl, entity]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    decodeFile(file, encoding || undefined).then((text) => {
      if (cancelled) return;
      const p = parseCsv(text);
      setParsed(p);
      setResult(null);
      if (tpl) {
        const m: Record<string, string> = {};
        for (const f of tpl.fields) {
          const hit = p.headers.find((h) => f.aliases.map(norm).includes(norm(h)) || norm(h) === norm(f.label) || norm(h) === norm(f.key));
          if (hit) m[f.key] = hit;
        }
        setMapping(m);
      }
    });
    return () => { cancelled = true; };
  }, [file, encoding, tpl]);

  const missingRequired = useMemo(() => (tpl ? tpl.fields.filter((f) => f.required && !mapping[f.key]) : []), [tpl, mapping]);

  async function run() {
    if (!parsed?.rows.length) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<Result>(`/import/${entity}`, { method: "POST", json: { rows: parsed.rows, mapping, options: opts } });
      setResult(r);
      router.refresh();
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (compact && !open) return <button type="button" className={btnSecondaryCls} onClick={() => setOpen(true)}>⇪ Импорт CSV</button>;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-900">Импорт из CSV{tpl ? ` — ${tpl.title}` : ""}</div>
          {tpl && <p className="text-xs text-slate-500">{tpl.description}</p>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <a href={`/api/v1/import/${entity}?template=1`} className="text-indigo-600 hover:underline">Скачать шаблон</a>
          {compact && <button type="button" className="text-slate-500 hover:underline" onClick={() => setOpen(false)}>закрыть</button>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Файл CSV (из 1С)" hint="кодировка определяется автоматически: UTF-8 или Windows-1251">
          <input type="file" accept=".csv,.txt,text/csv" className={inputCls} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Кодировка">
          <select className={inputCls} value={encoding} onChange={(e) => setEncoding(e.target.value)}>
            <option value="">Авто</option>
            <option value="utf-8">UTF-8</option>
            <option value="windows-1251">Windows-1251 (1С 7.7)</option>
            <option value="koi8-r">KOI8-R</option>
            <option value="utf-16le">UTF-16</option>
          </select>
        </Field>
        {options.map((o) => (
          <Field key={o.key} label={o.label} hint={o.hint}>
            <select className={inputCls} value={opts[o.key] ?? ""} onChange={(e) => setOpts((p) => ({ ...p, [o.key]: e.target.value }))}>
              <option value="">—</option>
              {o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        ))}
      </div>

      {tpl && parsed && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-700">Сопоставление колонок · строк в файле: {parsed.rows.length}</div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {tpl.fields.map((f) => (
              <label key={f.key} className="block text-xs">
                <span className={`mb-0.5 block ${f.required ? "font-semibold" : ""}`}>{f.label}{f.required ? " *" : ""}</span>
                <select className={`${inputCls} min-h-[2rem] py-1 text-xs`} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                  <option value="">— не импортировать —</option>
                  {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                {f.hint && <span className="text-[10px] text-slate-500">{f.hint}</span>}
              </label>
            ))}
          </div>
          {missingRequired.length > 0 && <div className="mt-2 text-xs text-rose-600">Не сопоставлены обязательные колонки: {missingRequired.map((f) => f.label).join(", ")}</div>}

          <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-[11px]">
              <thead className="bg-slate-50"><tr>{parsed.headers.map((h) => <th key={h} className="px-2 py-1 text-left font-medium text-slate-500">{h}</th>)}</tr></thead>
              <tbody>{parsed.rows.slice(0, 8).map((r, i) => <tr key={i} className="border-t border-slate-100">{parsed.headers.map((h) => <td key={h} className="max-w-[16rem] truncate px-2 py-1">{r[h]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={btnCls} disabled={busy || missingRequired.length > 0 || !parsed.rows.length} onClick={run}>{busy ? "Импорт…" : `Импортировать ${parsed.rows.length} строк`}</button>
            <button type="button" className={btnSecondaryCls} onClick={() => { setFile(null); setParsed(null); setResult(null); }}>Сбросить</button>
          </div>
        </div>
      )}

      {err && <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-rose-700">{err}</div>}
      {result && (
        <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">
          Готово: создано {result.created}, обновлено {result.updated}, пропущено {result.skipped} из {result.total}.
          {result.extra?.receiptDocumentId && <> Остатки оприходованы документом <a className="underline" href={`/inventory/documents/${result.extra.receiptDocumentId}`}>№{result.extra.receiptDocumentId}</a>.</>}
          {result.errors.length > 0 && (
            <details className="mt-1 text-xs text-rose-700"><summary>Ошибки ({result.errors.length})</summary><ul className="mt-1 list-disc pl-4">{result.errors.slice(0, 50).map((e, i) => <li key={i}>строка {e.row}: {e.message}</li>)}</ul></details>
          )}
        </div>
      )}
    </div>
  );
}
