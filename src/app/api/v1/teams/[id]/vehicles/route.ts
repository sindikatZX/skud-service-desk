import { db } from "@/db";
import { vehicleAssignments, vehicles, teams } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ok, withAuth, parseBody, parseQuery, parseId, notFound, conflict } from "@/lib/api";
import { vehicleAssignSchema } from "@/lib/validators";
import { syncVehicleHolder, vehicleWarehouse } from "@/lib/services/warehouses";

/**
 * Закрепление автомобиля за бригадой. Автомобиль — это склад, поэтому вместе с
 * машиной к бригаде переходит и её содержимое: после смены владельца отметка
 * «у бригады» на единицах пересчитывается.
 *
 * Все изменения закреплений выполняются одной транзакцией: при сбое на любом шаге
 * прежнее состояние сохраняется, а не остаётся «полуоткреплённая» машина.
 */
export const POST = withAuth(async (req, { params }) => {
  const teamId = parseId(params);
  const { vehicleId } = await parseBody(req, vehicleAssignSchema);

  const [team] = await db.select({ id: teams.id, isActive: teams.isActive }).from(teams).where(eq(teams.id, teamId));
  if (!team) throw notFound("Бригада не найдена");
  const [vehicle] = await db.select({ id: vehicles.id, isActive: vehicles.isActive }).from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!vehicle) throw notFound("Автомобиль не найден");
  if (!vehicle.isActive) throw conflict("Автомобиль выведен из эксплуатации — закрепить его нельзя");

  const [already] = await db
    .select({ id: vehicleAssignments.id })
    .from(vehicleAssignments)
    .where(and(eq(vehicleAssignments.vehicleId, vehicleId), eq(vehicleAssignments.teamId, teamId), isNull(vehicleAssignments.releasedAt)));
  if (already) return ok(already, { status: 200 });

  // Склад-автомобиль должен существовать до пересчёта содержимого (создаётся по требованию)
  await vehicleWarehouse(vehicleId);

  const { assignment, touched } = await db.transaction(async (tx) => {
    const now = new Date();
    // Снимаем машину с прежней бригады…
    await tx
      .update(vehicleAssignments)
      .set({ releasedAt: now })
      .where(and(eq(vehicleAssignments.vehicleId, vehicleId), isNull(vehicleAssignments.releasedAt)));
    // …и освобождаем бригаду от прежней машины: склад бригады — ровно один автомобиль
    const released = await tx
      .update(vehicleAssignments)
      .set({ releasedAt: now })
      .where(and(eq(vehicleAssignments.teamId, teamId), isNull(vehicleAssignments.releasedAt)))
      .returning({ vehicleId: vehicleAssignments.vehicleId });
    const [a] = await tx.insert(vehicleAssignments).values({ teamId, vehicleId }).returning();
    return { assignment: a, touched: [...new Set([...released.map((r) => r.vehicleId), vehicleId])] };
  });

  // Запас едет вместе с машиной: пересчитываем, за кем числится содержимое
  for (const id of touched) await syncVehicleHolder(id);
  return ok(assignment, { status: 201 });
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
