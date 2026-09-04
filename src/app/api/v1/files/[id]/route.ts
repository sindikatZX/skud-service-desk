import { withAuth, parseId } from "@/lib/api";
import { openAttachment, contentDisposition } from "@/lib/services/attachments";

export const dynamic = "force-dynamic";

/**
 * Выдача вложения. Inline — только для распознанных по содержимому изображений,
 * видео, аудио и PDF; всё остальное — принудительное скачивание как octet-stream.
 * nosniff + CSP sandbox: даже открытый в браузере файл не выполняется в контексте приложения.
 */
export const GET = withAuth(async (req, { user, params }) => {
  const id = parseId(params);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const { meta, data } = await openAttachment(user, id);
  const inlineOk = ["image", "video", "audio", "pdf"].includes(meta.kind) && !download;
  const headers = new Headers({
    "Content-Type": inlineOk ? meta.mimeType : "application/octet-stream",
    "Content-Length": String(data.length),
    "Content-Disposition": contentDisposition(inlineOk ? "inline" : "attachment", meta.originalName),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'",
    "Cache-Control": "private, max-age=3600",
    "X-Frame-Options": "SAMEORIGIN",
  });
  return new Response(new Uint8Array(data), { status: 200, headers });
}, ["tickets.read.all", "tickets.read.own"]);
