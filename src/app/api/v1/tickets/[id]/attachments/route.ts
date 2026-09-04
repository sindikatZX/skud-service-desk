import { ok, withAuth, parseId, badRequest } from "@/lib/api";
import { postMessageWithFiles } from "@/lib/services/chat";
import { listForTicket, toDto } from "@/lib/services/attachments";

export const dynamic = "force-dynamic";

/** Все файлы заявки (для галереи вложений). */
export const GET = withAuth(async (_req, { user, params }) => {
  const rows = await listForTicket(user, parseId(params));
  return ok(rows.map(toDto));
}, ["tickets.read.all", "tickets.read.own"]);

/** Сообщение чата с файлами: multipart/form-data — поля text, isInternal, files[]. */
export const POST = withAuth(async (req, { user, params }) => {
  const ticketId = parseId(params);
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    throw badRequest("Ожидается multipart/form-data");
  }
  const text = String(fd.get("text") ?? "");
  const internalRaw = fd.get("isInternal");
  const isInternal = internalRaw == null ? undefined : String(internalRaw) === "true" || String(internalRaw) === "1";
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  return ok(await postMessageWithFiles(user, ticketId, text, isInternal, files), { status: 201 });
}, ["chat.write"]);
