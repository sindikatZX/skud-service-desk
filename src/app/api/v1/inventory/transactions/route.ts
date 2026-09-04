import { ok, withAuth, parseQuery } from "@/lib/api";
import { listTransactions } from "@/lib/services/inventory";
import { can } from "@/lib/rbac";
import { transactionsQuerySchema } from "@/lib/validators";

export const GET = withAuth(async (req, { user }) => {
  const f = parseQuery(req, transactionsQuerySchema);
  // Кто не видит склад целиком — видит только движения своей бригады.
  const teamId = can(user, "inventory.read.all") ? f.teamId : (user.teamId ?? -1);
  return ok(await listTransactions({ ...f, teamId }));
}, ["inventory.read.all", "inventory.read.team"]);
