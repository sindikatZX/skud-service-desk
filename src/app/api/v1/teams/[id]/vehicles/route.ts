import { db } from "@/db";
import { vehicleAssignments } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ok, withAuth, parseBody, parseQuery, parseId } from "@/lib/api";
import { vehicleAssignSchema } from "@/lib/validators";
import { syncVehicleHolder } from "@/lib/services/warehouses";

/**
 * Закрепление автомобиля за бригадой. Автомобиль — это склад, поэтому вместе с
 * машиной к бригаде переходит и её содержимое: после смены владельца отметка
 * «у бригады» на единицах пересчитывается.
 */
export const POST = withAuth(async (req, { params }) => {
  const teamId = parseId(params);
  const { vehicleId } = await parseBody(req, vehicleAssignSchema);
  // Снимаем машину с прежней бригады…
  const previous = await db
    .update(vehicleAssignments)
    .set({ releasedAt: new Date() })
    .where(and(eq(vehicleAssignments.vehicleId, vehicleId), isNull(vehicleAssignments.releasedAt)))
    .returning({ teamId: vehicleAssignments.teamId });
  // …и освобождаем бригаду от прежней машины: склад бригады — ровно один автомобиль
  const released = await db
    .update(vehicleAssignments)
    .set({ releasedAt: new Date() })
    .where(and(eq(vehicleAssignments.teamId, teamId), isNull(vehicleAssignments.releasedAt)))
    .returning({ vehicleId: vehicleAssignments.vehicleId });

  const [a] = await db.insert(vehicleAssignments).values({ teamId, vehicleId }).returning();
  // Запас едет вместе с машиной: пересчитываем, за кем числится содержимое
  for (const r of released) await syncVehicleHolder(r.vehicleId);
  await syncVehicleHolder(vehicleId);
  void previous;
  return ok(a, { status: 201 });
}, ["vehicles.manage", "teams.manage"]);

/** Открепление: запас остаётся в машине, но перестаёт числиться за бригадой. */
export const DELETE = withAuth(async (req, { params }) => {
  const teamId = parseId(params);
  const { vehicleId } = parseQuery(req, vehicleAssignSchema);
  await db
    .update(vehicleAssignments)
    .set({ releasedAt: new Date() })
    .where(and(eq(vehicleAssignments.teamId, teamId), eq(vehicleAssignments.vehicleId, vehicleId), isNull(vehicleAssignments.releasedAt)));
  await syncVehicleHolder(vehicleId);
  return ok({ released: true });
}, ["vehicles.manage", "teams.manage"]);
