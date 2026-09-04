import { ok, withAuth } from "@/lib/api";
import { dashboardSummary } from "@/lib/services/reports";
export const GET = withAuth(async () => ok(await dashboardSummary()), ["reports.view", "reports.inventory"]);
