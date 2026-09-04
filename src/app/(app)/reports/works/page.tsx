import Link from "next/link";
import { db } from "@/db";
import { ticketTypes, sites, clients, teams, users, roles } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { canWithRole } from "@/lib/rbac";
import { Card, PageHeader, Field, inputCls } from "@/components/ui";
import { fmtQty, fmtDate } from "@/lib/labels";
import { worksReport, parsePeriod, periodLabel } from "@/lib/services/report-builder";
import { worksReportQuerySchema } from "@/lib/validators";
import { ReportToolbar, SortTh, PrintHeader, PrintFooter, MultiSelect, ReportForm } from "../ReportKit";

export const dynamic = "force-dynamic";

export default async function WorksReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["reports.works", "reports.view"]);
  const sp = await searchParams;
  const parsed = worksReportQuerySchema.safeParse(sp);
  const q = parsed.success ? parsed.data : worksReportQuerySchema.parse({});
  const canExport = canWithRole(user, "reports.export");
  const [types, siteRows, clientRows, teamRows, performers] = await Promise.all([
    db.select({ id: ticketTypes.id, name: ticketTypes.name }).from(ticketTypes).orderBy(asc(ticketTypes.sortOrder)),
    db.select({ id: sites.id, name: sites.name, clientName: clients.name }).from(sites).innerJoin(clients, eq(clients.id, sites.clientId)).orderBy(asc(clients.name), asc(sites.name)),
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
    db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
    db.select({ id: users.id, name: users.fullName }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(roles.isFieldStaff, true)).orderBy(asc(users.fullName)),
  ]);
  const period = parsePeriod(q.from, q.to);
  const rep = await worksReport({ period, typeIds: q.typeIds, q: q.q, siteIds: q.siteIds, clientIds: q.clientIds, teamIds: q.teamIds, performerIds: q.performerIds, sort: q.sort, dir: q.dir, limit: q.limit });
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const sort = q.sort ?? "date"; const dir = q.dir ?? "desc";
  const where = q.mode === "where";
  const title = where ? "Отчёт по работам: где сделали" : "Отчёт по работам: что сделали";
  const filters = [
    { label: "Виды работ", value: types.filter((t) => q.typeIds.includes(t.id)).map((t) => t.name).join(", ") },
    { label: "Работа", value: q.q ?? "" },
    { label: "Клиенты", value: clientRows.filter((c) => q.clientIds.includes(c.id)).map((c) => c.name).join(", ") },
    { label: "Объекты", value: siteRows.filter((s) => q.siteIds.includes(s.id)).map((s) => `${s.clientName} — ${s.name}`).join(", ") },
    { label: "Бригады", value: teamRows.filter((t) => q.teamIds.includes(t.id)).map((t) => t.name).join(", ") },
    { label: "Исполнители", value: performers.filter((p) => q.performerIds.includes(p.id)).map((p) => p.name).join(", ") },
  ];

  return (
    <div>
      <PageHeader title={title} subtitle="Выполненные работы из актов по заявкам" action={<Link href="/reports" className="no-print text-sm text-indigo-600">← Все отчёты</Link>} />
      <div className="no-print mb-3 flex gap-2 text-sm">
        <Link href={`/reports/works?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1]))), mode: "what" }).toString()}`} className={`rounded-full border px-3 py-1 ${!where ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"}`}>Что сделали</Link>
        <Link href={`/reports/works?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1]))), mode: "where" }).toString()}`} className={`rounded-full border px-3 py-1 ${where ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"}`}>Где сделали</Link>
      </div>
      <Card className="no-print mb-4">
        <ReportForm action="/reports/works">
          <input type="hidden" name="mode" value={q.mode} />
          <div className="grid gap-2">
            <Field label="Период с"><input type="date" name="from" defaultValue={q.from ?? ""} className={inputCls} /></Field>
            <Field label="по"><input type="date" name="to" defaultValue={q.to ?? ""} className={inputCls} /></Field>
            <Field label="Работа (часть наименования)"><input name="q" defaultValue={q.q ?? ""} className={inputCls} placeholder="монтаж камеры" /></Field>
          </div>
          <MultiSelect name="typeIds[]" label="Вид работ" options={types} selected={q.typeIds} />
          {where ? (
            <>
              <div className="grid gap-2">
                <MultiSelect name="clientIds[]" label="Клиенты" options={clientRows} selected={q.clientIds} size={4} />
                <MultiSelect name="teamIds[]" label="Бригады" options={teamRows} selected={q.teamIds} size={3} />
              </div>
              <MultiSelect name="siteIds[]" label="Точки (объекты) клиента" options={siteRows.map((s) => ({ value: s.id, label: `${s.clientName} — ${s.name}` }))} selected={q.siteIds} size={8} />
            </>
          ) : (
            <div className="grid gap-2">
              <MultiSelect name="performerIds[]" label="Исполнители" options={performers} selected={q.performerIds} size={4} />
              <MultiSelect name="teamIds[]" label="Бригады" options={teamRows} selected={q.teamIds} size={3} />
            </div>
          )}
        </ReportForm>
      </Card>

      <Card className="print-area">
        <PrintHeader title={title} period={periodLabel(period)} filters={filters} user={user.fullName} />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-0.5">Работ: <b>{rep.totals.works}</b></span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">Заявок: <b>{rep.totals.tickets}</b></span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">Часов: <b>{(rep.totals.minutes / 60).toFixed(1)}</b></span>
          </div>
          <div className="ml-auto"><ReportToolbar csvHref={`/api/v1/reports/works?${query}&format=csv`} resetHref={`/reports/works?mode=${q.mode}`} canExport={canExport} rows={rep.rows.length} /></div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{where ? "Сводка по объектам" : "Сводка по видам выполненных работ"}</div>
            <table className="w-full text-xs"><tbody>
              {(where ? rep.bySite : rep.byWork).slice(0, 15).map((g) => <tr key={g.key} className="border-t border-slate-100"><td className="py-1 pr-2">{g.label}</td><td className="py-1 text-right tabular-nums">{g.count} раб. · {fmtQty(g.quantity)} ед. · {(g.minutes / 60).toFixed(1)} ч</td></tr>)}
              {!(where ? rep.bySite : rep.byWork).length && <tr><td className="py-2 text-slate-400">Нет данных</td></tr>}
            </tbody></table>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{where ? "Сводка по бригадам" : "Сводка по видам заявок"}</div>
            <table className="w-full text-xs"><tbody>
              {(where ? rep.byTeam : rep.byType).map((g) => <tr key={g.key} className="border-t border-slate-100"><td className="py-1 pr-2">{g.label}</td><td className="py-1 text-right tabular-nums">{g.count} раб. · {g.tickets} заяв. · {(g.minutes / 60).toFixed(1)} ч</td></tr>)}
              {!(where ? rep.byTeam : rep.byType).length && <tr><td className="py-2 text-slate-400">Нет данных</td></tr>}
            </tbody></table>
          </div>
        </div>

        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <SortTh field="date" current={sort} dir={dir}>Дата</SortTh>
                {where && <><SortTh field="client" current={sort} dir={dir}>Клиент</SortTh><SortTh field="site" current={sort} dir={dir}>Объект</SortTh><SortTh field="team" current={sort} dir={dir}>Бригада</SortTh></>}
                <SortTh field="type" current={sort} dir={dir}>Вид работ</SortTh>
                <SortTh field="work" current={sort} dir={dir}>Работа</SortTh>
                <SortTh field="quantity" current={sort} dir={dir} className="text-right">Кол-во</SortTh>
                <SortTh field="minutes" current={sort} dir={dir} className="text-right">Мин.</SortTh>
                <SortTh field="ticket" current={sort} dir={dir}>Заявка</SortTh>
                {!where && <><SortTh field="performer" current={sort} dir={dir}>Исполнитель</SortTh><SortTh field="team" current={sort} dir={dir}>Бригада</SortTh><SortTh field="site" current={sort} dir={dir}>Объект</SortTh></>}
                {where && <SortTh field="performer" current={sort} dir={dir}>Исполнитель</SortTh>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rep.rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">{fmtDate(r.date)}</td>
                  {where && <><td className="px-3 py-1.5 text-xs">{r.client}</td><td className="px-3 py-1.5 text-xs"><div>{r.site}</div><div className="text-[11px] text-slate-500">{r.address}</div></td><td className="px-3 py-1.5 text-xs">{r.team ?? "—"}</td></>}
                  <td className="px-3 py-1.5 text-xs">{r.type}</td>
                  <td className="px-3 py-1.5 font-medium">{r.work}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(r.quantity)} {r.unit}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.minutes ?? "—"}</td>
                  <td className="px-3 py-1.5 text-xs"><Link href={`/tickets/${r.ticketId}`} className="font-mono text-indigo-600">{r.ticketNumber}</Link><div className="max-w-[16rem] truncate text-[11px] text-slate-500">{r.ticketTitle}</div></td>
                  {!where && <><td className="px-3 py-1.5 text-xs">{r.performer ?? "—"}</td><td className="px-3 py-1.5 text-xs">{r.team ?? "—"}</td><td className="px-3 py-1.5 text-xs">{r.client} — {r.site}</td></>}
                  {where && <td className="px-3 py-1.5 text-xs">{r.performer ?? "—"}</td>}
                </tr>
              ))}
              {!rep.rows.length && <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">Работ по заданным условиям нет</td></tr>}
            </tbody>
          </table>
        </div>
        <PrintFooter />
      </Card>
    </div>
  );
}
