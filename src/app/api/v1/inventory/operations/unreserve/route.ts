import { ok, withAuth, parseBody } from "@/lib/api";
import { unreserve, operationDigest } from "@/lib/services/inventory";
import { unreserveSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user, audit }) => {
  const b = await parseBody(req, unreserveSchema);
  const res = await unreserve({ reservationId: b.reservationId ?? undefined, unitId: b.unitId ?? undefined, actorId: user.id });
  audit.set(await operationDigest(res, "Снял резерв"));
  return ok(res, { status: 201 });
}, ["inventory.reserve"]);
