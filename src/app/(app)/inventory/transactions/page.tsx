import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { listTransactions } from "@/lib/services/inventory";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { asc } from "drizzle-orm";
import { Card, PageHeader, Table, Td, inputCls } from "@/components/ui";
import { fmtDate, fmtQty, TX_LABELS, LOC_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["inventory.read.all", "inventory.read.team"]);
  const sp = await searchParams;
  const n = (k: string) => (sp[k] ? Number(sp[k]) : undefined);
  const teamScope = user.scope === "team" ? (user.teamId ?? -1) : n("teamId");
  const [rows, teams, clientRows] = await Promise.all([
    listTransactions({ teamId: teamScope, clientId: n("clientId"), ticketId: n("ticketId"), type: sp.type || undefined, limit: 500 }),
    listTeamsWithDetails(),
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
  ]);
  const loc = (t: string | null, team: string | null) => (t ? (t === "team" && team ? team : LOC_LABELS[t]) : "");
  return (
    <div>
      <PageHeader title="Журнал складских операций" subtitle={`${rows.length} записей`} action={<Link href="/inventory" className="text-sm text-indigo-600">← Склад</Link>} />
      <Card className="mb-4">
        <form className="grid gap-2 sm:grid-cols-5">
          <select name="type" defaultValue={sp.type ?? ""} className={inputCls}><option value="">Все операции</option>{Object.entries(TX_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="teamId" defaultValue={sp.teamId ?? ""} className={inputCls}><option value="">Все бригады</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select name="clientId" defaultValue={sp.clientId ?? ""} className={inputCls}><option value="">Все клиенты</option>{clientRows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input name="ticketId" defaultValue={sp.ticketId ?? ""} placeholder="ID заявки" className={inputCls} />
          <div className="flex gap-2"><button className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Фильтр</button><Link href="/inventory/transactions" className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Сброс</Link></div>
        </form>
      </Card>
      <Card>
        <Table head={["Дата", "Операция", "Позиция", "Кол-во", "Откуда → Куда", "Бригада", "Клиент / заявка", "Кто"]} empty={!rows.length}>
          {rows.map((x) => (
            <tr key={x.id} className="hover:bg-slate-50">
              <Td className="whitespace-nowrap text-xs">{fmtDate(x.createdAt)}</Td>
              <Td className="text-xs font-medium">{TX_LABELS[x.type]}</Td>
              <Td><div className="text-sm">{x.itemName}</div>{x.unitId && <Link href={`/inventory/units/${x.unitId}`} className="font-mono text-xs text-indigo-600">{x.serialNumber}</Link>}</Td>
              <Td className="text-sm">{fmtQty(x.quantity)} {x.unit}</Td>
              <Td className="text-xs">{loc(x.fromLocationType, x.fromTeamName)}{x.fromLocationType && x.toLocationType && " → "}{loc(x.toLocationType, x.toTeamName)}{x.toLocationType === "site" && x.siteName ? ` (${x.siteName})` : ""}</Td>
              <Td className="text-xs">{x.teamName ?? "—"}</Td>
              <Td className="text-xs">{x.clientName && <div>{x.clientName}</div>}{x.ticketId && <Link href={`/tickets/${x.ticketId}`} className="font-mono text-indigo-600">{x.ticketNumber}</Link>}{!x.clientName && !x.ticketId && "—"}</Td>
              <Td className="text-xs">{x.actorName ?? "—"}{x.note && <div className="text-slate-400">{x.note}</div>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
