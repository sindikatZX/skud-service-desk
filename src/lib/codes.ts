import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Единый формат кодов справочников: `ПРЕФИКС_ГОД_НОМЕР`, например `NM_2025_00001`.
 *  - префикс — 2 латинские буквы, закреплён за справочником (см. CODE_PREFIXES);
 *  - год — год создания записи;
 *  - номер — 5 цифр, сквозной внутри справочника за год.
 *
 * Коды генерируются системой и уникальны внутри справочника. При импорте из CSV код —
 * ключ сопоставления: совпал с существующей записью → она перезаписывается, иначе
 * создаётся новая (с кодом из файла, если он корректен и свободен, или с новым).
 *
 * На коды системных записей код приложения больше не опирается: для этого есть
 * отдельные системные ключи (roles.sys_key = admin, ticket_types.sys_key = repair…),
 * поэтому пользователь может свободно перекодировать любой справочник.
 */

export type CodedTable =
  | "roles"
  | "ticket_types"
  | "ticket_priorities"
  | "catalog_categories"
  | "measure_units"
  | "work_catalog"
  | "warehouses"
  | "catalog_items"
  | "clients"
  | "sites"
  | "teams"
  | "vehicles"
  | "users";

export const CODE_PREFIXES: Record<CodedTable, string> = {
  roles: "RL",
  ticket_types: "TT",
  ticket_priorities: "PR",
  catalog_categories: "CT",
  measure_units: "MU",
  work_catalog: "WK",
  warehouses: "WH",
  catalog_items: "NM",
  clients: "CL",
  sites: "ST",
  teams: "TM",
  vehicles: "VH",
  users: "US",
};

export const CODE_LABELS: Record<CodedTable, string> = {
  roles: "Роли",
  ticket_types: "Типы работ",
  ticket_priorities: "Приоритеты",
  catalog_categories: "Категории товаров",
  measure_units: "Единицы измерения",
  work_catalog: "Справочник работ",
  warehouses: "Склады",
  catalog_items: "Товары (номенклатура)",
  clients: "Клиенты",
  sites: "Объекты",
  teams: "Бригады",
  vehicles: "Автопарк",
  users: "Сотрудники",
};

export const CODE_RE = /^[A-Z]{2}_\d{4}_\d{5}$/;

export function isValidCode(code: string, table?: CodedTable) {
  const c = code.trim().toUpperCase();
  if (!CODE_RE.test(c)) return false;
  return table ? c.startsWith(CODE_PREFIXES[table] + "_") : true;
}

export function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

const SQL_TABLE: Record<CodedTable, string> = Object.fromEntries(Object.keys(CODE_PREFIXES).map((k) => [k, k])) as Record<CodedTable, string>;

/**
 * Следующий свободный код справочника за текущий год.
 * Номер берётся как max(номер) + 1 среди кодов текущего года.
 */
export async function nextCode(table: CodedTable, year = new Date().getFullYear()): Promise<string> {
  const prefix = `${CODE_PREFIXES[table]}_${year}_`;
  const res = await db.execute(
    sql`select coalesce(max(substring(code from ${sql.raw(String(prefix.length + 1))})::int), 0) as n from ${sql.identifier(SQL_TABLE[table])} where code ~ ${"^" + prefix + "[0-9]{5}$"}`,
  );
  const n = Number((res.rows[0] as { n: number | string }).n) + 1;
  return `${prefix}${String(n).padStart(5, "0")}`;
}

/** Есть ли уже запись с таким кодом (кроме exceptId). */
export async function codeTaken(table: CodedTable, code: string, exceptId?: number) {
  const res = await db.execute(
    sql`select id from ${sql.identifier(SQL_TABLE[table])} where code = ${normalizeCode(code)} ${exceptId ? sql`and id <> ${exceptId}` : sql``} limit 1`,
  );
  return res.rows.length > 0;
}

/**
 * Код для новой записи: если передан корректный и свободный код — он и используется
 * (импорт с сохранением кодов), иначе генерируется новый.
 */
export async function resolveCode(table: CodedTable, wanted?: string | null): Promise<string> {
  if (wanted) {
    const c = normalizeCode(wanted);
    if (isValidCode(c, table) && !(await codeTaken(table, c))) return c;
  }
  return nextCode(table);
}

/** Системные ключи прежних версий: код записи был одновременно и ключом. */
const LEGACY_SYS_KEYS: Partial<Record<CodedTable, string[]>> = {
  roles: ["admin", "dispatcher", "technician", "warehouse", "client"],
  ticket_types: ["installation", "maintenance", "repair", "inspection", "other"],
  ticket_priorities: ["low", "normal", "high", "critical"],
  catalog_categories: ["camera", "recorder", "controller", "reader", "lock", "cable", "mount", "power", "network", "consumable", "other"],
};

let migrated = false;

/**
 * Перекодирование справочников в единый формат. Идемпотентно; выполняется при старте
 * (перед сидом) и один раз за процесс. Старые коды системных записей переносятся в
 * sys_key, единицы измерения получают symbol = старый код, остальные записи —
 * новые уникальные коды по порядку id (год — из даты создания записи).
 */
export async function migrateCodes(force = false) {
  if (migrated && !force) return;
  // 1) системные ключи
  for (const [table, keys] of Object.entries(LEGACY_SYS_KEYS) as [CodedTable, string[]][]) {
    await db.execute(
      sql`update ${sql.identifier(table)} set sys_key = code where sys_key is null and code in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`,
    );
  }
  // 2) обозначения единиц измерения
  await db.execute(sql`update measure_units set symbol = code where (symbol is null or symbol = '') and code !~ '^[A-Z]{2}_[0-9]{4}_[0-9]{5}$'`);
  await db.execute(sql`update measure_units set symbol = name where (symbol is null or symbol = '')`);
  // 3) новые коды всем записям вне формата
  for (const table of Object.keys(CODE_PREFIXES) as CodedTable[]) {
    const bad = await db.execute(
      sql`select id, extract(year from created_at)::int as y from ${sql.identifier(table)} where code is null or code !~ '^[A-Z]{2}_[0-9]{4}_[0-9]{5}$' order by id`,
    );
    const counters = new Map<number, number>();
    for (const r of bad.rows as { id: number; y: number | null }[]) {
      const year = r.y ?? new Date().getFullYear();
      let n = counters.get(year);
      if (n === undefined) {
        const prefix = `${CODE_PREFIXES[table]}_${year}_`;
        const res = await db.execute(sql`select coalesce(max(substring(code from ${sql.raw(String(prefix.length + 1))})::int), 0) as n from ${sql.identifier(table)} where code ~ ${"^" + prefix + "[0-9]{5}$"}`);
        n = Number((res.rows[0] as { n: number | string }).n);
      }
      n += 1;
      counters.set(year, n);
      const code = `${CODE_PREFIXES[table]}_${year}_${String(n).padStart(5, "0")}`;
      await db.execute(sql`update ${sql.identifier(table)} set code = ${code} where id = ${r.id}`);
    }
    // уникальность кода на уровне БД (для таблиц, где индекса не было); пустой код допускается
    // временно — до присвоения (новые записи получают код в той же транзакции/запросе).
    await db.execute(sql`drop index if exists ${sql.identifier(`${table}_code_uniq_idx`)}`).catch(() => undefined);
    await db.execute(sql`create unique index if not exists ${sql.identifier(`${table}_code_uniq_pidx`)} on ${sql.identifier(table)} (code) where code <> ''`).catch(() => undefined);
  }
  migrated = true;
}
