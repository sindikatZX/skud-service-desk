import { db } from "@/db";
import { vehicleAssignments } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ok, withAuth, parseBody, parseQuery, parseId } from "@/lib/api";
import { vehicleAssignSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { params }) => {
  const teamId = parseId(params);
  const { vehicleId } = await parseBody(req, vehicleAssignSchema);
  await db.update(vehicleAssignments).set({ releasedAt: new Date() }).where(and(eq(vehicleAssignments.vehicleId, vehicleId), isNull(vehicleAssignments.releasedAt)));
  const [a] = await db.insert(vehicleAssignments).values({ teamId, vehicleId }).returning();
  return ok(a, { status: 201 });
}, ["vehicles.manage", "teams.manage"]);

export const DELETE = withAuth(async (req, { params }) => {
  const teamId = parseId(params);
  const { vehicleId } = parseQuery(req, vehicleAssignSchema);
  await db
    .update(vehicleAssignments)
    .set({ releasedAt: new Date() })
    .where(and(eq(vehicleAssignments.teamId, teamId), eq(vehicleAssignments.vehicleId, vehicleId), isNull(vehicleAssignments.releasedAt)));
  return ok({ released: true });
}, ["vehicles.manage", "teams.manage"]);
