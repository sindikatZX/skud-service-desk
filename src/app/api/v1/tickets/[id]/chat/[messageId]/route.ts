import { ok, withAuth, parseBody, parseId } from "@/lib/api";
import { deleteMessage, editMessage } from "@/lib/services/chat";
import { chatEditSchema } from "@/lib/validators";

export const PATCH = withAuth(async (req, { user, params }) => {
  const b = await parseBody(req, chatEditSchema);
  return ok(await editMessage(user, parseId(params, "messageId"), b.text));
}, ["chat.write"]);

export const DELETE = withAuth(async (_req, { user, params }) => {
  await deleteMessage(user, parseId(params, "messageId"));
  return ok({ deleted: true });
}, ["tickets.read.all", "tickets.read.own"]);
