import { ok, withAuth, parseBody } from "@/lib/api";
import { writeOff } from "@/lib/services/inventory";
import { writeOffSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, writeOffSchema);
  return ok(
    await writeOff({
      catalogItemId: b.catalogItemId ?? undefined,
      unitId: b.unitId ?? undefined,
      teamId: b.teamId ?? undefined,
      quantity: b.quantity,
      actorId: user.id,
      note: b.note ?? undefined,
    }),
    { status: 201 },
  );
}, ["inventory.writeoff"]);
