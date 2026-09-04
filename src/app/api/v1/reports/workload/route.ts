import { ok, withAuth, parseQuery } from "@/lib/api";
import { employeeWorkload } from "@/lib/services/reports";
import { z } from "zod";
import { dateish } from "@/lib/validators";

const querySchema = z.object({ from: dateish, to: dateish });

export const GET = withAuth(async (req) => {
  const { from, to } = parseQuery(req, querySchema);
  return ok(await employeeWorkload(from ?? undefined, to ?? undefined));
}, ["reports.view"]);
