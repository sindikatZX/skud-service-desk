import { ok, withAuth, parseBody } from "@/lib/api";
import { receive } from "@/lib/services/inventory";
import { receiveSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, receiveSchema);
  return ok(
    await receive({
      catalogItemId: b.catalogItemId,
      quantity: b.quantity,
      units: b.units?.map((u) => ({ serialNumber: u.serialNumber, macAddress: u.macAddress })),
      actorId: user.id,
      note: b.note ?? undefined,
    }),
    { status: 201 },
  );
}, ["inventory.receive"]);
