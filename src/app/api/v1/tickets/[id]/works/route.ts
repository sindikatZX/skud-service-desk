import { ok, withAuth, parseBody, parseId } from "@/lib/api";
import { addWork } from "@/lib/services/tickets";
import { workCreateSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user, params }) => {
  const b = await parseBody(req, workCreateSchema);
  return ok(
    await addWork(user, parseId(params), {
      description: b.description,
      workCatalogId: b.workCatalogId ?? null,
      quantity: b.quantity ?? 1,
      unit: b.unit ?? "шт",
      durationMinutes: b.durationMinutes ?? null,
      performedBy: b.performedBy ?? null,
    }),
    { status: 201 },
  );
}, ["tickets.work", "tickets.assign"]);
