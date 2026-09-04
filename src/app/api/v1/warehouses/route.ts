import { ok, withAuth } from "@/lib/api";
import { ensureWarehouses } from "@/lib/services/warehouses";
import { warehousesSummary } from "@/lib/services/inventory";

/** Склады со сводкой остатков. */
export const GET = withAuth(async () => {
  await ensureWarehouses();
  return ok(await warehousesSummary());
}, ["inventory.read.all", "inventory.read.team"]);
