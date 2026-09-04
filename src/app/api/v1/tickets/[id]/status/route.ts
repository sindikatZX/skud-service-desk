import { ok, withAuth, parseBody, parseId } from "@/lib/api";
import { changeStatus } from "@/lib/services/tickets";
import { ticketStatusSchema } from "@/lib/validators";

export const POST = withAuth(async (req, { user, params }) => {
  const b = await parseBody(req, ticketStatusSchema);
  return ok(await changeStatus(user, parseId(params), b.status, b.comment));
}, ["tickets.work", "tickets.assign", "tickets.close", "tickets.cancel"]);
