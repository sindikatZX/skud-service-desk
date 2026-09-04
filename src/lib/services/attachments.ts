import { db } from "@/db";
import { ticketAttachments, ticketComments } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { badRequest, forbidden, notFound } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getTicket } from "@/lib/services/tickets";

/**
 * Вложения чата заявки. Меры безопасности:
 *  - файлы лежат ВНЕ public/ (UPLOAD_DIR, по умолчанию ./uploads) и никогда не отдаются
 *    как статика — только через /api/v1/files/[id] с проверкой доступа к заявке;
 *  - на диске файл хранится под случайным именем без расширения, поэтому исполнить его
 *    по «красивому» пути нельзя, а веб-сервер не сопоставит ему обработчик;
 *  - MIME-тип определяется по сигнатуре содержимого (магические байты), а не по
 *    расширению/заголовку клиента; всё, что не распознано как безопасное медиа,
 *    отдаётся как application/octet-stream с Content-Disposition: attachment;
 *  - inline-показ разрешён только для растровых изображений, видео, аудио и PDF
 *    (SVG и HTML — только скачивание: они могут содержать скрипты);
 *  - ответ всегда с X-Content-Type-Options: nosniff и CSP «sandbox», чтобы даже
 *    открытый в браузере файл не выполнялся в контексте приложения.
 */

export const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "uploads");
export const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;

export type AttachmentKind = "image" | "video" | "audio" | "pdf" | "file";

export type AttachmentDto = {
  id: number;
  name: string;
  size: number;
  mimeType: string;
  kind: AttachmentKind;
  url: string;
  downloadUrl: string;
};

/** Определение типа по сигнатуре. Возвращает только «безопасные для inline» типы. */
export function sniff(buf: Buffer): { mime: string; kind: AttachmentKind } {
  const b = buf;
  const startsWith = (sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
  const ascii = (s: string, offset = 0) => b.subarray(offset, offset + s.length).toString("latin1") === s;
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: "image" };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", kind: "image" };
  if (ascii("GIF87a") || ascii("GIF89a")) return { mime: "image/gif", kind: "image" };
  if (ascii("RIFF") && ascii("WEBP", 8)) return { mime: "image/webp", kind: "image" };
  if (startsWith([0x42, 0x4d])) return { mime: "image/bmp", kind: "image" };
  if (b.length > 12 && ascii("ftyp", 4)) {
    const brand = b.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return { mime: "image/heic", kind: "image" };
    if (brand.startsWith("qt")) return { mime: "video/quicktime", kind: "video" };
    if (["M4A ", "M4B "].includes(brand)) return { mime: "audio/mp4", kind: "audio" };
    return { mime: "video/mp4", kind: "video" };
  }
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return { mime: "video/webm", kind: "video" };
  if (ascii("RIFF") && ascii("AVI ", 8)) return { mime: "video/x-msvideo", kind: "video" };
  if (ascii("ID3") || startsWith([0xff, 0xfb]) || startsWith([0xff, 0xf3]) || startsWith([0xff, 0xf2])) return { mime: "audio/mpeg", kind: "audio" };
  if (ascii("OggS")) return { mime: "audio/ogg", kind: "audio" };
  if (ascii("RIFF") && ascii("WAVE", 8)) return { mime: "audio/wav", kind: "audio" };
  if (ascii("%PDF-")) return { mime: "application/pdf", kind: "pdf" };
  return { mime: "application/octet-stream", kind: "file" };
}

/** Имя файла для Content-Disposition: убираем управляющие символы, пути и кавычки. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[\x00-\x1f\x7f"\\]/g, "_").trim().slice(0, 180);
  return cleaned || "file";
}

/** Заголовок Content-Disposition с ASCII-фолбэком и RFC 5987 для кириллицы. */
export function contentDisposition(type: "inline" | "attachment", name: string) {
  const safe = safeFileName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function seesInternal(user: SessionUser) {
  return can(user, "chat.internal") && user.scope !== "client";
}

export function toDto(a: typeof ticketAttachments.$inferSelect): AttachmentDto {
  return {
    id: a.id,
    name: a.originalName,
    size: a.size,
    mimeType: a.mimeType,
    kind: a.kind as AttachmentKind,
    url: `/api/v1/files/${a.id}`,
    downloadUrl: `/api/v1/files/${a.id}?download=1`,
  };
}

/** Сохраняет файлы и создаёт записи вложений (без привязки к сообщению — её проставит чат). */
export async function storeFiles(user: SessionUser, ticketId: number, files: File[]) {
  if (!files.length) return [];
  if (files.length > MAX_FILES_PER_MESSAGE) throw badRequest(`Не более ${MAX_FILES_PER_MESSAGE} файлов в одном сообщении`);
  await mkdir(UPLOAD_DIR, { recursive: true });
  const saved: (typeof ticketAttachments.$inferSelect)[] = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    if (f.size <= 0) throw badRequest(`Файл «${f.name}» пуст`);
    if (f.size > MAX_FILE_BYTES) throw badRequest(`Файл «${f.name}» больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ`);
    const buf = Buffer.from(await f.arrayBuffer());
    const { mime, kind } = sniff(buf);
    const storedName = randomBytes(24).toString("hex"); // без расширения
    const sha256 = createHash("sha256").update(buf).digest("hex");
    await writeFile(path.join(UPLOAD_DIR, storedName), buf, { mode: 0o600 });
    const [row] = await db
      .insert(ticketAttachments)
      .values({ ticketId, uploaderId: user.id, originalName: safeFileName(f.name || "file"), storedName, mimeType: mime, size: buf.length, kind, sha256 })
      .returning();
    saved.push(row);
  }
  return saved;
}

export async function attachToComment(ids: number[], commentId: number) {
  if (!ids.length) return;
  await db.update(ticketAttachments).set({ commentId }).where(inArray(ticketAttachments.id, ids));
}

export async function listForTicket(user: SessionUser, ticketId: number) {
  const rows = await db.select().from(ticketAttachments).where(eq(ticketAttachments.ticketId, ticketId));
  if (seesInternal(user)) return rows;
  // Клиенту — только вложения открытых сообщений
  const ids = rows.map((r) => r.commentId).filter((x): x is number => x != null);
  if (!ids.length) return [];
  const open = await db.select({ id: ticketComments.id }).from(ticketComments).where(and(inArray(ticketComments.id, ids), eq(ticketComments.isInternal, false)));
  const openSet = new Set(open.map((o) => o.id));
  return rows.filter((r) => r.commentId && openSet.has(r.commentId));
}

/** Чтение файла с проверкой доступа: к заявке и к сообщению (внутренние — не клиенту). */
export async function openAttachment(user: SessionUser, id: number) {
  const [a] = await db.select().from(ticketAttachments).where(eq(ticketAttachments.id, id));
  if (!a) throw notFound("Файл не найден");
  await getTicket(user, a.ticketId); // область видимости роли
  if (a.commentId && !seesInternal(user)) {
    const [c] = await db.select({ isInternal: ticketComments.isInternal }).from(ticketComments).where(eq(ticketComments.id, a.commentId));
    if (!c || c.isInternal) throw forbidden("Файл недоступен");
  }
  const full = path.join(UPLOAD_DIR, a.storedName);
  if (path.dirname(full) !== UPLOAD_DIR) throw forbidden("Некорректный путь"); // защита от обхода
  try {
    await stat(full);
  } catch {
    throw notFound("Файл отсутствует на диске");
  }
  const data = await readFile(full);
  return { meta: a, data };
}

/** Удаляет файлы сообщения с диска и из БД (вызывается при удалении сообщения). */
export async function deleteForComment(commentId: number) {
  const rows = await db.select().from(ticketAttachments).where(eq(ticketAttachments.commentId, commentId));
  for (const r of rows) {
    await unlink(path.join(UPLOAD_DIR, r.storedName)).catch(() => undefined);
  }
  if (rows.length) await db.delete(ticketAttachments).where(eq(ticketAttachments.commentId, commentId));
}
