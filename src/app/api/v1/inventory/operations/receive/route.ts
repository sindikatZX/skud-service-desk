import { ok, withAuth, parseBody } from "@/lib/api";
import { receiveDocument } from "@/lib/services/inventory";
import { receiptDocSchema } from "@/lib/validators";

/** Поступление (партия): документ с несколькими позициями на выбранный склад. */
export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, receiptDocSchema);
  return ok(await receiveDocument({ ...b, toWarehouseId: b.toWarehouseId ?? undefined, actorId: user.id }), { status: 201 });
}, ["inventory.receive"]);
