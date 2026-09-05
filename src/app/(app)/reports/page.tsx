import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { can, canWithRole } from "@/lib/rbac";
import { dashboardSummary, employeeWorkload, inventoryConsumption, clientsReport, teamsStockSummary } from "@/lib/services/reports";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { Card, PageHeader, Table, Td, inputCls } from "@/components/ui";
import { STATUS_LABELS, fmtQty } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["reports.view", "reports.inventory", "reports.stock", "reports.movements", "reports.works"]);
  const sp = await searchParams;
  const from = sp.from ? new Date(sp.from) : undefined;
  const to = sp.to ? new Date(sp.to + "T23:59:59") : undefined;
  const teamId = sp.teamId ? Number(sp.teamId) : undefined;
  const viewOps = can(user, "reports.view");
  const [summary, workload, consumption, clientsRep, teamStock, teams] = await Promise.all([
    dashboardSummary(),
    viewOps ? employeeWorkload(from, to) : Promise.resolve([]),
    inventoryConsumption({ teamId, from, to }),
    viewOps ? clientsReport() : Promise.resolve([]),
    teamsStockSummary(),
    listTeamsWithDetails(),
  ]);
  // группировка расхода: бригада → клиент → заявка
  type Row = (typeof consumption)[number];
  const grouped = new Map<string, { teamName: string; clients: Map<string, { clientName: string; tickets: Map<string, { ticketId: number | null; ticketNumber: string | null; items: Row[] }> }> }>();
  for (const r of consumption) {
    const tk = String(r.teamId ?? 0);
    if (!grouped.has(tk)) grouped.set(tk, { teamName: r.teamName ?? "Без бригады", clients: new Map() });
    const g = grouped.get(tk)!;
    const ck = String(r.clientId ?? 0);
    if (!g.clients.has(ck)) g.clients.set(ck, { clientName: r.clientName ?? "—", tickets: new Map() });
    const c = g.clients.get(ck)!;
    const tkk = String(r.ticketId ?? 0);
    if (!c.tickets.has(tkk)) c.tickets.set(tkk, { ticketId: r.ticketId, ticketNumber: r.ticketNumber, items: [] });
    c.tickets.get(tkk)!.items.push(r);
  }
  return (
    <div>
      <PageHeader title="Отчёты" subtitle="Конфигурируемые отчёты с печатью и экспортом в CSV · сводки по заявкам, сотрудникам, складу и клиентам" />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { href: "/reports/stock", icon: "📦", title: "Отчёт остатков", text: "Начальный остаток, приход, расход и конечный остаток по складам за период.", ok: canWithRole(user, "reports.stock") || canWithRole(user, "reports.inventory") },
          { href: "/reports/movements", icon: "🔀", title: "Движение товаров", text: "Установка, поступление, перемещение, списание — по товарам, складам и периоду.", ok: canWithRole(user, "reports.movements") || canWithRole(user, "reports.inventory") },
          { href: "/reports/works?mode=what", icon: "🧰", title: "Работы: что сделали", text: "Выполненные работы за период по видам, с поиском по наименованию.", ok: canWithRole(user, "reports.works") || canWithRole(user, "reports.view") },
          { href: "/reports/works?mode=where", icon: "📍", title: "Работы: где сделали", text: "Работы по точкам клиентов, видам работ и бригадам.", ok: canWithRole(user, "reports.works") || canWithRole(user, "reports.view") },
        ].filter((c) => c.ok).map((c) => (
          <Link key={c.href} href={c.href} className="block transition hover:-translate-y-0.5">
            <Card>
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none">{c.icon}</span>
                <div>
                  <div className="font-semibold text-slate-900">{c.title}</div>
                  <p className="mt-0.5 text-sm text-slate-500">{c.text}</p>
                  <div className="mt-2 text-xs text-indigo-600">настроить · печать · CSV →</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex items-center gap-1.5"><span className="text-xs text-slate-500">с</span><input type="date" name="from" defaultValue={sp.from ?? ""} className={`${inputCls} w-[9.5rem] px-2`} /></label>
          <label className="flex items-center gap-1.5"><span className="text-xs text-slate-500">по</span><input type="date" name="to" defaultValue={sp.to ?? ""} className={`${inputCls} w-[9.5rem] px-2`} /></label>
          <select name="teamId" defaultValue={sp.teamId ?? ""} className={`${inputCls} w-auto min-w-[10rem]`}><option value="">Все бригады</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <div className="flex gap-2"><button className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Сформировать</button><Link href="/reports" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm">Очистить</Link></div>
        </form>
      </Card>

      {viewOps && (
        <>
          <h2 className="mb-2 text-lg font-semibold">Заявки</h2>
          {/* Показатели — компактные таблицы вместо крупных плиток: четыре блока в одну строку на широком экране */}
          <Card className="mb-4 p-3! sm:p-4!">
            <div className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <KpiTable
                title="По статусам"
                rows={Object.entries(STATUS_LABELS).map(([k, v]) => ({ key: k, label: v, value: summary.byStatus[k] ?? 0, href: `/tickets?status=${k}` }))}
              />
              <KpiTable
                title="SLA"
                rows={[
                  { key: "react", label: "Ср. время реакции", value: summary.avgReactionHours != null ? `${summary.avgReactionHours} ч` : "—", hint: "создание → в работу" },
                  { key: "res", label: "Ср. время решения", value: summary.avgResolutionHours != null ? `${summary.avgResolutionHours} ч` : "—", hint: "в работу → выполнено" },
                  { key: "cycle", label: "Полный цикл", value: summary.avgCompletionHours != null ? `${summary.avgCompletionHours} ч` : "—", hint: "создание → выполнено" },
                  { key: "ontime", label: "Выполнено в срок", value: summary.onTimeRate != null ? `${summary.onTimeRate}%` : "—", hint: "доля закрытых не позже срока" },
                ]}
              />
              <KpiTable title="По типам работ" rows={summary.byType.map((t) => ({ key: t.name, label: t.name, value: t.count }))} />
              <KpiTable title="По приоритетам" rows={summary.byPriority.map((p) => ({ key: p.name, label: p.name, value: p.count }))} />
            </div>
          </Card>
          <Card title="Загрузка и эффективность монтажников" className="mb-4">
            <Table head={["Сотрудник", "Бригада", "Работ выполнено", "Заявок с участием", "Часы (по работам)", "Активных заявок бригады", "Выполнено бригадой", "Просрочено", "Ср. время выполнения"]} empty={!workload.length}>
              {workload.map((w) => (
                <tr key={w.id}><Td className="font-medium">{w.fullName}</Td><Td>{w.teamName ? <Link href={`/teams/${w.teamId}`} className="text-indigo-600">{w.teamName}</Link> : "—"}</Td><Td>{w.works}</Td><Td>{w.ticketsTouched}</Td><Td>{(w.minutes / 60).toFixed(1)}</Td><Td>{w.teamActiveTickets}</Td><Td>{w.teamDoneTickets}</Td><Td className={w.teamOverdue ? "font-semibold text-rose-600" : ""}>{w.teamOverdue}</Td><Td>{w.teamAvgHours != null ? `${w.teamAvgHours} ч` : "—"}</Td></tr>
              ))}
            </Table>
          </Card>
          <Card title="Клиенты" className="mb-4">
            <Table head={["Клиент", "Объектов", "Заявок всего", "Открытых", "Установлено серийных ед."]} empty={!clientsRep.length}>
              {clientsRep.map((c) => <tr key={c.clientId}><Td><Link href={`/clients/${c.clientId}`} className="font-medium text-indigo-700">{c.clientName}</Link></Td><Td>{c.sites}</Td><Td>{c.tickets}</Td><Td>{c.open}</Td><Td>{c.installedUnits}</Td></tr>)}
            </Table>
          </Card>
        </>
      )}

      <h2 id="consumption" className="mb-2 text-lg font-semibold">Склад</h2>
      <Card title="Остатки у бригад (выдано и не установлено)" className="mb-4">
        <Table head={["Бригада", "Серийных ед. у бригады", "В резерве", "Позиций материалов"]} empty={!teamStock.length}>
          {teamStock.map((s) => <tr key={s.teamId}><Td><Link href={`/teams/${s.teamId}`} className="font-medium text-indigo-700">{s.teamName}</Link></Td><Td>{s.unitsAtTeam}</Td><Td>{s.unitsReserved}</Td><Td>{s.materialItems}</Td></tr>)}
        </Table>
      </Card>
      <Card title="Расход оборудования и материалов: бригада → клиент → заявка">
        {grouped.size === 0 && <p className="text-sm text-slate-400">За выбранный период установок не было</p>}
        <div className="space-y-4">
          {[...grouped.values()].map((g) => (
            <div key={g.teamName} className="rounded-xl border border-slate-200">
              <div className="rounded-t-xl bg-slate-50 px-3 py-2 font-semibold">{g.teamName}</div>
              {[...g.clients.values()].map((c) => (
                <div key={c.clientName} className="border-t border-slate-100 px-3 py-2">
                  <div className="text-sm font-medium text-indigo-800">{c.clientName}</div>
                  {[...c.tickets.values()].map((t) => (
                    <div key={String(t.ticketId)} className="ml-3 mt-1">
                      <div className="text-xs text-slate-500">Заявка {t.ticketId ? <Link href={`/tickets/${t.ticketId}`} className="font-mono text-indigo-600">{t.ticketNumber}</Link> : "—"}</div>
                      <ul className="ml-3 text-sm">{t.items.map((i, idx) => <li key={idx} className="flex justify-between gap-4"><span>{i.itemName} <span className="text-xs text-slate-400">{i.sku}</span></span><span className="whitespace-nowrap font-medium">{fmtQty(i.quantity)} {i.unit}{i.units ? ` (${i.units} S/N)` : ""}</span></li>)}</ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Компактная таблица показателей: подпись слева, значение справа (табличные цифры). */
function KpiTable({ title, rows }: { title: string; rows: { key: string; label: string; value: number | string; href?: string; hint?: string }[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-slate-100 last:border-0">
              <td className="py-0.5 pr-2 text-slate-700">
                {r.href ? <Link href={r.href} className="hover:text-indigo-700 hover:underline">{r.label}</Link> : r.label}
                {r.hint && <span className="ml-1 text-[10px] text-slate-400">{r.hint}</span>}
              </td>
              <td className="py-0.5 text-right font-semibold tabular-nums text-slate-900">{r.value}</td>
            </tr>
          ))}
          {!rows.length && <tr><td className="py-1 text-slate-400">Нет данных</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
