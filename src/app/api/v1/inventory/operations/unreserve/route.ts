import { ok, withAuth, parseBody } from "@/lib/api";
import { unreserve } from "@/lib/services/inventory";
import { unreserveSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, unreserveSchema);
  return ok(
    await unreserve({ reservationId: b.reservationId ?? undefined, unitId: b.unitId ?? undefined, actorId: user.id }),
    { status: 201 },
  );
}, ["inventory.reserve"]);
