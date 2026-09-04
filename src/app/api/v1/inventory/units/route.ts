import { db } from "@/db";
import { equipmentUnits, catalogItems, catalogCategories, teams, sites } from "@/db/schema";
import { and, eq, sql, desc, or } from "drizzle-orm";
import { ok, withAuth } from "@/lib/api";
import { can } from "@/lib/rbac";

export const GET = withAuth(async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const conds = [];
  const q = sp.get("q");
  const status = sp.get("status");
  if (q) conds.push(or(sql`${equipmentUnits.serialNumber} ilike ${"%" + q + "%"}`, sql`${equipmentUnits.macAddress} ilike ${"%" + q + "%"}`, sql`${catalogItems.name} ilike ${"%" + q + "%"}`));
  if (status) conds.push(eq(equipmentUnits.status, status as typeof equipmentUnits.$inferSelect.status));
  if (!can(user, "inventory.read.all")) conds.push(eq(equipmentUnits.teamId, user.teamId ?? -1));
  const rows = await db
    .select({
      id: equipmentUnits.id, serialNumber: equipmentUnits.serialNumber, macAddress: equipmentUnits.macAddress, status: equipmentUnits.status,
      locationType: equipmentUnits.locationType, teamId: equipmentUnits.teamId, teamName: teams.name, siteId: equipmentUnits.siteId, siteName: sites.name,
      ticketId: equipmentUnits.ticketId, catalogItemId: catalogItems.id, sku: catalogItems.sku, name: catalogItems.name, category: catalogCategories.name,
    })
    .from(equipmentUnits)
    .innerJoin(catalogItems, eq(catalogItems.id, equipmentUnits.catalogItemId))
    .innerJoin(catalogCategories, eq(catalogCategories.id, catalogItems.categoryId))
    .leftJoin(teams, eq(teams.id, equipmentUnits.teamId))
    .leftJoin(sites, eq(sites.id, equipmentUnits.siteId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(equipmentUnits.updatedAt))
    .limit(500);
  return ok(rows);
}, ["inventory.read.all", "inventory.read.team"]);
