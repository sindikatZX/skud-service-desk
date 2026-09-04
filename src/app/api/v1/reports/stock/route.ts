import { ok, withAuth, parseQuery, forbidden } from "@/lib/api";
import { stockReportQuerySchema } from "@/lib/validators";
import { stockReport, stockCsv, parsePeriod } from "@/lib/services/report-builder";
import { canSeePrices, canWithRole } from "@/lib/rbac";
import { csvResponse, datedName } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Отчёт остатков по складам за период (JSON или ?format=csv). */
export const GET = withAuth(async (req, { user }) => {
  if (!canWithRole(user, "reports.stock") && !canWithRole(user, "reports.inventory")) throw forbidden("Нет права на отчёт остатков");
  const q = parseQuery(req, stockReportQuerySchema);
  const canPrices = canSeePrices(user);
  const rep = await stockReport({ warehouseIds: q.warehouseIds, period: parsePeriod(q.from, q.to), q: q.q, categoryId: q.categoryId, onlyNonZero: q.onlyNonZero, sort: q.sort, dir: q.dir, canPrices });
  if (q.format === "csv") {
    if (!canWithRole(user, "reports.export")) throw forbidden("Нет права на экспорт отчётов");
    return csvResponse(stockCsv(rep, canPrices), datedName("ostatki"));
  }
  return ok(rep);
});
