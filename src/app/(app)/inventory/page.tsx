import Link from "next/link";
import { db } from "@/db";
import { catalogItems } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { getStock } from "@/lib/services/inventory";
import { teamsStockSummary } from "@/lib/services/reports";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { Card, PageHeader, Stat } from "@/components/ui";
import { StockView } from "@/components/StockView";
import { InventoryOps } from "./InventoryOps";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const user = await requireUser(["inventory.read.all"]);
  const [stock, items, teams, summary] = await Promise.all([
    getStock("warehouse", 0),
    db.select().from(catalogItems).where(eq(catalogItems.isActive, true)).orderBy(asc(catalogItems.name)),
    listTeamsWithDetails(),
    teamsStockSummary(),
  ]);
  const perms = { receive: can(user, "inventory.receive"), issue: can(user, "inventory.issue"), writeoff: can(user, "inventory.writeoff") };
  const freeUnits = stock.units.filter((u) => u.status === "in_warehouse");
  return (
    <div>
      <PageHeader title="Центральный склад" subtitle="Остатки, поступления, отгрузка бригадам" action={<div className="flex gap-3 text-sm"><Link href="/inventory/transactions" className="text-indigo-600">Журнал операций →</Link><Link href="/reports#consumption" className="text-indigo-600">Расход по бригадам →</Link></div>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Серийных единиц на складе" value={freeUnits.length} />
        <Stat label="Позиций материалов" value={stock.balances.length} />
        <Stat label="У бригад (ед.)" value={summary.reduce((a, s) => a + s.unitsAtTeam + s.unitsReserved, 0)} />
        <Stat label="Резерв со склада" value={stock.units.filter((u) => u.status === "reserved").length + stock.reservations.length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <InventoryOps items={items.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, isSerialized: i.isSerialized }))} units={freeUnits.map((u) => ({ id: u.id, name: u.name, serialNumber: u.serialNumber }))} balances={stock.balances.map((b) => ({ catalogItemId: b.catalogItemId, name: b.name, unit: b.unit, quantity: b.quantity }))} teams={teams.filter((t) => t.isActive).map((t) => ({ id: t.id, name: t.name }))} perms={perms} />
          <Card title="Остатки у бригад">
            <ul className="divide-y divide-slate-100 text-sm">{summary.map((s) => <li key={s.teamId} className="flex items-center justify-between py-2"><Link href={`/teams/${s.teamId}`} className="font-medium text-indigo-700">{s.teamName}</Link><span className="text-xs text-slate-500">{s.unitsAtTeam} ед. · {s.unitsReserved} резерв · {s.materialItems} поз.</span></li>)}</ul>
          </Card>
        </div>
        <div className="lg:col-span-2"><StockView stock={stock} title="Серийное оборудование на складе" /></div>
      </div>
    </div>
  );
}
