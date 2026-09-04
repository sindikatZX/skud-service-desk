import { ok, withAuth, parseBody } from "@/lib/api";
import { returnToWarehouse } from "@/lib/services/inventory";
import { returnSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, returnSchema);
  return ok(
    await returnToWarehouse({
      teamId: b.teamId,
      catalogItemId: b.catalogItemId ?? undefined,
      unitId: b.unitId ?? undefined,
      quantity: b.quantity,
      actorId: user.id,
      note: b.note ?? undefined,
    }),
    { status: 201 },
  );
}, ["inventory.return"]);
