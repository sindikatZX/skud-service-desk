"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, inputCls, btnCls } from "@/components/ui";

type Item = { id: number; sku: string; name: string; unit: string; isSerialized: boolean };
type Unit = { id: number; name: string; serialNumber: string };
type Balance = { catalogItemId: number; name: string; unit: string; quantity: string };
type Team = { id: number; name: string };

export function InventoryOps({ items, units, balances, teams, perms }: { items: Item[]; units: Unit[]; balances: Balance[]; teams: Team[]; perms: { receive: boolean; issue: boolean; writeoff: boolean } }) {
  const router = useRouter();
  const [tab, setTab] = useState<"receive" | "issue" | "writeoff">(perms.receive ? "receive" : "issue");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [recvItem, setRecvItem] = useState<number>(items[0]?.id ?? 0);
  const recvIsSerial = items.find((i) => i.id === recvItem)?.isSerialized ?? false;
  const [issueMode, setIssueMode] = useState<"unit" | "qty">("unit");

  async function run(fn: () => Promise<unknown>, okText: string, form?: HTMLFormElement) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); form?.reset(); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  const tabs = [perms.receive && { k: "receive", l: "Поступление" }, perms.issue && { k: "issue", l: "Отгрузка бригаде" }, perms.writeoff && { k: "writeoff", l: "Списание" }].filter(Boolean) as { k: typeof tab; l: string }[];
  if (!tabs.length) return null;

  return (
    <Card title="Складские операции">
      <div className="mb-3 flex flex-wrap gap-1">{tabs.map((t) => <button key={t.k} onClick={() => setTab(t.k)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{t.l}</button>)}</div>
      {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      {tab === "receive" && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const serials = String(fd.get("serials") ?? "").split(/\n|,|;/).map((s) => s.trim()).filter(Boolean).map((line) => { const [sn, mac] = line.split(/\s+/); return { serialNumber: sn, macAddress: mac || null }; }); run(() => api("/inventory/operations/receive", { method: "POST", json: { catalogItemId: recvItem, quantity: recvIsSerial ? undefined : Number(fd.get("quantity")), units: recvIsSerial ? serials : undefined, note: fd.get("note") || undefined } }), "Оприходовано", form); }}>
          <Field label="Номенклатура"><select className={inputCls} value={recvItem} onChange={(e) => setRecvItem(Number(e.target.value))}>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku}){i.isSerialized ? " · серийный" : ""}</option>)}</select></Field>
          {recvIsSerial ? <Field label="Серийные номера" hint="По одному в строке. Опционально через пробел MAC-адрес: SN123 AA:BB:CC:DD:EE:FF"><textarea name="serials" className={inputCls} rows={4} required placeholder={"SN-0001\nSN-0002 00:1A:2B:3C:4D:5E"} /></Field> : <Field label="Количество"><input name="quantity" type="number" step="0.001" min="0.001" className={inputCls} required /></Field>}
          <Field label="Примечание"><input name="note" className={inputCls} placeholder="Поставщик, накладная №…" /></Field>
          <button className={btnCls} disabled={busy}>Оприходовать</button>
        </form>
      )}

      {tab === "issue" && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const teamId = Number(fd.get("teamId")); const json = issueMode === "unit" ? { teamId, unitId: Number(fd.get("unitId")), note: fd.get("note") || undefined } : { teamId, catalogItemId: Number(fd.get("catalogItemId")), quantity: Number(fd.get("quantity")), note: fd.get("note") || undefined }; run(() => api("/inventory/operations/issue", { method: "POST", json }), "Отгружено бригаде", form); }}>
          <Field label="Бригада"><select name="teamId" className={inputCls} required>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <div className="flex gap-2 text-xs"><button type="button" onClick={() => setIssueMode("unit")} className={`rounded-lg px-2 py-1 ${issueMode === "unit" ? "bg-slate-800 text-white" : "bg-slate-100"}`}>Серийная единица</button><button type="button" onClick={() => setIssueMode("qty")} className={`rounded-lg px-2 py-1 ${issueMode === "qty" ? "bg-slate-800 text-white" : "bg-slate-100"}`}>Материал (кол-во)</button></div>
          {issueMode === "unit" ? (
            <Field label="Единица на складе"><select name="unitId" className={inputCls} required>{units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.serialNumber}</option>)}</select></Field>
          ) : (
            <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><Field label="Материал"><select name="catalogItemId" className={inputCls} required>{balances.map((b) => <option key={b.catalogItemId} value={b.catalogItemId}>{b.name} (ост. {b.quantity} {b.unit})</option>)}</select></Field></div><Field label="Кол-во"><input name="quantity" type="number" step="0.001" min="0.001" className={inputCls} required /></Field></div>
          )}
          <Field label="Примечание"><input name="note" className={inputCls} /></Field>
          <button className={btnCls} disabled={busy || !teams.length}>Отгрузить</button>
        </form>
      )}

      {tab === "writeoff" && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const unitId = Number(fd.get("unitId")); const json = unitId ? { unitId, note: fd.get("note") || undefined } : { catalogItemId: Number(fd.get("catalogItemId")), quantity: Number(fd.get("quantity")), note: fd.get("note") || undefined }; run(() => api("/inventory/operations/write-off", { method: "POST", json }), "Списано", form); }}>
          <Field label="Серийная единица (со склада)"><select name="unitId" className={inputCls} defaultValue=""><option value="">— или материал ниже —</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.serialNumber}</option>)}</select></Field>
          <div className="grid grid-cols-3 gap-2"><div className="col-span-2"><Field label="Материал"><select name="catalogItemId" className={inputCls}>{balances.map((b) => <option key={b.catalogItemId} value={b.catalogItemId}>{b.name} (ост. {b.quantity} {b.unit})</option>)}</select></Field></div><Field label="Кол-во"><input name="quantity" type="number" step="0.001" min="0" defaultValue="0" className={inputCls} /></Field></div>
          <Field label="Причина"><input name="note" className={inputCls} required placeholder="Брак / утеря / …" /></Field>
          <button className={btnCls} disabled={busy}>Списать</button>
        </form>
      )}
    </Card>
  );
}
