import { ok, withAuth, parseBody } from "@/lib/api";
import { receiveDocument, operationDigest } from "@/lib/services/inventory";
import { receiptDocSchema } from "@/lib/validators";

/** Поступление (партия): документ с несколькими позициями на выбранный склад. */
export const POST = withAuth(async (req, { user, audit }) => {
  const b = await parseBody(req, receiptDocSchema);
  const res = await receiveDocument({ ...b, toWarehouseId: b.toWarehouseId ?? undefined, actorId: user.id });
  audit.set(await operationDigest(res, "Оприходовал на склад"));
  return ok(res, { status: 201 });
}, ["inventory.receive"]);
