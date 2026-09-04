import { ok, withAuth, parseId, notFound } from "@/lib/api";
import { getDocument } from "@/lib/services/inventory";

export const GET = withAuth(async (_req, { params }) => {
  const d = await getDocument(parseId(params));
  if (!d) throw notFound("Документ не найден");
  return ok(d);
}, ["inventory.read.all", "inventory.read.team"]);
