import type { Permission } from "@/lib/rbac";

/**
 * Реестр модулей платформы.
 *
 * Приложение — не один продукт, а набор модулей: одна и та же система работает как
 * сервис-деск с выездами, как складской учёт или как запись клиентов в салон.
 * Состав включённых модулей выбирается при установке (мастер настройки `/setup`)
 * и хранится в БД, поэтому сборка кода одна на всех, а конфигурация — своя у каждого
 * заказчика.
 *
 * Модуль описывает: какие разделы он добавляет в навигацию, какие права относятся
 * к его функциям и от каких модулей он зависит.
 */

export type ModuleId =
  | "tickets"
  | "clients"
  | "teams"
  | "inventory"
  | "catalog"
  | "reports"
  | "staff"
  | "directories"
  | "admin";

export type AppModule = {
  id: ModuleId;
  name: string;
  /** Чем модуль полезен — текст для мастера настройки. */
  description: string;
  /** Основные модули нельзя отключить: без них система нежизнеспособна. */
  core?: boolean;
  /** Модули, без которых этот не работает. */
  requires?: ModuleId[];
  /** Разделы, которые модуль добавляет в навигацию (для подсказки в мастере). */
  sections: string[];
  /** Права, которые имеет смысл выдавать, только если модуль включён. */
  permissions?: Permission[];
};

export const MODULES: AppModule[] = [
  {
    id: "tickets",
    name: "Заявки и работы",
    description: "Приём обращений, статусы выполнения, назначение исполнителей, обсуждение и акты работ.",
    sections: ["Заявки"],
    permissions: ["tickets.read.all", "tickets.read.own", "tickets.create", "tickets.assign", "tickets.schedule", "tickets.work", "tickets.close", "tickets.cancel", "tickets.delete", "chat.write", "chat.internal"],
  },
  {
    id: "clients",
    name: "Клиенты и объекты",
    description: "Контрагенты, их объекты и история обслуживания. Нужен, если работа ведётся по заказчикам.",
    sections: ["Клиенты"],
    permissions: ["clients.read", "clients.manage", "sites.manage"],
  },
  {
    id: "teams",
    name: "Бригады и автопарк",
    description: "Выездные бригады, закреплённые автомобили и склад-автомобиль. Для полевых работ.",
    requires: ["tickets"],
    sections: ["Бригады", "Моя бригада"],
    permissions: ["teams.read", "teams.manage", "vehicles.manage"],
  },
  {
    id: "inventory",
    name: "Склад",
    description: "Склады, приход и перемещение, серийный учёт, документы и остатки.",
    requires: ["catalog"],
    sections: ["Склад"],
    permissions: ["inventory.read.all", "inventory.read.team", "inventory.receive", "inventory.issue", "inventory.return", "inventory.reserve", "inventory.install", "inventory.writeoff"],
  },
  {
    id: "catalog",
    name: "Номенклатура",
    description: "Справочник товаров, материалов и услуг с категориями и ценами.",
    sections: ["Товары"],
    permissions: ["catalog.read", "catalog.manage"],
  },
  {
    id: "reports",
    name: "Отчёты",
    description: "Отчёты по работам, остаткам и движению с отбором, печатью и выгрузкой.",
    sections: ["Отчёты"],
    permissions: ["reports.view", "reports.inventory"],
  },
  { id: "staff", name: "Сотрудники и роли", description: "Учётные записи, роли и права доступа.", core: true, sections: ["Сотрудники"], permissions: ["users.manage"] },
  { id: "directories", name: "Справочники", description: "Списки, из которых заполняются формы: типы, категории, единицы измерения.", core: true, sections: ["Справочники"], permissions: ["directories.manage"] },
  { id: "admin", name: "Администрирование", description: "Оформление, резервные копии, обслуживание и очистка базы.", core: true, sections: ["Администрирование"], permissions: ["admin.backup", "admin.maintenance"] },
];

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));
export const CORE_MODULES = MODULES.filter((m) => m.core).map((m) => m.id);

/**
 * Отраслевые заготовки: набор модулей и подписи разделов под конкретный род занятий.
 * Заготовка — это стартовая точка, в мастере её можно изменить галочками.
 */
export type IndustryPreset = {
  id: string;
  name: string;
  description: string;
  modules: ModuleId[];
  /** Переименование разделов под отрасль: путь → название. */
  labels?: Record<string, string>;
};

export const PRESETS: IndustryPreset[] = [
  {
    id: "service",
    name: "Сервис и монтаж",
    description: "Выездное обслуживание: заявки, бригады с автомобилями, склад и оборудование на объектах.",
    modules: ["tickets", "clients", "teams", "catalog", "inventory", "reports"],
  },
  {
    id: "warehouse",
    name: "Складской учёт",
    description: "Только товары и склад: приход, перемещения, остатки и отчёты. Без выездов и бригад.",
    modules: ["catalog", "inventory", "reports"],
    labels: { "/inventory": "Склады", "/catalog": "Номенклатура" },
  },
  {
    id: "salon",
    name: "Салон услуг",
    description: "Запись клиентов и услуги: обращения как записи, клиенты, прайс услуг, отчёты. Без бригад и выездов.",
    modules: ["tickets", "clients", "catalog", "reports"],
    labels: { "/tickets": "Записи", "/catalog": "Услуги и товары", "/clients": "Клиенты" },
  },
  {
    id: "custom",
    name: "Свой набор",
    description: "Начать с пустого набора и отметить нужные модули самостоятельно.",
    modules: [],
  },
];

/** Добавляет обязательные зависимости к выбранному набору. */
export function withDependencies(ids: ModuleId[]): ModuleId[] {
  const set = new Set<ModuleId>([...ids, ...CORE_MODULES]);
  let added = true;
  while (added) {
    added = false;
    for (const id of [...set]) {
      for (const dep of MODULE_BY_ID.get(id)?.requires ?? []) {
        if (!set.has(dep)) { set.add(dep); added = true; }
      }
    }
  }
  return MODULES.filter((m) => set.has(m.id)).map((m) => m.id);
}

/** Модули, которые перестанут работать без выключаемого модуля. */
export function dependents(id: ModuleId): ModuleId[] {
  return MODULES.filter((m) => (m.requires ?? []).includes(id)).map((m) => m.id);
}
