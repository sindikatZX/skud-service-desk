import Link from "next/link";
import { db } from "@/db";
import { catalogItems } from "@/db/schema";
import { asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can, canWithRole, canSeePrices, canEditPrices } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { getFormDictionaries } from "@/lib/services/directories";
import { categoryTree } from "@/lib/services/import";
import { itemAvailability } from "@/lib/services/inventory";
import { listWarehouses } from "@/lib/services/warehouses";
import { CatalogTree } from "./CatalogTree";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const user = await requireUser(["catalog.read"]);
  const manage = can(user, "catalog.manage");
  const showPrices = canSeePrices(user);
  const editPrices = canEditPrices(user);
  const [rows, tree, avail, { units }, whs] = await Promise.all([
    db.select().from(catalogItems).orderBy(asc(catalogItems.name)),
    categoryTree(),
    itemAvailability(),
    getFormDictionaries(),
    listWarehouses(),
  ]);
  const items = rows.map((i) => {
    const a = avail.get(i.id) ?? { qtyWarehouse: 0, qtyTeams: 0, unitsWarehouse: 0, unitsTeam: 0, unitsInstalled: 0 };
    return { id: i.id, code: i.code, sku: i.sku, name: i.name, externalCode: i.externalCode, categoryId: i.categoryId, unit: i.unit, isSerialized: i.isSerialized, manufacturer: i.manufacturer, isActive: i.isActive, price: showPrices ? i.price : null, ...a };
  });

  return (
    <div>
      <PageHeader
        title="Справочник товаров (номенклатура)"
        subtitle={manage ? <>Иерархический справочник (папки как в 1С). Папки также редактируются в <Link href="/directories/categories" className="text-indigo-600 hover:underline">справочнике категорий</Link>.</> : "Каталог оборудования и материалов по папкам"}
      />
      <CatalogTree
        categories={tree}
        items={items}
        units={units.map((u) => ({ code: u.symbol, name: u.name }))}
        manage={manage}
        showPrices={showPrices}
        editPrices={editPrices}
        canImport={manage && (canWithRole(user, "data.import") || can(user, "directories.manage"))}
        warehouses={whs.filter((w) => w.kind !== "team").map((w) => ({ id: w.id, name: w.name }))}
      />
    </div>
  );
}
