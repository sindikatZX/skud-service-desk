import { ok, withAuth, parseBody, forbidden } from "@/lib/api";
import { reserve } from "@/lib/services/inventory";
import { getTicket } from "@/lib/services/tickets";
import { reserveSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, reserveSchema);
  const t = await getTicket(user, b.ticketId);
  // Монтажник работает только с остатками своей бригады — со склада резервирует диспетчер/склад.
  if (user.scope === "team" && (t.teamId !== user.teamId || b.fromWarehouse))
    throw forbidden("Монтажник резервирует только из остатков своей бригады");
  return ok(
    await reserve({
      ticketId: b.ticketId,
      catalogItemId: b.catalogItemId ?? undefined,
      unitId: b.unitId ?? undefined,
      quantity: b.quantity,
      fromWarehouse: b.fromWarehouse,
      actorId: user.id,
      note: b.note ?? undefined,
    }),
    { status: 201 },
  );
}, ["inventory.reserve"]);
