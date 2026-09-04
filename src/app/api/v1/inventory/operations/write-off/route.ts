import { ok, withAuth, parseBody } from "@/lib/api";
import { writeOffDocument, writeOff } from "@/lib/services/inventory";
import { writeOffDocSchema, writeOffSchema } from "@/lib/validators";

/** Списание: документ с позициями (lines) или одиночная позиция (старый формат). */
export const POST = withAuth(async (req, { user }) => {
  const raw = (await req.clone().json().catch(() => ({}))) as Record<string, unknown>;
  if (Array.isArray(raw.lines)) {
    const b = await parseBody(req, writeOffDocSchema);
    return ok(await writeOffDocument({ ...b, fromWarehouseId: b.fromWarehouseId ?? undefined, actorId: user.id }), { status: 201 });
  }
  const b = await parseBody(req, writeOffSchema);
  return ok(await writeOff({ ...b, catalogItemId: b.catalogItemId ?? undefined, unitId: b.unitId ?? undefined, teamId: b.teamId ?? undefined, quantity: b.quantity, note: b.note ?? undefined, actorId: user.id }), { status: 201 });
}, ["inventory.writeoff"]);
