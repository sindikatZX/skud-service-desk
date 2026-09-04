import { db } from "@/db";
import {
  roles,
  ticketTypes,
  ticketPriorities,
  catalogCategories,
  measureUnits,
  users,
  tickets,
  catalogItems,
} from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { conflict, notFound } from "@/lib/api";
import type { Permission } from "@/lib/rbac";

/**
 * Справочники: типы работ, приоритеты, категории номенклатуры, единицы измерения и роли.
 * Всё редактируется в разделе «Справочники» и подставляется в формы вместо
 * зашитых в код списков.
 *
 * Системные записи (isSystem) переименовываются и настраиваются, но не удаляются:
 * на их коды опирается первичная настройка системы.
 */

const SYSTEM_LOCKED = "Системная запись справочника не удаляется. Её можно переименовать или отключить (снять «Активна»).";

/**
 * Счётчики использования записей справочника.
 * Считаем отдельным group by и склеиваем в памяти: коррелированный подзапрос
 * в select-поле Drizzle разворачивает не по строке, а один раз на весь запрос.
 */
async function usageCounts<K extends string | number>(
  rows: { key: K; count: number }[],
): Promise<Map<K, number>> {
  return new Map(rows.map((r) => [r.key, r.count]));
}

/** Справочники для выпадающих списков в формах — только активные записи. */
export async function getFormDictionaries() {
  const [types, priorities, categories, units] = await Promise.all([
    db.select().from(ticketTypes).where(eq(ticketTypes.isActive, true)).orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.name)),
    db
      .select()
      .from(ticketPriorities)
      .where(eq(ticketPriorities.isActive, true))
      .orderBy(asc(ticketPriorities.sortOrder), asc(ticketPriorities.name)),
    db
      .select()
      .from(catalogCategories)
      .where(eq(catalogCategories.isActive, true))
      .orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name)),
    db.select().from(measureUnits).where(eq(measureUnits.isActive, true)).orderBy(asc(measureUnits.sortOrder), asc(measureUnits.name)),
  ]);
  return { types, priorities, categories, units };
}

async function ensureCodeFree(table: typeof ticketTypes | typeof catalogCategories | typeof measureUnits | typeof ticketPriorities | typeof roles, code: string, exceptId?: number) {
  const rows = await db.select({ id: table.id }).from(table).where(eq(table.code, code));
  if (rows.some((r) => r.id !== exceptId)) throw conflict(`Код «${code}» уже занят в этом справочнике`);
}

// ─────────────────────────── ТИПЫ РАБОТ ───────────────────────────

export async function listTicketTypes() {
  const [rows, used] = await Promise.all([
    db.select().from(ticketTypes).orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.name)),
    db
      .select({ key: tickets.typeId, count: sql<number>`count(*)::int` })
      .from(tickets)
      .groupBy(tickets.typeId)
      .then(usageCounts),
  ]);
  return rows.map((r) => ({ ...r, usedBy: used.get(r.id) ?? 0 }));
}

export async function createTicketType(input: { code: string; name: string; sortOrder?: number; isActive?: boolean }) {
  await ensureCodeFree(ticketTypes, input.code);
  const [row] = await db.insert(ticketTypes).values({ ...input, isSystem: false }).returning();
  return row;
}

export async function updateTicketType(id: number, patch: { code?: string; name?: string; sortOrder?: number; isActive?: boolean }) {
  if (patch.code) await ensureCodeFree(ticketTypes, patch.code, id);
  const [row] = await db.update(ticketTypes).set(patch).where(eq(ticketTypes.id, id)).returning();
  if (!row) throw notFound("Тип работ не найден");
  return row;
}

export async function deleteTicketType(id: number) {
  const [row] = await db.select().from(ticketTypes).where(eq(ticketTypes.id, id));
  if (!row) throw notFound("Тип работ не найден");
  if (row.isSystem) throw conflict(SYSTEM_LOCKED);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.typeId, id));
  if (used.n > 0) throw conflict(`Тип используют ${used.n} заявок. Переведите их на другой тип или отключите запись.`);
  await db.delete(ticketTypes).where(eq(ticketTypes.id, id));
}

// ─────────────────────────── ПРИОРИТЕТЫ ───────────────────────────

export async function listPriorities() {
  const [rows, used] = await Promise.all([
    db.select().from(ticketPriorities).orderBy(asc(ticketPriorities.sortOrder), asc(ticketPriorities.name)),
    db
      .select({ key: tickets.priorityId, count: sql<number>`count(*)::int` })
      .from(tickets)
      .groupBy(tickets.priorityId)
      .then(usageCounts),
  ]);
  return rows.map((r) => ({ ...r, usedBy: used.get(r.id) ?? 0 }));
}

export async function createPriority(input: {
  code: string;
  name: string;
  slaHours?: number | null;
  colorClass?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  await ensureCodeFree(ticketPriorities, input.code);
  const [row] = await db.insert(ticketPriorities).values({ ...input, isSystem: false }).returning();
  return row;
}

export async function updatePriority(
  id: number,
  patch: { code?: string; name?: string; slaHours?: number | null; colorClass?: string; sortOrder?: number; isActive?: boolean },
) {
  if (patch.code) await ensureCodeFree(ticketPriorities, patch.code, id);
  const [row] = await db.update(ticketPriorities).set(patch).where(eq(ticketPriorities.id, id)).returning();
  if (!row) throw notFound("Приоритет не найден");
  return row;
}

export async function deletePriority(id: number) {
  const [row] = await db.select().from(ticketPriorities).where(eq(ticketPriorities.id, id));
  if (!row) throw notFound("Приоритет не найден");
  if (row.isSystem) throw conflict(SYSTEM_LOCKED);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(eq(tickets.priorityId, id));
  if (used.n > 0) throw conflict(`Приоритет используют ${used.n} заявок. Переведите их на другой приоритет или отключите запись.`);
  await db.delete(ticketPriorities).where(eq(ticketPriorities.id, id));
}

// ─────────────────────────── КАТЕГОРИИ НОМЕНКЛАТУРЫ ───────────────────────────

export async function listCategories() {
  const [rows, used] = await Promise.all([
    db.select().from(catalogCategories).orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name)),
    db
      .select({ key: catalogItems.categoryId, count: sql<number>`count(*)::int` })
      .from(catalogItems)
      .groupBy(catalogItems.categoryId)
      .then(usageCounts),
  ]);
  return rows.map((r) => ({ ...r, usedBy: used.get(r.id) ?? 0 }));
}

export async function createCategory(input: { code: string; name: string; sortOrder?: number; isActive?: boolean }) {
  await ensureCodeFree(catalogCategories, input.code);
  const [row] = await db.insert(catalogCategories).values({ ...input, isSystem: false }).returning();
  return row;
}

export async function updateCategory(id: number, patch: { code?: string; name?: string; sortOrder?: number; isActive?: boolean }) {
  if (patch.code) await ensureCodeFree(catalogCategories, patch.code, id);
  const [row] = await db.update(catalogCategories).set(patch).where(eq(catalogCategories.id, id)).returning();
  if (!row) throw notFound("Категория не найдена");
  return row;
}

export async function deleteCategory(id: number) {
  const [row] = await db.select().from(catalogCategories).where(eq(catalogCategories.id, id));
  if (!row) throw notFound("Категория не найдена");
  if (row.isSystem) throw conflict(SYSTEM_LOCKED);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(catalogItems).where(eq(catalogItems.categoryId, id));
  if (used.n > 0) throw conflict(`Категорию используют ${used.n} позиций номенклатуры. Переведите их в другую категорию или отключите запись.`);
  await db.delete(catalogCategories).where(eq(catalogCategories.id, id));
}

// ─────────────────────────── ЕДИНИЦЫ ИЗМЕРЕНИЯ ───────────────────────────

export async function listMeasureUnits() {
  const [rows, used] = await Promise.all([
    db.select().from(measureUnits).orderBy(asc(measureUnits.sortOrder), asc(measureUnits.name)),
    db
      .select({ key: catalogItems.unit, count: sql<number>`count(*)::int` })
      .from(catalogItems)
      .groupBy(catalogItems.unit)
      .then(usageCounts),
  ]);
  return rows.map((r) => ({ ...r, usedBy: used.get(r.code) ?? 0 }));
}

export async function createMeasureUnit(input: { code: string; name: string; sortOrder?: number; isActive?: boolean }) {
  await ensureCodeFree(measureUnits, input.code);
  const [row] = await db.insert(measureUnits).values({ ...input, isSystem: false }).returning();
  return row;
}

export async function updateMeasureUnit(id: number, patch: { code?: string; name?: string; sortOrder?: number; isActive?: boolean }) {
  if (patch.code) await ensureCodeFree(measureUnits, patch.code, id);
  const [row] = await db.update(measureUnits).set(patch).where(eq(measureUnits.id, id)).returning();
  if (!row) throw notFound("Единица измерения не найдена");
  return row;
}

export async function deleteMeasureUnit(id: number) {
  const [row] = await db.select().from(measureUnits).where(eq(measureUnits.id, id));
  if (!row) throw notFound("Единица измерения не найдена");
  if (row.isSystem) throw conflict(SYSTEM_LOCKED);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(catalogItems).where(eq(catalogItems.unit, row.code));
  if (used.n > 0) throw conflict(`Единицу используют ${used.n} позиций номенклатуры.`);
  await db.delete(measureUnits).where(eq(measureUnits.id, id));
}

/** Проверка, что код единицы измерения существует в справочнике. */
export async function assertMeasureUnitExists(code: string) {
  const [row] = await db.select({ id: measureUnits.id }).from(measureUnits).where(eq(measureUnits.code, code));
  if (!row) throw conflict(`Единица измерения «${code}» отсутствует в справочнике`);
}

// ─────────────────────────── РОЛИ ───────────────────────────

export async function listRoles() {
  const [rows, used] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db
      .select({ key: users.roleId, count: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.roleId)
      .then(usageCounts),
  ]);
  return rows.map((r) => ({ ...r, usedBy: used.get(r.id) ?? 0 }));
}

export async function createRole(input: {
  code: string;
  name: string;
  description?: string | null;
  scope?: "all" | "team" | "client";
  isFieldStaff?: boolean;
  permissions?: string[];
  sortOrder?: number;
  isActive?: boolean;
}) {
  await ensureCodeFree(roles, input.code);
  const [row] = await db
    .insert(roles)
    .values({
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      scope: input.scope ?? "all",
      isFieldStaff: input.isFieldStaff ?? false,
      permissions: (input.permissions ?? []) as Permission[],
      sortOrder: input.sortOrder ?? 100,
      isActive: input.isActive ?? true,
      isSystem: false,
    })
    .returning();
  return row;
}

export async function updateRole(
  id: number,
  patch: {
    code?: string;
    name?: string;
    description?: string | null;
    scope?: "all" | "team" | "client";
    isFieldStaff?: boolean;
    permissions?: string[];
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const [existing] = await db.select().from(roles).where(eq(roles.id, id));
  if (!existing) throw notFound("Роль не найдена");
  if (patch.code) await ensureCodeFree(roles, patch.code, id);
  // У системной роли код неизменен: на него опирается первичная настройка.
  const set = { ...patch, permissions: patch.permissions as Permission[] | undefined };
  if (existing.isSystem) delete set.code;

  // Нельзя оставить систему без роли, управляющей пользователями.
  if (patch.permissions && existing.permissions.includes("users.manage") && !patch.permissions.includes("users.manage")) {
    const others = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(roles)
      .where(sql`'users.manage' = any(${roles.permissions}) and ${roles.id} <> ${id} and ${roles.isActive}`);
    if ((others[0]?.n ?? 0) === 0) throw conflict("Это единственная роль с правом «Управление сотрудниками» — снять его нельзя");
  }

  const [row] = await db.update(roles).set(set).where(eq(roles.id, id)).returning();
  return row;
}

export async function deleteRole(id: number) {
  const [row] = await db.select().from(roles).where(eq(roles.id, id));
  if (!row) throw notFound("Роль не найдена");
  if (row.isSystem) throw conflict(SYSTEM_LOCKED);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.roleId, id));
  if (used.n > 0) throw conflict(`Роль назначена ${used.n} сотрудникам. Переведите их на другую роль перед удалением.`);
  await db.delete(roles).where(eq(roles.id, id));
}
