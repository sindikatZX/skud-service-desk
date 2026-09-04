import { db } from "@/db";
import { teams, teamMembers, users, vehicleAssignments, vehicles } from "@/db/schema";
import { eq, isNull, asc } from "drizzle-orm";

export async function listTeamsWithDetails() {
  const all = await db.select().from(teams).orderBy(asc(teams.name));
  const members = await db
    .select({ teamId: teamMembers.teamId, userId: users.id, fullName: users.fullName, phone: users.phone, isLead: teamMembers.isLead })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(isNull(teamMembers.leftAt));
  const cars = await db
    .select({ teamId: vehicleAssignments.teamId, vehicleId: vehicles.id, plateNumber: vehicles.plateNumber, model: vehicles.model })
    .from(vehicleAssignments)
    .innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId))
    .where(isNull(vehicleAssignments.releasedAt));
  return all.map((t) => ({
    ...t,
    members: members.filter((m) => m.teamId === t.id),
    vehicles: cars.filter((c) => c.teamId === t.id),
  }));
}
export type TeamWithDetails = Awaited<ReturnType<typeof listTeamsWithDetails>>[number];
