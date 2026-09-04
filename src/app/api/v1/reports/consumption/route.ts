import { ok, withAuth, parseQuery } from "@/lib/api";
import { inventoryConsumption } from "@/lib/services/reports";
import { z } from "zod";
import { dateish } from "@/lib/validators";

const querySchema = z.object({
  teamId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive().optional(),
  from: dateish,
  to: dateish,
});

export const GET = withAuth(async (req) => {
  const f = parseQuery(req, querySchema);
  return ok(await inventoryConsumption({ teamId: f.teamId, clientId: f.clientId, from: f.from ?? undefined, to: f.to ?? undefined }));
}, ["reports.inventory", "reports.view"]);
