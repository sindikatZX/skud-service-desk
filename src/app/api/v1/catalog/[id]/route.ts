import { db } from "@/db";
import { catalogItems, catalogCategories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound, conflict } from "@/lib/api";
import { catalogUpdateSchema } from "@/lib/validators";
import { assertMeasureUnitExists } from "@/lib/services/directories";
import { deleteCatalogItem } from "@/lib/services/deletion";

export const PATCH = withAuth(async (req, { params }) => {
  const id = parseId(params);
  const b = await parseBody(req, catalogUpdateSchema);
  if (b.categoryId !== undefined) {
    const [category] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(eq(catalogCategories.id, b.categoryId));
    if (!category) throw conflict("Категория не найдена в справочнике");
  }
  if (b.unit !== undefined) await assertMeasureUnitExists(b.unit);
  const [c] = await db.update(catalogItems).set(b).where(eq(catalogItems.id, id)).returning();
  if (!c) throw notFound("Позиция не найдена");
  return ok(c);
}, ["catalog.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteCatalogItem(parseId(params));
  return ok({ deleted: true });
}, ["catalog.manage"]);
