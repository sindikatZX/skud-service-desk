import { db } from "@/db";
import { clients, sites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, notFound, forbidden } from "@/lib/api";
import { serviceHistory } from "@/lib/services/tickets";
import { clientUpdateSchema } from "@/lib/validators";
import { deleteClient } from "@/lib/services/deletion";

export const GET = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  if (user.scope === "client" && user.clientId !== id) throw forbidden();
  const [c] = await db.select().from(clients).where(eq(clients.id, id));
  if (!c) throw notFound("Клиент не найден");
  const clientSites = await db.select().from(sites).where(eq(sites.clientId, id)).orderBy(sites.name);
  const history = await serviceHistory(user, { clientId: id });
  return ok({ client: c, sites: clientSites, tickets: history });
}, ["clients.read", "tickets.read.own"]);

export const PATCH = withAuth(async (req, { params }) => {
  const id = parseId(params);
  const b = await parseBody(req, clientUpdateSchema);
  const [c] = await db.update(clients).set(b).where(eq(clients.id, id)).returning();
  if (!c) throw notFound("Клиент не найден");
  return ok(c);
}, ["clients.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteClient(parseId(params));
  return ok({ deleted: true });
}, ["clients.manage"]);
