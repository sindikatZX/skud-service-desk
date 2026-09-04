import Link from "next/link";
import { db } from "@/db";
import { catalogItems, catalogCategories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can, canWithRole } from "@/lib/rbac";
import { getStockByWarehouse, warehousesSummary } from "@/lib/services/inventory";
import { PageHeader, Stat } from "@/components/ui";
import { WarehouseWorkspace } from "./WarehouseWorkspace";

export const dynamic = "force-dynamic";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["inventory.read.all"]);
  const sp = await searchParams;
  const whs = await warehousesSummary();
  const requested = Number(sp.wh);
  const current = whs.find((w) => w.id === requested) ?? whs.find((w) => w.kind === "central") ?? whs[0];
  const [stock, items] = await Promise.all([
    current ? getStockByWarehouse(current.id) : Promise.resolve({ balances: [], units: [], reservations: [] }),
    db
      .select({ id: catalogItems.id, sku: catalogItems.sku, name: catalogItems.name, unit: catalogItems.unit, isSerialized: catalogItems.isSerialized, categoryId: catalogItems.categoryId, categoryName: catalogCategories.name })
      .from(catalogItems)
      .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
      .where(eq(catalogItems.isActive, true))
      .orderBy(asc(catalogItems.name)),
  ]);
  const perms = {
    receive: can(user, "inventory.receive"),
    transfer: canWithRole(user, "inventory.transfer") || can(user, "inventory.issue"),
    writeoff: can(user, "inventory.writeoff"),
  };
  const totalUnits = whs.reduce((a, w) => a + w.unitsFree, 0);
  const totalReserved = whs.reduce((a, w) => a + w.unitsReserved, 0);

  return (
    <div>
      <PageHeader
        title="Склады"
        subtitle="Мультисклад: остатки по каждому складу, поступления партиями, перемещения и списания документами"
        action={<div className="flex flex-wrap gap-3 text-sm"><Link href="/inventory/documents" className="text-indigo-600">Документы →</Link><Link href="/inventory/transactions" className="text-indigo-600">Журнал операций →</Link><Link href="/reports#consumption" className="text-indigo-600">Расход по бригадам →</Link></div>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Складов" value={whs.length} hint={`${whs.filter((w) => w.kind === "team").length} складов бригад`} />
        <Stat label="Серийных единиц" value={totalUnits} hint="свободных на всех складах" />
        <Stat label="В резерве" value={totalReserved} />
        <Stat label="Позиций материалов" value={whs.reduce((a, w) => a + w.materialItems, 0)} />
      </div>
      {current ? (
        <WarehouseWorkspace
          warehouses={whs.map((w) => ({ id: w.id, name: w.name, kind: w.kind, teamId: w.teamId, materialItems: w.materialItems, unitsFree: w.unitsFree, unitsReserved: w.unitsReserved }))}
          initialWarehouseId={current.id}
          initialStock={{
            balances: stock.balances,
            units: stock.units.map((u) => ({ ...u, receiptDate: u.receiptDate ? u.receiptDate.toISOString() : null })),
            reservations: stock.reservations,
          }}
          items={items}
          perms={perms}
        />
      ) : (
        <p className="text-sm text-slate-500">Склады не настроены.</p>
      )}
    </div>
  );
}
