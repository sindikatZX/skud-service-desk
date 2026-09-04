"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, inputCls, btnCls, btnSecondaryCls, btnDangerCls } from "@/components/ui";
import { STATUS_LABELS, toLocalInput } from "@/lib/labels";

type Props = {
  ticket: {
    id: number; status: string; teamId: number | null; priorityId: number; typeId: number;
    dueAt: string | null; scheduledStart: string | null; scheduledEnd: string | null; resultNote: string | null;
  };
  allowed: string[];
  /** Права текущего пользователя — считаются на сервере из роли. */
  perms: { assign: boolean; work: boolean; install: boolean; reserve: boolean; remove: boolean };
  types: { id: number; name: string }[];
  priorities: { id: number; name: string }[];
  isClosed: boolean;
  teams: { id: number; name: string; members: string }[];
  teamMembers: { id: number; fullName: string }[];
  teamStock: {
    units: { id: number; name: string; serialNumber: string; status: string; ticketId: number | null }[];
    balances: { catalogItemId: number; name: string; unit: string; quantity: number }[];
    reservations: { id: number; catalogItemId: number; name: string; unit: string; quantity: number }[];
    reservedUnits: { id: number; name: string; serialNumber: string }[];
  } | null;
};

export function TicketActions({ ticket, allowed, perms, types, priorities, isClosed, teams, teamMembers, teamStock }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, okText = "Сохранено") {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); router.refresh(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  const [statusComment, setStatusComment] = useState("");
  const [tab, setTab] = useState<"status" | "assign" | "work" | "install" | "reserve">(
    perms.assign && ticket.status === "new" ? "assign" : "status",
  );

  const tabs = [
    { k: "status", l: "Статус", show: allowed.length > 0 },
    { k: "assign", l: "Назначение", show: perms.assign && !isClosed },
    { k: "work", l: "Работы", show: perms.work && !isClosed && ticket.teamId },
    { k: "install", l: "Установка", show: perms.install && !isClosed && ticket.teamId && teamStock },
    { k: "reserve", l: "Резерв", show: perms.reserve && !isClosed && ticket.teamId && teamStock },
  ].filter((t) => t.show) as { k: typeof tab; l: string }[];

  async function removeTicket() {
    if (!window.confirm("Удалить заявку вместе с историей статусов, работами и чатом?\n\nЕсли по заявке есть резервы или установленное оборудование, удаление будет отклонено.")) return;
    setBusy(true); setMsg(null);
    try {
      await api(`/tickets/${ticket.id}`, { method: "DELETE" });
      router.push("/tickets");
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <Card title="Действия">
      <div className="no-scrollbar -mx-4 mb-3 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${tab === t.k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 active:bg-slate-200"}`}>{t.l}</button>
        ))}
      </div>
      {msg && <div className={`mb-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      {tab === "status" && (
        <div className="space-y-2">
          <textarea className={inputCls} rows={2} placeholder={allowed.includes("done") ? "Комментарий / итог работ (сохраняется как результат при завершении)" : "Комментарий к смене статуса"} value={statusComment} onChange={(e) => setStatusComment(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {allowed.map((s) => (
              <button key={s} disabled={busy} className={`flex-1 sm:flex-none ${s === "cancelled" ? btnDangerCls : s === "done" || s === "closed" ? btnCls : btnSecondaryCls}`}
                onClick={() => run(() => api(`/tickets/${ticket.id}/status`, { method: "POST", json: { status: s, comment: statusComment || undefined } }), `Статус: ${STATUS_LABELS[s]}`)}>
                → {STATUS_LABELS[s]}
              </button>
            ))}
            {allowed.length === 0 && <span className="text-sm text-slate-400">Переходы недоступны</span>}
          </div>
        </div>
      )}

      {tab === "assign" && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const b = Object.fromEntries(fd.entries()); run(() => api(`/tickets/${ticket.id}`, { method: "PATCH", json: { teamId: b.teamId ? Number(b.teamId) : null, scheduledStart: b.scheduledStart || null, scheduledEnd: b.scheduledEnd || null, dueAt: b.dueAt || null, priorityId: Number(b.priorityId), typeId: Number(b.typeId) } })); }}>
          <Field label="Бригада"><select name="teamId" className={inputCls} defaultValue={ticket.teamId ?? ""}><option value="">— не назначена —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.members ? ` (${t.members})` : ""}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Начало выезда"><input name="scheduledStart" type="datetime-local" className={inputCls} defaultValue={toLocalInput(ticket.scheduledStart)} /></Field>
            <Field label="Окончание"><input name="scheduledEnd" type="datetime-local" className={inputCls} defaultValue={toLocalInput(ticket.scheduledEnd)} /></Field>
          </div>
          <Field label="Срок выполнения"><input name="dueAt" type="datetime-local" className={inputCls} defaultValue={toLocalInput(ticket.dueAt)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Приоритет"><select name="priorityId" className={inputCls} defaultValue={ticket.priorityId}>{priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Тип"><select name="typeId" className={inputCls} defaultValue={ticket.typeId}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          </div>
          <button className={btnCls} disabled={busy}>Сохранить назначение</button>
        </form>
      )}

      {tab === "work" && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const b = Object.fromEntries(fd.entries()); run(() => api(`/tickets/${ticket.id}/works`, { method: "POST", json: b }), "Работа добавлена").then(() => form.reset()); }}>
          <Field label="Описание работы"><input name="description" className={inputCls} required placeholder="Напр.: Замена камеры, настройка регистратора" /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Кол-во"><input name="quantity" type="number" step="0.01" min="0.01" defaultValue="1" className={inputCls} /></Field>
            <Field label="Ед."><input name="unit" defaultValue="шт" className={inputCls} /></Field>
            <Field label="Мин."><input name="durationMinutes" type="number" min="0" className={inputCls} /></Field>
          </div>
          {teamMembers.length > 0 && <Field label="Исполнитель"><select name="performedBy" className={inputCls}>{teamMembers.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</select></Field>}
          <button className={btnCls} disabled={busy}>Добавить работу</button>
        </form>
      )}

      {tab === "install" && teamStock && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Списание из остатков бригады заявки. Сначала используются резервы под эту заявку.</p>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const unitId = Number(new FormData(form).get("unitId")); if (!unitId) return; run(() => api("/inventory/operations/install", { method: "POST", json: { ticketId: ticket.id, unitId } }), "Оборудование установлено"); }}>
            <Field label="Серийное оборудование" hint="Зарезервированные под заявку и свободные у бригады">
              <select name="unitId" className={inputCls} defaultValue="">
                <option value="">— выберите единицу —</option>
                {teamStock.reservedUnits.map((u) => <option key={`r${u.id}`} value={u.id}>★ {u.name} · {u.serialNumber} (резерв)</option>)}
                {teamStock.units.filter((u) => u.status === "at_team").map((u) => <option key={u.id} value={u.id}>{u.name} · {u.serialNumber}</option>)}
              </select>
            </Field>
            <button className={btnCls} disabled={busy}>Установить единицу</button>
          </form>
          <form className="space-y-2 border-t border-slate-200 pt-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => api("/inventory/operations/install", { method: "POST", json: { ticketId: ticket.id, catalogItemId: Number(fd.get("catalogItemId")), quantity: Number(fd.get("quantity")) } }), "Материал списан на объект"); }}>
            <Field label="Материалы (количественный учёт)">
              <select name="catalogItemId" className={inputCls} required>
                {teamStock.reservations.map((r) => <option key={`r${r.id}`} value={r.catalogItemId}>★ {r.name} — резерв {r.quantity} {r.unit}</option>)}
                {teamStock.balances.map((b) => <option key={b.catalogItemId} value={b.catalogItemId}>{b.name} — доступно {b.quantity} {b.unit}</option>)}
              </select>
            </Field>
            <div className="flex gap-2">
              <input name="quantity" type="number" step="0.001" min="0.001" defaultValue="1" className={inputCls} required />
              <button className={btnCls} disabled={busy || (!teamStock.balances.length && !teamStock.reservations.length)}>Списать</button>
            </div>
          </form>
        </div>
      )}

      {tab === "reserve" && teamStock && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Резервирование из остатков бригады под эту заявку.</p>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const unitId = Number(new FormData(e.currentTarget).get("unitId")); if (!unitId) return; run(() => api("/inventory/operations/reserve", { method: "POST", json: { ticketId: ticket.id, unitId } }), "Единица зарезервирована"); }}>
            <Field label="Серийное оборудование у бригады">
              <select name="unitId" className={inputCls} defaultValue=""><option value="">— выберите —</option>{teamStock.units.filter((u) => u.status === "at_team").map((u) => <option key={u.id} value={u.id}>{u.name} · {u.serialNumber}</option>)}</select>
            </Field>
            <button className={btnSecondaryCls} disabled={busy}>Зарезервировать единицу</button>
          </form>
          <form className="space-y-2 border-t border-slate-200 pt-3" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => api("/inventory/operations/reserve", { method: "POST", json: { ticketId: ticket.id, catalogItemId: Number(fd.get("catalogItemId")), quantity: Number(fd.get("quantity")) } }), "Материал зарезервирован"); }}>
            <Field label="Материалы">
              <select name="catalogItemId" className={inputCls} required>{teamStock.balances.map((b) => <option key={b.catalogItemId} value={b.catalogItemId}>{b.name} — доступно {b.quantity} {b.unit}</option>)}</select>
            </Field>
            <div className="flex gap-2"><input name="quantity" type="number" step="0.001" min="0.001" defaultValue="1" className={inputCls} required /><button className={btnSecondaryCls} disabled={busy || !teamStock.balances.length}>Резерв</button></div>
          </form>
          {(teamStock.reservations.length > 0 || teamStock.reservedUnits.length > 0) && (
            <div className="border-t border-slate-200 pt-3">
              <div className="mb-1 text-xs font-semibold text-slate-600">Снять резерв</div>
              <ul className="space-y-1 text-sm">
                {teamStock.reservedUnits.map((u) => <li key={`u${u.id}`} className="flex items-center justify-between gap-2"><span>{u.name} · <span className="font-mono text-xs">{u.serialNumber}</span></span><button disabled={busy} className="text-xs text-rose-600" onClick={() => run(() => api("/inventory/operations/unreserve", { method: "POST", json: { unitId: u.id } }), "Резерв снят")}>снять</button></li>)}
                {teamStock.reservations.map((r) => <li key={`r${r.id}`} className="flex items-center justify-between gap-2"><span>{r.name} — {r.quantity} {r.unit}</span><button disabled={busy} className="text-xs text-rose-600" onClick={() => run(() => api("/inventory/operations/unreserve", { method: "POST", json: { reservationId: r.id } }), "Резерв снят")}>снять</button></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {perms.remove && (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <button onClick={removeTicket} disabled={busy} className={btnDangerCls}>Удалить заявку</button>
          <p className="mt-1 text-[11px] text-slate-500">Ошибочно созданную заявку можно удалить, пока по ней нет складских движений.</p>
        </div>
      )}
    </Card>
  );
}
