import { db } from "@/db";
import { sites } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseId, notFound, forbidden } from "@/lib/api";
import { getSiteEquipment } from "@/lib/services/inventory";

/**
 * Оборудование, установленное на объекте.
 *
 * Пользователь портала видит только объекты своего клиента: без этой проверки
 * перебором номеров в адресе можно было получить состав оборудования чужих объектов.
 */
export const GET = withAuth(async (_req, { user, params }) => {
  const id = parseId(params);
  const [site] = await db.select({ clientId: sites.clientId }).from(sites).where(eq(sites.id, id));
  if (!site) throw notFound("Объект не найден");
  if (user.scope === "client" && user.clientId !== site.clientId) throw forbidden();
  return ok(await getSiteEquipment(id));
}, ["clients.read", "tickets.read.own"]);
