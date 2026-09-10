import { ok, withAuth, parseBody } from "@/lib/api";
import { issueToTeam, operationDigest } from "@/lib/services/inventory";
import { issueSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user, audit }) => {
  const b = await parseBody(req, issueSchema);
  const res = await issueToTeam({
    teamId: b.teamId,
    catalogItemId: b.catalogItemId ?? undefined,
    unitId: b.unitId ?? undefined,
    quantity: b.quantity,
    actorId: user.id,
    note: b.note ?? undefined,
  });
  audit.set(await operationDigest(res, "Отгрузил бригаде"));
  return ok(res, { status: 201 });
}, ["inventory.issue"]);
