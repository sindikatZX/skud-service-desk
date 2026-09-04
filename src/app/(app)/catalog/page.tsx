import Link from "next/link";
import { db } from "@/db";
import { catalogItems, catalogCategories, equipmentUnits, stockBalances } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader, Table, Td, Badge } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";
import { fmtQty } from "@/lib/labels";
import { getFormDictionaries } from "@/lib/services/directories";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const user = await requireUser(["catalog.read"]);
  const manage = can(user, "catalog.manage");
  const [rows, { categories, units }] = await Promise.all([
    db
      .select({
        item: catalogItems,
        categoryName: catalogCategories.name,
        unitsWarehouse: sql<number>`(select count(*) from ${equipmentUnits} eu where eu.catalog_item_id = ${catalogItems.id} and eu.status = 'in_warehouse')::int`,
        unitsTeam: sql<number>`(select count(*) from ${equipmentUnits} eu where eu.catalog_item_id = ${catalogItems.id} and eu.status in ('at_team','reserved'))::int`,
        unitsInstalled: sql<number>`(select count(*) from ${equipmentUnits} eu where eu.catalog_item_id = ${catalogItems.id} and eu.status = 'installed')::int`,
        qtyWarehouse: sql<string>`coalesce((select sum(quantity) from ${stockBalances} sb where sb.catalog_item_id = ${catalogItems.id} and sb.location_type='warehouse'),0)`,
        qtyTeams: sql<string>`coalesce((select sum(quantity) from ${stockBalances} sb where sb.catalog_item_id = ${catalogItems.id} and sb.location_type='team'),0)`,
      })
      .from(catalogItems)
      .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
      .orderBy(asc(catalogItems.name)),
    getFormDictionaries(),
  ]);

  return (
    <div>
      <PageHeader
        title="Номенклатура"
        subtitle={
          manage ? (
            <>Категории и единицы измерения — в <Link href="/directories/categories" className="text-indigo-600 hover:underline">справочниках</Link></>
          ) : (
            "Каталог типов оборудования и материалов"
          )
        }
        action={
          manage ? (
            <QuickForm
              collapsible
              title="+ Позиция"
              endpoint="/catalog"
              submitLabel="Создать"
              fields={[
                { name: "sku", label: "Артикул", required: true },
                { name: "name", label: "Наименование", required: true },
                { name: "categoryId", label: "Категория", type: "select", required: true, numeric: true, options: categories.map((c) => ({ value: c.id, label: c.name })) },
                { name: "unit", label: "Ед. изм.", type: "select", required: true, defaultValue: "шт", options: units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })) },
                { name: "manufacturer", label: "Производитель" },
                { name: "isSerialized", label: "Серийный учёт (S/N)", type: "checkbox" },
                { name: "description", label: "Описание", type: "textarea" },
              ]}
            />
          ) : null
        }
      />
      <Card>
        <Table head={["Позиция", "Категория", "Учёт", "Склад", "У бригад", "Установлено", ...(manage ? [""] : [])]} empty={!rows.length}>
          {rows.map(({ item: i, categoryName, ...s }) => (
            <tr key={i.id} className="hover:bg-slate-50">
              <Td><div className="font-medium">{i.name}</div><div className="text-xs text-slate-500">{i.sku}{i.manufacturer ? ` · ${i.manufacturer}` : ""}</div></Td>
              <Td className="text-xs">{categoryName}</Td>
              <Td>{i.isSerialized ? <Badge tone="indigo">серийный</Badge> : <Badge>кол-во, {i.unit}</Badge>}</Td>
              <Td>{i.isSerialized ? s.unitsWarehouse : `${fmtQty(s.qtyWarehouse)} ${i.unit}`}</Td>
              <Td>{i.isSerialized ? s.unitsTeam : `${fmtQty(s.qtyTeams)} ${i.unit}`}</Td>
              <Td>{i.isSerialized ? s.unitsInstalled : "—"}</Td>
              {manage && (
                <Td>
                  <ActionButton
                    endpoint={`/catalog/${i.id}`}
                    method="DELETE"
                    label="удалить"
                    confirm={`Удалить позицию «${i.name}»?\n\nЕсли по ней есть движения или остатки, удаление будет отклонено — тогда снимите галочку «активна».`}
                    className="text-xs text-rose-600 hover:underline"
                  />
                </Td>
              )}
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
