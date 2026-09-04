import { db } from "@/db";
import { nextCode } from "@/lib/codes";
import { sites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId, forbidden } from "@/lib/api";
import { siteCreateSchema } from "@/lib/validators";

export const GET = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  if (user.scope === "client" && user.clientId !== id) throw forbidden();
  return ok(await db.select().from(sites).where(eq(sites.clientId, id)).orderBy(sites.name));
}, ["clients.read", "tickets.read.own"]);

export const POST = withAuth(async (req, { params }) => {
  const b = await parseBody(req, siteCreateSchema);
  const [s] = await db.insert(sites).values({ ...b, clientId: parseId(params), code: await nextCode("sites") }).returning();
  return ok(s, { status: 201 });
}, ["sites.manage"]);
