import { ensureWarehouses } from "@/lib/services/warehouses";
import { nextCode } from "@/lib/codes";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { ok, withAuth, parseBody } from "@/lib/api";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { teamCreateSchema } from "@/lib/validators";

export const GET = withAuth(async () => ok(await listTeamsWithDetails()), ["teams.read"]);

export const POST = withAuth(async (req) => {
  const b = await parseBody(req, teamCreateSchema);
  const [t] = await db.insert(teams).values({ ...b, code: await nextCode("teams") }).returning();
  await ensureWarehouses(true); // склад бригады
  return ok(t, { status: 201 });
}, ["teams.manage"]);
