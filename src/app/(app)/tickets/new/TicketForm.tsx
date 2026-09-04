"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Card, Field, inputCls, btnCls } from "@/components/ui";

type Props = {
  clients: { id: number; name: string }[];
  sites: { id: number; clientId: number; name: string; address: string }[];
  teams: { id: number; name: string }[];
  types: { id: number; name: string }[];
  priorities: { id: number; name: string; slaHours: number | null }[];
  canAssign: boolean;
};

export function TicketForm({ clients, sites, teams, types, priorities, canAssign }: Props) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? 0);
  const clientSites = useMemo(() => sites.filter((s) => s.clientId === clientId), [sites, clientId]);
  const [siteId, setSiteId] = useState(clientSites[0]?.id ?? 0);
  const [priorityId, setPriorityId] = useState(priorities[1]?.id ?? priorities[0]?.id ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sla = priorities.find((p) => p.id === priorityId)?.slaHours ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries([...fd.entries()].filter(([, v]) => v !== ""));
    try {
      const t = await api<{ id: number }>("/tickets", {
        method: "POST",
        json: { ...body, clientId, siteId: siteId || clientSites[0]?.id, priorityId },
      });
      router.push(`/tickets/${t.id}`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Клиент"><select className={inputCls} value={clientId} onChange={(e) => { const id = Number(e.target.value); setClientId(id); setSiteId(sites.find((s) => s.clientId === id)?.id ?? 0); }}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Объект"><select className={inputCls} value={siteId || clientSites[0]?.id || ""} onChange={(e) => setSiteId(Number(e.target.value))} required>{clientSites.length === 0 && <option value="">— у клиента нет объектов —</option>}{clientSites.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.address}</option>)}</select></Field>
        </div>
        <Field label="Тема заявки"><input name="title" className={inputCls} required placeholder="Напр.: Не работает камера на входе" /></Field>
        <Field label="Описание"><textarea name="description" className={inputCls} rows={3} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Тип работ" hint="Список ведётся в справочниках">
            <select name="typeId" className={inputCls} required defaultValue={types[0]?.id}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Приоритет">
            <select className={inputCls} value={priorityId} onChange={(e) => setPriorityId(Number(e.target.value))}>
              {priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Срок выполнения" hint={sla ? `Если не задать — ${sla} ч по SLA приоритета` : undefined}>
            <input name="dueAt" type="datetime-local" className={inputCls} />
          </Field>
        </div>
        {canAssign && (
          <div className="grid gap-4 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
            <Field label="Бригада"><select name="teamId" className={inputCls} defaultValue=""><option value="">— не назначена —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label="Начало выезда"><input name="scheduledStart" type="datetime-local" className={inputCls} /></Field>
            <Field label="Окончание"><input name="scheduledEnd" type="datetime-local" className={inputCls} /></Field>
          </div>
        )}
        {err && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        <button className={btnCls} disabled={busy || !clientSites.length}>{busy ? "Сохранение…" : "Создать заявку"}</button>
      </form>
    </Card>
  );
}
