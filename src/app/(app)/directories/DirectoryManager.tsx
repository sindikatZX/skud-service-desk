"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Table, Td, Badge, Field, inputCls, btnCls, btnSecondaryCls } from "@/components/ui";
import { CsvImport } from "@/components/CsvImport";

export type DictField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: { value: string | number; label: string }[];
  /** приводить значение select к числу */
  numeric?: boolean;
  /** значение пустого варианта отправлять как null (например, «корень» у папки) */
  nullable?: boolean;
};

export type DictRow = {
  id: number;
  code: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  usedBy: number;
  [key: string]: unknown;
};

type Props = {
  /** Ключ справочника в API: ticket-types | priorities | categories | measure-units */
  dict: string;
  rows: DictRow[];
  /** Дополнительные поля сверх code/name/sortOrder. */
  extraFields?: DictField[];
  /** Что показывать в колонке «Использований». */
  usageLabel: string;
  codeHint?: string;
  /** Разрешить менять код у несистемных записей. */
  codeEditable?: boolean;
  /** Ключ шаблона импорта CSV (если справочник поддерживает импорт). */
  importEntity?: string;
  /** Дополнительные колонки таблицы: ключ поля → заголовок. */
  extraColumns?: { key: string; label: string; render?: "kindLabel" }[];
};

/**
 * Универсальный экран справочника: добавление, переименование, включение/отключение
 * и удаление записей. Предустановленные (демонстрационные) записи редактируются и удаляются
 * наравне с остальными — сервер отклонит удаление только при наличии ссылок из документов.
 */
export function DirectoryManager({ dict, rows, extraFields = [], usageLabel, codeHint, importEntity }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      setEditing(null);
      setAdding(false);
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function valuesOf(form: HTMLFormElement) {
    const fd = new FormData(form);
    const out: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      if (k === "code") continue; // код генерируется сервером
      const spec = [...extraFields].find((f) => f.name === k);
      if (v === "") { if (spec?.nullable) out[k] = null; continue; }
      out[k] = spec?.type === "number" || spec?.numeric || k === "sortOrder" ? Number(v) : String(v);
    }
    out.isActive = fd.get("isActive") === "on";
    return out;
  }

  const rowFields = (row?: DictRow) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Код" hint={codeHint ?? "формат XX_ГГГГ_NNNNN, присваивается системой и не меняется"}>
        <input
          name="code"
          className={`${inputCls} font-mono`}
          defaultValue={row?.code ?? ""}
          disabled
          placeholder="генерируется автоматически"
        />
      </Field>
      <Field label="Название" hint={row?.kind === "vehicle" ? "склад-автомобиль: название = модель · госномер, меняется в автопарке" : undefined}>
        <input name="name" className={inputCls} required defaultValue={row?.name ?? ""} placeholder="Ремонт" readOnly={row?.kind === "vehicle"} />
      </Field>
      {extraFields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint}>
          {f.type === "select" ? (
            <select name={f.name} className={inputCls} required={f.required} defaultValue={(row?.[f.name] as string | number | null) ?? ""}>
              {!f.required && <option value="">—</option>}
              {(f.options ?? []).filter((o) => !(row && f.name === "parentId" && o.value === row.id)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
          <input
            name={f.name}
            type={f.type ?? "text"}
            className={inputCls}
            required={f.required}
            placeholder={f.placeholder}
            defaultValue={(row?.[f.name] as string | number | null) ?? ""}
          />
          )}
        </Field>
      ))}
      <Field label="Порядок сортировки">
        <input name="sortOrder" type="number" className={inputCls} defaultValue={row?.sortOrder ?? 100} />
      </Field>
      <label className="flex items-center gap-2 pt-6 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={row?.isActive ?? true} className="h-4 w-4" />
        Активна (доступна в формах)
      </label>
    </div>
  );

  return (
    <Card
      title={`Записей: ${rows.length}`}
      action={!adding && <button className={btnCls} onClick={() => { setAdding(true); setEditing(null); }}>+ Добавить</button>}
    >
      {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
      {importEntity && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CsvImport entity={importEntity} compact />
          <a href={`/api/v1/import/${importEntity}?export=1`} className={btnSecondaryCls} download>⇩ Экспорт CSV</a>
          <a href={`/api/v1/import/${importEntity}?template=1`} className="text-xs text-indigo-600 hover:underline">шаблон CSV</a>
          <span className="text-xs text-slate-500">При импорте записи сопоставляются по коду: совпал — перезаписывается, нет — создаётся.</span>
        </div>
      )}

      {adding && (
        <form
          className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3"
          onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; run(() => api(`/directories/${dict}`, { method: "POST", json: valuesOf(f) }), "Запись добавлена"); }}
        >
          <div className="mb-2 text-sm font-semibold">Новая запись</div>
          {rowFields()}
          <div className="mt-3 flex gap-2">
            <button className={btnCls} disabled={busy}>Создать</button>
            <button type="button" className={btnSecondaryCls} onClick={() => setAdding(false)}>Отмена</button>
          </div>
        </form>
      )}

      <Table head={["Код", "Название", ...extraFields.map((f) => f.label), usageLabel, "Статус", ""]} empty={!rows.length}>
        {rows.map((r) =>
          editing === r.id ? (
            <tr key={r.id}>
              <td colSpan={5 + extraFields.length} className="px-3 py-3">
                <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; run(() => api(`/directories/${dict}/${r.id}`, { method: "PATCH", json: valuesOf(f) }), "Изменения сохранены"); }}>
                  {rowFields(r)}
                  <div className="mt-3 flex gap-2">
                    <button className={btnCls} disabled={busy}>Сохранить</button>
                    <button type="button" className={btnSecondaryCls} onClick={() => setEditing(null)}>Отмена</button>
                  </div>
                </form>
              </td>
            </tr>
          ) : (
            <tr key={r.id} className="hover:bg-slate-50">
              <Td><span className="font-mono text-xs">{r.code}</span></Td>
              <Td>
                <span className="font-medium">{r.name}</span>
                {r.isSystem && <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400" title="Создана при первом запуске; редактируется и удаляется как обычная">предустановленная</span>}
              </Td>
              {extraFields.map((f) => {
                const v = r[f.name] as string | number | null;
                const label = f.type === "select" ? (f.options?.find((o) => String(o.value) === String(v))?.label ?? v) : v;
                return <Td key={f.name} className="text-xs">{label ?? "—"}</Td>;
              })}
              <Td className="text-xs">{r.usedBy}</Td>
              <Td>{r.isActive ? <Badge tone="green">активна</Badge> : <Badge>отключена</Badge>}</Td>
              <Td>
                <div className="flex items-center gap-3">
                  <button className="text-xs text-indigo-600 hover:underline" onClick={() => { setEditing(r.id); setAdding(false); }}>изменить</button>
                  <button
                    className="text-xs text-rose-600 hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Удалить «${r.name}»?${r.usedBy ? `\n\nЗапись используется ${r.usedBy} раз — удаление будет отклонено.` : ""}`)) return;
                      run(() => api(`/directories/${dict}/${r.id}`, { method: "DELETE" }), "Запись удалена");
                    }}
                  >
                    удалить
                  </button>
                </div>
              </Td>
            </tr>
          ),
        )}
      </Table>
    </Card>
  );
}
