"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, Badge, inputCls, btnCls, btnSecondaryCls, btnDangerCls, UnitStatusBadge } from "@/components/ui";
import { fmtQty, fmtDate, WAREHOUSE_KIND_LABELS } from "@/lib/labels";

export type WhSummary = { id: number; name: string; kind: string; teamId: number | null; materialItems: number; unitsFree: number; unitsReserved: number };
export type Item = { id: number; sku: string; name: string; unit: string; isSerialized: boolean; categoryId: number; categoryName: string };
export type Stock = {
  balances: { catalogItemId: number; sku: string; name: string; unit: string; category: string; quantity: string }[];
  units: { id: number; catalogItemId: number; sku: string; name: string; category: string; serialNumber: string; macAddress: string | null; status: string; ticketId: number | null; receiptNumber: string | null; receiptDate: string | Date | null }[];
  reservations: { id: number; name: string; unit: string; quantity: string; ticketId: number; ticketNumber: string }[];
};
type Perms = { receive: boolean; transfer: boolean; writeoff: boolean };

type ReceiptLine = { key: number; catalogItemId: number; quantity: string; serials: string; price: string };

/** Текущее локальное время для datetime-local (вычисляется в состоянии, не в рендере). */
function nowLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
type Op = "receive" | "transfer" | "writeoff";

/** Рабочее место склада: выбор склада, остатки с галочками, документы Поступление / Перемещение / Списание. */
export function WarehouseWorkspace({ warehouses, initialWarehouseId, initialStock, items, perms }: { warehouses: WhSummary[]; initialWarehouseId: number; initialStock: Stock; items: Item[]; perms: Perms }) {
  const router = useRouter();
  const [whId, setWhId] = useState(initialWarehouseId);
  const [stock, setStock] = useState<Stock>(initialStock);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selUnits, setSelUnits] = useState<Set<number>>(new Set());
  const [selItems, setSelItems] = useState<Map<number, string>>(new Map()); // catalogItemId → qty
  const [op, setOp] = useState<Op | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; docId?: number } | null>(null);

  const wh = warehouses.find((w) => w.id === whId);

  async function load(id: number) {
    setLoading(true);
    try {
      const s = await api<Stock>(`/warehouses/${id}/stock`);
      setStock(s);
      setSelUnits(new Set()); setSelItems(new Map());
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setLoading(false); }
  }
  /** Смена склада — по действию пользователя, без эффекта. */
  function selectWarehouse(id: number) {
    if (id === whId) return;
    setWhId(id);
    setOp(null);
    void load(id);
  }

  const ql = q.trim().toLowerCase();
  const filt = (s: string) => !ql || s.toLowerCase().includes(ql);
  const balances = stock.balances.filter((b) => filt(`${b.name} ${b.sku} ${b.category}`));
  const freeUnits = stock.units.filter((u) => u.status !== "reserved" && filt(`${u.name} ${u.sku} ${u.serialNumber} ${u.macAddress ?? ""}`));
  const reservedUnits = stock.units.filter((u) => u.status === "reserved");

  const toggleUnit = (id: number) => setSelUnits((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleItem = (id: number, max: string) => setSelItems((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, max); return n; });
  const allUnitsSel = freeUnits.length > 0 && freeUnits.every((u) => selUnits.has(u.id));
  const allItemsSel = balances.length > 0 && balances.every((b) => selItems.has(b.catalogItemId));
  const selCount = selUnits.size + selItems.size;

  async function submit(path: string, body: unknown, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ document: { id: number; number: string } }>(path, { method: "POST", json: body });
      setMsg({ ok: true, text: `${okText}: документ ${r.document.number}`, docId: r.document.id });
      setOp(null);
      await load(whId);
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  /** Строки перемещения/списания из отмеченных позиций. */
  function selectedLines() {
    const lines: { unitIds?: number[]; catalogItemId?: number; quantity?: number }[] = [];
    // серийные — группируем по номенклатуре
    const byItem = new Map<number, number[]>();
    for (const u of stock.units) if (selUnits.has(u.id)) byItem.set(u.catalogItemId, [...(byItem.get(u.catalogItemId) ?? []), u.id]);
    for (const [catalogItemId, unitIds] of byItem) lines.push({ catalogItemId, unitIds });
    for (const [catalogItemId, qty] of selItems) lines.push({ catalogItemId, quantity: Number(qty) });
    return lines;
  }

  return (
    <div className="space-y-4">
      {/* Склады */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {warehouses.map((w) => (
          <button key={w.id} onClick={() => selectWarehouse(w.id)} className={`shrink-0 rounded-2xl border px-3 py-2 text-left text-xs ${w.id === whId ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            <div className="font-semibold">{w.name}</div>
            <div className={w.id === whId ? "text-indigo-100" : "text-slate-500"}>{WAREHOUSE_KIND_LABELS[w.kind]} · {w.unitsFree} ед. · {w.materialItems} поз.{w.unitsReserved ? ` · ${w.unitsReserved} рез.` : ""}</div>
          </button>
        ))}
        <Link href="/directories/warehouses" className="shrink-0 rounded-2xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50">+ Новый склад</Link>
      </div>

      {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}{msg.docId && <> · <Link href={`/inventory/documents/${msg.docId}`} className="underline">открыть</Link></>}</div>}

      {/* Панель действий */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию, артикулу, S/N…" className={`${inputCls} max-w-xs`} />
          <div className="flex-1" />
          {perms.receive && <button className={btnCls} onClick={() => setOp(op === "receive" ? null : "receive")}>+ Поступление</button>}
          {perms.transfer && <button className={btnSecondaryCls} disabled={!selCount} onClick={() => setOp("transfer")}>⇄ Переместить{selCount ? ` (${selCount})` : ""}</button>}
          {perms.writeoff && <button className={btnDangerCls} disabled={!selCount} onClick={() => setOp("writeoff")}>✕ Списать{selCount ? ` (${selCount})` : ""}</button>}
        </div>
        {selCount > 0 && <div className="mt-2 text-xs text-slate-500">Отмечено: {selUnits.size} серийных ед., {selItems.size} позиций материалов. <button className="text-indigo-600 hover:underline" onClick={() => { setSelUnits(new Set()); setSelItems(new Map()); }}>снять выделение</button></div>}

        {op === "receive" && wh && <ReceiptForm items={items} warehouses={warehouses} defaultWarehouseId={whId} busy={busy} onCancel={() => setOp(null)} onSubmit={(body) => submit("/inventory/operations/receive", body, "Оприходовано")} />}
        {op === "transfer" && wh && (
          <MoveForm
            title={`Перемещение с «${wh.name}»`}
            targets={warehouses.filter((w) => w.id !== whId)}
            lines={selectedLines()}
            items={items}
            stock={stock}
            selItems={selItems}
            setSelItems={setSelItems}
            busy={busy}
            submitLabel="Переместить"
            onCancel={() => setOp(null)}
            onSubmit={(extra) => submit("/inventory/operations/transfer", { fromWarehouseId: whId, ...extra, lines: selectedLines() }, "Перемещено")}
          />
        )}
        {op === "writeoff" && wh && (
          <MoveForm
            title={`Списание со склада «${wh.name}»`}
            lines={selectedLines()}
            items={items}
            stock={stock}
            selItems={selItems}
            setSelItems={setSelItems}
            busy={busy}
            danger
            submitLabel="Списать"
            onCancel={() => setOp(null)}
            onSubmit={(extra) => submit("/inventory/operations/write-off", { fromWarehouseId: whId, ...extra, lines: selectedLines() }, "Списано")}
          />
        )}
      </Card>

      <div className={`grid gap-4 lg:grid-cols-2 ${loading ? "opacity-50" : ""}`}>
        <Card title={<>Серийное оборудование <span className="text-sm font-normal text-slate-500">({freeUnits.length}{reservedUnits.length ? ` + ${reservedUnits.length} в резерве` : ""})</span></>}>
          <div className="-mx-4 max-h-[32rem] overflow-auto sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={allUnitsSel} onChange={(e) => setSelUnits(e.target.checked ? new Set([...selUnits, ...freeUnits.map((u) => u.id)]) : new Set([...selUnits].filter((id) => !freeUnits.some((u) => u.id === id))))} /></th>
                  <th className="px-3 py-2 font-medium">Позиция</th><th className="px-3 py-2 font-medium">S/N</th><th className="px-3 py-2 font-medium">Партия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {freeUnits.map((u) => (
                  <tr key={u.id} className={selUnits.has(u.id) ? "bg-indigo-50/60" : "hover:bg-slate-50"} onClick={() => toggleUnit(u.id)}>
                    <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={selUnits.has(u.id)} onChange={() => toggleUnit(u.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <td className="px-3 py-2"><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.sku} · {u.category}</div></td>
                    <td className="px-3 py-2"><Link href={`/inventory/units/${u.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-indigo-600">{u.serialNumber}</Link>{u.macAddress && <div className="font-mono text-[10px] text-slate-400">{u.macAddress}</div>}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{u.receiptNumber ? <>{u.receiptNumber}<div className="text-[10px]">{fmtDate(u.receiptDate, false)}</div></> : "—"}</td>
                  </tr>
                ))}
                {reservedUnits.map((u) => (
                  <tr key={u.id} className="bg-amber-50/40">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2"><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.sku}</div></td>
                    <td className="px-3 py-2"><Link href={`/inventory/units/${u.id}`} className="font-mono text-xs text-indigo-600">{u.serialNumber}</Link></td>
                    <td className="px-3 py-2 text-xs"><UnitStatusBadge status={u.status} /> {u.ticketId && <Link href={`/tickets/${u.ticketId}`} className="text-indigo-600">#{u.ticketId}</Link>}</td>
                  </tr>
                ))}
                {!freeUnits.length && !reservedUnits.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Нет серийного оборудования</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={<>Материалы <span className="text-sm font-normal text-slate-500">({balances.length})</span></>}>
          <div className="-mx-4 max-h-[32rem] overflow-auto sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={allItemsSel} onChange={(e) => setSelItems(e.target.checked ? new Map([...selItems, ...balances.map((b) => [b.catalogItemId, b.quantity] as [number, string])]) : new Map())} /></th>
                  <th className="px-3 py-2 font-medium">Позиция</th><th className="px-3 py-2 font-medium">Остаток</th><th className="px-3 py-2 font-medium">К операции</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {balances.map((b) => (
                  <tr key={b.catalogItemId} className={selItems.has(b.catalogItemId) ? "bg-indigo-50/60" : "hover:bg-slate-50"}>
                    <td className="px-3 py-2"><input type="checkbox" className="h-4 w-4" checked={selItems.has(b.catalogItemId)} onChange={() => toggleItem(b.catalogItemId, b.quantity)} /></td>
                    <td className="px-3 py-2"><div className="font-medium">{b.name}</div><div className="text-xs text-slate-500">{b.sku} · {b.category}</div></td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtQty(b.quantity)} {b.unit}</td>
                    <td className="px-3 py-2">{selItems.has(b.catalogItemId) && <input type="number" step="0.001" min="0.001" max={b.quantity} value={selItems.get(b.catalogItemId)} onChange={(e) => setSelItems((m) => new Map(m).set(b.catalogItemId, e.target.value))} className={`${inputCls} min-h-[2rem] w-24 py-1`} />}</td>
                  </tr>
                ))}
                {!balances.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Нет материалов</td></tr>}
              </tbody>
            </table>
          </div>
          {stock.reservations.length > 0 && (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs">
              <div className="mb-1 font-semibold text-amber-800">Резервы под заявки</div>
              <ul className="space-y-0.5">{stock.reservations.map((r) => <li key={r.id}>{r.name} — {fmtQty(r.quantity)} {r.unit} · <Link href={`/tickets/${r.ticketId}`} className="text-indigo-600">{r.ticketNumber}</Link></li>)}</ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Подбор нескольких позиций из номенклатуры с поиском и галочками. */
function ItemPicker({ items, onAdd, exclude }: { items: Item[]; onAdd: (ids: number[]) => void; exclude: Set<number> }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const ql = q.trim().toLowerCase();
  const list = useMemo(() => items.filter((i) => !exclude.has(i.id) && (!ql || `${i.name} ${i.sku} ${i.categoryName}`.toLowerCase().includes(ql))).slice(0, 200), [items, exclude, ql]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск в номенклатуре…" className={`${inputCls} mb-2 min-h-[2rem] py-1`} />
      <div className="max-h-48 overflow-auto text-xs">
        {list.map((i) => (
          <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4" checked={sel.has(i.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
            <span className="flex-1"><span className="font-medium">{i.name}</span> <span className="text-slate-400">{i.sku} · {i.categoryName}</span></span>
            {i.isSerialized && <Badge tone="indigo">S/N</Badge>}
          </label>
        ))}
        {!list.length && <div className="py-3 text-center text-slate-400">Ничего не найдено</div>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={`${btnSecondaryCls} min-h-[2rem] py-1 text-xs`} disabled={!sel.size} onClick={() => { onAdd([...sel]); setSel(new Set()); }}>Добавить выбранные ({sel.size})</button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setSel(new Set(list.map((i) => i.id)))}>выбрать все найденные</button>
      </div>
    </div>
  );
}

function ReceiptForm({ items, warehouses, defaultWarehouseId, busy, onCancel, onSubmit }: { items: Item[]; warehouses: WhSummary[]; defaultWarehouseId: number; busy: boolean; onCancel: () => void; onSubmit: (body: unknown) => void }) {
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [toWarehouseId, setTo] = useState(defaultWarehouseId);
  const [picker, setPicker] = useState(true);
  const [docDate] = useState(nowLocal);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const add = (ids: number[]) => setLines((l) => [...l, ...ids.map((id, i) => ({ key: l.length + i + 1 + (l.at(-1)?.key ?? 0), catalogItemId: id, quantity: "1", serials: "", price: "" }))]);
  const upd = (key: number, patch: Partial<ReceiptLine>) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  return (
    <form className="mt-3 space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const body = {
        toWarehouseId,
        number: fd.get("number") || undefined,
        externalNumber: fd.get("externalNumber") || undefined,
        docDate: fd.get("docDate") || undefined,
        supplier: fd.get("supplier") || undefined,
        note: fd.get("note") || undefined,
        lines: lines.map((l) => {
          const it = byId.get(l.catalogItemId);
          if (it?.isSerialized) {
            const units = l.serials.split(/\n|,|;/).map((s) => s.trim()).filter(Boolean).map((line) => { const [sn, mac] = line.split(/\s+/); return { serialNumber: sn, macAddress: mac || null }; });
            return { catalogItemId: l.catalogItemId, units, price: l.price ? Number(l.price) : undefined };
          }
          return { catalogItemId: l.catalogItemId, quantity: Number(l.quantity), price: l.price ? Number(l.price) : undefined };
        }),
      };
      onSubmit(body);
    }}>
      <div className="text-sm font-semibold">Документ «Поступление» (партия)</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="На склад"><select className={inputCls} value={toWarehouseId} onChange={(e) => setTo(Number(e.target.value))}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Дата документа"><input name="docDate" type="datetime-local" className={inputCls} defaultValue={docDate} /></Field>
        <Field label="Номер" hint="пусто — присвоится автоматически (ПН-000001)"><input name="number" className={inputCls} placeholder="авто" /></Field>
        <Field label="Вх. номер поставщика"><input name="externalNumber" className={inputCls} placeholder="накладная №…" /></Field>
        <Field label="Поставщик"><input name="supplier" className={inputCls} /></Field>
        <div className="sm:col-span-2 lg:col-span-3"><Field label="Примечание"><input name="note" className={inputCls} /></Field></div>
      </div>

      <div className="text-xs font-semibold text-slate-700">Позиции ({lines.length})</div>
      {lines.length > 0 && (
        <div className="space-y-2">
          {lines.map((l) => {
            const it = byId.get(l.catalogItemId);
            return (
              <div key={l.key} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-start">
                <div className="text-sm"><div className="font-medium">{it?.name}</div><div className="text-xs text-slate-500">{it?.sku}{it?.isSerialized ? " · серийный" : ` · ${it?.unit}`}</div></div>
                {it?.isSerialized ? (
                  <textarea rows={2} required value={l.serials} onChange={(e) => upd(l.key, { serials: e.target.value })} className={`${inputCls} w-full sm:w-64`} placeholder={"S/N по одному в строке\nSN-001 AA:BB:CC:DD:EE:FF"} />
                ) : (
                  <input type="number" step="0.001" min="0.001" required value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })} className={`${inputCls} w-28`} placeholder="Кол-во" />
                )}
                <input type="number" step="0.01" min="0" value={l.price} onChange={(e) => upd(l.key, { price: e.target.value })} className={`${inputCls} w-28`} placeholder="Цена" />
                <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}>убрать</button>
              </div>
            );
          })}
        </div>
      )}
      {picker ? <ItemPicker items={items} exclude={new Set(lines.map((l) => l.catalogItemId))} onAdd={(ids) => { add(ids); }} /> : <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setPicker(true)}>+ подобрать из номенклатуры</button>}
      <div className="flex gap-2">
        <button className={btnCls} disabled={busy || !lines.length}>{busy ? "…" : `Оприходовать (${lines.length})`}</button>
        <button type="button" className={btnSecondaryCls} onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}

function MoveForm({ title, targets, lines, items, stock, selItems, setSelItems, busy, danger, submitLabel, onCancel, onSubmit }: {
  title: string;
  targets?: WhSummary[];
  lines: { unitIds?: number[]; catalogItemId?: number; quantity?: number }[];
  items: Item[];
  stock: Stock;
  selItems: Map<number, string>;
  setSelItems: (m: Map<number, string>) => void;
  busy: boolean;
  danger?: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (extra: { toWarehouseId?: number; number?: string; docDate?: string; note?: string }) => void;
}) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [to, setTo] = useState(targets?.[0]?.id ?? 0);
  const [docDate] = useState(nowLocal);
  const units = stock.units;
  return (
    <form className={`mt-3 space-y-3 rounded-2xl border p-3 ${danger ? "border-rose-200 bg-rose-50/40" : "border-indigo-200 bg-indigo-50/40"}`} onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      onSubmit({ toWarehouseId: targets ? to : undefined, number: String(fd.get("number") || "") || undefined, docDate: String(fd.get("docDate") || "") || undefined, note: String(fd.get("note") || "") || undefined });
    }}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {targets && <Field label="На склад"><select className={inputCls} value={to} onChange={(e) => setTo(Number(e.target.value))} required>{targets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>}
        <Field label="Дата документа"><input name="docDate" type="datetime-local" className={inputCls} defaultValue={docDate} /></Field>
        <Field label="Номер" hint="пусто — авто"><input name="number" className={inputCls} placeholder="авто" /></Field>
        <Field label="Примечание"><input name="note" className={inputCls} placeholder={danger ? "Причина списания" : "Основание"} /></Field>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-2 text-xs">
        <div className="mb-1 font-semibold text-slate-700">Строки документа ({lines.length})</div>
        <ul className="space-y-1">
          {lines.map((l, i) => {
            const it = byId.get(l.catalogItemId ?? 0);
            if (l.unitIds) return <li key={i}>{it?.name ?? "Серийное оборудование"} — {l.unitIds.length} ед.: <span className="font-mono">{l.unitIds.map((id) => units.find((u) => u.id === id)?.serialNumber).join(", ")}</span></li>;
            return (
              <li key={i} className="flex items-center gap-2">{it?.name} — <input type="number" step="0.001" min="0.001" value={selItems.get(l.catalogItemId!) ?? ""} onChange={(e) => setSelItems(new Map(selItems).set(l.catalogItemId!, e.target.value))} className={`${inputCls} min-h-[1.75rem] w-24 py-0.5`} /> {it?.unit}</li>
            );
          })}
        </ul>
        {!lines.length && <div className="text-slate-400">Отметьте позиции галочками в таблицах ниже</div>}
      </div>
      <div className="flex gap-2">
        <button className={danger ? btnDangerCls : btnCls} disabled={busy || !lines.length || (targets ? !to : false)}>{busy ? "…" : submitLabel}</button>
        <button type="button" className={btnSecondaryCls} onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}
