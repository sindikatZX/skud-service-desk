/**
 * Словарь терминов модулей.
 *
 * Одна и та же сущность называется по-разному в зависимости от рода занятий:
 * в сервисной компании это «заявка», в салоне — «запись», на складе — «заказ».
 * Тексты интерфейса берут слово отсюда, а не вшивают его в разметку, поэтому
 * смена отраслевой заготовки меняет формулировки на страницах, а не только
 * названия разделов.
 *
 * Русский язык требует падежей, поэтому термин — это набор форм, а не строка:
 * «создать заявку» и «нет заявок» нельзя собрать из одного слова.
 */

export type TermForms = {
  /** Именительный, ед. ч.: заявка */
  nom: string;
  /** Винительный, ед. ч.: создать заявку */
  acc: string;
  /** Родительный, ед. ч.: срок заявки */
  gen: string;
  /** Именительный, мн. ч. (заголовки разделов): Заявки */
  plural: string;
  /** Родительный, мн. ч.: нет заявок */
  pluralGen: string;
};

export type TermKey = "ticket" | "client" | "site" | "team" | "item" | "warehouse";

export type Terms = Record<TermKey, TermForms>;

/** Термины по умолчанию — сервис и монтаж. */
export const DEFAULT_TERMS: Terms = {
  ticket: { nom: "заявка", acc: "заявку", gen: "заявки", plural: "Заявки", pluralGen: "заявок" },
  client: { nom: "клиент", acc: "клиента", gen: "клиента", plural: "Клиенты", pluralGen: "клиентов" },
  site: { nom: "объект", acc: "объект", gen: "объекта", plural: "Объекты", pluralGen: "объектов" },
  team: { nom: "бригада", acc: "бригаду", gen: "бригады", plural: "Бригады", pluralGen: "бригад" },
  item: { nom: "позиция", acc: "позицию", gen: "позиции", plural: "Товары", pluralGen: "позиций" },
  warehouse: { nom: "склад", acc: "склад", gen: "склада", plural: "Склады", pluralGen: "складов" },
};

/**
 * Переопределения под отраслевые заготовки. Указывается только то, что отличается,
 * остальное берётся из словаря по умолчанию.
 */
export const PRESET_TERMS: Record<string, Partial<Record<TermKey, Partial<TermForms>>>> = {
  salon: {
    ticket: { nom: "запись", acc: "запись", gen: "записи", plural: "Записи", pluralGen: "записей" },
    item: { nom: "услуга", acc: "услугу", gen: "услуги", plural: "Услуги и товары", pluralGen: "услуг" },
    site: { nom: "адрес", acc: "адрес", gen: "адреса", plural: "Адреса", pluralGen: "адресов" },
  },
  warehouse: {
    ticket: { nom: "заказ", acc: "заказ", gen: "заказа", plural: "Заказы", pluralGen: "заказов" },
    item: { nom: "номенклатура", acc: "номенклатуру", gen: "номенклатуры", plural: "Номенклатура", pluralGen: "позиций" },
  },
};

/** Словарь для рода занятий: заготовка поверх значений по умолчанию. */
export function termsFor(presetId: string | undefined): Terms {
  const overrides = PRESET_TERMS[presetId ?? ""] ?? {};
  const result = {} as Terms;
  for (const key of Object.keys(DEFAULT_TERMS) as TermKey[]) {
    result[key] = { ...DEFAULT_TERMS[key], ...(overrides[key] ?? {}) };
  }
  return result;
}

/** Слово с заглавной буквы: «заявка» → «Заявка». */
export function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Подписи разделов навигации, выведенные из словаря терминов. */
export function navLabelsFrom(terms: Terms): Record<string, string> {
  return {
    "/tickets": terms.ticket.plural,
    "/clients": terms.client.plural,
    "/teams": terms.team.plural,
    "/catalog": terms.item.plural,
    "/inventory": terms.warehouse.plural,
  };
}
