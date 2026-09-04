import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { teamsStockSummary } from "@/lib/services/reports";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { sql } from "drizzle-orm";
import { Card, PageHeader, Badge } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const user = await requireUser(["teams.read"]);
  const [teams, stock, load] = await Promise.all([
    listTeamsWithDetails(),
    can(user, "inventory.read.all") ? teamsStockSummary() : Promise.resolve([]),
    db.select({ teamId: tickets.teamId, active: sql<number>`count(*) filter (where ${tickets.status} in ('assigned','scheduled','in_progress','on_hold'))::int` }).from(tickets).groupBy(tickets.teamId),
  ]);
  const smap = new Map(stock.map((s) => [s.teamId, s]));
  const lmap = new Map(load.map((l) => [l.teamId, l.active]));
  return (
    <div>
      <PageHeader title="Бригады" subtitle="Состав 2–3 монтажника, закреплённый автомобиль, собственные остатки" action={can(user, "teams.manage") ? <QuickForm collapsible title="+ Бригада" endpoint="/teams" submitLabel="Создать" fields={[{ name: "name", label: "Название", required: true, placeholder: "Бригада №3" }, { name: "description", label: "Описание" }]} /> : null} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {teams.map((t) => {
          const s = smap.get(t.id);
          return (
            <Card key={t.id} title={<Link href={`/teams/${t.id}`} className="text-indigo-700">{t.name}</Link>} action={t.isActive ? <Badge tone="green">активна</Badge> : <Badge>неактивна</Badge>}>
              <div className="space-y-2 text-sm">
                <div><div className="text-xs text-slate-500">Состав ({t.members.length}/3)</div>{t.members.length ? <ul>{t.members.map((m) => <li key={m.userId}>{m.isLead && "★ "}{m.fullName}{m.phone && <span className="text-xs text-slate-500"> · {m.phone}</span>}</li>)}</ul> : <span className="text-slate-400">—</span>}</div>
                <div><div className="text-xs text-slate-500">Автомобиль</div>{t.vehicles.length ? t.vehicles.map((v) => <div key={v.vehicleId}>{v.model} <span className="font-mono">{v.plateNumber}</span></div>) : <span className="text-slate-400">не закреплён</span>}</div>
                <div className="flex flex-wrap gap-2 pt-1 text-xs">
                  <Badge tone="indigo">Активных заявок: {lmap.get(t.id) ?? 0}</Badge>
                  {s && <Badge tone="amber">Остатки: {s.unitsAtTeam + s.unitsReserved} ед. / {s.materialItems} поз.</Badge>}
                </div>
                {can(user, "teams.manage") && (
                  <div className="pt-1">
                    <ActionButton
                      endpoint={`/teams/${t.id}`}
                      method="DELETE"
                      label="удалить бригаду"
                      confirm={`Удалить бригаду «${t.name}»?

Удаление возможно, только если на бригаде нет заявок, оборудования и остатков.`}
                      className="text-xs text-rose-600 hover:underline"
                    />
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
