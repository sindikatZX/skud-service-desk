import { ok, withAuth, parseId, forbidden } from "@/lib/api";
import { getStockByWarehouse } from "@/lib/services/inventory";
import { getWarehouse } from "@/lib/services/warehouses";
import { can } from "@/lib/rbac";

/** Остатки склада (склад бригады → остатки бригады). */
export const GET = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  if (!can(user, "inventory.read.all")) {
    const w = await getWarehouse(id);
    if (w.kind !== "team" || w.teamId !== user.teamId) throw forbidden("Доступны только остатки своей бригады");
  }
  return ok(await getStockByWarehouse(id));
}, ["inventory.read.all", "inventory.read.team"]);
