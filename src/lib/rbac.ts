import type { RoleScope } from "@/db/schema";

/**
 * Права системы. Набор прав фиксирован в коде (на них опираются проверки),
 * а вот роли и их наборы прав пользователь заводит сам в справочнике «Роли».
 * Матрица прав системных ролей описана в docs/04-roles-and-permissions.md.
 */
export type Permission =
  | "users.manage"
  | "clients.read"
  | "clients.manage"
  | "sites.manage"
  | "teams.read"
  | "teams.manage"
  | "vehicles.manage"
  | "catalog.read"
  | "catalog.manage"
  | "directories.manage"
  | "tickets.read.all"
  | "tickets.read.own"
  | "tickets.create"
  | "tickets.assign"
  | "tickets.schedule"
  | "tickets.work"
  | "tickets.close"
  | "tickets.cancel"
  | "tickets.delete"
  | "tickets.reopen"
  | "chat.write"
  | "chat.internal"
  | "inventory.read.all"
  | "inventory.read.team"
  | "inventory.receive"
  | "inventory.issue"
  | "inventory.return"
  | "inventory.reserve"
  | "inventory.install"
  | "inventory.writeoff"
  | "inventory.transfer"
  | "data.import"
  | "data.export"
  | "catalog.prices.view"
  | "catalog.prices.manage"
  | "reports.view"
  | "reports.inventory"
  | "reports.stock"
  | "reports.movements"
  | "reports.works"
  | "reports.export"
  | "admin.backup"
  | "admin.maintenance";

/** Каталог прав для экрана редактирования роли: группа → права с описанием. */
export const PERMISSION_GROUPS: { group: string; items: { key: Permission; label: string }[] }[] = [
  {
    group: "Заявки",
    items: [
      { key: "tickets.read.all", label: "Видеть все заявки" },
      { key: "tickets.read.own", label: "Видеть только свои заявки" },
      { key: "tickets.create", label: "Создавать заявки" },
      { key: "tickets.assign", label: "Назначать бригаду, редактировать заявку" },
      { key: "tickets.schedule", label: "Планировать выезд" },
      { key: "tickets.work", label: "Выполнять работы (брать в работу, закрывать наряд)" },
      { key: "tickets.close", label: "Закрывать заявки" },
      { key: "tickets.cancel", label: "Отменять заявки" },
      { key: "tickets.delete", label: "Удалять заявки" },
      { key: "tickets.reopen", label: "Возвращать в работу закрытые заявки" },
    ],
  },
  {
    group: "Обсуждение",
    items: [
      { key: "chat.write", label: "Писать в чат заявки" },
      { key: "chat.internal", label: "Видеть внутренние сообщения (скрытые от клиента)" },
    ],
  },
  {
    group: "Клиенты и объекты",
    items: [
      { key: "clients.read", label: "Просмотр клиентов" },
      { key: "clients.manage", label: "Управление клиентами (создание, изменение, удаление)" },
      { key: "sites.manage", label: "Управление объектами" },
    ],
  },
  {
    group: "Бригады",
    items: [
      { key: "teams.read", label: "Просмотр бригад" },
      { key: "teams.manage", label: "Управление бригадами и составом" },
      { key: "vehicles.manage", label: "Управление автопарком" },
    ],
  },
  {
    group: "Склад",
    items: [
      { key: "inventory.read.all", label: "Видеть остатки всех мест хранения" },
      { key: "inventory.read.team", label: "Видеть остатки своей бригады" },
      { key: "inventory.receive", label: "Приходовать на склад" },
      { key: "inventory.issue", label: "Отгружать бригаде" },
      { key: "inventory.return", label: "Принимать возврат на склад" },
      { key: "inventory.reserve", label: "Резервировать под заявку" },
      { key: "inventory.install", label: "Проводить установку на объекте" },
      { key: "inventory.writeoff", label: "Списывать" },
      { key: "inventory.transfer", label: "Перемещать между складами" },
    ],
  },
  {
    group: "Справочники и администрирование",
    items: [
      { key: "catalog.read", label: "Просмотр справочника товаров (номенклатуры)" },
      { key: "catalog.manage", label: "Управление товарами (номенклатурой)" },
      { key: "catalog.prices.view", label: "Видеть цены товаров" },
      { key: "catalog.prices.manage", label: "Изменять цены товаров" },
      { key: "directories.manage", label: "Управление справочниками (типы работ, роли, категории…)" },
      { key: "users.manage", label: "Управление сотрудниками" },
      { key: "data.import", label: "Импорт справочников из CSV (1С)" },
      { key: "data.export", label: "Экспорт справочников в CSV" },
    ],
  },
  {
    group: "Отчёты",
    items: [
      { key: "reports.view", label: "Операционные отчёты (сводка, загрузка, клиенты)" },
      { key: "reports.inventory", label: "Складские сводки" },
      { key: "reports.stock", label: "Отчёт остатков по складам" },
      { key: "reports.movements", label: "Отчёт движения товаров" },
      { key: "reports.works", label: "Отчёты по работам (что и где сделали)" },
      { key: "reports.export", label: "Экспорт отчётов в CSV и печать" },
    ],
  },
  {
    group: "Администрирование базы данных",
    items: [
      { key: "admin.backup", label: "Резервные копии: создание, скачивание, восстановление" },
      { key: "admin.maintenance", label: "Обслуживание БД: очистка данных, проверка и исправление целостности" },
    ],
  },
];

/**
 * Права, добавленные в новых версиях: при старте докидываются системным ролям,
 * у которых они предусмотрены в SYSTEM_ROLES (пользовательские настройки не трогаем).
 */
export const ADDED_PERMISSIONS: Permission[] = [
  "directories.manage", "tickets.reopen", "inventory.transfer", "data.import", "data.export",
  "catalog.prices.view", "catalog.prices.manage",
  "reports.stock", "reports.movements", "reports.works", "reports.export",
  "admin.backup", "admin.maintenance",
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);
export function isPermission(v: string): v is Permission {
  return PERMISSION_SET.has(v);
}

export const SCOPE_LABELS: Record<RoleScope, string> = {
  all: "Все данные",
  team: "Только своей бригады",
  client: "Только своего клиента",
};

/** Всё, что нужно для проверки прав. Совпадает по форме с SessionUser. */
export type PermissionHolder = { permissions: Permission[]; scope: RoleScope };

export function can(user: PermissionHolder, perm: Permission): boolean {
  return user.permissions.includes(perm);
}

/**
 * Права, появившиеся в новых версиях. У ролей, сохранённых в БД до обновления,
 * их нет в массиве permissions — администратору они доверяются неявно, а
 * роль «Склад» получает складские новинки; остальным их выдаёт админ в справочнике ролей.
 */
const IMPLIED: Partial<Record<string, Permission[]>> = {
  admin: ADDED_PERMISSIONS,
  warehouse: ["inventory.transfer", "data.import", "data.export", "reports.stock", "reports.movements", "reports.export"],
  dispatcher: ["reports.works", "reports.export"],
};
export function canWithRole(user: PermissionHolder & { role?: string }, perm: Permission): boolean {
  if (can(user, perm)) return true;
  return Boolean(user.role && IMPLIED[user.role]?.includes(perm));
}

export function canAny(user: PermissionHolder, perms: Permission[]): boolean {
  return perms.some((p) => can(user, p));
}

/** Любое из прав с учётом неявных прав системных ролей. */
export function canAnyWithRole(user: PermissionHolder & { role?: string }, perms: Permission[]): boolean {
  return perms.some((p) => canWithRole(user, p));
}

/** Цены товаров видны только ролям с явным правом (монтажникам и клиентам — никогда). */
export function canSeePrices(user: PermissionHolder & { role?: string }): boolean {
  if (user.scope === "client" || user.scope === "team") return false;
  return canWithRole(user, "catalog.prices.view") || canWithRole(user, "catalog.prices.manage");
}
export function canEditPrices(user: PermissionHolder & { role?: string }): boolean {
  if (user.scope === "client" || user.scope === "team") return false;
  return canWithRole(user, "catalog.prices.manage");
}

/**
 * Системные роли: создаются при первом запуске и защищены от удаления,
 * потому что на их коды опирается сид и первичный вход администратора.
 * Переименовать их и изменить набор прав можно.
 */
export const SYSTEM_ROLES: {
  /** Системный ключ роли (roles.sys_key); код в формате RL_ГГГГ_NNNNN генерируется. */
  code: string;
  name: string;
  description: string;
  scope: RoleScope;
  isFieldStaff: boolean;
  sortOrder: number;
  permissions: Permission[];
}[] = [
  {
    code: "admin",
    name: "Администратор",
    description: "Полный доступ ко всем разделам и справочникам",
    scope: "all",
    isFieldStaff: false,
    sortOrder: 10,
    permissions: ALL_PERMISSIONS.filter((p) => p !== "tickets.read.own" && p !== "inventory.read.team"),
  },
  {
    code: "dispatcher",
    name: "Диспетчер",
    description: "Приём заявок, назначение бригад, планирование выездов",
    scope: "all",
    isFieldStaff: false,
    sortOrder: 20,
    permissions: [
      "clients.read", "clients.manage", "sites.manage", "teams.read", "catalog.read",
      "tickets.read.all", "tickets.create", "tickets.assign", "tickets.schedule", "tickets.close",
      "tickets.cancel", "chat.write", "chat.internal", "inventory.read.all", "inventory.reserve", "reports.view",
      "reports.works", "reports.export",
    ],
  },
  {
    code: "technician",
    name: "Монтажник",
    description: "Работа по заявкам своей бригады, установка оборудования",
    scope: "team",
    isFieldStaff: true,
    sortOrder: 30,
    permissions: [
      "clients.read", "teams.read", "catalog.read", "tickets.read.own", "tickets.work",
      "chat.write", "chat.internal", "inventory.read.team", "inventory.reserve", "inventory.install",
    ],
  },
  {
    code: "warehouse",
    name: "Склад",
    description: "Приём, отгрузка бригадам, возвраты и списание",
    scope: "all",
    isFieldStaff: false,
    sortOrder: 40,
    permissions: [
      "teams.read", "catalog.read", "catalog.manage", "tickets.read.all", "chat.write", "chat.internal",
      "inventory.read.all", "inventory.receive", "inventory.issue", "inventory.return", "inventory.reserve",
      "inventory.writeoff", "inventory.transfer", "data.import", "data.export", "reports.inventory",
      "reports.stock", "reports.movements", "reports.export",
    ],
  },
  {
    code: "client",
    name: "Клиент",
    description: "Портал заказчика: свои заявки и переписка по ним",
    scope: "client",
    isFieldStaff: false,
    sortOrder: 50,
    permissions: ["tickets.read.own", "tickets.create", "chat.write"],
  },
];
