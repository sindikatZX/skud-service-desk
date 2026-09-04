import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { listTickets } from "@/lib/services/tickets";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { Card, PageHeader, StatusBadge, Table, Td, inputCls } from "@/components/ui";
import { fmtDate, STATUS_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["tickets.read.all", "tickets.read.own"]);
  const sp = await searchParams;
  const [rows, teams] = await Promise.all([
    listTickets(user, { status: sp.status, q: sp.q, teamId: sp.teamId ? Number(sp.teamId) : undefined, overdue: sp.overdue === "1" }),
    can(user, "teams.read") ? listTeamsWithDetails() : Promise.resolve([]),
  ]);
  const isTech = user.scope === "team";
  return (
    <div>
      <PageHeader
        title={isTech ? "Заявки моей бригады" : "Заявки"}
        subtitle={`${rows.length} заявок`}
        action={can(user, "tickets.create") ? <Link href="/tickets/new" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">+ Новая заявка</Link> : null}
      />
      {sp.denied && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">Раздел недоступен для вашей роли.</div>}
      <Card className="mb-4">
        <form className="grid gap-2 sm:grid-cols-4">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Поиск по номеру / названию" className={inputCls} />
          <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
            <option value="">Все статусы</option>
            <option value="new,assigned,scheduled,in_progress,on_hold">Открытые</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {teams.length > 0 && !isTech && (
            <select name="teamId" defaultValue={sp.teamId ?? ""} className={inputCls}>
              <option value="">Все бригады</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Фильтр</button>
            <Link href="/tickets" className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Сброс</Link>
          </div>
        </form>
      </Card>
      {/* Мобильные карточки */}
      <div className="space-y-2 md:hidden">
        {rows.length === 0 && <p className="text-center text-sm text-slate-400">Нет заявок</p>}
        {rows.map((t) => (
          <Link key={t.id} href={`/tickets/${t.id}`} className="block rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between"><span className="font-mono text-xs text-slate-500">{t.number}</span><StatusBadge status={t.status} /></div>
            <div className="mt-1 font-semibold">{t.title}</div>
            <div className="text-xs text-slate-500">{t.clientName} · {t.siteAddress}</div>
            <div className="mt-1 flex justify-between text-xs"><span className={t.priorityColor}>{t.priorityName} · {t.typeName}</span><span>{t.scheduledStart ? `Выезд ${fmtDate(t.scheduledStart)}` : `Срок ${fmtDate(t.dueAt)}`}</span></div>
          </Link>
        ))}
      </div>
      <Card className="hidden md:block">
        <Table head={["№", "Заявка", "Клиент / объект", "Бригада", "Выезд", "Срок", "Статус"]} empty={!rows.length}>
          {rows.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50">
              <Td><Link href={`/tickets/${t.id}`} className="font-mono text-xs text-indigo-600">{t.number}</Link></Td>
              <Td><Link href={`/tickets/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-500">{t.typeName} · <span className={t.priorityColor}>{t.priorityName}</span></div></Td>
              <Td><div>{t.clientName}</div><div className="text-xs text-slate-500">{t.siteName} — {t.siteAddress}</div></Td>
              <Td>{t.teamName ?? <span className="text-slate-400">—</span>}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtDate(t.scheduledStart)}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtDate(t.dueAt)}</Td>
              <Td><StatusBadge status={t.status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
