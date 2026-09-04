import { db } from "@/db";
import { ticketComments, users, roles, ticketAttachments } from "@/db/schema";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { attachToComment, deleteForComment, storeFiles, toDto, type AttachmentDto } from "@/lib/services/attachments";
import { conflict, forbidden, notFound } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getTicket } from "@/lib/services/tickets";

/**
 * Чат по заявке: диспетчер, бригада и склад обсуждают работу в одной ленте.
 *
 * Видимость: сообщения с isInternal = true доступны только сотрудникам с правом
 * `chat.internal`; заказчик в портале видит и пишет только открытые сообщения.
 * Доступ к самой ленте ограничен теми же правилами, что и доступ к заявке.
 */

export type ChatMessage = {
  id: number;
  ticketId: number;
  authorId: number | null;
  authorName: string;
  authorRole: string | null;
  text: string;
  isInternal: boolean;
  editedAt: Date | null;
  createdAt: Date;
  own: boolean;
  canDelete: boolean;
  attachments: AttachmentDto[];
};

/** Может ли пользователь видеть внутренние сообщения. */
function seesInternal(user: SessionUser) {
  return can(user, "chat.internal") && user.scope !== "client";
}

function canModerate(user: SessionUser) {
  return can(user, "users.manage");
}

export async function listMessages(
  user: SessionUser,
  ticketId: number,
  opts: { afterId?: number; limit?: number } = {},
): Promise<ChatMessage[]> {
  await getTicket(user, ticketId); // проверка доступа к заявке

  const conds = [eq(ticketComments.ticketId, ticketId)];
  if (opts.afterId) conds.push(gt(ticketComments.id, opts.afterId));
  if (!seesInternal(user)) conds.push(eq(ticketComments.isInternal, false));

  const rows = await db
    .select({
      id: ticketComments.id,
      ticketId: ticketComments.ticketId,
      authorId: ticketComments.authorId,
      storedName: ticketComments.authorName,
      currentName: users.fullName,
      authorRole: roles.name,
      text: ticketComments.text,
      isInternal: ticketComments.isInternal,
      editedAt: ticketComments.editedAt,
      createdAt: ticketComments.createdAt,
    })
    .from(ticketComments)
    .leftJoin(users, eq(users.id, ticketComments.authorId))
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(...conds))
    .orderBy(asc(ticketComments.id))
    .limit(opts.limit ?? 300);

  const ids = rows.map((r) => r.id);
  const files = ids.length ? await db.select().from(ticketAttachments).where(inArray(ticketAttachments.commentId, ids)) : [];
  const byComment = new Map<number, AttachmentDto[]>();
  for (const f of files) {
    if (!f.commentId) continue;
    const list = byComment.get(f.commentId) ?? [];
    list.push(toDto(f));
    byComment.set(f.commentId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    ticketId: r.ticketId,
    authorId: r.authorId,
    // Имя из профиля, а если автор удалён — сохранённое при отправке.
    authorName: r.currentName ?? r.storedName ?? "Удалённый пользователь",
    authorRole: r.authorRole,
    text: r.text,
    isInternal: r.isInternal,
    editedAt: r.editedAt,
    createdAt: r.createdAt,
    own: r.authorId === user.id,
    canDelete: r.authorId === user.id || canModerate(user),
    attachments: byComment.get(r.id) ?? [],
  }));
}

/** Сообщение с вложениями (multipart). Текст может быть пустым, если есть файлы. */
export async function postMessageWithFiles(user: SessionUser, ticketId: number, text: string, isInternal: boolean | undefined, files: File[]) {
  const ticket = await getTicket(user, ticketId);
  if (!can(user, "chat.write")) throw forbidden("Нет права писать в чат заявки");
  if (["closed", "cancelled"].includes(ticket.status)) throw conflict("Заявка завершена — обсуждение закрыто");
  const value = text.trim();
  if (!value && !files.length) throw conflict("Добавьте текст или файлы");
  const internal = seesInternal(user) ? (isInternal ?? true) : false;
  const saved = await storeFiles(user, ticketId, files);
  const [row] = await db
    .insert(ticketComments)
    .values({ ticketId, authorId: user.id, authorName: user.fullName, text: value || (saved.length ? `📎 ${saved.length} файл(ов)` : ""), isInternal: internal })
    .returning();
  await attachToComment(saved.map((s) => s.id), row.id);
  return { ...row, attachments: saved.map(toDto) };
}

export async function postMessage(user: SessionUser, ticketId: number, text: string, isInternal?: boolean) {
  const ticket = await getTicket(user, ticketId);
  if (!can(user, "chat.write")) throw forbidden("Нет права писать в чат заявки");
  if (["closed", "cancelled"].includes(ticket.status)) throw conflict("Заявка завершена — обсуждение закрыто");

  // Заказчик пишет только открытые сообщения; сотрудник без права на внутренние — тоже.
  const internal = seesInternal(user) ? (isInternal ?? true) : false;

  const [row] = await db
    .insert(ticketComments)
    .values({ ticketId, authorId: user.id, authorName: user.fullName, text, isInternal: internal })
    .returning();
  return row;
}

export async function editMessage(user: SessionUser, messageId: number, text: string) {
  const [msg] = await db.select().from(ticketComments).where(eq(ticketComments.id, messageId));
  if (!msg) throw notFound("Сообщение не найдено");
  await getTicket(user, msg.ticketId);
  if (msg.authorId !== user.id) throw forbidden("Редактировать можно только свои сообщения");
  const [row] = await db
    .update(ticketComments)
    .set({ text, editedAt: new Date() })
    .where(eq(ticketComments.id, messageId))
    .returning();
  return row;
}

export async function deleteMessage(user: SessionUser, messageId: number) {
  const [msg] = await db.select().from(ticketComments).where(eq(ticketComments.id, messageId));
  if (!msg) throw notFound("Сообщение не найдено");
  await getTicket(user, msg.ticketId);
  if (msg.authorId !== user.id && !canModerate(user)) throw forbidden("Удалить можно только своё сообщение");
  await deleteForComment(messageId);
  await db.delete(ticketComments).where(eq(ticketComments.id, messageId));
}

/** Количество сообщений по заявке — для бейджа в списке заявок. */
export async function unreadHint(ticketId: number) {
  const rows = await db.select({ id: ticketComments.id }).from(ticketComments).where(eq(ticketComments.ticketId, ticketId));
  return rows.length;
}
