import { ok, withAuth, parseQuery, forbidden } from "@/lib/api";
import { movementsReportQuerySchema } from "@/lib/validators";
import { movementsReport, movementsCsv, parsePeriod } from "@/lib/services/report-builder";
import { canSeePrices, canWithRole } from "@/lib/rbac";
import { csvResponse, datedName } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Отчёт движения товаров (JSON или ?format=csv). */
export const GET = withAuth(async (req, { user }) => {
  if (!canWithRole(user, "reports.movements") && !canWithRole(user, "reports.inventory")) throw forbidden("Нет права на отчёт движения товаров");
  const q = parseQuery(req, movementsReportQuerySchema);
  const canPrices = canSeePrices(user);
  const rep = await movementsReport({ types: q.types, period: parsePeriod(q.from, q.to), itemIds: q.itemIds, q: q.q, warehouseIds: q.warehouseIds, sort: q.sort, dir: q.dir, limit: q.limit, canPrices });
  if (q.format === "csv") {
    if (!canWithRole(user, "reports.export")) throw forbidden("Нет права на экспорт отчётов");
    return csvResponse(movementsCsv(rep, canPrices), datedName("dvizhenie"));
  }
  return ok(rep);
});
