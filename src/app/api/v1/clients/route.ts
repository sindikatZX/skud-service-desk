import { db } from "@/db";
import { nextCode } from "@/lib/codes";
import { clients, sites, tickets } from "@/db/schema";
import { eq, sql, asc } from "drizzle-orm";
import { ok, withAuth, parseBody } from "@/lib/api";
import { clientCreateSchema } from "@/lib/validators";

export const GET = withAuth(async (_req, { user }) => {
  const rows = await db
    .select({
      id: clients.id, name: clients.name, inn: clients.inn, contactPerson: clients.contactPerson, phone: clients.phone,
      email: clients.email, isActive: clients.isActive, createdAt: clients.createdAt,
      sitesCount: sql<number>`(select count(*) from ${sites} where ${sites.clientId} = ${clients.id})::int`,
      openTickets: sql<number>`(select count(*) from ${tickets} where ${tickets.clientId} = ${clients.id} and ${tickets.status} not in ('done','closed','cancelled'))::int`,
    })
    .from(clients)
    .where(user.scope === "client" ? eq(clients.id, user.clientId ?? -1) : undefined)
    .orderBy(asc(clients.name));
  return ok(rows);
}, ["clients.read", "tickets.read.own"]);

export const POST = withAuth(async (req) => {
  const b = await parseBody(req, clientCreateSchema);
  const [c] = await db.insert(clients).values({ ...b, code: await nextCode("clients") }).returning();
  return ok(c, { status: 201 });
}, ["clients.manage"]);
