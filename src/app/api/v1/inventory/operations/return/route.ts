import { ok, withAuth, parseBody } from "@/lib/api";
import { returnToWarehouse, operationDigest } from "@/lib/services/inventory";
import { returnSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user, audit }) => {
  const b = await parseBody(req, returnSchema);
  const res = await returnToWarehouse({
    teamId: b.teamId,
    catalogItemId: b.catalogItemId ?? undefined,
    unitId: b.unitId ?? undefined,
    quantity: b.quantity,
    actorId: user.id,
    note: b.note ?? undefined,
  });
  audit.set(await operationDigest(res, "Принял возврат от бригады"));
  return ok(res, { status: 201 });
}, ["inventory.return"]);
