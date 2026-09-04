import { db } from "@/db";
import { catalogItems, catalogCategories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound, conflict, forbidden } from "@/lib/api";
import { catalogUpdateSchema } from "@/lib/validators";
import { assertMeasureUnitExists } from "@/lib/services/directories";
import { deleteCatalogItem } from "@/lib/services/deletion";
import { canEditPrices, canSeePrices } from "@/lib/rbac";
import { stripPrices } from "@/lib/prices";

export const PATCH = withAuth(async (req, { params, user }) => {
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
  const [c] = await db.update(catalogItems).set(set).where(eq(catalogItems.id, id)).returning();
  if (!c) throw notFound("Позиция не найдена");
  return ok(stripPrices([c], canSeePrices(user))[0]);
}, ["catalog.manage", "catalog.prices.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteCatalogItem(parseId(params));
  return ok({ deleted: true });
}, ["catalog.manage"]);
