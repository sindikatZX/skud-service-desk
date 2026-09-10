import { ok, withAuth, parseBody, forbidden } from "@/lib/api";
import { transferDocument, operationDigest } from "@/lib/services/inventory";
import { transferDocSchema } from "@/lib/validators";
import { canWithRole } from "@/lib/rbac";

/** Перемещение между складами (в т.ч. на склад бригады и обратно). */
export const POST = withAuth(async (req, { user, audit }) => {
  if (!canWithRole(user, "inventory.transfer") && !canWithRole(user, "inventory.issue")) throw forbidden("Нет права на перемещение");
  const b = await parseBody(req, transferDocSchema);
  const res = await transferDocument({ ...b, actorId: user.id });
  audit.set(await operationDigest(res, "Переместил"));
  return ok(res, { status: 201 });
}, ["inventory.transfer", "inventory.issue", "inventory.return"]);
