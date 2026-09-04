import { ok, withAuth, parseQuery, forbidden } from "@/lib/api";
import { worksReportQuerySchema } from "@/lib/validators";
import { worksReport, worksCsv, parsePeriod } from "@/lib/services/report-builder";
import { canWithRole } from "@/lib/rbac";
import { csvResponse, datedName } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Отчёты по работам: mode=what (что сделали) / where (где сделали). JSON или ?format=csv. */
export const GET = withAuth(async (req, { user }) => {
  if (!canWithRole(user, "reports.works") && !canWithRole(user, "reports.view")) throw forbidden("Нет права на отчёты по работам");
  const q = parseQuery(req, worksReportQuerySchema);
  const rep = await worksReport({ period: parsePeriod(q.from, q.to), typeIds: q.typeIds, q: q.q, siteIds: q.siteIds, clientIds: q.clientIds, teamIds: q.teamIds, performerIds: q.performerIds, sort: q.sort, dir: q.dir, limit: q.limit });
  if (q.format === "csv") {
    if (!canWithRole(user, "reports.export")) throw forbidden("Нет права на экспорт отчётов");
    return csvResponse(worksCsv(rep, q.mode), datedName(q.mode === "what" ? "raboty_chto" : "raboty_gde"));
  }
  return ok(rep);
});
