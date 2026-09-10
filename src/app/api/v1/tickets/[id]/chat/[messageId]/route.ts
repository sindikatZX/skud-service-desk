import { ok, withAuth, parseBody, parseId } from "@/lib/api";
import { deleteMessage, editMessage } from "@/lib/services/chat";
import { chatEditSchema } from "@/lib/validators";

export const PATCH = withAuth(async (req, { user, params, audit }) => {
  const b = await parseBody(req, chatEditSchema);
  const id = parseId(params, "messageId");
  const res = await editMessage(user, id, b.text);
  audit.set({ entity: "chat_message", entityId: id, summary: `Изменил своё сообщение в чате заявки #${parseId(params)}`, details: { новыйТекст: b.text } });
  return ok(res);
}, ["chat.write"]);

export const DELETE = withAuth(async (_req, { user, params, audit }) => {
  const id = parseId(params, "messageId");
  const removed = await deleteMessage(user, id);
  audit.set({
    entity: "chat_message",
    entityId: id,
    entityLabel: removed.text.slice(0, 80),
    summary: `Удалил сообщение ${removed.authorName === user.fullName ? "своё" : `от «${removed.authorName}»`} в чате заявки #${removed.ticketId}`,
    details: { текст: removed.text, внутреннее: removed.isInternal, отправлено: removed.createdAt },
  });
  return ok({ deleted: true });
}, ["tickets.read.all", "tickets.read.own"]);
