import { ok, withAuth } from "@/lib/api";
import { teamsStockSummary } from "@/lib/services/reports";
export const GET = withAuth(async () => ok(await teamsStockSummary()), ["reports.inventory", "reports.view"]);
