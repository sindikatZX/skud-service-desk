import { db } from "@/db";
import { vehicles, vehicleAssignments, teams } from "@/db/schema";
import { and, eq, isNull, asc } from "drizzle-orm";
import { ok, withAuth, parseBody, conflict } from "@/lib/api";
import { vehicleCreateSchema } from "@/lib/validators";

export const GET = withAuth(async () => {
  const rows = await db
    .select({ id: vehicles.id, plateNumber: vehicles.plateNumber, model: vehicles.model, year: vehicles.year, isActive: vehicles.isActive, teamId: vehicleAssignments.teamId, teamName: teams.name })
    .from(vehicles)
    .leftJoin(vehicleAssignments, and(eq(vehicleAssignments.vehicleId, vehicles.id), isNull(vehicleAssignments.releasedAt)))
    .leftJoin(teams, eq(teams.id, vehicleAssignments.teamId))
    .orderBy(asc(vehicles.plateNumber));
  return ok(rows);
}, ["teams.read"]);

export const POST = withAuth(async (req) => {
  const b = await parseBody(req, vehicleCreateSchema);
  const [exists] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.plateNumber, b.plateNumber));
  if (exists) throw conflict(`Автомобиль с номером «${b.plateNumber}» уже заведён`);
  const [v] = await db.insert(vehicles).values({ ...b, year: b.year ?? null }).returning();
  return ok(v, { status: 201 });
}, ["vehicles.manage"]);
