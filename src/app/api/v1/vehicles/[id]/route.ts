import { db } from "@/db";
import { vehicles } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound } from "@/lib/api";
import { vehicleCreateSchema } from "@/lib/validators";
import { deleteVehicle } from "@/lib/services/deletion";

export const PATCH = withAuth(async (req, { params }) => {
  const b = await parseBody(req, vehicleCreateSchema.partial());
  const [v] = await db
    .update(vehicles)
    .set({ ...b, year: b.year ?? undefined })
    .where(eq(vehicles.id, parseId(params)))
    .returning();
  if (!v) throw notFound("Автомобиль не найден");
  return ok(v);
}, ["vehicles.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteVehicle(parseId(params));
  return ok({ deleted: true });
}, ["vehicles.manage"]);
