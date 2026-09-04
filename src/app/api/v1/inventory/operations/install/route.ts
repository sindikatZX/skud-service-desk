import { ok, withAuth, parseBody, forbidden } from "@/lib/api";
import { install } from "@/lib/services/inventory";
import { getTicket } from "@/lib/services/tickets";
import { installSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, installSchema);
  const t = await getTicket(user, b.ticketId);
  if (user.scope === "team" && t.teamId !== user.teamId) throw forbidden("Заявка не назначена вашей бригаде");
  return ok(
    await install({
      ticketId: b.ticketId,
      catalogItemId: b.catalogItemId ?? undefined,
      unitId: b.unitId ?? undefined,
      quantity: b.quantity,
      actorId: user.id,
      note: b.note ?? undefined,
    }),
    { status: 201 },
  );
}, ["inventory.install"]);
