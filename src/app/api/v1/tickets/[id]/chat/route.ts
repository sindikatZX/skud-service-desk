import { ok, withAuth, parseBody, parseQuery, parseId } from "@/lib/api";
import { listMessages, postMessage } from "@/lib/services/chat";
import { chatPostSchema, chatQuerySchema } from "@/lib/validators";

/** Лента обсуждения заявки. afterId — для дозагрузки только новых сообщений. */
export const GET = withAuth(async (req, { user, params }) => {
  const q = parseQuery(req, chatQuerySchema);
  return ok(await listMessages(user, parseId(params), q));
}, ["tickets.read.all", "tickets.read.own"]);

export const POST = withAuth(async (req, { user, params }) => {
  const b = await parseBody(req, chatPostSchema);
  return ok(await postMessage(user, parseId(params), b.text, b.isInternal), { status: 201 });
}, ["chat.write"]);
