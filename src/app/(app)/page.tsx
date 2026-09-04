import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/page-auth";
import { dashboardSummary, teamsStockSummary } from "@/lib/services/reports";
import { listTickets } from "@/lib/services/tickets";
import { Card, PageHeader, Stat, StatusBadge, Table, Td, Fab } from "@/components/ui";
import { fmtDate } from "@/lib/labels";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser([]);
  if (user.scope !== "all") redirect("/tickets");
  const [summary, active, overdue, teamStock] = await Promise.all([
    dashboardSummary(),
    listTickets(user, { status: "new,assigned,scheduled,in_progress,on_hold", limit: 10 }),
    listTickets(user, { overdue: true, limit: 5 }),
    can(user, "inventory.read.all") ? teamsStockSummary() : Promise.resolve([]),
  ]);
  const s = summary.byStatus;
  const openCount = (s.new ?? 0) + (s.assigned ?? 0) + (s.scheduled ?? 0) + (s.in_progress ?? 0) + (s.on_hold ?? 0);
  return (
    <div>
      <PageHeader title="Главная" subtitle={`Добро пожаловать, ${user.fullName}`} action={can(user, "tickets.create") ? <Link href="/tickets/new" className="hidden rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white lg:inline-flex">+ Новая заявка</Link> : null} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Новые" value={s.new ?? 0} href="/tickets?status=new" />
        <Stat label="В работе" value={(s.in_progress ?? 0) + (s.scheduled ?? 0) + (s.assigned ?? 0)} href="/tickets?status=assigned,scheduled,in_progress" />
        <Stat label="Открытых всего" value={openCount} href="/tickets" />
        <Stat label="Просрочено" value={<span className={summary.overdue ? "text-rose-600" : ""}>{summary.overdue}</span>} href="/tickets?overdue=1" />
        <Stat label="Выезды сегодня" value={summary.scheduledToday} />
        <Stat label="Ср. время выполнения" value={summary.avgCompletionHours != null ? `${summary.avgCompletionHours} ч` : "—"} hint="от создания до выполнения" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Активные заявки" className="xl:col-span-2" action={<Link href="/tickets?status=new,assigned,scheduled,in_progress,on_hold" className="text-sm text-indigo-600">Все →</Link>}>
          <ul className="space-y-2 md:hidden">
            {active.length === 0 && <li className="py-4 text-center text-sm text-slate-400">Активных заявок нет</li>}
            {active.map((t) => (
              <li key={t.id}>
                <Link href={`/tickets/${t.id}`} className="block rounded-xl border border-slate-200 p-3 active:bg-slate-50">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-slate-500">{t.number}</span><StatusBadge status={t.status} /></div>
                  <div className="mt-1 font-medium leading-snug">{t.title}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate-500"><span className="truncate">{t.clientName}{t.teamName ? ` · ${t.teamName}` : ""}</span><span className="shrink-0">до {fmtDate(t.dueAt)}</span></div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
          <Table head={["№", "Заявка", "Клиент / объект", "Бригада", "Срок", "Статус"]} empty={!active.length}>
            {active.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td><Link href={`/tickets/${t.id}`} className="font-mono text-xs text-indigo-600">{t.number}</Link></Td>
                <Td><div className="font-medium">{t.title}</div><div className="text-xs text-slate-500">{t.typeName} · <span className={t.priorityColor}>{t.priorityName}</span></div></Td>
                <Td><div>{t.clientName}</div><div className="text-xs text-slate-500">{t.siteName}</div></Td>
                <Td>{t.teamName ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(t.dueAt)}</Td>
                <Td><StatusBadge status={t.status} /></Td>
              </tr>
            ))}
          </Table>
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="Просроченные">
            {overdue.length ? (
              <ul className="space-y-2 text-sm">
                {overdue.map((t) => (
                  <li key={t.id}><Link href={`/tickets/${t.id}`} className="block rounded-xl border border-rose-100 bg-rose-50 px-3 py-2"><div className="font-medium text-rose-800">{t.title}</div><div className="text-xs text-rose-600">{t.clientName} · срок {fmtDate(t.dueAt)}</div></Link></li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-400">Просроченных заявок нет</p>}
          </Card>
          {teamStock.length > 0 && (
            <Card title="Остатки у бригад" action={<Link href="/inventory" className="text-sm text-indigo-600">Склад →</Link>}>
              <ul className="divide-y divide-slate-100 text-sm">
                {teamStock.map((t) => (
                  <li key={t.teamId} className="flex items-center justify-between py-2">
                    <Link href={`/teams/${t.teamId}`} className="font-medium text-indigo-700">{t.teamName}</Link>
                    <span className="text-xs text-slate-500">{t.unitsAtTeam} ед. · {t.unitsReserved} в резерве · {t.materialItems} поз. материалов</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      {can(user, "tickets.create") && <Fab href="/tickets/new" label="Заявка" />}
    </div>
  );
}
