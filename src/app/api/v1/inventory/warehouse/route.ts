import { ok, withAuth } from "@/lib/api";
import { getStock } from "@/lib/services/inventory";
export const GET = withAuth(async () => ok(await getStock("warehouse", 0)), ["inventory.read.all"]);
