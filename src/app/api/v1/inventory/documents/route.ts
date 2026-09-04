import { ok, withAuth, parseQuery } from "@/lib/api";
import { listDocuments } from "@/lib/services/inventory";
import { documentsQuerySchema } from "@/lib/validators";

/** Журнал складских документов: поступления (партии), перемещения, списания. */
export const GET = withAuth(async (req) => {
  const q = parseQuery(req, documentsQuerySchema);
  return ok(await listDocuments(q));
}, ["inventory.read.all", "inventory.read.team"]);
