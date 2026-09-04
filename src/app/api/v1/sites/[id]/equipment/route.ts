import { ok, withAuth, parseId } from "@/lib/api";
import { getSiteEquipment } from "@/lib/services/inventory";

export const GET = withAuth(async (_req, { params }) => ok(await getSiteEquipment(parseId(params))), ["clients.read", "tickets.read.own"]);
