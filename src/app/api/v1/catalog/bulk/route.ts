import { db } from "@/db";
import { catalogItems, catalogCategories } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { ok, withAuth, parseBody, conflict } from "@/lib/api";
import { catalogBulkSchema } from "@/lib/validators";
import { deleteCatalogItem } from "@/lib/services/deletion";

/** Массовые действия над отмеченными позициями номенклатуры. */
export const POST = withAuth(async (req) => {
  const b = await parseBody(req, catalogBulkSchema);
  if (b.action === "activate" || b.action === "deactivate") {
    await db.update(catalogItems).set({ isActive: b.action === "activate" }).where(inArray(catalogItems.id, b.ids));
    return ok({ affected: b.ids.length });
  }
  if (b.action === "move") {
    if (!b.categoryId) throw conflict("Укажите папку назначения");
    const [cat] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(eq(catalogCategories.id, b.categoryId));
    if (!cat) throw conflict("Папка не найдена");
    await db.update(catalogItems).set({ categoryId: b.categoryId }).where(inArray(catalogItems.id, b.ids));
    return ok({ affected: b.ids.length });
  }
  const errors: { id: number; message: string }[] = [];
  let deleted = 0;
  for (const id of b.ids) {
    try {
      await deleteCatalogItem(id);
      deleted++;
    } catch (e) {
      errors.push({ id, message: (e as Error).message });
    }
  }
  return ok({ affected: deleted, errors });
}, ["catalog.manage"]);
