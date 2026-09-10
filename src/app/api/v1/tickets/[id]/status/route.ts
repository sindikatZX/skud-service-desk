import { db } from "@/db";
import { tickets } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ok, withAuth, parseBody, parseId } from "@/lib/api";
import { changeStatus } from "@/lib/services/tickets";
import { ticketStatusSchema } from "@/lib/validators";
import { STATUS_LABELS } from "@/lib/labels";

export const POST = withAuth(async (req, { user, params, audit }) => {
  const id = parseId(params);
  const b = await parseBody(req, ticketStatusSchema);
  // Прежний статус читаем до перехода — иначе в журнале останется только «стало»
  const [was] = await db.select({ status: tickets.status, number: tickets.number, title: tickets.title }).from(tickets).where(eq(tickets.id, id));
  const t = await changeStatus(user, id, b.status, b.comment);
  audit.set({
    entity: "ticket",
    entityId: id,
    entityLabel: was ? `${was.number} — ${was.title}` : null,
    summary: `Перевёл заявку ${was?.number ?? `#${id}`} из «${STATUS_LABELS[was?.status ?? t.status]}» в «${STATUS_LABELS[t.status]}»`,
    details: b.comment ? { комментарий: b.comment } : undefined,
  });
  return ok(t);
}, ["tickets.work", "tickets.assign", "tickets.close", "tickets.cancel"]);
