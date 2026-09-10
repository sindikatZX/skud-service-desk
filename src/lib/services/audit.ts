import { db } from "@/db";
import { auditLog, users, roles } from "@/db/schema";
import { and, desc, eq, gte, lte, ilike, or, sql, type SQL } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";

/**
 * Журнал действий.
 *
 * Записи создаются автоматически на слое API (`withAuth`) для каждого изменяющего
 * запроса. Такой подход выбран намеренно: если полагаться на ручные вызовы в
 * сервисах, часть действий рано или поздно останется незаписанной — а журнал
 * ценен именно полнотой.
 *
 * Слой API знает метод и адрес запроса, поэтому фразу для журнала выводим из них
 * (`describe`), а обработчик может уточнить её через `ctx.audit.set(...)`, если
 * знает больше — например, сколько и чего именно списали.
 */

export type AuditAction = "create" | "update" | "delete" | "operation" | "login" | "logout" | "denied";

export type AuditDraft = {
  action?: AuditAction;
  entity?: string;
  entityId?: number | null;
  entityLabel?: string | null;
  summary?: string;
  details?: unknown;
};

/** Накопитель уточнений: обработчик дополняет запись, пока выполняется запрос. */
export class AuditContext {
  private draft: AuditDraft = {};
  set(patch: AuditDraft) {
    this.draft = { ...this.draft, ...patch };
  }
  get value(): AuditDraft {
    return this.draft;
  }
}

/** Человеческие названия сущностей по адресу запроса. */
const ENTITY_BY_SEGMENT: Record<string, { entity: string; one: string; acc: string }> = {
  tickets: { entity: "ticket", one: "заявка", acc: "заявку" },
  clients: { entity: "client", one: "клиент", acc: "клиента" },
  sites: { entity: "site", one: "объект", acc: "объект" },
  teams: { entity: "team", one: "бригада", acc: "бригаду" },
  vehicles: { entity: "vehicle", one: "автомобиль", acc: "автомобиль" },
  users: { entity: "user", one: "сотрудник", acc: "сотрудника" },
  catalog: { entity: "catalog_item", one: "товар", acc: "товар" },
  warehouses: { entity: "warehouse", one: "склад", acc: "склад" },
  directories: { entity: "directory", one: "запись справочника", acc: "запись справочника" },
  inventory: { entity: "inventory", one: "склад", acc: "склад" },
  chat: { entity: "chat_message", one: "сообщение", acc: "сообщение" },
  works: { entity: "ticket_work", one: "работа", acc: "работу" },
  status: { entity: "ticket", one: "статус заявки", acc: "статус заявки" },
  attachments: { entity: "attachment", one: "вложение", acc: "вложение" },
  setup: { entity: "installation", one: "настройка системы", acc: "настройку системы" },
  branding: { entity: "branding", one: "оформление", acc: "оформление" },
  admin: { entity: "admin", one: "обслуживание", acc: "обслуживание" },
  import: { entity: "import", one: "импорт", acc: "импорт" },
};

/** Складские операции: адрес → готовая фраза. */
const INVENTORY_OPS: Record<string, string> = {
  receive: "Оприходовал на склад",
  issue: "Отгрузил бригаде",
  return: "Принял возврат на склад",
  transfer: "Переместил между складами",
  reserve: "Зарезервировал под заявку",
  unreserve: "Снял резерв",
  install: "Списал на объект (установка)",
  "write-off": "Списал со склада",
};

const VERB: Record<AuditAction, string> = {
  create: "Создал",
  update: "Изменил",
  delete: "Удалил",
  operation: "Выполнил операцию",
  login: "Вошёл в систему",
  logout: "Вышел из системы",
  denied: "Попытка действия без прав",
};

/**
 * Выводит действие, сущность и фразу из метода и адреса запроса.
 * Это заготовка: обработчик может уточнить её через ctx.audit.set().
 */
export function describe(method: string, pathname: string): Required<Pick<AuditDraft, "action" | "entity" | "summary">> & { entityId: number | null } {
  const parts = pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const idFromPath = parts.map(Number).filter((n) => Number.isInteger(n) && n > 0).pop() ?? null;

  // Складские операции описываются точнее остальных: это самые «денежные» действия
  if (parts[0] === "inventory" && parts[1] === "operations") {
    return { action: "operation", entity: "inventory", entityId: idFromPath, summary: INVENTORY_OPS[last] ?? "Складская операция" };
  }
  if (parts[0] === "auth" && last === "login") return { action: "login", entity: "session", entityId: null, summary: VERB.login };
  if (parts[0] === "auth" && last === "logout") return { action: "logout", entity: "session", entityId: null, summary: VERB.logout };

  const action: AuditAction = method === "POST" ? "create" : method === "DELETE" ? "delete" : "update";
  // Ищем самый конкретный известный сегмент: /tickets/5/chat → сообщение, а не заявка
  const known = [...parts].reverse().find((p) => ENTITY_BY_SEGMENT[p]);
  const meta = known ? ENTITY_BY_SEGMENT[known] : null;
  const entity = meta?.entity ?? parts[0] ?? "unknown";
  const what = meta?.acc ?? parts[0] ?? "запись";
  const summary = `${VERB[action]} ${what}${idFromPath ? ` #${idFromPath}` : ""}`;
  return { action, entity, entityId: idFromPath, summary };
}


/** Подписи для фильтров журнала. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  operation: "Складская операция",
  login: "Вход",
  logout: "Выход",
  denied: "Отказ в доступе",
};

/** Сущности, встречающиеся в журнале, — человеческими словами. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.values(ENTITY_BY_SEGMENT).map((m) => [m.entity, m.one[0].toUpperCase() + m.one.slice(1)])),
  session: "Сеанс работы",
  chat_message: "Сообщение в чате",
  ticket_work: "Работа по заявке",
  catalog_item: "Товар",
  role: "Роль",
};

/**
 * Что изменилось: только отличающиеся поля, «было → стало».
 *
 * Журнал ценнее, когда отвечает не «изменил товар», а «изменил цену с 1200 на 1350»:
 * по такой записи разбирают спор, не поднимая резервную копию.
 */
/** Служебные поля: их правит система, а не человек — в журнале они только шумят. */
const TECHNICAL_FIELDS = new Set(["id", "createdAt", "updatedAt", "priceUpdatedAt", "passwordHash"]);

export function changes(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string> = {}) {
  const out: Record<string, string> = {};
  for (const key of Object.keys(after)) {
    if (TECHNICAL_FIELDS.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (a === b) continue;
    if (a instanceof Date && b instanceof Date && a.getTime() === b.getTime()) continue;
    if (String(a ?? "") === String(b ?? "")) continue;
    out[labels[key] ?? key] = `${show(a)} → ${show(b)}`;
  }
  return out;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "пусто";
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (v instanceof Date) return v.toLocaleString("ru-RU");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Поля, которые никогда не попадают в журнал. */
const SECRET_FIELDS = ["password", "passwordHash", "token", "secret", "confirm"];

/** Убирает пароли и обрезает объёмные значения: журнал не должен хранить лишнее. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value !== "object") return value;
  if (depth > 3) return "…";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_FIELDS.some((s) => k.toLowerCase().includes(s.toLowerCase()))) { out[k] = "···"; continue; }
    if (typeof v === "string" && v.startsWith("data:")) { out[k] = "«вложенный файл»"; continue; }
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

export async function recordAudit(entry: {
  user?: Pick<SessionUser, "id" | "fullName" | "roleName"> | null;
  action: AuditAction;
  entity: string;
  entityId?: number | null;
  entityLabel?: string | null;
  summary: string;
  method?: string;
  path?: string;
  status?: number;
  details?: unknown;
  ip?: string | null;
}) {
  try {
    await db.insert(auditLog).values({
      actorId: entry.user?.id ?? null,
      actorName: entry.user?.fullName ?? "неизвестный",
      actorRole: entry.user?.roleName ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      entityLabel: entry.entityLabel ?? null,
      summary: entry.summary,
      method: entry.method ?? null,
      path: entry.path ?? null,
      status: entry.status ?? null,
      details: entry.details === undefined ? null : sanitize(entry.details),
      ip: entry.ip ?? null,
    });
  } catch (e) {
    // Журнал не должен ронять сам запрос: пользователь уже выполнил действие
    console.error("audit failed", e);
  }
}

export type AuditFilter = {
  from?: Date | null;
  to?: Date | null;
  actorId?: number;
  action?: string;
  entity?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export async function listAudit(f: AuditFilter = {}) {
  const conds: SQL[] = [];
  if (f.from) conds.push(gte(auditLog.at, f.from));
  if (f.to) conds.push(lte(auditLog.at, f.to));
  if (f.actorId) conds.push(eq(auditLog.actorId, f.actorId));
  if (f.action) conds.push(eq(auditLog.action, f.action));
  if (f.entity) conds.push(eq(auditLog.entity, f.entity));
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(or(ilike(auditLog.summary, like), ilike(auditLog.actorName, like), ilike(auditLog.entityLabel, like), ilike(auditLog.path, like))!);
  }
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(auditLog).where(where).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(f.limit ?? 100).offset(f.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);
  return { rows, total: n };
}

/** Сотрудники, встречающиеся в журнале, — для фильтра. */
export async function auditActors() {
  return db
    .selectDistinctOn([users.id], { id: users.id, fullName: users.fullName, roleName: roles.name })
    .from(auditLog)
    .innerJoin(users, eq(users.id, auditLog.actorId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .orderBy(users.id);
}

/** История по конкретному объекту — для карточки товара, заявки и т. д. */
export async function auditFor(entity: string, entityId: number, limit = 50) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}
