import { ok, withAuth, parseBody, parseQuery } from "@/lib/api";
import { listTickets, createTicket } from "@/lib/services/tickets";
import { ticketCreateSchema, ticketListQuerySchema } from "@/lib/validators";

export const GET = withAuth(async (req, { user }) => {
  const f = parseQuery(req, ticketListQuerySchema);
  return ok(await listTickets(user, f));
}, ["tickets.read.all", "tickets.read.own"]);

export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, ticketCreateSchema);
  return ok(await createTicket(user, b), { status: 201 });
}, ["tickets.create"]);
