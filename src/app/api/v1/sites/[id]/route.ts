import { db } from "@/db";
import { sites, clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound, forbidden } from "@/lib/api";
import { serviceHistory } from "@/lib/services/tickets";
import { getSiteEquipment } from "@/lib/services/inventory";
import { siteUpdateSchema } from "@/lib/validators";
import { deleteSite } from "@/lib/services/deletion";

export const GET = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  const [s] = await db
    .select({ site: sites, clientName: clients.name })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .where(eq(sites.id, id));
  if (!s) throw notFound("Объект не найден");
  if (user.scope === "client" && user.clientId !== s.site.clientId) throw forbidden();
  const [equipment, history] = await Promise.all([getSiteEquipment(id), serviceHistory(user, { siteId: id })]);
  return ok({ site: { ...s.site, clientName: s.clientName }, equipment, tickets: history });
}, ["clients.read", "tickets.read.own"]);

export const PATCH = withAuth(async (req, { params }) => {
  const b = await parseBody(req, siteUpdateSchema);
  const [s] = await db.update(sites).set(b).where(eq(sites.id, parseId(params))).returning();
  if (!s) throw notFound("Объект не найден");
  return ok(s);
}, ["sites.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteSite(parseId(params));
  return ok({ deleted: true });
}, ["sites.manage"]);
