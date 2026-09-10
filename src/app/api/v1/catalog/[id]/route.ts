import { db } from "@/db";
import { catalogItems, catalogCategories, equipmentUnits, stockBalances, stockTransactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound, conflict, forbidden } from "@/lib/api";
import { catalogUpdateSchema } from "@/lib/validators";
import { assertMeasureUnitExists } from "@/lib/services/directories";
import { deleteCatalogItem } from "@/lib/services/deletion";
import { canEditPrices, canSeePrices } from "@/lib/rbac";
import { stripPrices } from "@/lib/prices";
import { changes } from "@/lib/services/audit";

export const PATCH = withAuth(async (req, { params, user, audit }) => {
  const id = parseId(params);
  const b = await parseBody(req, catalogUpdateSchema);
  if (b.categoryId !== undefined) {
    const [category] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(eq(catalogCategories.id, b.categoryId));
    if (!category) throw conflict("Категория не найдена в справочнике");
  }
  if (b.unit !== undefined) await assertMeasureUnitExists(b.unit);
  const { price, ...rest } = b;
  const set: Partial<typeof catalogItems.$inferInsert> = { ...rest };
  if (price !== undefined) {
    if (!canEditPrices(user)) throw forbidden("Нет права изменять цены товаров");
    set.price = price === null ? null : String(price);
    set.priceUpdatedAt = new Date();
  }
  const [was] = await db.select().from(catalogItems).where(eq(catalogItems.id, id));
  if (!was) throw notFound("Позиция не найдена");
  // Вид учёта нельзя переключать под существующими остатками: количественный остаток
  // и серийные единицы — разные способы хранения, и смена «на ходу» рассинхронизирует их
  if (b.isSerialized !== undefined && b.isSerialized !== was.isSerialized && (await hasMovements(id)))
    throw conflict("По позиции уже есть остатки или движения — вид учёта (серийный / количественный) менять нельзя. Заведите отдельную позицию.");
  // Единица измерения — смысл хранимого количества: сменить «шт» на «м» под остатком
  // значит молча превратить 10 штук в 10 метров. Пока остаток не нулевой — нельзя
  if (b.unit !== undefined && b.unit !== was.unit && (await hasStock(id)))
    throw conflict("По позиции есть остатки — единицу измерения менять нельзя: количество не пересчитывается. Спишите или переместите остаток, либо заведите отдельную позицию.");
  const [c] = await db.update(catalogItems).set(set).where(eq(catalogItems.id, id)).returning();
  const diff = changes(was, c, CATALOG_FIELDS);
  audit.set({
    entity: "catalog_item",
    entityId: id,
    entityLabel: c.name,
    summary: `Изменил товар «${c.name}»${Object.keys(diff).length ? `: ${Object.entries(diff).map(([k, v]) => `${k} ${v}`).join("; ")}` : ""}`,
    details: diff,
  });
  return ok(stripPrices([c], canSeePrices(user))[0]);
}, ["catalog.manage", "catalog.prices.manage"]);

export const DELETE = withAuth(async (_req, { params, audit }) => {
  const id = parseId(params);
  // Имя читаем до удаления: после него в журнале остался бы только номер
  const [was] = await db.select({ name: catalogItems.name, sku: catalogItems.sku }).from(catalogItems).where(eq(catalogItems.id, id));
  await deleteCatalogItem(id);
  audit.set({ entity: "catalog_item", entityId: id, entityLabel: was?.name ?? null, summary: `Удалил товар «${was?.name ?? id}»${was?.sku ? ` (${was.sku})` : ""}` });
  return ok({ deleted: true });
}, ["catalog.manage"]);

/** Есть ли сейчас остатки или серийные единицы на учёте (без учёта прошлых движений). */
async function hasStock(id: number) {
  const [row] = await db
    .select({
      n: sql<number>`(select count(*) from ${equipmentUnits} where ${equipmentUnits.catalogItemId} = ${id} and ${equipmentUnits.status} <> 'written_off')::int
        + (select count(*) from ${stockBalances} where ${stockBalances.catalogItemId} = ${id} and ${stockBalances.quantity} <> 0)::int`,
    })
    .from(catalogItems)
    .where(eq(catalogItems.id, id));
  return (row?.n ?? 0) > 0;
}

/** Есть ли по позиции остатки, серийные единицы или движения. */
async function hasMovements(id: number) {
  const [row] = await db
    .select({
      n: sql<number>`(select count(*) from ${equipmentUnits} where ${equipmentUnits.catalogItemId} = ${id})::int
        + (select count(*) from ${stockBalances} where ${stockBalances.catalogItemId} = ${id} and ${stockBalances.quantity} <> 0)::int
        + (select count(*) from ${stockTransactions} where ${stockTransactions.catalogItemId} = ${id})::int`,
    })
    .from(catalogItems)
    .where(eq(catalogItems.id, id));
  return (row?.n ?? 0) > 0;
}

/** Русские названия полей товара — журнал читают люди, а не разработчики. */
const CATALOG_FIELDS: Record<string, string> = {
  name: "наименование",
  fullName: "полное наименование",
  externalCode: "код 1С",
  manufacturer: "производитель",
  sku: "артикул",
  categoryId: "категория",
  unit: "единица измерения",
  price: "цена",
  isSerialized: "серийный учёт",
  isActive: "активность",
  description: "описание",
};
