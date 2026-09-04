import { ok, withAuth, parseBody, parseId } from "@/lib/api";
import { getTicketDetails, updateTicket } from "@/lib/services/tickets";
import { getTicketMaterials, getTicketReservations } from "@/lib/services/inventory";
import { ticketUpdateSchema } from "@/lib/validators";
import { deleteTicket } from "@/lib/services/deletion";

export const GET = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  const details = await getTicketDetails(user, id);
  const [materials, reservations] = await Promise.all([getTicketMaterials(id), getTicketReservations(id)]);
  return ok({ ...details, materials, reservations });
}, ["tickets.read.all", "tickets.read.own"]);

export const PATCH = withAuth(async (req, { user, params }) => {
  const b = await parseBody(req, ticketUpdateSchema);
  return ok(await updateTicket(user, parseId(params), b));
}, ["tickets.assign", "tickets.work"]);

export const DELETE = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  await getTicketDetails(user, id); // заявка должна быть видна пользователю
  await deleteTicket(id);
  return ok({ deleted: true });
}, ["tickets.delete"]);
