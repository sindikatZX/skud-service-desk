import { ok, withAuth } from "@/lib/api";
import { clientsReport } from "@/lib/services/reports";
export const GET = withAuth(async () => ok(await clientsReport()), ["reports.view"]);
