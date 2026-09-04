import { ok, withAuth, parseBody } from "@/lib/api";
import { issueToTeam } from "@/lib/services/inventory";
import { issueSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, issueSchema);
  return ok(
    await issueToTeam({
      teamId: b.teamId,
      catalogItemId: b.catalogItemId ?? undefined,
      unitId: b.unitId ?? undefined,
      quantity: b.quantity,
      actorId: user.id,
      note: b.note ?? undefined,
    }),
    { status: 201 },
  );
}, ["inventory.issue"]);
