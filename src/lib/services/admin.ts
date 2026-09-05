import { db, pool } from "@/db";
import { dbBackups } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { badRequest, notFound } from "@/lib/api";
import { migrateCodes } from "@/lib/codes";
import { ensureWarehouses, getCentralWarehouse } from "@/lib/services/warehouses";

/**
 * Администрирование БД: резервные копии (все таблицы, включая справочники),
 * восстановление, очистка несистемных данных «с чистого листа», обслуживание
 * (VACUUM / ANALYZE / REINDEX) и проверка/исправление целостности данных.
 *
 * Формат копии — gzip-JSON со всеми строками всех таблиц схемы public
 * (кроме журнала копий) и значениями последовательностей. Не зависит от pg_dump,
 * поэтому работает и в контейнере без клиентских утилит PostgreSQL.
 */

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "./backups");
const REGISTRY = "db_backups";
const BACKUP_VERSION = 2;

type Dump = {
  version: number;
  createdAt: string;
  app: string;
  tables: Record<string, { columns: string[]; rows: unknown[][] }>;
  sequences: Record<string, number>;
};

/** Уникальное имя файла копии: дата-время до миллисекунд + счётчик при совпадении. */
async function uniqueBackupName(suffix = "") {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const base = `backup_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}${suffix}`;
  for (let i = 0; ; i++) {
    const name = `${base}${i ? `_${i}` : ""}.json.gz`;
    try { await fs.access(path.join(BACKUP_DIR, name)); } catch { return name; }
  }
}

async function listTables(): Promise<string[]> {
  const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> ${REGISTRY} order by table_name`);
  return (res.rows as { table_name: string }[]).map((r) => r.table_name);
}

async function columnsOf(table: string): Promise<string[]> {
  const res = await db.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`);
  return (res.rows as { column_name: string }[]).map((r) => r.column_name);
}

/** Порядок таблиц по внешним ключам: родители раньше детей (для восстановления). */
async function topoOrder(tables: string[]): Promise<string[]> {
  const res = await db.execute(sql`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f' and n.nspname = 'public'`);
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t, new Set());
  for (const r of res.rows as { child: string; parent: string }[]) {
    const child = r.child.replace(/"/g, ""); const parent = r.parent.replace(/"/g, "");
    if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  }
  const out: string[] = []; const seen = new Set<string>();
  const visit = (t: string, stack: Set<string>) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const p of deps.get(t) ?? []) visit(p, stack);
    stack.delete(t); seen.add(t); out.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return out;
}

// ─────────────────────────── РЕЗЕРВНЫЕ КОПИИ ───────────────────────────

export async function createBackup(input: { reason?: string; note?: string | null; userId?: number }) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const tables = await listTables();
  const dump: Dump = { version: BACKUP_VERSION, createdAt: new Date().toISOString(), app: "skud-service-desk", tables: {}, sequences: {} };
  let rowsTotal = 0;
  for (const t of tables) {
    const columns = await columnsOf(t);
    const res = await pool.query({ text: `select ${columns.map((c) => `"${c}"`).join(", ")} from "${t}" order by 1`, rowMode: "array" });
    dump.tables[t] = { columns, rows: res.rows as unknown[][] };
    rowsTotal += res.rows.length;
  }
  const seqs = await db.execute(sql`select sequencename as name, coalesce(last_value, 0)::bigint as v from pg_sequences where schemaname = 'public'`);
  for (const r of seqs.rows as { name: string; v: string | number }[]) dump.sequences[r.name] = Number(r.v);

  const fileName = await uniqueBackupName();
  const buf = gzipSync(Buffer.from(JSON.stringify(dump)), { level: 6 });
  await fs.writeFile(path.join(BACKUP_DIR, fileName), buf);
  const [row] = await db.insert(dbBackups).values({ fileName, size: buf.length, tables: tables.length, rows: rowsTotal, reason: input.reason ?? "manual", note: input.note ?? null, createdBy: input.userId ?? null }).returning();
  return row;
}

export async function listBackups() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const rows = await db.select().from(dbBackups).orderBy(desc(dbBackups.createdAt));
  const files = new Set(await fs.readdir(BACKUP_DIR));
  // копии, положенные в каталог вручную (или после переноса), регистрируем
  for (const f of files) {
    if (!/^backup_.*\.json\.gz$/.test(f) || rows.some((r) => r.fileName === f)) continue;
    const st = await fs.stat(path.join(BACKUP_DIR, f));
    const [row] = await db.insert(dbBackups).values({ fileName: f, size: st.size, reason: "external", note: "Файл найден в каталоге копий", createdAt: st.mtime }).returning();
    rows.push(row);
  }
  return rows.map((r) => ({ ...r, exists: files.has(r.fileName) })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function backupFile(id: number) {
  const [row] = await db.select().from(dbBackups).where(eq(dbBackups.id, id));
  if (!row) throw notFound("Резервная копия не найдена");
  const full = path.join(BACKUP_DIR, path.basename(row.fileName));
  try {
    const data = await fs.readFile(full);
    return { row, data };
  } catch {
    throw notFound("Файл резервной копии отсутствует на диске");
  }
}

export async function deleteBackup(id: number) {
  const [row] = await db.select().from(dbBackups).where(eq(dbBackups.id, id));
  if (!row) throw notFound("Резервная копия не найдена");
  await fs.rm(path.join(BACKUP_DIR, path.basename(row.fileName)), { force: true });
  await db.delete(dbBackups).where(eq(dbBackups.id, id));
}

/** Загрузка копии из файла (upload): проверка формата и сохранение в каталог. */
export async function importBackupFile(data: Buffer, originalName: string, userId?: number) {
  let dump: Dump;
  try {
    const raw = originalName.endsWith(".gz") || (data[0] === 0x1f && data[1] === 0x8b) ? gunzipSync(data) : data;
    dump = JSON.parse(raw.toString("utf8")) as Dump;
  } catch {
    throw badRequest("Файл не является резервной копией системы (ожидается .json.gz)");
  }
  if (!dump?.tables || typeof dump.tables !== "object") throw badRequest("Некорректная структура резервной копии");
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const fileName = await uniqueBackupName("_uploaded");
  const buf = gzipSync(Buffer.from(JSON.stringify(dump)));
  await fs.writeFile(path.join(BACKUP_DIR, fileName), buf);
  const rows = Object.values(dump.tables).reduce((s, t) => s + t.rows.length, 0);
  const [row] = await db.insert(dbBackups).values({ fileName, size: buf.length, tables: Object.keys(dump.tables).length, rows, reason: "uploaded", note: `Загружен файл ${originalName}`, createdBy: userId ?? null }).returning();
  return row;
}

/**
 * Восстановление из копии: все таблицы очищаются и заполняются данными копии
 * в одной транзакции (родители раньше детей), последовательности выставляются.
 * Колонки, которых нет в текущей схеме, пропускаются; отсутствующие в копии — берут default.
 */
export async function restoreBackup(id: number, opts: { backupFirst: boolean; userId?: number }) {
  const { row, data } = await backupFile(id);
  const dump = JSON.parse(gunzipSync(data).toString("utf8")) as Dump;
  if (!dump.tables) throw badRequest("Некорректная резервная копия");
  let preBackup: { id: number; fileName: string } | null = null;
  if (opts.backupFirst) preBackup = await createBackup({ reason: "auto", note: `Перед восстановлением из ${row.fileName}`, userId: opts.userId });

  const current = await listTables();
  const order = await topoOrder(current);
  const client = await pool.connect();
  let restoredRows = 0;
  const skippedTables: string[] = [];
  try {
    await client.query("begin");
    await client.query(`truncate ${current.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
    for (const t of order) {
      const src = dump.tables[t];
      if (!src) { skippedTables.push(t); continue; }
      const cols = await columnsOf(t);
      const idx = src.columns.map((c, i) => (cols.includes(c) ? i : -1)).filter((i) => i >= 0);
      const names = idx.map((i) => `"${src.columns[i]}"`);
      if (!names.length || !src.rows.length) continue;
      const BATCH = 500;
      for (let off = 0; off < src.rows.length; off += BATCH) {
        const chunk = src.rows.slice(off, off + BATCH);
        const values: unknown[] = [];
        const tuples = chunk.map((r) => `(${idx.map((i) => { values.push(normalizeValue(r[i])); return `$${values.length}`; }).join(", ")})`);
        await client.query(`insert into "${t}" (${names.join(", ")}) values ${tuples.join(", ")}`, values);
        restoredRows += chunk.length;
      }
    }
    // последовательности
    for (const t of current) {
      await client.query(`select setval(pg_get_serial_sequence('"${t}"', 'id'), coalesce((select max(id) from "${t}"), 0) + 1, false)`).catch(() => undefined);
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw badRequest(`Восстановление отменено: ${(e as Error).message}`);
  } finally {
    client.release();
  }
  await migrateCodes(true).catch(() => undefined);
  return { restoredRows, tables: order.length - skippedTables.length, skippedTables, preBackup, source: row.fileName };
}

function normalizeValue(v: unknown) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v) && !Array.isArray(v)) return JSON.stringify(v);
  return v;
}

// ─────────────────────────── ОЧИСТКА ───────────────────────────

/**
 * Таблицы с оперативными данными: очищаются полностью, в порядке «дети раньше родителей».
 * Намеренно DELETE, а не TRUNCATE … CASCADE: каскад TRUNCATE зацепил бы users (FK на clients)
 * и warehouses (FK на teams), а DELETE отрабатывает ON DELETE SET NULL / CASCADE как задумано.
 */
const OPERATIONAL_TABLES = [
  "ticket_attachments", "ticket_comments", "ticket_materials", "ticket_works", "ticket_status_history",
  "stock_transactions", "stock_reservations", "stock_balances", "stock_document_lines", "stock_documents", "equipment_units",
  "tickets", "vehicle_assignments", "vehicles", "team_members", "teams", "sites", "catalog_items", "clients",
];
/** Справочники с системными записями: удаляются только несистемные строки. */
const DIRECTORY_TABLES = ["ticket_types", "ticket_priorities", "catalog_categories", "measure_units", "work_catalog", "warehouses", "roles"];

/**
 * «С чистого листа»: удаляет все оперативные данные и несистемные строки справочников.
 * Сотрудники сохраняются (keepUsers) либо остаются только администраторы — систему
 * нельзя оставить без входа. Файлы вложений удаляются с диска.
 */
export async function resetData(opts: { keepUsers: boolean; backupFirst: boolean; wipeDirectories?: boolean; userId?: number }) {
  let preBackup: { id: number; fileName: string } | null = null;
  if (opts.backupFirst) preBackup = await createBackup({ reason: "auto", note: "Перед очисткой базы данных", userId: opts.userId });
  const existing = new Set(await listTables());
  const client = await pool.connect();
  const removed: Record<string, number> = {};
  try {
    await client.query("begin");
    for (const t of OPERATIONAL_TABLES) {
      if (!existing.has(t)) continue;
      const c = await client.query(`select count(*)::int as n from "${t}"`);
      removed[t] = c.rows[0].n;
    }
    for (const t of OPERATIONAL_TABLES) {
      if (!existing.has(t)) continue;
      await client.query(`delete from "${t}"`);
      await client.query(`select setval(pg_get_serial_sequence('"${t}"', 'id'), 1, false)`).catch(() => undefined);
    }
    if (!opts.keepUsers) {
      const r = await client.query(`delete from users where role_id not in (select id from roles where sys_key = 'admin' or 'users.manage' = any(permissions)) returning id`);
      removed.users = r.rowCount ?? 0;
    }
    if (opts.wipeDirectories && existing.has("system_row_tombstones")) {
      // Полная очистка справочников, включая предустановленные (демонстрационные) записи.
      // Удалённые предустановленные ключи запоминаются, чтобы не вернуться при следующем старте.
      for (const t of ["ticket_types", "ticket_priorities", "catalog_categories"]) {
        if (!existing.has(t)) continue;
        await client.query(`insert into system_row_tombstones (table_name, sys_key) select '${t}', sys_key from "${t}" where sys_key is not null on conflict do nothing`);
        const r = await client.query(`delete from "${t}" returning id`);
        removed[t] = r.rowCount ?? 0;
      }
      if (existing.has("measure_units")) {
        await client.query(`insert into system_row_tombstones (table_name, sys_key) select 'measure_units', symbol from measure_units where is_system on conflict do nothing`);
        removed.measure_units = (await client.query(`delete from measure_units returning id`)).rowCount ?? 0;
      }
      if (existing.has("work_catalog")) removed.work_catalog = (await client.query(`delete from work_catalog returning id`)).rowCount ?? 0;
      if (existing.has("warehouses")) {
        await client.query(`insert into system_row_tombstones (table_name, sys_key) select 'warehouses', 'transit' from warehouses where kind = 'transit' on conflict do nothing`);
        removed.warehouses = (await client.query(`delete from warehouses where kind <> 'central' returning id`)).rowCount ?? 0;
      }
      if (existing.has("roles")) {
        await client.query(`insert into system_row_tombstones (table_name, sys_key) select 'roles', sys_key from roles where sys_key is not null and sys_key <> 'admin' and id not in (select role_id from users) on conflict do nothing`);
        removed.roles = (await client.query(`delete from roles where coalesce(sys_key, '') <> 'admin' and id not in (select role_id from users) returning id`)).rowCount ?? 0;
      }
    } else {
      for (const t of DIRECTORY_TABLES) {
        if (!existing.has(t)) continue;
        const r = t === "roles"
          ? await client.query(`delete from roles where is_system = false and id not in (select role_id from users) returning id`)
          : t === "warehouses"
            ? await client.query(`delete from warehouses where is_system = false or kind = 'team' returning id`)
            : await client.query(`delete from "${t}" where is_system = false returning id`);
        removed[t] = r.rowCount ?? 0;
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw badRequest(`Очистка отменена: ${(e as Error).message}`);
  } finally {
    client.release();
  }
  // вложения чата на диске
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  try {
    for (const f of await fs.readdir(uploadDir)) await fs.rm(path.join(uploadDir, f), { recursive: true, force: true });
  } catch { /* каталога может не быть */ }
  await ensureWarehouses(true);
  return { removed, preBackup };
}

// ─────────────────────────── ОБСЛУЖИВАНИЕ ───────────────────────────

export async function dbStats() {
  const size = await db.execute(sql`select pg_size_pretty(pg_database_size(current_database())) as size, current_database() as name, version() as version`);
  const tables = await db.execute(sql`
    select relname as table, n_live_tup::int as rows, n_dead_tup::int as dead, pg_size_pretty(pg_total_relation_size(relid)) as size,
      last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
    from pg_stat_user_tables where schemaname = 'public' order by relname`);
  const s = size.rows[0] as { size: string; name: string; version: string };
  return { size: s.size, name: s.name, version: s.version.split(" on ")[0], tables: tables.rows as { table: string; rows: number; dead: number; size: string; last_vacuum: Date | null; last_autovacuum: Date | null; last_analyze: Date | null; last_autoanalyze: Date | null }[] };
}

export async function maintenance(action: "vacuum" | "analyze" | "reindex") {
  const tables = await listTables();
  const started = Date.now();
  if (action === "vacuum") await pool.query("vacuum (analyze)");
  else if (action === "analyze") await pool.query("analyze");
  else for (const t of [...tables, REGISTRY]) await pool.query(`reindex table "${t}"`);
  return { action, tables: tables.length, ms: Date.now() - started };
}

// ─────────────────────────── ЦЕЛОСТНОСТЬ ───────────────────────────

export type IntegrityIssue = { key: string; title: string; count: number; severity: "error" | "warning" | "info"; fixable: boolean; fix?: string; sample?: string[] };

type Check = { key: string; title: string; severity: IntegrityIssue["severity"]; fix?: string; count: () => Promise<{ n: number; sample?: string[] }>; repair?: () => Promise<number> };

async function cnt(q: ReturnType<typeof sql>): Promise<number> {
  const r = await db.execute(q);
  return Number((r.rows[0] as { n: number | string })?.n ?? 0);
}

async function checks(): Promise<Check[]> {
  const central = await getCentralWarehouse();
  return [
    {
      key: "units_orphan_warehouse", title: "Серийные единицы на несуществующем складе", severity: "error", fix: "перенести на центральный склад",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from equipment_units u where u.location_type = 'warehouse' and (u.warehouse_id is null or not exists (select 1 from warehouses w where w.id = u.warehouse_id))`) }),
      repair: async () => { const r = await db.execute(sql`update equipment_units u set warehouse_id = ${central.id} where u.location_type = 'warehouse' and (u.warehouse_id is null or not exists (select 1 from warehouses w where w.id = u.warehouse_id))`); return r.rowCount ?? 0; },
    },
    {
      key: "units_status_mismatch", title: "Статус серийной единицы не соответствует месту хранения", severity: "error", fix: "выровнять статус по месту хранения",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from equipment_units where (status = 'in_warehouse' and location_type <> 'warehouse') or (status = 'at_team' and location_type <> 'team') or (status = 'installed' and location_type <> 'site')`) }),
      repair: async () => {
        const a = await db.execute(sql`update equipment_units set location_type = 'warehouse', team_id = null, warehouse_id = coalesce(warehouse_id, ${central.id}) where status = 'in_warehouse' and location_type <> 'warehouse'`);
        const b = await db.execute(sql`update equipment_units set location_type = 'team', warehouse_id = null where status = 'at_team' and location_type <> 'team' and team_id is not null`);
        const c = await db.execute(sql`update equipment_units set location_type = 'site', team_id = null, warehouse_id = null where status = 'installed' and location_type <> 'site'`);
        return (a.rowCount ?? 0) + (b.rowCount ?? 0) + (c.rowCount ?? 0);
      },
    },
    {
      key: "balances_orphan_location", title: "Остатки материалов в несуществующем месте хранения", severity: "error", fix: "перенести на центральный склад (нулевые — удалить)",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from stock_balances b where (b.location_type = 'warehouse' and not exists (select 1 from warehouses w where w.id = b.warehouse_id)) or (b.location_type = 'team' and not exists (select 1 from teams t where t.id = b.team_id))`) }),
      repair: async () => {
        const d = await db.execute(sql`delete from stock_balances b where b.quantity = 0 and ((b.location_type = 'warehouse' and not exists (select 1 from warehouses w where w.id = b.warehouse_id)) or (b.location_type = 'team' and not exists (select 1 from teams t where t.id = b.team_id)))`);
        const orphans = await db.execute(sql`select id, catalog_item_id, quantity from stock_balances b where (b.location_type = 'warehouse' and not exists (select 1 from warehouses w where w.id = b.warehouse_id)) or (b.location_type = 'team' and not exists (select 1 from teams t where t.id = b.team_id))`);
        let moved = 0;
        for (const o of orphans.rows as { id: number; catalog_item_id: number; quantity: string }[]) {
          await db.execute(sql`insert into stock_balances (catalog_item_id, location_type, team_id, warehouse_id, quantity) values (${o.catalog_item_id}, 'warehouse', 0, ${central.id}, ${o.quantity}) on conflict (catalog_item_id, location_type, team_id, warehouse_id) do update set quantity = stock_balances.quantity + excluded.quantity, updated_at = now()`);
          await db.execute(sql`delete from stock_balances where id = ${o.id}`);
          moved++;
        }
        return (d.rowCount ?? 0) + moved;
      },
    },
    {
      key: "negative_balances", title: "Отрицательные остатки материалов", severity: "warning",
      count: async () => {
        const r = await db.execute(sql`select ci.name || ': ' || b.quantity as s from stock_balances b join catalog_items ci on ci.id = b.catalog_item_id where b.quantity < 0 limit 5`);
        return { n: await cnt(sql`select count(*)::int as n from stock_balances where quantity < 0`), sample: (r.rows as { s: string }[]).map((x) => x.s) };
      },
    },
    {
      key: "stale_reservations", title: "Активные резервы по закрытым/отменённым заявкам", severity: "warning", fix: "снять резервы",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from stock_reservations r join tickets t on t.id = r.ticket_id where r.status = 'active' and t.status in ('closed','cancelled')`) }),
      repair: async () => {
        const rows = await db.execute(sql`select r.id, r.catalog_item_id, r.location_type, r.team_id, r.warehouse_id, r.quantity from stock_reservations r join tickets t on t.id = r.ticket_id where r.status = 'active' and t.status in ('closed','cancelled')`);
        for (const r of rows.rows as { id: number; catalog_item_id: number; location_type: string; team_id: number; warehouse_id: number; quantity: string }[]) {
          await db.execute(sql`insert into stock_balances (catalog_item_id, location_type, team_id, warehouse_id, quantity) values (${r.catalog_item_id}, ${r.location_type}::location_type, ${r.team_id}, ${r.warehouse_id}, ${r.quantity}) on conflict (catalog_item_id, location_type, team_id, warehouse_id) do update set quantity = stock_balances.quantity + excluded.quantity, updated_at = now()`);
          await db.execute(sql`update stock_reservations set status = 'cancelled' where id = ${r.id}`);
        }
        const u = await db.execute(sql`update equipment_units u set status = 'at_team', ticket_id = null from tickets t where u.ticket_id = t.id and u.status = 'reserved' and t.status in ('closed','cancelled') and u.location_type = 'team'`);
        const w = await db.execute(sql`update equipment_units u set status = 'in_warehouse', ticket_id = null from tickets t where u.ticket_id = t.id and u.status = 'reserved' and t.status in ('closed','cancelled') and u.location_type = 'warehouse'`);
        return rows.rows.length + (u.rowCount ?? 0) + (w.rowCount ?? 0);
      },
    },
    {
      key: "orphan_tx_refs", title: "Складские операции со ссылками на удалённые документы/заявки", severity: "info", fix: "обнулить ссылки",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from stock_transactions x where (x.document_id is not null and not exists (select 1 from stock_documents d where d.id = x.document_id)) or (x.ticket_id is not null and not exists (select 1 from tickets t where t.id = x.ticket_id))`) }),
      repair: async () => {
        const a = await db.execute(sql`update stock_transactions x set document_id = null where x.document_id is not null and not exists (select 1 from stock_documents d where d.id = x.document_id)`);
        const b = await db.execute(sql`update stock_transactions x set ticket_id = null where x.ticket_id is not null and not exists (select 1 from tickets t where t.id = x.ticket_id)`);
        return (a.rowCount ?? 0) + (b.rowCount ?? 0);
      },
    },
    {
      key: "orphan_attachments", title: "Вложения без заявки", severity: "warning", fix: "удалить записи",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from ticket_attachments a where not exists (select 1 from tickets t where t.id = a.ticket_id)`) }),
      repair: async () => { const r = await db.execute(sql`delete from ticket_attachments a where not exists (select 1 from tickets t where t.id = a.ticket_id)`); return r.rowCount ?? 0; },
    },
    {
      key: "doc_counters", title: "Счётчики документов (строк/количество) расходятся со строками", severity: "warning", fix: "пересчитать",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from stock_documents d where d.lines_count <> (select count(*) from stock_document_lines l where l.document_id = d.id) or d.total_quantity <> (select coalesce(sum(quantity),0) from stock_document_lines l where l.document_id = d.id)`) }),
      repair: async () => { const r = await db.execute(sql`update stock_documents d set lines_count = s.n, total_quantity = s.q from (select document_id, count(*) as n, coalesce(sum(quantity),0) as q from stock_document_lines group by document_id) s where s.document_id = d.id and (d.lines_count <> s.n or d.total_quantity <> s.q)`); return r.rowCount ?? 0; },
    },
    {
      key: "tickets_no_number", title: "Заявки без номера", severity: "warning", fix: "присвоить номера",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from tickets where number is null or number = ''`) }),
      repair: async () => { const r = await db.execute(sql`update tickets set number = 'ЗК-' || extract(year from created_at)::int || '-' || lpad(id::text, 5, '0') where number is null or number = ''`); return r.rowCount ?? 0; },
    },
    {
      key: "missing_units", title: "Единицы измерения товаров/работ, отсутствующие в справочнике", severity: "warning", fix: "создать недостающие единицы",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from (select distinct unit from catalog_items union select distinct unit from work_catalog) u where not exists (select 1 from measure_units m where m.symbol = u.unit)`) }),
      repair: async () => {
        const rows = await db.execute(sql`select distinct unit from (select unit from catalog_items union select unit from work_catalog) u where not exists (select 1 from measure_units m where m.symbol = u.unit)`);
        const { nextCode } = await import("@/lib/codes");
        for (const r of rows.rows as { unit: string }[]) await db.execute(sql`insert into measure_units (code, symbol, name, sort_order) values (${await nextCode("measure_units")}, ${r.unit}, ${r.unit}, 500)`);
        return rows.rows.length;
      },
    },
    {
      key: "bad_codes", title: "Коды справочников вне формата XX_ГГГГ_NNNNN или дубликаты", severity: "warning", fix: "перекодировать",
      count: async () => {
        const tables = ["roles", "ticket_types", "ticket_priorities", "catalog_categories", "measure_units", "work_catalog", "warehouses", "catalog_items", "clients", "sites", "teams", "vehicles", "users"];
        let n = 0;
        for (const t of tables) {
          n += await cnt(sql`select count(*)::int as n from ${sql.identifier(t)} where code is null or code !~ '^[A-Z]{2}_[0-9]{4}_[0-9]{5}$'`);
          n += await cnt(sql`select coalesce(sum(c) - count(*), 0)::int as n from (select count(*) as c from ${sql.identifier(t)} group by code having count(*) > 1) d`);
        }
        return { n };
      },
      repair: async () => {
        const tables = ["roles", "ticket_types", "ticket_priorities", "catalog_categories", "measure_units", "work_catalog", "warehouses", "catalog_items", "clients", "sites", "teams", "vehicles", "users"];
        let n = 0;
        for (const t of tables) {
          const r = await db.execute(sql`update ${sql.identifier(t)} set code = '' where id in (select id from (select id, row_number() over (partition by code order by id) rn from ${sql.identifier(t)}) d where rn > 1)`);
          n += r.rowCount ?? 0;
        }
        await migrateCodes(true);
        return n;
      },
    },
    {
      key: "missing_team_warehouses", title: "Бригады без склада бригады", severity: "warning", fix: "создать склады",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from teams t where not exists (select 1 from warehouses w where w.team_id = t.id)`) }),
      repair: async () => { const n = await cnt(sql`select count(*)::int as n from teams t where not exists (select 1 from warehouses w where w.team_id = t.id)`); await ensureWarehouses(true); return n; },
    },
    {
      key: "users_inactive_role", title: "Активные сотрудники с отключённой ролью", severity: "info",
      count: async () => ({ n: await cnt(sql`select count(*)::int as n from users u join roles r on r.id = u.role_id where u.is_active and not r.is_active`) }),
    },
    {
      key: "no_admin", title: "Нет активного пользователя с правом управления сотрудниками", severity: "error",
      count: async () => ({ n: (await cnt(sql`select count(*)::int as n from users u join roles r on r.id = u.role_id where u.is_active and r.is_active and 'users.manage' = any(r.permissions)`)) > 0 ? 0 : 1 }),
    },
  ];
}

export async function integrityCheck(): Promise<{ issues: IntegrityIssue[]; ok: boolean; checkedAt: Date }> {
  const list = await checks();
  const issues: IntegrityIssue[] = [];
  for (const c of list) {
    const { n, sample } = await c.count();
    issues.push({ key: c.key, title: c.title, count: n, severity: c.severity, fixable: Boolean(c.repair), fix: c.fix, sample });
  }
  return { issues, ok: issues.every((i) => i.count === 0), checkedAt: new Date() };
}

export async function integrityRepair(opts: { backupFirst: boolean; userId?: number }) {
  let preBackup: { id: number; fileName: string } | null = null;
  if (opts.backupFirst) preBackup = await createBackup({ reason: "auto", note: "Перед исправлением целостности", userId: opts.userId });
  const list = await checks();
  const fixed: { key: string; title: string; fixed: number }[] = [];
  for (const c of list) {
    if (!c.repair) continue;
    const { n } = await c.count();
    if (!n) continue;
    fixed.push({ key: c.key, title: c.title, fixed: await c.repair() });
  }
  const after = await integrityCheck();
  return { fixed, after, preBackup };
}
