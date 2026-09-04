import { db } from "@/db";
import { teams, teamMembers, users, vehicleAssignments, vehicles } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound } from "@/lib/api";
import { teamUpdateSchema } from "@/lib/validators";
import { deleteTeam } from "@/lib/services/deletion";

export const GET = withAuth(async (_req, { params }) => {
  const id = parseId(params);
  const [t] = await db.select().from(teams).where(eq(teams.id, id));
  if (!t) throw notFound("Бригада не найдена");
  const membersHistory = await db
    .select({ id: teamMembers.id, userId: users.id, fullName: users.fullName, isLead: teamMembers.isLead, joinedAt: teamMembers.joinedAt, leftAt: teamMembers.leftAt })
    .from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).where(eq(teamMembers.teamId, id)).orderBy(desc(teamMembers.joinedAt));
  const vehiclesHistory = await db
    .select({ id: vehicleAssignments.id, vehicleId: vehicles.id, plateNumber: vehicles.plateNumber, model: vehicles.model, assignedAt: vehicleAssignments.assignedAt, releasedAt: vehicleAssignments.releasedAt })
    .from(vehicleAssignments).innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId)).where(eq(vehicleAssignments.teamId, id)).orderBy(desc(vehicleAssignments.assignedAt));
  return ok({ team: t, membersHistory, vehiclesHistory });
}, ["teams.read"]);

export const PATCH = withAuth(async (req, { params }) => {
  const b = await parseBody(req, teamUpdateSchema);
  const [t] = await db.update(teams).set(b).where(eq(teams.id, parseId(params))).returning();
  if (!t) throw notFound("Бригада не найдена");
  return ok(t);
}, ["teams.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteTeam(parseId(params));
  return ok({ deleted: true });
}, ["teams.manage"]);
