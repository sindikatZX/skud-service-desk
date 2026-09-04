import { db } from "@/db";
import { equipmentUnits } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, notFound, parseId, parseBody } from "@/lib/api";
import { getUnitHistory } from "@/lib/services/inventory";
import { unitUpdateSchema } from "@/lib/validators";
import { deleteEquipmentUnit } from "@/lib/services/deletion";

export const GET = withAuth(async (_req, { params }) => {
  const r = await getUnitHistory(parseId(params));
  if (!r) throw notFound("Единица не найдена");
  return ok(r);
}, ["inventory.read.all", "inventory.read.team", "clients.read"]);

export const PATCH = withAuth(async (req, { params }) => {
  const b = await parseBody(req, unitUpdateSchema);
  const [u] = await db
    .update(equipmentUnits)
    .set({ ...b, updatedAt: new Date() })
    .where(eq(equipmentUnits.id, parseId(params)))
    .returning();
  if (!u) throw notFound("Единица не найдена");
  return ok(u);
}, ["inventory.receive", "inventory.writeoff"]);

/** Удаление ошибочно оприходованной единицы вместе с её проводками. */
export const DELETE = withAuth(async (_req, { params }) => {
  await deleteEquipmentUnit(parseId(params));
  return ok({ deleted: true });
}, ["inventory.writeoff"]);
