import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { listTickets } from "@/lib/services/tickets";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { Card, PageHeader, StatusBadge, Table, Td, inputCls, Fab, Chips, Badge } from "@/components/ui";
import { fmtDate, STATUS_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const OPEN = "new,assigned,scheduled,in_progress,on_hold";

function buildHref(base: Record<string, string | undefined>, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `/tickets?${qs}` : "/tickets";
}

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["tickets.read.all", "tickets.read.own"]);
  const sp = await searchParams;
  const filters = { q: sp.q, teamId: sp.teamId, status: sp.status, overdue: sp.overdue };
  const [rows, teams] = await Promise.all([
    listTickets(user, { status: sp.status, q: sp.q, teamId: sp.teamId ? Number(sp.teamId) : undefined, overdue: sp.overdue === "1" }),
    can(user, "teams.read") ? listTeamsWithDetails() : Promise.resolve([]),
  ]);
  const isTech = user.scope === "team";
  const canCreate = can(user, "tickets.create");
  const hasAdvanced = Boolean(sp.q || sp.teamId);

  const chips = [
    { href: buildHref(filters, { status: undefined, overdue: undefined }), label: "Все", active: !sp.status && sp.overdue !== "1" },
    { href: buildHref(filters, { status: OPEN, overdue: undefined }), label: "Открытые", active: sp.status === OPEN && sp.overdue !== "1" },
    { href: buildHref(filters, { status: undefined, overdue: "1" }), label: "Просроченные", active: sp.overdue === "1", tone: "rose" as const },
    ...Object.entries(STATUS_LABELS).map(([k, v]) => ({ href: buildHref(filters, { status: k, overdue: undefined }), label: v, active: sp.status === k && sp.overdue !== "1" })),
  ];

  return (
    <div>
      <PageHeader
        title={isTech ? "Заявки моей бригады" : "Заявки"}
        subtitle={`${rows.length} ${plural(rows.length, "заявка", "заявки", "заявок")}`}
        action={canCreate ? <Link href="/tickets/new" className="hidden rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white lg:inline-flex">+ Новая заявка</Link> : null}
      />
      {sp.denied && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">Раздел недоступен для вашей роли.</div>}

      <div className="mb-3">
        <Chips items={chips} />
      </div>

      <details className="group mb-4" open={hasAdvanced}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 group-open:bg-indigo-50 group-open:text-indigo-700">⌕</span>
          Поиск и фильтры
          {hasAdvanced && <Badge tone="indigo">активны</Badge>}
        </summary>
        <Card className="mt-2">
          <form className="grid gap-2 sm:grid-cols-4">
            {sp.status && <input type="hidden" name="status" value={sp.status} />}
            {sp.overdue && <input type="hidden" name="overdue" value={sp.overdue} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Номер, название, адрес…" className={`${inputCls} sm:col-span-2`} inputMode="search" enterKeyHint="search" />
            {teams.length > 0 && !isTech ? (
              <select name="teamId" defaultValue={sp.teamId ?? ""} className={inputCls}>
                <option value="">Все бригады</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : <div className="hidden sm:block" />}
            <div className="flex gap-2">
              <button className="min-h-[2.5rem] flex-1 rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Найти</button>
              <Link href="/tickets" className="inline-flex min-h-[2.5rem] items-center rounded-xl border border-slate-300 px-4 py-2 text-sm">Сброс</Link>
            </div>
          </form>
        </Card>
      </details>

      {/* Мобильные карточки */}
      <div className="space-y-2 md:hidden">
        {rows.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-400">Заявок по этому фильтру нет</div>}
        {rows.map((t) => {
          const overdue = isOverdue(t.dueAt, t.status);
          return (
            <Link key={t.id} href={`/tickets/${t.id}`} className={`block rounded-2xl border bg-white p-3.5 shadow-sm active:bg-slate-50 ${overdue ? "border-rose-200" : "border-slate-200"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{t.number}</span>
                <div className="flex items-center gap-1.5">{overdue && <Badge tone="rose">просрочена</Badge>}<StatusBadge status={t.status} /></div>
              </div>
              <div className="mt-1.5 text-[15px] font-semibold leading-snug">{t.title}</div>
              <div className="mt-0.5 truncate text-xs text-slate-500">{t.clientName} · {t.siteAddress}</div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="truncate"><span className={`font-medium ${t.priorityColor}`}>{t.priorityName}</span> · {t.typeName}{t.teamName && !isTech ? ` · ${t.teamName}` : ""}</span>
                <span className={`shrink-0 ${overdue ? "font-semibold text-rose-600" : "text-slate-600"}`}>{t.scheduledStart ? `Выезд ${fmtDate(t.scheduledStart)}` : `Срок ${fmtDate(t.dueAt)}`}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Таблица (планшет/desktop) */}
      <Card className="hidden md:block">
        <Table head={["№", "Заявка", "Клиент / объект", "Бригада", "Выезд", "Срок", "Статус"]} empty={!rows.length} emptyText="Заявок по этому фильтру нет">
          {rows.map((t) => {
            const overdue = isOverdue(t.dueAt, t.status);
            return (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td><Link href={`/tickets/${t.id}`} className="font-mono text-xs text-indigo-600">{t.number}</Link></Td>
                <Td><Link href={`/tickets/${t.id}`} className="font-medium hover:underline">{t.title}</Link><div className="text-xs text-slate-500">{t.typeName} · <span className={t.priorityColor}>{t.priorityName}</span></div></Td>
                <Td><div>{t.clientName}</div><div className="text-xs text-slate-500">{t.siteName} — {t.siteAddress}</div></Td>
                <Td>{t.teamName ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(t.scheduledStart)}</Td>
                <Td className={`whitespace-nowrap text-xs ${overdue ? "font-semibold text-rose-600" : ""}`}>{fmtDate(t.dueAt)}</Td>
                <Td><StatusBadge status={t.status} /></Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      {canCreate && <Fab href="/tickets/new" label="Заявка" />}
    </div>
  );
}

function isOverdue(dueAt: Date | string | null, status: string) {
  return Boolean(dueAt) && new Date(dueAt as Date).getTime() < Date.now() && !["done", "closed", "cancelled"].includes(status);
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
