"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Badge, inputCls, btnCls, btnSecondaryCls, btnDangerCls } from "@/components/ui";
import { CsvImport } from "@/components/CsvImport";
import { QuickForm } from "@/components/QuickForm";
import { fmtQty } from "@/lib/labels";

export type CatNode = { id: number; code: string; name: string; parentId: number | null; isActive: boolean; count: number };
export type CatItem = {
  id: number; sku: string; name: string; externalCode: string | null; categoryId: number; unit: string; isSerialized: boolean; manufacturer: string | null; isActive: boolean;
  qtyWarehouse: number; qtyTeams: number; unitsWarehouse: number; unitsTeam: number; unitsInstalled: number;
};

const ALL = -1;

/** Дерево папок номенклатуры (как в 1С) + список позиций с галочками и массовыми действиями. */
export function CatalogTree({ categories, items, units, manage, canImport, warehouses }: { categories: CatNode[]; items: CatItem[]; units: { code: string; name: string }[]; manage: boolean; canImport: boolean; warehouses: { id: number; name: string }[] }) {
  const router = useRouter();
  const [folder, setFolder] = useState<number>(ALL);
  const [onlyStock, setOnlyStock] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(categories.filter((c) => !c.parentId).map((c) => c.id)));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [moveTo, setMoveTo] = useState<number>(0);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const children = useMemo(() => {
    const m = new Map<number | null, CatNode[]>();
    for (const c of categories) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [categories]);

  /** Все id вложенных папок (включая саму). */
  const subtree = (id: number): number[] => [id, ...(children.get(id) ?? []).flatMap((c) => subtree(c.id))];
  const inFolder = useMemo(() => (folder === ALL ? null : new Set(subtree(folder))), [folder, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasStock = (i: CatItem) => (i.isSerialized ? i.unitsWarehouse + i.unitsTeam > 0 : i.qtyWarehouse + i.qtyTeams > 0);
  const ql = q.trim().toLowerCase();
  const list = items.filter((i) => (!inFolder || inFolder.has(i.categoryId)) && (!onlyStock || hasStock(i)) && (showInactive || i.isActive) && (!ql || `${i.name} ${i.sku} ${i.manufacturer ?? ""} ${i.externalCode ?? ""}`.toLowerCase().includes(ql)));

  const countIn = (id: number) => { const s = new Set(subtree(id)); return items.filter((i) => s.has(i.categoryId) && (!onlyStock || hasStock(i)) && (showInactive || i.isActive)).length; };
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? "";
  const path = (id: number): string => { const c = categories.find((x) => x.id === id); return c ? (c.parentId ? `${path(c.parentId)} / ${c.name}` : c.name) : ""; };

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = list.length > 0 && list.every((i) => sel.has(i.id));

  async function bulk(action: "activate" | "deactivate" | "move" | "delete") {
    if (!sel.size) return;
    if (action === "delete" && !window.confirm(`Удалить ${sel.size} позиций? Позиции с движениями/остатками удалены не будут.`)) return;
    if (action === "move" && !moveTo) { setMsg({ ok: false, text: "Выберите папку назначения" }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ affected: number; errors?: { id: number; message: string }[] }>("/catalog/bulk", { method: "POST", json: { ids: [...sel], action, categoryId: action === "move" ? moveTo : undefined } });
      setMsg({ ok: true, text: `Обработано: ${r.affected}${r.errors?.length ? `, отклонено: ${r.errors.length} (${r.errors[0].message})` : ""}` });
      setSel(new Set());
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  function Tree({ parentId, depth }: { parentId: number | null; depth: number }) {
    const nodes = children.get(parentId) ?? [];
    return (
      <ul className={depth ? "ml-3 border-l border-slate-100 pl-1" : ""}>
        {nodes.map((c) => {
          const kids = children.get(c.id) ?? [];
          const open = expanded.has(c.id);
          return (
            <li key={c.id}>
              <div className={`flex items-center gap-1 rounded-lg px-1 py-1 text-sm ${folder === c.id ? "bg-indigo-50 font-semibold text-indigo-700" : "hover:bg-slate-50"} ${!c.isActive ? "opacity-50" : ""}`}>
                <button type="button" className="w-4 text-xs text-slate-400" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}>{kids.length ? (open ? "▾" : "▸") : ""}</button>
                <button type="button" className="flex flex-1 items-center gap-1.5 text-left" onClick={() => setFolder(c.id)}>
                  <span>{open && kids.length ? "📂" : "📁"}</span><span className="truncate">{c.name}</span>
                  <span className="ml-auto text-[10px] text-slate-400">{countIn(c.id)}</span>
                </button>
              </div>
              {open && kids.length > 0 && <Tree parentId={c.id} depth={depth + 1} />}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card className="h-fit">
        <button type="button" onClick={() => setFolder(ALL)} className={`mb-1 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-sm ${folder === ALL ? "bg-indigo-50 font-semibold text-indigo-700" : "hover:bg-slate-50"}`}>🗂 Вся номенклатура <span className="ml-auto text-[10px] text-slate-400">{items.filter((i) => (!onlyStock || hasStock(i)) && (showInactive || i.isActive)).length}</span></button>
        <Tree parentId={null} depth={0} />
        {manage && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <QuickForm collapsible compact title="+ Папка" endpoint="/directories/categories" submitLabel="Создать папку" variant="secondary"
              fields={[
                { name: "name", label: "Название папки", required: true },
                { name: "code", label: "Код (латиницей)", required: true, placeholder: "cable_utp" },
                { name: "parentId", label: "Родительская папка", type: "select", numeric: true, options: [{ value: "", label: "— корень —" }, ...categories.map((c) => ({ value: c.id, label: path(c.id) }))], defaultValue: folder > 0 ? folder : "" },
              ]} />
          </div>
        )}
      </Card>

      <div className="space-y-3">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: название, артикул, код 1С…" className={`${inputCls} max-w-xs`} />
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} />Только в наличии</label>
            <label className="flex items-center gap-1.5 text-sm text-slate-500"><input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Показывать отключённые</label>
            <div className="flex-1" />
            {canImport && <button type="button" className={btnSecondaryCls} onClick={() => setShowImport((v) => !v)}>⇪ Импорт из 1С</button>}
            {manage && <button type="button" className={btnCls} onClick={() => setShowAdd((v) => !v)}>+ Позиция</button>}
          </div>
          {folder !== ALL && <div className="mt-2 text-xs text-slate-500">Папка: <span className="font-medium text-slate-700">{path(folder)}</span> · <button className="text-indigo-600 hover:underline" onClick={() => setFolder(ALL)}>сбросить</button></div>}
          {showAdd && manage && (
            <div className="mt-3">
              <QuickForm title="Новая позиция" endpoint="/catalog" submitLabel="Создать" onDone={() => { setShowAdd(false); router.refresh(); }}
                fields={[
                  { name: "name", label: "Наименование", required: true },
                  { name: "sku", label: "Артикул", hint: "не обязателен — будет сгенерирован" },
                  { name: "externalCode", label: "Код 1С" },
                  { name: "categoryId", label: "Папка", type: "select", required: true, numeric: true, options: categories.map((c) => ({ value: c.id, label: path(c.id) })), defaultValue: folder > 0 ? folder : categories[0]?.id },
                  { name: "unit", label: "Ед. изм.", type: "select", required: true, defaultValue: "шт", options: units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })) },
                  { name: "manufacturer", label: "Производитель" },
                  { name: "isSerialized", label: "Серийный учёт (S/N)", type: "checkbox" },
                  { name: "description", label: "Описание", type: "textarea" },
                ]} />
            </div>
          )}
          {showImport && canImport && (
            <div className="mt-3">
              <CsvImport entity="catalog" options={[
                { key: "categoryId", label: "Папка по умолчанию", hint: "если в файле нет группы", choices: categories.map((c) => ({ value: c.id, label: path(c.id) })) },
                { key: "warehouseId", label: "Оприходовать остатки на склад", hint: "колонка «Остаток» → документ поступления", choices: warehouses.map((w) => ({ value: w.id, label: w.name })) },
              ]} />
            </div>
          )}
        </Card>

        {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

        {manage && sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
            <span className="font-medium">Выбрано: {sel.size}</span>
            <button className={`${btnSecondaryCls} min-h-[2rem] py-1 text-xs`} disabled={busy} onClick={() => bulk("activate")}>Включить</button>
            <button className={`${btnSecondaryCls} min-h-[2rem] py-1 text-xs`} disabled={busy} onClick={() => bulk("deactivate")}>Отключить</button>
            <span className="flex items-center gap-1">
              <select className={`${inputCls} min-h-[2rem] w-56 py-1 text-xs`} value={moveTo} onChange={(e) => setMoveTo(Number(e.target.value))}><option value={0}>— папка назначения —</option>{categories.map((c) => <option key={c.id} value={c.id}>{path(c.id)}</option>)}</select>
              <button className={`${btnSecondaryCls} min-h-[2rem] py-1 text-xs`} disabled={busy} onClick={() => bulk("move")}>Переместить в папку</button>
            </span>
            <button className={`${btnDangerCls} min-h-[2rem] py-1 text-xs`} disabled={busy} onClick={() => bulk("delete")}>Удалить</button>
            <button className="text-xs text-slate-500 hover:underline" onClick={() => setSel(new Set())}>снять</button>
          </div>
        )}

        <Card>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  {manage && <th className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set([...sel, ...list.map((i) => i.id)]) : new Set([...sel].filter((id) => !list.some((i) => i.id === id))))} /></th>}
                  <th className="px-3 py-2 font-medium">Позиция</th><th className="px-3 py-2 font-medium">Папка</th><th className="px-3 py-2 font-medium">Учёт</th><th className="px-3 py-2 font-medium">Склады</th><th className="px-3 py-2 font-medium">У бригад</th><th className="px-3 py-2 font-medium">Установлено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((i) => (
                  <tr key={i.id} className={`${sel.has(i.id) ? "bg-indigo-50/60" : "hover:bg-slate-50"} ${!i.isActive ? "opacity-50" : ""}`}>
                    {manage && <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={sel.has(i.id)} onChange={() => toggle(i.id)} /></td>}
                    <td className="px-3 py-2"><div className="font-medium">{i.name}</div><div className="text-xs text-slate-500">{i.sku}{i.externalCode ? ` · 1С: ${i.externalCode}` : ""}{i.manufacturer ? ` · ${i.manufacturer}` : ""}</div></td>
                    <td className="px-3 py-2 text-xs"><button className="text-left text-indigo-600 hover:underline" onClick={() => setFolder(i.categoryId)}>{catName(i.categoryId)}</button></td>
                    <td className="px-3 py-2">{i.isSerialized ? <Badge tone="indigo">серийный</Badge> : <Badge>кол-во, {i.unit}</Badge>}</td>
                    <td className="px-3 py-2">{i.isSerialized ? i.unitsWarehouse : `${fmtQty(i.qtyWarehouse)} ${i.unit}`}</td>
                    <td className="px-3 py-2">{i.isSerialized ? i.unitsTeam : `${fmtQty(i.qtyTeams)} ${i.unit}`}</td>
                    <td className="px-3 py-2">{i.isSerialized ? i.unitsInstalled : "—"}</td>
                  </tr>
                ))}
                {!list.length && <tr><td colSpan={manage ? 7 : 6} className="px-3 py-8 text-center text-slate-400">{onlyStock ? "В этой папке нет позиций в наличии. Снимите флажок «Только в наличии»." : "Нет позиций"}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-slate-500">Показано {list.length} из {items.length}</div>
        </Card>
      </div>
    </div>
  );
}
