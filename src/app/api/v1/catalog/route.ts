import { db } from "@/db";
import { catalogItems, catalogCategories } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { ok, withAuth, parseBody, conflict } from "@/lib/api";
import { catalogCreateSchema } from "@/lib/validators";
import { assertMeasureUnitExists } from "@/lib/services/directories";
import { generateSku } from "@/lib/services/import";
import { resolveCode } from "@/lib/codes";
import { canEditPrices, canSeePrices } from "@/lib/rbac";
import { stripPrices } from "@/lib/prices";

export const GET = withAuth(async (_req, { user }) => {
  const rows = await db
    .select({
      id: catalogItems.id,
      code: catalogItems.code,
      sku: catalogItems.sku,
      name: catalogItems.name,
      categoryId: catalogItems.categoryId,
      categoryName: catalogCategories.name,
      externalCode: catalogItems.externalCode,
      unit: catalogItems.unit,
      isSerialized: catalogItems.isSerialized,
      manufacturer: catalogItems.manufacturer,
      description: catalogItems.description,
      price: catalogItems.price,
      priceUpdatedAt: catalogItems.priceUpdatedAt,
      isActive: catalogItems.isActive,
      unitsCount: sql<number>`(select count(*) from equipment_units eu where eu.catalog_item_id = ${catalogItems.id})::int`,
    })
    .from(catalogItems)
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .orderBy(asc(catalogItems.name));
  return ok(stripPrices(rows, canSeePrices(user)));
}, ["catalog.read"]);

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, catalogCreateSchema);
  const [category] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(eq(catalogCategories.id, b.categoryId));
  if (!category) throw conflict("Категория не найдена в справочнике");
  await assertMeasureUnitExists(b.unit);
  // Артикул не обязателен: если не задан — генерируется из кода 1С или по времени.
  const sku = b.sku ?? (await generateSku(b.externalCode));
  const [exists] = await db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.sku, sku));
  if (exists) throw conflict(`Артикул «${sku}» уже используется`);
  const { price, code: wantedCode, ...rest } = b;
  const code = await resolveCode("catalog_items", wantedCode);
  const withPrice = price != null && canEditPrices(user);
  const [c] = await db
    .insert(catalogItems)
    .values({ ...rest, sku, code, price: withPrice ? String(price) : null, priceUpdatedAt: withPrice ? new Date() : null })
    .returning();
  return ok(stripPrices([c], canSeePrices(user))[0], { status: 201 });
}, ["catalog.manage"]);
