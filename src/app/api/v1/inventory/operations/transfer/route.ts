import { ok, withAuth, parseBody, forbidden } from "@/lib/api";
import { transferDocument } from "@/lib/services/inventory";
import { transferDocSchema } from "@/lib/validators";
import { canWithRole } from "@/lib/rbac";

/** Перемещение между складами (в т.ч. на склад бригады и обратно). */
export const POST = withAuth(async (req, { user }) => {
  if (!canWithRole(user, "inventory.transfer") && !canWithRole(user, "inventory.issue")) throw forbidden("Нет права на перемещение");
  const b = await parseBody(req, transferDocSchema);
  return ok(await transferDocument({ ...b, actorId: user.id }), { status: 201 });
}, ["inventory.transfer", "inventory.issue", "inventory.return"]);
