import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { getStock, listTransactions } from "@/lib/services/inventory";
import { listTickets } from "@/lib/services/tickets";
import { Card, PageHeader, StatusBadge, Table, Td, Empty } from "@/components/ui";
import { StockView } from "@/components/StockView";
import { fmtDate, fmtQty, TX_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function MyTeamPage() {
  const user = await requireUser(["inventory.read.team"]);
  if (!user.teamId) return <div><PageHeader title="Моя бригада" /><Empty text="Вы не состоите в бригаде. Обратитесь к администратору." /></div>;
  const [team, stock, today, tx] = await Promise.all([
    listTeamsWithDetails().then((all) => all.find((t) => t.id === user.teamId)),
    getStock("team", user.teamId),
    listTickets(user, { status: "assigned,scheduled,in_progress,on_hold", limit: 20 }),
    listTransactions({ teamId: user.teamId, limit: 30 }),
  ]);
  return (
    <div>
      <PageHeader title={team?.name ?? "Моя бригада"} subtitle={<>{team?.members.map((m) => m.fullName).join(", ")}{team?.vehicles.length ? <> · 🚐 {team.vehicles.map((v) => `${v.model} ${v.plateNumber}`).join(", ")}</> : null}</>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Текущие заявки">
            {today.length ? <ul className="space-y-2 text-sm">{today.map((t) => <li key={t.id}><Link href={`/tickets/${t.id}`} className="block rounded-xl border border-slate-200 p-2 hover:bg-slate-50"><div className="flex justify-between"><span className="font-mono text-xs text-slate-500">{t.number}</span><StatusBadge status={t.status} /></div><div className="font-medium">{t.title}</div><div className="text-xs text-slate-500">{t.siteAddress}</div><div className="text-xs text-slate-500">Выезд: {fmtDate(t.scheduledStart)}</div></Link></li>)}</ul> : <p className="text-sm text-slate-400">Нет активных заявок</p>}
          </Card>
          <Card title="Последние движения">
            <Table head={["Дата", "Операция", "Позиция", "Кол-во"]} empty={!tx.length}>
              {tx.map((x) => <tr key={x.id}><Td className="whitespace-nowrap text-xs">{fmtDate(x.createdAt)}</Td><Td className="text-xs">{TX_LABELS[x.type]}</Td><Td className="text-xs">{x.itemName}{x.serialNumber && <div className="font-mono text-[10px]">{x.serialNumber}</div>}</Td><Td className="text-xs">{fmtQty(x.quantity)}</Td></tr>)}
            </Table>
          </Card>
        </div>
        <div className="lg:col-span-2"><StockView stock={stock} title="Оборудование у бригады" /></div>
      </div>
    </div>
  );
}
