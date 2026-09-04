import { ok, withAuth, forbidden, parseId } from "@/lib/api";
import { getStock } from "@/lib/services/inventory";
import { can } from "@/lib/rbac";

export const GET = withAuth(async (_req, { user, params }) => {
  const teamId = parseId(params);
  if (!can(user, "inventory.read.all") && user.teamId !== teamId) throw forbidden("Доступны только остатки своей бригады");
  return ok(await getStock("team", teamId));
}, ["inventory.read.all", "inventory.read.team"]);
