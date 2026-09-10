import { ok, withAuth, parseQuery } from "@/lib/api";
import { listAudit, auditActors } from "@/lib/services/audit";
import { auditQuerySchema } from "@/lib/validators";

/** Журнал действий: кто, когда и что сделал. Только для тех, кому доверен просмотр. */
export const GET = withAuth(async (req) => {
  const q = parseQuery(req, auditQuerySchema);
  const [log, actors] = await Promise.all([listAudit(q), auditActors()]);
  return ok({ ...log, actors });
}, ["audit.view"]);
