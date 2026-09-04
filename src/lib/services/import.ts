import { db } from "@/db";
import {
  catalogCategories, catalogItems, measureUnits, ticketTypes, ticketPriorities, clients, sites, workCatalog, warehouses,
  roles, teams, vehicles, users,
} from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { badRequest } from "@/lib/api";
import { buildCsv, csvNum, type CsvCell } from "@/lib/csv";
import { isValidCode, nextCode, normalizeCode, resolveCode, type CodedTable } from "@/lib/codes";
import { ALL_PERMISSIONS, isPermission, type Permission } from "@/lib/rbac";
import { hashPassword } from "@/lib/auth";
import { ensureWarehouses } from "@/lib/services/warehouses";

/**
 * Импорт и экспорт справочников в CSV.
 *
 * Клиент разбирает CSV (кодировка, разделитель) и присылает массив строк «колонка → значение».
 * Сервер сопоставляет колонки по шаблону (алиасы русских/английских заголовков).
 *
 * Ключ сопоставления — уникальный код справочника (XX_ГГГГ_NNNNN): если код из файла
 * совпал с существующей записью, она перезаписывается; новая запись не создаётся.
 * Без кода (или с незнакомым кодом) используются вторичные ключи (код 1С, артикул,
 * ИНН, обозначение, имя), а затем запись создаётся — с кодом из файла, если он
 * корректен и свободен, иначе с новым сгенерированным.
 *
 * Экспорт выдаёт CSV с теми же колонками, что и шаблон, — файл можно править и загружать обратно.
 */

export type ImportField = { key: string; label: string; required?: boolean; aliases: string[]; hint?: string };
export type ImportTemplate = {
  entity: string;
  title: string;
  description: string;
  fields: ImportField[];
  sample: string[][];
  /** Таблица кодов (для генерации/проверки формата). */
  table?: CodedTable;
  /** Требуемое право на экспорт цен (колонка «Цена» скрывается без него). */
  priceField?: string;
};

const F = (key: string, label: string, aliases: string[], required = false, hint?: string): ImportField => ({ key, label, aliases, required, hint });
const CODE = F("code", "Код", ["код", "code", "уникальныйкод", "код записи"], false, "XX_ГГГГ_NNNNN — ключ сопоставления; пусто → новая запись");

export const IMPORT_TEMPLATES: Record<string, ImportTemplate> = {
  catalog: {
    entity: "catalog",
    table: "catalog_items",
    priceField: "price",
    title: "Товары (номенклатура)",
    description: "Иерархический список: элементы и группы (1С:Торговля и Склад 7.7). Группы создаются как папки категорий. Артикул не обязателен — берётся из таблицы или генерируется.",
    fields: [
      CODE,
      F("externalCode", "Код 1С", ["код1с", "внешнийкод", "id", "код 1с"], false, "вторичный ключ для повторного импорта"),
      F("name", "Наименование", ["наименование", "название", "name", "номенклатура", "товар"], true),
      F("fullName", "Полное наименование", ["полноенаименование", "полное наименование", "fullname"]),
      F("sku", "Артикул", ["артикул", "sku", "art", "арт"]),
      F("group", "Группа (путь)", ["группа", "родитель", "папка", "категория", "group", "parent", "категория/группа"], false, "путь через / или имя родителя"),
      F("isGroup", "Это группа", ["этогруппа", "это группа", "группа?", "isgroup", "папка?"], false, "1/да — строка описывает группу"),
      F("unit", "Ед. изм.", ["ед", "ед.", "единица", "единицаизмерения", "базоваяединица", "unit", "ед. изм.", "едизм"]),
      F("manufacturer", "Производитель", ["производитель", "изготовитель", "бренд", "manufacturer", "vendor"]),
      F("isSerialized", "Серийный учёт", ["серийный", "серийныйучет", "серийный учёт", "s/n", "serialized"], false, "1/да"),
      F("description", "Описание", ["описание", "комментарий", "description", "примечание"]),
      F("price", "Цена", ["цена", "price", "стоимость"], false, "только при праве изменять цены"),
      F("isActive", "Активна", ["активна", "активен", "active", "isactive"], false, "1/0"),
      F("quantity", "Остаток", ["остаток", "количество", "кол-во", "quantity", "qty"], false, "если задан склад — приходуется поступлением"),
    ],
    sample: [
      ["Код", "Код 1С", "Наименование", "Артикул", "Группа", "Ед. изм.", "Производитель", "Серийный учёт", "Цена", "Активна", "Остаток"],
      ["", "00001", "Кабель UTP cat.5e", "CBL-UTP5E", "Кабель/UTP", "м", "", "0", "38,50", "1", "610"],
      ["", "00002", "IP-камера DS-2CD2043G2-I", "", "Видеонаблюдение/Камеры", "шт", "Hikvision", "1", "14900", "1", "0"],
    ],
  },
  categories: {
    entity: "categories",
    table: "catalog_categories",
    title: "Категории (группы товаров)",
    description: "Папки номенклатуры. Родитель задаётся именем или путём.",
    fields: [CODE, F("name", "Название", ["наименование", "название", "name"], true), F("group", "Родитель", ["родитель", "группа", "parent", "путь"]), F("isActive", "Активна", ["активна", "active"])],
    sample: [["Код", "Название", "Родитель", "Активна"], ["", "Кабель", "", "1"], ["", "UTP", "Кабель", "1"]],
  },
  "measure-units": {
    entity: "measure-units",
    table: "measure_units",
    title: "Единицы измерения",
    description: "Обозначение — как показывается в интерфейсе (шт, м, компл); оно уникально.",
    fields: [CODE, F("symbol", "Обозначение", ["обозначение", "сокращение", "краткое", "symbol", "ед"], true), F("name", "Название", ["наименование", "название", "name", "полное"], true), F("isActive", "Активна", ["активна", "active"])],
    sample: [["Код", "Обозначение", "Название", "Активна"], ["", "шт", "Штука", "1"], ["", "м", "Метр", "1"]],
  },
  "ticket-types": {
    entity: "ticket-types",
    table: "ticket_types",
    title: "Типы работ",
    description: "Виды заявок: монтаж, ТО, ремонт…",
    fields: [CODE, F("name", "Название", ["наименование", "название", "name"], true), F("sortOrder", "Порядок", ["порядок", "sort", "sortorder"]), F("isActive", "Активна", ["активна", "active"])],
    sample: [["Код", "Название", "Порядок", "Активна"], ["", "Монтаж", "10", "1"]],
  },
  priorities: {
    entity: "priorities",
    table: "ticket_priorities",
    title: "Приоритеты и SLA",
    description: "SLA в часах.",
    fields: [CODE, F("name", "Название", ["наименование", "название", "name"], true), F("slaHours", "SLA, часов", ["sla", "часы", "срок", "slahours"]), F("sortOrder", "Порядок", ["порядок", "sort"]), F("isActive", "Активна", ["активна", "active"])],
    sample: [["Код", "Название", "SLA, часов", "Порядок", "Активна"], ["", "Высокий", "24", "30", "1"]],
  },
  works: {
    entity: "works",
    table: "work_catalog",
    title: "Справочник работ (услуги)",
    description: "Наименование, единица, цена, норматив времени.",
    fields: [
      CODE,
      F("externalCode", "Код 1С", ["код1с", "внешнийкод", "код 1с"]),
      F("name", "Наименование", ["наименование", "название", "name", "услуга", "работа"], true),
      F("unit", "Ед. изм.", ["ед", "ед.", "единица", "unit", "ед. изм."]),
      F("defaultMinutes", "Норматив, мин", ["норматив", "минуты", "время", "minutes", "длительность"]),
      F("price", "Цена", ["цена", "price", "стоимость"]),
      F("isActive", "Активна", ["активна", "active"]),
    ],
    sample: [["Код", "Код 1С", "Наименование", "Ед. изм.", "Норматив, мин", "Цена", "Активна"], ["", "У-001", "Монтаж камеры", "шт", "60", "1500", "1"]],
  },
  clients: {
    entity: "clients",
    table: "clients",
    title: "Клиенты (контрагенты)",
    description: "Ключ сопоставления — код, затем ИНН, затем название.",
    fields: [
      CODE,
      F("name", "Название", ["наименование", "название", "name", "контрагент", "клиент"], true),
      F("inn", "ИНН", ["инн", "inn"]),
      F("contactPerson", "Контактное лицо", ["контакт", "контактноелицо", "контактное лицо", "contact"]),
      F("phone", "Телефон", ["телефон", "phone", "тел"]),
      F("email", "Email", ["email", "e-mail", "почта"]),
      F("notes", "Примечание", ["примечание", "комментарий", "notes"]),
      F("isActive", "Активен", ["активен", "активна", "active"]),
    ],
    sample: [["Код", "Название", "ИНН", "Контактное лицо", "Телефон", "Email", "Примечание", "Активен"], ["", "ООО «Пример»", "7800000000", "Иванов И.И.", "+7 812 000-00-00", "info@example.ru", "", "1"]],
  },
  sites: {
    entity: "sites",
    table: "sites",
    title: "Справочник объектов",
    description: "Объекты обслуживания с привязкой к клиенту (по коду клиента, названию или ИНН). Клиент создаётся, если не найден.",
    fields: [
      CODE,
      F("client", "Клиент", ["клиент", "контрагент", "заказчик", "client", "владелец"], true),
      F("clientCode", "Код клиента", ["кодклиента", "код клиента", "clientcode"]),
      F("clientInn", "ИНН клиента", ["инн", "иннклиента", "inn"]),
      F("name", "Название объекта", ["объект", "наименование", "название", "name", "site"], true),
      F("address", "Адрес", ["адрес", "address"], true),
      F("contactPerson", "Контактное лицо", ["контакт", "контактноелицо", "контактное лицо", "contact"]),
      F("contactPhone", "Телефон", ["телефон", "phone", "тел"]),
      F("notes", "Примечание", ["примечание", "комментарий", "notes"]),
      F("isActive", "Активен", ["активен", "активна", "active"]),
    ],
    sample: [["Код", "Клиент", "Код клиента", "ИНН клиента", "Название объекта", "Адрес", "Контактное лицо", "Телефон", "Примечание", "Активен"], ["", "ООО «Пример»", "", "7800000000", "Офис на Невском", "СПб, Невский пр., 1", "", "+7 812 000-00-00", "", "1"]],
  },
  warehouses: {
    entity: "warehouses",
    table: "warehouses",
    title: "Склады",
    description: "Дополнительные склады. Вид — «transit» или «other»; центральный и склады бригад создаются системой.",
    fields: [CODE, F("name", "Название", ["наименование", "название", "name", "склад"], true), F("address", "Адрес", ["адрес", "address"]), F("kind", "Вид", ["вид", "тип", "kind"]), F("isActive", "Активен", ["активен", "активна", "active"])],
    sample: [["Код", "Название", "Адрес", "Вид", "Активен"], ["", "Склад №2", "СПб, ул. Складская, 1", "other", "1"]],
  },
  roles: {
    entity: "roles",
    table: "roles",
    title: "Роли и права",
    description: "Права перечисляются через запятую кодами (например tickets.read.all, chat.write). Область: all / team / client.",
    fields: [
      CODE,
      F("name", "Название", ["наименование", "название", "name", "роль"], true),
      F("description", "Описание", ["описание", "description"]),
      F("scope", "Область данных", ["область", "scope", "область данных"]),
      F("isFieldStaff", "Полевой сотрудник", ["полевой", "монтажник", "fieldstaff", "полевой сотрудник"]),
      F("permissions", "Права", ["права", "permissions", "разрешения"]),
      F("sortOrder", "Порядок", ["порядок", "sort"]),
      F("isActive", "Активна", ["активна", "active"]),
    ],
    sample: [["Код", "Название", "Описание", "Область данных", "Полевой сотрудник", "Права", "Порядок", "Активна"], ["", "Старший монтажник", "", "team", "1", "tickets.read.own, tickets.work, chat.write, inventory.read.team", "35", "1"]],
  },
  teams: {
    entity: "teams",
    table: "teams",
    title: "Бригады",
    description: "Названия и описания бригад; склад бригады создаётся автоматически.",
    fields: [CODE, F("name", "Название", ["наименование", "название", "name", "бригада"], true), F("description", "Описание", ["описание", "description"]), F("isActive", "Активна", ["активна", "active"])],
    sample: [["Код", "Название", "Описание", "Активна"], ["", "Бригада №3", "Юг города", "1"]],
  },
  vehicles: {
    entity: "vehicles",
    table: "vehicles",
    title: "Автопарк",
    description: "Ключ сопоставления — код, затем госномер.",
    fields: [CODE, F("plateNumber", "Госномер", ["госномер", "номер", "plate", "platenumber"], true), F("model", "Модель", ["модель", "model", "марка"], true), F("year", "Год", ["год", "year"]), F("notes", "Примечание", ["примечание", "notes"]), F("isActive", "Активен", ["активен", "active"])],
    sample: [["Код", "Госномер", "Модель", "Год", "Примечание", "Активен"], ["", "А123ВС178", "ГАЗель Next", "2021", "", "1"]],
  },
  employees: {
    entity: "employees",
    table: "users",
    title: "Сотрудники",
    description: "Ключ сопоставления — код, затем email. Роль — по названию или коду роли. Для новых сотрудников нужен пароль (колонка «Пароль»); при экспорте пароли не выгружаются.",
    fields: [
      CODE,
      F("email", "Email (логин)", ["email", "e-mail", "логин", "почта"], true),
      F("fullName", "ФИО", ["фио", "имя", "сотрудник", "fullname", "name"], true),
      F("phone", "Телефон", ["телефон", "phone"]),
      F("role", "Роль", ["роль", "role"], true),
      F("client", "Клиент (для роли клиента)", ["клиент", "client", "кодклиента"]),
      F("password", "Пароль", ["пароль", "password"], false, "только для новых записей"),
      F("isActive", "Активен", ["активен", "active"]),
    ],
    sample: [["Код", "Email (логин)", "ФИО", "Телефон", "Роль", "Клиент (для роли клиента)", "Пароль", "Активен"], ["", "tech5@fsm.local", "Иванов Иван", "+7 921 000-00-00", "Монтажник", "", "password", "1"]],
  },
};

export type ImportResult = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[]; total: number; extra?: Record<string, number> };

const norm = (s: string) => s.toLowerCase().replace(/[\s_"'«».\-]/g, "").replace(/ё/g, "е");
const yes = (v?: string) => /^(1|да|true|yes|истина|y|д|\+)$/i.test((v ?? "").trim());
const num = (v?: string) => {
  if (!v) return null;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
/** Флаг активности: колонка не сопоставлена или пустая → не трогаем. */
const flag = (v: string | undefined, mapped: boolean): boolean | undefined => (!mapped || !v?.trim() ? undefined : yes(v));

/** Автосопоставление колонок файла с полями шаблона. */
export function autoMapping(template: ImportTemplate, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of template.fields) {
    const hit = headers.find((h) => f.aliases.map(norm).includes(norm(h)) || norm(h) === norm(f.label) || norm(h) === norm(f.key));
    if (hit) map[f.key] = hit;
  }
  return map;
}

function pick(row: Record<string, string>, mapping: Record<string, string>, key: string): string {
  const col = mapping[key];
  if (!col) return "";
  return (row[col] ?? "").trim();
}

/** Транслит для автогенерации коротких имён/артикулов из русских названий. */
export function slugify(s: string, fallback = "item") {
  const t: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const out = s
    .toLowerCase()
    .split("")
    .map((ch) => t[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  const res = /^[a-z]/.test(out) ? out : `x_${out}`;
  return res.length > 1 ? res : fallback;
}

/** Уникальный артикул для позиции без артикула. */
export async function generateSku(hint?: string | null) {
  const base = hint ? `1C-${hint.replace(/\s+/g, "")}` : `N-${Date.now().toString(36).toUpperCase()}`;
  let sku = base.slice(0, 50);
  for (let i = 1; i < 1000; i++) {
    const [dup] = await db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.sku, sku));
    if (!dup) return sku;
    sku = `${base.slice(0, 44)}-${i}`;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────── папки категорий ───────────────

type CatRow = typeof catalogCategories.$inferSelect;

class CategoryResolver {
  private cache = new Map<string, number>(); // "parentId|normName" → id
  private rows: CatRow[] = [];
  async load() {
    this.rows = await db.select().from(catalogCategories);
    for (const r of this.rows) this.cache.set(`${r.parentId ?? 0}|${norm(r.name)}`, r.id);
  }
  byCode(code: string) {
    const c = normalizeCode(code);
    return this.rows.find((r) => r.code === c);
  }
  /** Путь «Кабель/UTP» → id самой вложенной папки; создаёт недостающие. */
  async resolvePath(pathStr: string, externalCode?: string | null): Promise<number | null> {
    const parts = pathStr.split(/[\/\\>|]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return null;
    let parentId: number | null = null;
    for (const part of parts) {
      const key = `${parentId ?? 0}|${norm(part)}`;
      let id: number | undefined = this.cache.get(key);
      if (!id) {
        // одноимённая папка в другом месте? — если родитель не задан, используем существующую
        const anywhere: CatRow | undefined = parentId === null ? this.rows.find((r) => norm(r.name) === norm(part)) : undefined;
        if (anywhere) id = anywhere.id;
        else {
          const code = await nextCode("catalog_categories");
          const inserted: CatRow[] = await db.insert(catalogCategories).values({ code, name: part, parentId, externalCode: externalCode ?? null, sortOrder: 500 }).returning();
          const row: CatRow = inserted[0];
          this.rows.push(row);
          id = row.id;
          this.cache.set(key, row.id);
        }
      }
      parentId = id ?? null;
    }
    return parentId;
  }
  /** Группа по коду 1С (когда файл содержит колонку «Родитель» = код). */
  byExternal(code: string) {
    return this.rows.find((r) => r.externalCode && r.externalCode === code)?.id ?? null;
  }
  async defaultId() {
    const other = this.rows.find((r) => r.sysKey === "other") ?? this.rows[0];
    if (other) return other.id;
    const [row] = await db.insert(catalogCategories).values({ code: await nextCode("catalog_categories"), sysKey: "other", name: "Другое", isSystem: true, sortOrder: 999 }).returning();
    this.rows.push(row);
    return row.id;
  }
}

/** Обозначение единицы измерения: создаёт недостающую единицу. */
async function ensureUnit(symbolIn: string) {
  const symbol = symbolIn.trim();
  if (!symbol) return "шт";
  const [u] = await db.select({ symbol: measureUnits.symbol }).from(measureUnits).where(eq(measureUnits.symbol, symbol));
  if (u) return u.symbol;
  await db.insert(measureUnits).values({ code: await nextCode("measure_units"), symbol, name: symbol, sortOrder: 500 });
  return symbol;
}

// ─────────────── импортёры ───────────────

export type ImportContext = { actorId: number; canPrices: boolean };

export async function runImport(entity: string, rows: Record<string, string>[], mappingIn?: Record<string, string>, options: Record<string, string | number | boolean> = {}, ctx: ImportContext = { actorId: 0, canPrices: false }): Promise<ImportResult> {
  const tpl = IMPORT_TEMPLATES[entity];
  if (!tpl) throw badRequest(`Неизвестный шаблон импорта «${entity}»`);
  const actorId = ctx.actorId;
  // Заголовки — объединение ключей первых строк (в неполных строках часть колонок может отсутствовать).
  const headers = [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)))];
  const mapping = { ...autoMapping(tpl, headers), ...(mappingIn ?? {}) };
  for (const f of tpl.fields) if (f.required && !mapping[f.key]) throw badRequest(`Не сопоставлена обязательная колонка «${f.label}»`);
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [], total: rows.length };
  const fail = (i: number, message: string) => {
    if (res.errors.length < 200) res.errors.push({ row: i + 2, message });
    res.skipped++;
  };
  const g = (row: Record<string, string>, key: string) => pick(row, mapping, key);
  const codeOf = (row: Record<string, string>) => {
    const c = g(row, "code");
    return c && tpl.table && isValidCode(c, tpl.table) ? normalizeCode(c) : null;
  };
  const active = (row: Record<string, string>) => flag(g(row, "isActive"), Boolean(mapping.isActive));
  const sort = (row: Record<string, string>) => (mapping.sortOrder ? num(g(row, "sortOrder")) : null);

  switch (entity) {
    case "catalog": {
      const cats = new CategoryResolver();
      await cats.load();
      const defaultCat = options.categoryId ? Number(options.categoryId) : null;
      const whId = options.warehouseId ? Number(options.warehouseId) : null;
      const receiptLines: { catalogItemId: number; quantity: number }[] = [];
      // 1) сначала строки-группы — чтобы элементы нашли родителей по коду
      const groupRows = rows.map((r, i) => ({ r, i })).filter(({ r }) => yes(g(r, "isGroup")));
      const groupByCode = new Map<string, number>();
      for (const { r } of groupRows) {
        const parent = g(r, "group");
        const path = parent ? `${parent}/${g(r, "name")}` : g(r, "name");
        const id = await cats.resolvePath(path, g(r, "externalCode") || null);
        if (id && g(r, "externalCode")) groupByCode.set(g(r, "externalCode"), id);
      }
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (yes(g(r, "isGroup"))) { res.updated++; continue; }
        const name = g(r, "name");
        if (!name) { fail(i, "пустое наименование"); continue; }
        try {
          const code = codeOf(r);
          const ext = g(r, "externalCode") || null;
          let sku = g(r, "sku") || null;
          const groupStr = g(r, "group");
          let categoryId: number | null = null;
          if (groupStr) categoryId = groupByCode.get(groupStr) ?? cats.byCode(groupStr)?.id ?? cats.byExternal(groupStr) ?? (await cats.resolvePath(groupStr));
          if (!categoryId) categoryId = defaultCat ?? (await cats.defaultId());
          const unit = await ensureUnit(g(r, "unit") || "шт");
          const isActive = active(r);
          const price = mapping.price && ctx.canPrices ? num(g(r, "price")) : undefined;
          const patch = {
            name,
            fullName: g(r, "fullName") || null,
            categoryId,
            unit,
            manufacturer: g(r, "manufacturer") || null,
            description: g(r, "description") || null,
            externalCode: ext,
            ...(isActive !== undefined ? { isActive } : {}),
            ...(price !== undefined ? { price: price != null ? String(price) : null, priceUpdatedAt: new Date() } : {}),
          };
          const serialized = mapping.isSerialized ? yes(g(r, "isSerialized")) : undefined;
          // поиск существующей: по коду → по коду 1С → по артикулу → по имени
          let existing = code ? (await db.select().from(catalogItems).where(eq(catalogItems.code, code)))[0] : undefined;
          if (!existing && ext) existing = (await db.select().from(catalogItems).where(eq(catalogItems.externalCode, ext)))[0];
          if (!existing && sku) existing = (await db.select().from(catalogItems).where(eq(catalogItems.sku, sku)))[0];
          if (!existing && !code && !ext && !sku) existing = (await db.select().from(catalogItems).where(eq(catalogItems.name, name)))[0];
          let itemId: number;
          if (existing) {
            await db.update(catalogItems).set({ ...patch, ...(sku && sku !== existing.sku ? { sku } : {}), ...(serialized !== undefined ? { isSerialized: serialized } : {}) }).where(eq(catalogItems.id, existing.id));
            itemId = existing.id;
            res.updated++;
          } else {
            if (!sku) sku = await generateSku(ext);
            else {
              const [dup] = await db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.sku, sku));
              if (dup) sku = await generateSku(sku);
            }
            const [row] = await db.insert(catalogItems).values({ ...patch, sku, code: await resolveCode("catalog_items", code), isSerialized: serialized ?? false }).returning();
            itemId = row.id;
            res.created++;
          }
          const qty = num(g(r, "quantity"));
          if (whId && qty && qty > 0 && !serialized) receiptLines.push({ catalogItemId: itemId, quantity: qty });
        } catch (e) {
          fail(i, (e as Error).message);
        }
      }
      if (whId && receiptLines.length && actorId) {
        const { receiveDocument } = await import("@/lib/services/inventory");
        const doc = await receiveDocument({ toWarehouseId: whId, note: "Импорт остатков из 1С", supplier: "Импорт CSV", actorId, lines: receiptLines });
        res.extra = { receiptDocumentId: doc.document.id, receiptLines: receiptLines.length };
      }
      return res;
    }
    case "categories": {
      const cats = new CategoryResolver();
      await cats.load();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        try {
          const code = codeOf(r);
          const parent = g(r, "group");
          const parentId = parent ? (cats.byCode(parent)?.id ?? (await cats.resolvePath(parent))) : null;
          const ex = code ? cats.byCode(code) : undefined;
          const isActive = active(r);
          if (ex) {
            await db.update(catalogCategories).set({ name, parentId: parentId === ex.id ? ex.parentId : parentId, ...(isActive !== undefined ? { isActive } : {}) }).where(eq(catalogCategories.id, ex.id));
            res.updated++;
          } else {
            const before = new Set((await db.select({ id: catalogCategories.id }).from(catalogCategories)).map((x) => x.id));
            const id = await cats.resolvePath(parent ? `${parent}/${name}` : name);
            if (id && !before.has(id)) {
              if (code) await db.update(catalogCategories).set({ code }).where(eq(catalogCategories.id, id));
              res.created++;
            } else if (id) {
              if (isActive !== undefined) await db.update(catalogCategories).set({ isActive }).where(eq(catalogCategories.id, id));
              res.updated++;
            }
          }
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
    case "measure-units": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const symbol = g(r, "symbol"); const name = g(r, "name") || symbol;
        if (!symbol) { fail(i, "пустое обозначение"); continue; }
        try {
          const code = codeOf(r);
          const isActive = active(r);
          let ex = code ? (await db.select().from(measureUnits).where(eq(measureUnits.code, code)))[0] : undefined;
          if (!ex) ex = (await db.select().from(measureUnits).where(eq(measureUnits.symbol, symbol)))[0];
          if (ex) {
            if (ex.symbol !== symbol) {
              const [dup] = await db.select({ id: measureUnits.id }).from(measureUnits).where(eq(measureUnits.symbol, symbol));
              if (dup) throw new Error(`обозначение «${symbol}» уже занято другой единицей`);
              await db.update(catalogItems).set({ unit: symbol }).where(eq(catalogItems.unit, ex.symbol));
              await db.update(workCatalog).set({ unit: symbol }).where(eq(workCatalog.unit, ex.symbol));
            }
            await db.update(measureUnits).set({ symbol, name, ...(isActive !== undefined ? { isActive } : {}) }).where(eq(measureUnits.id, ex.id));
            res.updated++;
          } else {
            await db.insert(measureUnits).values({ code: await resolveCode("measure_units", code), symbol, name, sortOrder: 500, ...(isActive !== undefined ? { isActive } : {}) });
            res.created++;
          }
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
    case "ticket-types": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = codeOf(r);
        const isActive = active(r); const sortOrder = sort(r);
        let ex = code ? (await db.select().from(ticketTypes).where(eq(ticketTypes.code, code)))[0] : undefined;
        if (!ex && !code) ex = (await db.select().from(ticketTypes).where(eq(ticketTypes.name, name)))[0];
        const patch = { name, ...(isActive !== undefined ? { isActive } : {}), ...(sortOrder != null ? { sortOrder } : {}) };
        if (ex) { await db.update(ticketTypes).set(patch).where(eq(ticketTypes.id, ex.id)); res.updated++; }
        else { await db.insert(ticketTypes).values({ ...patch, code: await resolveCode("ticket_types", code), sortOrder: sortOrder ?? 500 }); res.created++; }
      }
      return res;
    }
    case "priorities": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = codeOf(r);
        const slaHours = num(g(r, "slaHours"));
        const isActive = active(r); const sortOrder = sort(r);
        let ex = code ? (await db.select().from(ticketPriorities).where(eq(ticketPriorities.code, code)))[0] : undefined;
        if (!ex && !code) ex = (await db.select().from(ticketPriorities).where(eq(ticketPriorities.name, name)))[0];
        const patch = { name, ...(slaHours != null ? { slaHours } : {}), ...(isActive !== undefined ? { isActive } : {}), ...(sortOrder != null ? { sortOrder } : {}) };
        if (ex) { await db.update(ticketPriorities).set(patch).where(eq(ticketPriorities.id, ex.id)); res.updated++; }
        else { await db.insert(ticketPriorities).values({ ...patch, code: await resolveCode("ticket_priorities", code), slaHours: slaHours ?? null, sortOrder: sortOrder ?? 500 }); res.created++; }
      }
      return res;
    }
    case "works": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое наименование"); continue; }
        try {
          const code = codeOf(r);
          const ext = g(r, "externalCode") || null;
          const unit = await ensureUnit(g(r, "unit") || "шт");
          const isActive = active(r);
          const patch = { name, unit, defaultMinutes: num(g(r, "defaultMinutes")), price: num(g(r, "price"))?.toString() ?? null, externalCode: ext, ...(isActive !== undefined ? { isActive } : {}) };
          let ex = code ? (await db.select().from(workCatalog).where(eq(workCatalog.code, code)))[0] : undefined;
          if (!ex && ext) ex = (await db.select().from(workCatalog).where(eq(workCatalog.externalCode, ext)))[0];
          if (!ex && !code) ex = (await db.select().from(workCatalog).where(eq(workCatalog.name, name)))[0];
          if (ex) { await db.update(workCatalog).set(patch).where(eq(workCatalog.id, ex.id)); res.updated++; }
          else { await db.insert(workCatalog).values({ ...patch, code: await resolveCode("work_catalog", code), sortOrder: 500 }); res.created++; }
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
    case "clients": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = codeOf(r);
        const inn = g(r, "inn") || null;
        const isActive = active(r);
        const patch = { name, inn, contactPerson: g(r, "contactPerson") || null, phone: g(r, "phone") || null, email: g(r, "email") || null, notes: g(r, "notes") || null, ...(isActive !== undefined ? { isActive } : {}) };
        let ex = code ? (await db.select().from(clients).where(eq(clients.code, code)))[0] : undefined;
        if (!ex && inn) ex = (await db.select().from(clients).where(eq(clients.inn, inn)))[0];
        if (!ex && !code) ex = (await db.select().from(clients).where(eq(clients.name, name)))[0];
        if (ex) { await db.update(clients).set(patch).where(eq(clients.id, ex.id)); res.updated++; }
        else { await db.insert(clients).values({ ...patch, code: await resolveCode("clients", code) }); res.created++; }
      }
      return res;
    }
    case "sites": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const clientName = g(r, "client"); const name = g(r, "name"); const address = g(r, "address");
        if (!clientName || !name || !address) { fail(i, "нужны клиент, объект и адрес"); continue; }
        const code = codeOf(r);
        const inn = g(r, "clientInn") || null;
        const clientCode = g(r, "clientCode");
        let client = clientCode && isValidCode(clientCode, "clients") ? (await db.select().from(clients).where(eq(clients.code, normalizeCode(clientCode))))[0] : undefined;
        if (!client && inn) client = (await db.select().from(clients).where(eq(clients.inn, inn)))[0];
        if (!client) client = (await db.select().from(clients).where(eq(clients.name, clientName)))[0];
        if (!client) client = (await db.insert(clients).values({ name: clientName, inn, code: await nextCode("clients") }).returning())[0];
        const isActive = active(r);
        const patch = { clientId: client.id, name, address, contactPerson: g(r, "contactPerson") || null, contactPhone: g(r, "contactPhone") || null, notes: g(r, "notes") || null, ...(isActive !== undefined ? { isActive } : {}) };
        let ex = code ? (await db.select().from(sites).where(eq(sites.code, code)))[0] : undefined;
        if (!ex && !code) ex = (await db.select().from(sites).where(and(eq(sites.clientId, client.id), eq(sites.name, name))))[0];
        if (ex) { await db.update(sites).set(patch).where(eq(sites.id, ex.id)); res.updated++; }
        else { await db.insert(sites).values({ ...patch, code: await resolveCode("sites", code) }); res.created++; }
      }
      return res;
    }
    case "warehouses": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = codeOf(r);
        const kindRaw = g(r, "kind").toLowerCase();
        const kind = kindRaw.includes("транзит") || kindRaw === "transit" ? "transit" : "other";
        const isActive = active(r);
        let ex = code ? (await db.select().from(warehouses).where(eq(warehouses.code, code)))[0] : undefined;
        if (!ex && !code) ex = (await db.select().from(warehouses).where(eq(warehouses.name, name)))[0];
        if (ex) { await db.update(warehouses).set({ name, address: g(r, "address") || null, ...(isActive !== undefined && ex.kind !== "team" ? { isActive } : {}) }).where(eq(warehouses.id, ex.id)); res.updated++; }
        else { await db.insert(warehouses).values({ code: await resolveCode("warehouses", code), name, kind, address: g(r, "address") || null, sortOrder: 500, ...(isActive !== undefined ? { isActive } : {}) }); res.created++; }
      }
      return res;
    }
    case "roles": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        try {
          const code = codeOf(r);
          const scopeRaw = g(r, "scope").toLowerCase();
          const scope: "all" | "team" | "client" | undefined = scopeRaw === "team" || scopeRaw.includes("бригад") ? "team" : scopeRaw === "client" || scopeRaw.includes("клиент") ? "client" : scopeRaw ? "all" : undefined;
          const permsRaw = g(r, "permissions");
          const perms = mapping.permissions ? permsRaw.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean) : undefined;
          const unknown = perms?.filter((p) => !isPermission(p)) ?? [];
          if (unknown.length) throw new Error(`неизвестные права: ${unknown.join(", ")}`);
          const isActive = active(r); const sortOrder = sort(r);
          const patch = {
            name,
            description: g(r, "description") || null,
            ...(scope ? { scope } : {}),
            ...(mapping.isFieldStaff ? { isFieldStaff: yes(g(r, "isFieldStaff")) } : {}),
            ...(perms ? { permissions: perms as Permission[] } : {}),
            ...(isActive !== undefined ? { isActive } : {}),
            ...(sortOrder != null ? { sortOrder } : {}),
          };
          let ex = code ? (await db.select().from(roles).where(eq(roles.code, code)))[0] : undefined;
          if (!ex && !code) ex = (await db.select().from(roles).where(eq(roles.name, name)))[0];
          if (ex) {
            // единственную роль с users.manage нельзя лишить этого права
            if (perms && ex.permissions.includes("users.manage") && !perms.includes("users.manage")) {
              const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(roles).where(sql`'users.manage' = any(${roles.permissions}) and ${roles.id} <> ${ex.id} and ${roles.isActive}`);
              if (!n) throw new Error("нельзя снять «users.manage» с единственной роли администратора");
            }
            await db.update(roles).set(patch).where(eq(roles.id, ex.id)); res.updated++;
          } else {
            await db.insert(roles).values({ ...patch, code: await resolveCode("roles", code), scope: scope ?? "all", permissions: (perms ?? []) as Permission[], sortOrder: sortOrder ?? 500 }); res.created++;
          }
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
    case "teams": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = codeOf(r);
        const isActive = active(r);
        const patch = { name, description: g(r, "description") || null, ...(isActive !== undefined ? { isActive } : {}) };
        let ex = code ? (await db.select().from(teams).where(eq(teams.code, code)))[0] : undefined;
        if (!ex && !code) ex = (await db.select().from(teams).where(eq(teams.name, name)))[0];
        if (ex) { await db.update(teams).set(patch).where(eq(teams.id, ex.id)); res.updated++; }
        else { await db.insert(teams).values({ ...patch, code: await resolveCode("teams", code) }); res.created++; }
      }
      await ensureWarehouses(true);
      return res;
    }
    case "vehicles": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const plateNumber = g(r, "plateNumber").toUpperCase().replace(/\s+/g, ""); const model = g(r, "model");
        if (!plateNumber || !model) { fail(i, "нужны госномер и модель"); continue; }
        const code = codeOf(r);
        const isActive = active(r);
        const patch = { plateNumber, model, year: num(g(r, "year")), notes: g(r, "notes") || null, ...(isActive !== undefined ? { isActive } : {}) };
        let ex = code ? (await db.select().from(vehicles).where(eq(vehicles.code, code)))[0] : undefined;
        if (!ex) ex = (await db.select().from(vehicles).where(eq(vehicles.plateNumber, plateNumber)))[0];
        if (ex) { await db.update(vehicles).set(patch).where(eq(vehicles.id, ex.id)); res.updated++; }
        else { await db.insert(vehicles).values({ ...patch, code: await resolveCode("vehicles", code) }); res.created++; }
      }
      return res;
    }
    case "employees": {
      const roleRows = await db.select().from(roles);
      const findRole = (v: string) => {
        const c = normalizeCode(v);
        return roleRows.find((x) => x.code === c) ?? roleRows.find((x) => norm(x.name) === norm(v)) ?? roleRows.find((x) => x.sysKey === v.toLowerCase());
      };
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const email = g(r, "email").toLowerCase(); const fullName = g(r, "fullName"); const roleStr = g(r, "role");
        if (!email || !fullName || !roleStr) { fail(i, "нужны email, ФИО и роль"); continue; }
        try {
          const code = codeOf(r);
          const role = findRole(roleStr);
          if (!role) throw new Error(`роль «${roleStr}» не найдена`);
          let clientId: number | null = null;
          const clientStr = g(r, "client");
          if (clientStr) {
            const c = isValidCode(clientStr, "clients") ? (await db.select().from(clients).where(eq(clients.code, normalizeCode(clientStr))))[0] : (await db.select().from(clients).where(eq(clients.name, clientStr)))[0];
            if (!c) throw new Error(`клиент «${clientStr}» не найден`);
            clientId = c.id;
          }
          const isActive = active(r);
          const patch = { email, fullName, phone: g(r, "phone") || null, roleId: role.id, clientId, ...(isActive !== undefined ? { isActive } : {}) };
          let ex = code ? (await db.select().from(users).where(eq(users.code, code)))[0] : undefined;
          if (!ex) ex = (await db.select().from(users).where(eq(users.email, email)))[0];
          if (ex) {
            if (ex.email !== email) {
              const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
              if (dup) throw new Error(`email «${email}» уже занят`);
            }
            await db.update(users).set(patch).where(eq(users.id, ex.id)); res.updated++;
          } else {
            const password = g(r, "password");
            if (!password || password.length < 6) throw new Error("для нового сотрудника нужен пароль (минимум 6 символов)");
            await db.insert(users).values({ ...patch, code: await resolveCode("users", code), passwordHash: await hashPassword(password) }); res.created++;
          }
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
  }
  throw badRequest("Импорт для этого справочника не реализован");
}

/** CSV-шаблон (UTF-8 с BOM, разделитель «;») для скачивания. */
export function templateCsv(entity: string) {
  const tpl = IMPORT_TEMPLATES[entity];
  if (!tpl) throw badRequest("Неизвестный шаблон");
  return buildCsv(tpl.sample[0], tpl.sample.slice(1));
}

// ─────────────── экспорт ───────────────

const b = (v: boolean) => (v ? "1" : "0");

/** Экспорт справочника в CSV с колонками шаблона (файл пригоден для обратного импорта). */
export async function exportCsv(entity: string, opts: { canPrices: boolean }): Promise<{ csv: string; fileName: string }> {
  const tpl = IMPORT_TEMPLATES[entity];
  if (!tpl) throw badRequest("Неизвестный справочник");
  let headers: string[] = [];
  let rows: CsvCell[][] = [];
  switch (entity) {
    case "catalog": {
      const cats = await db.select().from(catalogCategories);
      const path = (id: number | null): string => { const c = cats.find((x) => x.id === id); if (!c) return ""; const p = path(c.parentId); return p ? `${p}/${c.name}` : c.name; };
      const items = await db.select().from(catalogItems).orderBy(asc(catalogItems.name));
      headers = ["Код", "Код 1С", "Наименование", "Полное наименование", "Артикул", "Группа", "Ед. изм.", "Производитель", "Серийный учёт", "Описание", ...(opts.canPrices ? ["Цена"] : []), "Активна"];
      rows = items.map((i) => [i.code, i.externalCode, i.name, i.fullName, i.sku, path(i.categoryId), i.unit, i.manufacturer, b(i.isSerialized), i.description, ...(opts.canPrices ? [csvNum(i.price)] : []), b(i.isActive)]);
      break;
    }
    case "categories": {
      const cats = await db.select().from(catalogCategories).orderBy(asc(catalogCategories.sortOrder), asc(catalogCategories.name));
      const path = (id: number | null): string => { const c = cats.find((x) => x.id === id); if (!c) return ""; const p = path(c.parentId); return p ? `${p}/${c.name}` : c.name; };
      headers = ["Код", "Название", "Родитель", "Активна"];
      rows = cats.map((c) => [c.code, c.name, path(c.parentId), b(c.isActive)]);
      break;
    }
    case "measure-units": {
      const list = await db.select().from(measureUnits).orderBy(asc(measureUnits.sortOrder), asc(measureUnits.name));
      headers = ["Код", "Обозначение", "Название", "Активна"];
      rows = list.map((u) => [u.code, u.symbol, u.name, b(u.isActive)]);
      break;
    }
    case "ticket-types": {
      const list = await db.select().from(ticketTypes).orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.name));
      headers = ["Код", "Название", "Порядок", "Активна"];
      rows = list.map((t) => [t.code, t.name, t.sortOrder, b(t.isActive)]);
      break;
    }
    case "priorities": {
      const list = await db.select().from(ticketPriorities).orderBy(asc(ticketPriorities.sortOrder), asc(ticketPriorities.name));
      headers = ["Код", "Название", "SLA, часов", "Порядок", "Активна"];
      rows = list.map((p) => [p.code, p.name, p.slaHours, p.sortOrder, b(p.isActive)]);
      break;
    }
    case "works": {
      const list = await db.select().from(workCatalog).orderBy(asc(workCatalog.sortOrder), asc(workCatalog.name));
      headers = ["Код", "Код 1С", "Наименование", "Ед. изм.", "Норматив, мин", "Цена", "Активна"];
      rows = list.map((w) => [w.code, w.externalCode, w.name, w.unit, w.defaultMinutes, csvNum(w.price), b(w.isActive)]);
      break;
    }
    case "clients": {
      const list = await db.select().from(clients).orderBy(asc(clients.name));
      headers = ["Код", "Название", "ИНН", "Контактное лицо", "Телефон", "Email", "Примечание", "Активен"];
      rows = list.map((c) => [c.code, c.name, c.inn, c.contactPerson, c.phone, c.email, c.notes, b(c.isActive)]);
      break;
    }
    case "sites": {
      const list = await db.select({ s: sites, clientName: clients.name, clientCode: clients.code, clientInn: clients.inn }).from(sites).innerJoin(clients, eq(clients.id, sites.clientId)).orderBy(asc(clients.name), asc(sites.name));
      headers = ["Код", "Клиент", "Код клиента", "ИНН клиента", "Название объекта", "Адрес", "Контактное лицо", "Телефон", "Примечание", "Активен"];
      rows = list.map(({ s, clientName, clientCode, clientInn }) => [s.code, clientName, clientCode, clientInn, s.name, s.address, s.contactPerson, s.contactPhone, s.notes, b(s.isActive)]);
      break;
    }
    case "warehouses": {
      const list = await db.select().from(warehouses).orderBy(asc(warehouses.sortOrder), asc(warehouses.name));
      headers = ["Код", "Название", "Адрес", "Вид", "Активен"];
      rows = list.map((w) => [w.code, w.name, w.address, w.kind, b(w.isActive)]);
      break;
    }
    case "roles": {
      const list = await db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.name));
      headers = ["Код", "Название", "Описание", "Область данных", "Полевой сотрудник", "Права", "Порядок", "Активна"];
      rows = list.map((r) => [r.code, r.name, r.description, r.scope, b(r.isFieldStaff), r.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)).join(", "), r.sortOrder, b(r.isActive)]);
      break;
    }
    case "teams": {
      const list = await db.select().from(teams).orderBy(asc(teams.name));
      headers = ["Код", "Название", "Описание", "Активна"];
      rows = list.map((t) => [t.code, t.name, t.description, b(t.isActive)]);
      break;
    }
    case "vehicles": {
      const list = await db.select().from(vehicles).orderBy(asc(vehicles.plateNumber));
      headers = ["Код", "Госномер", "Модель", "Год", "Примечание", "Активен"];
      rows = list.map((v) => [v.code, v.plateNumber, v.model, v.year, v.notes, b(v.isActive)]);
      break;
    }
    case "employees": {
      const list = await db.select({ u: users, roleName: roles.name, clientName: clients.name }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).leftJoin(clients, eq(clients.id, users.clientId)).orderBy(asc(users.fullName));
      headers = ["Код", "Email (логин)", "ФИО", "Телефон", "Роль", "Клиент (для роли клиента)", "Пароль", "Активен"];
      rows = list.map(({ u, roleName, clientName }) => [u.code, u.email, u.fullName, u.phone, roleName, clientName, "", b(u.isActive)]);
      break;
    }
    default:
      throw badRequest("Экспорт для этого справочника не реализован");
  }
  return { csv: buildCsv(headers, rows), fileName: `${entity}.csv` };
}

/** Дерево категорий с количеством позиций (для «Товаров»). */
export async function categoryTree() {
  const cats = await db.select().from(catalogCategories).orderBy(catalogCategories.sortOrder, catalogCategories.name);
  const counts = await db.select({ id: catalogItems.categoryId, n: sql<number>`count(*)::int` }).from(catalogItems).groupBy(catalogItems.categoryId);
  const cm = new Map(counts.map((c) => [c.id, c.n]));
  return cats.map((c) => ({ id: c.id, code: c.code, name: c.name, parentId: c.parentId, isActive: c.isActive, count: cm.get(c.id) ?? 0 }));
}
