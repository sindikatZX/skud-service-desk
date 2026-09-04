import { db } from "@/db";
import { catalogCategories, catalogItems, measureUnits, ticketTypes, ticketPriorities, clients, sites, workCatalog, warehouses } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { badRequest } from "@/lib/api";

/**
 * Импорт справочников из CSV-выгрузок (в первую очередь «1С:Торговля и Склад 7.7»).
 *
 * Клиент разбирает CSV (кодировка, разделитель) и присылает массив строк «колонка → значение».
 * Сервер сопоставляет колонки по шаблону (алиасы русских/английских заголовков), создаёт
 * недостающие записи и обновляет существующие по ключу (код 1С / артикул / код / имя).
 *
 * Иерархия групп номенклатуры передаётся либо колонкой «Группа» с путём «Кабель/UTP»,
 * либо парой «ЭтоГруппа»/«Родитель» (как в стандартной обработке выгрузки 1С 7.7).
 */

export type ImportField = { key: string; label: string; required?: boolean; aliases: string[]; hint?: string };
export type ImportTemplate = { entity: string; title: string; description: string; fields: ImportField[]; sample: string[][] };

const F = (key: string, label: string, aliases: string[], required = false, hint?: string): ImportField => ({ key, label, aliases, required, hint });

export const IMPORT_TEMPLATES: Record<string, ImportTemplate> = {
  catalog: {
    entity: "catalog",
    title: "Номенклатура (1С:Торговля и Склад 7.7)",
    description: "Иерархический список: элементы и группы. Группы создаются как папки категорий. Артикул не обязателен — берётся из таблицы или генерируется.",
    fields: [
      F("externalCode", "Код 1С", ["код", "code", "код1с", "id"], false, "ключ для повторного импорта"),
      F("name", "Наименование", ["наименование", "название", "name", "номенклатура"], true),
      F("fullName", "Полное наименование", ["полноенаименование", "полное наименование", "fullname"]),
      F("sku", "Артикул", ["артикул", "sku", "art", "арт"]),
      F("group", "Группа (путь)", ["группа", "родитель", "папка", "категория", "group", "parent", "категория/группа"], false, "путь через / или имя родителя"),
      F("isGroup", "Это группа", ["этогруппа", "это группа", "группа?", "isgroup", "папка?"], false, "1/да — строка описывает группу"),
      F("unit", "Ед. изм.", ["ед", "ед.", "единица", "единицаизмерения", "базоваяединица", "unit", "ед. изм.", "едизм"]),
      F("manufacturer", "Производитель", ["производитель", "изготовитель", "бренд", "manufacturer", "vendor"]),
      F("isSerialized", "Серийный учёт", ["серийный", "серийныйучет", "серийный учёт", "s/n", "serialized"], false, "1/да"),
      F("description", "Описание", ["описание", "комментарий", "description", "примечание"]),
      F("quantity", "Остаток", ["остаток", "количество", "кол-во", "quantity", "qty"], false, "если задан склад — приходуется поступлением"),
      F("price", "Цена", ["цена", "price", "стоимость"]),
    ],
    sample: [
      ["Код", "Наименование", "Артикул", "Группа", "Ед.", "Производитель", "Остаток"],
      ["00001", "Кабель UTP cat.5e", "CBL-UTP5E", "Кабель/UTP", "м", "", "610"],
      ["00002", "IP-камера DS-2CD2043G2-I", "", "Видеонаблюдение/Камеры", "шт", "Hikvision", "0"],
    ],
  },
  categories: {
    entity: "categories",
    title: "Категории (группы номенклатуры)",
    description: "Папки номенклатуры. Родитель задаётся именем или путём.",
    fields: [F("code", "Код", ["код", "code"]), F("name", "Название", ["наименование", "название", "name"], true), F("group", "Родитель", ["родитель", "группа", "parent", "путь"])],
    sample: [["Код", "Наименование", "Родитель"], ["cable", "Кабель", ""], ["utp", "UTP", "Кабель"]],
  },
  "measure-units": {
    entity: "measure-units",
    title: "Единицы измерения",
    description: "Код — как показывается в интерфейсе (шт, м, компл).",
    fields: [F("code", "Код", ["код", "code", "сокращение", "краткое"], true), F("name", "Название", ["наименование", "название", "name", "полное"], true)],
    sample: [["Код", "Наименование"], ["шт", "Штука"], ["м", "Метр"]],
  },
  "ticket-types": {
    entity: "ticket-types",
    title: "Типы работ",
    description: "Код латиницей; если не задан — генерируется из названия.",
    fields: [F("code", "Код", ["код", "code"]), F("name", "Название", ["наименование", "название", "name"], true)],
    sample: [["Код", "Наименование"], ["installation", "Монтаж"]],
  },
  priorities: {
    entity: "priorities",
    title: "Приоритеты и SLA",
    description: "SLA в часах.",
    fields: [F("code", "Код", ["код", "code"]), F("name", "Название", ["наименование", "название", "name"], true), F("slaHours", "SLA, часов", ["sla", "часы", "срок", "slahours"])],
    sample: [["Код", "Наименование", "SLA"], ["high", "Высокий", "24"]],
  },
  works: {
    entity: "works",
    title: "Справочник работ (услуги)",
    description: "Номенклатура услуг из 1С: наименование, единица, цена, норматив времени.",
    fields: [
      F("externalCode", "Код 1С", ["код", "code"]),
      F("name", "Наименование", ["наименование", "название", "name", "услуга", "работа"], true),
      F("unit", "Ед. изм.", ["ед", "ед.", "единица", "unit", "ед. изм."]),
      F("defaultMinutes", "Норматив, мин", ["норматив", "минуты", "время", "minutes", "длительность"]),
      F("price", "Цена", ["цена", "price", "стоимость"]),
    ],
    sample: [["Код", "Наименование", "Ед.", "Норматив", "Цена"], ["У-001", "Монтаж камеры", "шт", "60", "1500"]],
  },
  clients: {
    entity: "clients",
    title: "Клиенты (контрагенты)",
    description: "Ключ сопоставления — ИНН, иначе название.",
    fields: [
      F("name", "Название", ["наименование", "название", "name", "контрагент", "клиент"], true),
      F("inn", "ИНН", ["инн", "inn"]),
      F("contactPerson", "Контактное лицо", ["контакт", "контактноелицо", "контактное лицо", "contact"]),
      F("phone", "Телефон", ["телефон", "phone", "тел"]),
      F("email", "Email", ["email", "e-mail", "почта"]),
      F("notes", "Примечание", ["примечание", "комментарий", "notes"]),
    ],
    sample: [["Наименование", "ИНН", "Телефон"], ["ООО «Пример»", "7800000000", "+7 812 000-00-00"]],
  },
  sites: {
    entity: "sites",
    title: "Справочник объектов",
    description: "Объекты обслуживания с привязкой к клиенту (по названию или ИНН). Клиент создаётся, если не найден.",
    fields: [
      F("client", "Клиент", ["клиент", "контрагент", "заказчик", "client", "владелец"], true),
      F("clientInn", "ИНН клиента", ["инн", "иннклиента", "inn"]),
      F("name", "Название объекта", ["объект", "наименование", "название", "name", "site"], true),
      F("address", "Адрес", ["адрес", "address"], true),
      F("contactPerson", "Контактное лицо", ["контакт", "контактноелицо", "контактное лицо", "contact"]),
      F("contactPhone", "Телефон", ["телефон", "phone", "тел"]),
      F("notes", "Примечание", ["примечание", "комментарий", "notes"]),
    ],
    sample: [["Клиент", "Объект", "Адрес", "Телефон"], ["ООО «Пример»", "Офис на Невском", "СПб, Невский пр., 1", "+7 812 000-00-00"]],
  },
  warehouses: {
    entity: "warehouses",
    title: "Склады",
    description: "Список складов из 1С. Вид — «transit» или «other».",
    fields: [F("code", "Код", ["код", "code"]), F("name", "Название", ["наименование", "название", "name", "склад"], true), F("address", "Адрес", ["адрес", "address"]), F("kind", "Вид", ["вид", "тип", "kind"])],
    sample: [["Код", "Наименование"], ["main2", "Склад №2"]],
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

/** Транслит для автогенерации кодов справочников из русских названий. */
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
  private async ensureCode(base: string) {
    let code = base;
    for (let i = 1; i < 500; i++) {
      const [dup] = await db.select({ id: catalogCategories.id }).from(catalogCategories).where(eq(catalogCategories.code, code));
      if (!dup) return code;
      code = `${base.slice(0, 34)}_${i}`;
    }
    return `${base}_${Date.now().toString(36)}`;
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
          const code = await this.ensureCode(slugify(part, "group"));
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
    const other = this.rows.find((r) => r.code === "other") ?? this.rows[0];
    if (other) return other.id;
    const [row] = await db.insert(catalogCategories).values({ code: "other", name: "Другое", isSystem: true, sortOrder: 999 }).returning();
    this.rows.push(row);
    return row.id;
  }
}

async function ensureUnit(code: string) {
  const c = code.trim();
  if (!c) return "шт";
  const [u] = await db.select({ code: measureUnits.code }).from(measureUnits).where(eq(measureUnits.code, c));
  if (u) return u.code;
  await db.insert(measureUnits).values({ code: c, name: c, sortOrder: 500 }).onConflictDoNothing({ target: measureUnits.code });
  return c;
}

// ─────────────── импортёры ───────────────

export async function runImport(entity: string, rows: Record<string, string>[], mappingIn?: Record<string, string>, options: Record<string, string | number | boolean> = {}, actorId = 0): Promise<ImportResult> {
  const tpl = IMPORT_TEMPLATES[entity];
  if (!tpl) throw badRequest(`Неизвестный шаблон импорта «${entity}»`);
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
          const ext = g(r, "externalCode") || null;
          let sku = g(r, "sku") || null;
          const groupStr = g(r, "group");
          let categoryId: number | null = null;
          if (groupStr) categoryId = groupByCode.get(groupStr) ?? cats.byExternal(groupStr) ?? (await cats.resolvePath(groupStr));
          if (!categoryId) categoryId = defaultCat ?? (await cats.defaultId());
          const unit = await ensureUnit(g(r, "unit") || "шт");
          const patch = {
            name,
            fullName: g(r, "fullName") || null,
            categoryId,
            unit,
            manufacturer: g(r, "manufacturer") || null,
            description: g(r, "description") || null,
            externalCode: ext,
          };
          const serialized = mapping.isSerialized ? yes(g(r, "isSerialized")) : undefined;
          // поиск существующей: по коду 1С → по артикулу → по имени
          let existing = ext ? (await db.select().from(catalogItems).where(eq(catalogItems.externalCode, ext)))[0] : undefined;
          if (!existing && sku) existing = (await db.select().from(catalogItems).where(eq(catalogItems.sku, sku)))[0];
          if (!existing && !ext && !sku) existing = (await db.select().from(catalogItems).where(eq(catalogItems.name, name)))[0];
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
            const [row] = await db.insert(catalogItems).values({ ...patch, sku, isSerialized: serialized ?? false }).returning();
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
          const parent = g(r, "group");
          const id = await cats.resolvePath(parent ? `${parent}/${name}` : name, g(r, "code") || null);
          if (id) res.created++;
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
    case "measure-units": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const code = g(r, "code"); const name = g(r, "name") || code;
        if (!code) { fail(i, "пустой код"); continue; }
        const [ex] = await db.select().from(measureUnits).where(eq(measureUnits.code, code));
        if (ex) { await db.update(measureUnits).set({ name }).where(eq(measureUnits.id, ex.id)); res.updated++; }
        else { await db.insert(measureUnits).values({ code, name, sortOrder: 500 }); res.created++; }
      }
      return res;
    }
    case "ticket-types": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = (g(r, "code") || slugify(name)).toLowerCase();
        const [ex] = await db.select().from(ticketTypes).where(eq(ticketTypes.code, code));
        if (ex) { await db.update(ticketTypes).set({ name }).where(eq(ticketTypes.id, ex.id)); res.updated++; }
        else { await db.insert(ticketTypes).values({ code, name, sortOrder: 500 }); res.created++; }
      }
      return res;
    }
    case "priorities": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = (g(r, "code") || slugify(name)).toLowerCase();
        const slaHours = num(g(r, "slaHours"));
        const [ex] = await db.select().from(ticketPriorities).where(eq(ticketPriorities.code, code));
        if (ex) { await db.update(ticketPriorities).set({ name, ...(slaHours != null ? { slaHours } : {}) }).where(eq(ticketPriorities.id, ex.id)); res.updated++; }
        else { await db.insert(ticketPriorities).values({ code, name, slaHours: slaHours ?? null, sortOrder: 500 }); res.created++; }
      }
      return res;
    }
    case "works": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое наименование"); continue; }
        try {
          const ext = g(r, "externalCode") || null;
          const unit = await ensureUnit(g(r, "unit") || "шт");
          const patch = { name, unit, defaultMinutes: num(g(r, "defaultMinutes")), price: num(g(r, "price"))?.toString() ?? null, externalCode: ext };
          let ex = ext ? (await db.select().from(workCatalog).where(eq(workCatalog.externalCode, ext)))[0] : undefined;
          if (!ex) ex = (await db.select().from(workCatalog).where(eq(workCatalog.name, name)))[0];
          if (ex) { await db.update(workCatalog).set(patch).where(eq(workCatalog.id, ex.id)); res.updated++; }
          else {
            let code = slugify(ext || name, "work");
            const [dup] = await db.select({ id: workCatalog.id }).from(workCatalog).where(eq(workCatalog.code, code));
            if (dup) code = `${code.slice(0, 30)}_${Date.now().toString(36)}`;
            await db.insert(workCatalog).values({ ...patch, code, sortOrder: 500 });
            res.created++;
          }
        } catch (e) { fail(i, (e as Error).message); }
      }
      return res;
    }
    case "clients": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const inn = g(r, "inn") || null;
        const patch = { name, inn, contactPerson: g(r, "contactPerson") || null, phone: g(r, "phone") || null, email: g(r, "email") || null, notes: g(r, "notes") || null };
        let ex = inn ? (await db.select().from(clients).where(eq(clients.inn, inn)))[0] : undefined;
        if (!ex) ex = (await db.select().from(clients).where(eq(clients.name, name)))[0];
        if (ex) { await db.update(clients).set(patch).where(eq(clients.id, ex.id)); res.updated++; }
        else { await db.insert(clients).values(patch); res.created++; }
      }
      return res;
    }
    case "sites": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const clientName = g(r, "client"); const name = g(r, "name"); const address = g(r, "address");
        if (!clientName || !name || !address) { fail(i, "нужны клиент, объект и адрес"); continue; }
        const inn = g(r, "clientInn") || null;
        let client = inn ? (await db.select().from(clients).where(eq(clients.inn, inn)))[0] : undefined;
        if (!client) client = (await db.select().from(clients).where(eq(clients.name, clientName)))[0];
        if (!client) client = (await db.insert(clients).values({ name: clientName, inn }).returning())[0];
        const patch = { clientId: client.id, name, address, contactPerson: g(r, "contactPerson") || null, contactPhone: g(r, "contactPhone") || null, notes: g(r, "notes") || null };
        const [ex] = await db.select().from(sites).where(and(eq(sites.clientId, client.id), eq(sites.name, name)));
        if (ex) { await db.update(sites).set(patch).where(eq(sites.id, ex.id)); res.updated++; }
        else { await db.insert(sites).values(patch); res.created++; }
      }
      return res;
    }
    case "warehouses": {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = g(r, "name");
        if (!name) { fail(i, "пустое название"); continue; }
        const code = (g(r, "code") || slugify(name, "wh")).toLowerCase();
        const kindRaw = g(r, "kind").toLowerCase();
        const kind = kindRaw.includes("транзит") || kindRaw === "transit" ? "transit" : "other";
        const [ex] = await db.select().from(warehouses).where(eq(warehouses.code, code));
        if (ex) { await db.update(warehouses).set({ name, address: g(r, "address") || null }).where(eq(warehouses.id, ex.id)); res.updated++; }
        else { await db.insert(warehouses).values({ code, name, kind, address: g(r, "address") || null, sortOrder: 500 }); res.created++; }
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
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "\ufeff" + tpl.sample.map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

/** Дерево категорий с количеством позиций (для «Номенклатуры»). */
export async function categoryTree() {
  const cats = await db.select().from(catalogCategories).orderBy(catalogCategories.sortOrder, catalogCategories.name);
  const counts = await db.select({ id: catalogItems.categoryId, n: sql<number>`count(*)::int` }).from(catalogItems).groupBy(catalogItems.categoryId);
  const cm = new Map(counts.map((c) => [c.id, c.n]));
  return cats.map((c) => ({ id: c.id, code: c.code, name: c.name, parentId: c.parentId, isActive: c.isActive, count: cm.get(c.id) ?? 0 }));
}
