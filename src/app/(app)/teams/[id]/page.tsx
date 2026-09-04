import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { teams, teamMembers, users, vehicleAssignments, vehicles, roles } from "@/db/schema";
import { and, eq, desc, isNull, asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { getStock } from "@/lib/services/inventory";
import { listTickets } from "@/lib/services/tickets";
import { Card, PageHeader, StatusBadge, Table, Td, Badge } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";
import { StockView } from "@/components/StockView";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["teams.read"]);
  const id = Number((await params).id);
  const [t] = await db.select().from(teams).where(eq(teams.id, id));
  if (!t) notFound();
  const canSeeStock = can(user, "inventory.read.all") || user.teamId === id;
  const [members, cars, stock, active, freeTechs, freeCars] = await Promise.all([
    db.select({ id: teamMembers.id, userId: users.id, fullName: users.fullName, phone: users.phone, isLead: teamMembers.isLead, joinedAt: teamMembers.joinedAt, leftAt: teamMembers.leftAt }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).where(eq(teamMembers.teamId, id)).orderBy(desc(teamMembers.joinedAt)),
    db.select({ id: vehicleAssignments.id, vehicleId: vehicles.id, plateNumber: vehicles.plateNumber, model: vehicles.model, assignedAt: vehicleAssignments.assignedAt, releasedAt: vehicleAssignments.releasedAt }).from(vehicleAssignments).innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId)).where(eq(vehicleAssignments.teamId, id)).orderBy(desc(vehicleAssignments.assignedAt)),
    canSeeStock ? getStock("team", id) : Promise.resolve(null),
    listTickets(user, { teamId: id, limit: 30 }),
    can(user, "teams.manage") ? db.select({ id: users.id, fullName: users.fullName, teamId: teamMembers.teamId }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).leftJoin(teamMembers, and(eq(teamMembers.userId, users.id), isNull(teamMembers.leftAt))).where(and(eq(roles.isFieldStaff, true), eq(users.isActive, true))).orderBy(asc(users.fullName)) : Promise.resolve([]),
    can(user, "teams.manage") ? db.select({ id: vehicles.id, plateNumber: vehicles.plateNumber, model: vehicles.model }).from(vehicles).where(eq(vehicles.isActive, true)) : Promise.resolve([]),
  ]);
  const current = members.filter((m) => !m.leftAt);
  const currentCars = cars.filter((c) => !c.releasedAt);
  const manage = can(user, "teams.manage");
  return (
    <div>
      <PageHeader title={t.name} subtitle={t.description ?? "Бригада монтажников"} action={<Link href="/teams" className="text-sm text-indigo-600">← Бригады</Link>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title={`Состав (${current.length}/3)`}>
            <ul className="space-y-1 text-sm">
              {current.map((m) => <li key={m.id} className="flex items-center justify-between"><span>{m.isLead && <Badge tone="indigo">старший</Badge>} {m.fullName}<span className="text-xs text-slate-500"> · с {fmtDate(m.joinedAt, false)}</span></span>{manage && <ActionButton endpoint={`/teams/${id}/members?userId=${m.userId}`} method="DELETE" label="вывести" confirm="Вывести сотрудника из бригады?" className="text-xs text-rose-600" />}</li>)}
              {!current.length && <li className="text-slate-400">Нет участников</li>}
            </ul>
            {manage && current.length < 3 && (
              <div className="mt-3"><QuickForm compact collapsible variant="secondary" title="+ Добавить монтажника" endpoint={`/teams/${id}/members`} submitLabel="Добавить" fields={[{ name: "userId", label: "Сотрудник", type: "select", required: true, numeric: true, options: freeTechs.map((u) => ({ value: u.id, label: `${u.fullName}${u.teamId ? " (в другой бригаде)" : ""}` })) }, { name: "isLead", label: "Старший", type: "checkbox" }]} /></div>
            )}
            {members.some((m) => m.leftAt) && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">История состава</summary><ul className="mt-1 space-y-0.5">{members.filter((m) => m.leftAt).map((m) => <li key={m.id}>{m.fullName}: {fmtDate(m.joinedAt, false)} — {fmtDate(m.leftAt, false)}</li>)}</ul></details>}
          </Card>
          <Card title="Автомобиль">
            <ul className="space-y-1 text-sm">
              {currentCars.map((c) => <li key={c.id} className="flex items-center justify-between"><span>{c.model} <span className="font-mono">{c.plateNumber}</span><span className="text-xs text-slate-500"> · с {fmtDate(c.assignedAt, false)}</span></span>{manage && <ActionButton endpoint={`/teams/${id}/vehicles?vehicleId=${c.vehicleId}`} method="DELETE" label="открепить" className="text-xs text-rose-600" />}</li>)}
              {!currentCars.length && <li className="text-slate-400">Не закреплён</li>}
            </ul>
            {manage && <div className="mt-3"><QuickForm compact collapsible variant="secondary" title="+ Закрепить автомобиль" endpoint={`/teams/${id}/vehicles`} submitLabel="Закрепить" fields={[{ name: "vehicleId", label: "Автомобиль", type: "select", required: true, numeric: true, options: freeCars.map((v) => ({ value: v.id, label: `${v.model} ${v.plateNumber}` })) }]} /></div>}
            {cars.some((c) => c.releasedAt) && <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">История закрепления</summary><ul className="mt-1 space-y-0.5">{cars.filter((c) => c.releasedAt).map((c) => <li key={c.id}>{c.model} {c.plateNumber}: {fmtDate(c.assignedAt, false)} — {fmtDate(c.releasedAt, false)}</li>)}</ul></details>}
          </Card>
          <Card title="Заявки бригады">
            <Table head={["№", "Заявка", "Статус"]} empty={!active.length}>
              {active.map((x) => <tr key={x.id}><Td><Link href={`/tickets/${x.id}`} className="font-mono text-xs text-indigo-600">{x.number}</Link></Td><Td><div className="text-sm">{x.title}</div><div className="text-xs text-slate-500">{x.clientName}</div></Td><Td><StatusBadge status={x.status} /></Td></tr>)}
            </Table>
          </Card>
        </div>
        <div className="lg:col-span-2">
          {stock && !currentCars.length ? <Card title="Склад бригады"><p className="text-sm text-slate-500">Бригаде не закреплён автомобиль. Склад бригады — это её машина, поэтому хранить запас негде: закрепите автомобиль в блоке «Автомобиль».</p></Card> : stock ? <StockView stock={stock} title={`Серийное оборудование в машине${currentCars[0] ? ` (${currentCars[0].model} ${currentCars[0].plateNumber})` : ""}`} unitAction={can(user, "inventory.return") && stock ? (u) => (u.status === "at_team" ? <ActionButton endpoint="/inventory/operations/return" json={{ unitId: u.id, teamId: id }} label="вернуть на склад" confirm="Вернуть единицу на склад?" /> : null) : undefined} /> : <Card>Остатки доступны только участникам бригады и складу</Card>}
          {can(user, "inventory.return") && stock && stock.balances.length > 0 && (
            <div className="mt-4"><QuickForm compact title="Возврат материалов на склад" endpoint="/inventory/operations/return" submitLabel="Вернуть" fields={[{ name: "catalogItemId", label: "Материал", type: "select", required: true, numeric: true, options: stock.balances.map((b) => ({ value: b.catalogItemId, label: `${b.name} (${b.quantity} ${b.unit})` })) }, { name: "quantity", label: "Кол-во", type: "number", step: "0.001", required: true }]} extra={{ teamId: id }} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
