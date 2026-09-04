import { ok, withAuth } from "@/lib/api";
import { getTicket } from "@/lib/services/tickets";
import { getTicketMaterials } from "@/lib/services/inventory";
export const GET = withAuth(async (_req, { user, params }) => {
  const id = Number(params.id);
  await getTicket(user, id);
  return ok(await getTicketMaterials(id));
}, ["tickets.read.all", "tickets.read.own"]);
