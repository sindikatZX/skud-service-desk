import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ─────────────────────────── ENUMS ───────────────────────────
//
// Перечислениями остаётся только то, с чем связана логика кода: статусы заявок
// (конечный автомат переходов), статусы складских единиц и типы операций.
// Всё, что пользователь должен уметь заводить сам (роли, типы работ, приоритеты,
// категории оборудования, единицы измерения), вынесено в таблицы-справочники ниже.

export const ticketStatusEnum = pgEnum("ticket_status", [
  "new",
  "assigned",
  "scheduled",
  "in_progress",
  "on_hold",
  "done",
  "closed",
  "cancelled",
]);

/** Область видимости данных, которую даёт роль. */
export const roleScopeEnum = pgEnum("role_scope", ["all", "team", "client"]);

export const unitStatusEnum = pgEnum("unit_status", [
  "in_warehouse",
  "at_team",
  "reserved",
  "installed",
  "written_off",
]);

export const locationTypeEnum = pgEnum("location_type", ["warehouse", "team", "site"]);

export const txTypeEnum = pgEnum("stock_tx_type", [
  "receive",
  "issue_to_team",
  "return_to_warehouse",
  "reserve",
  "unreserve",
  "install",
  "write_off",
  "transfer",
]);

/** Тип складского документа: поступление (партия), перемещение, списание. */
export const stockDocTypeEnum = pgEnum("stock_doc_type", ["receipt", "transfer", "writeoff"]);

/** Вид склада: центральный, транзитный, склад бригады (привязан к бригаде), прочий. */
export const warehouseKindEnum = pgEnum("warehouse_kind", ["central", "transit", "team", "other"]);

export const reservationStatusEnum = pgEnum("reservation_status", ["active", "consumed", "cancelled"]);

// ─────────────────────────── СПРАВОЧНИКИ ───────────────────────────
// Редактируются из раздела «Справочники» (/directories). Записи со isSystem = true
// нельзя удалить: на их коды опирается код (например, роль admin или тип «Ремонт»
// по умолчанию), но переименовать и настроить их можно.

/** Роль с собственным набором прав. Права хранятся кодами из lib/rbac. */
export const roles = pgTable(
  "roles",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Какие данные видит роль: все / только своей бригады / только своего клиента. */
    scope: roleScopeEnum("scope").notNull().default("all"),
    /** Может входить в состав бригады (монтажник). */
    isFieldStaff: boolean("is_field_staff").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    permissions: text("permissions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roles_code_idx").on(t.code)],
);

/** Тип работ по заявке (Монтаж, ТО, Ремонт…). */
export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ticket_types_code_idx").on(t.code)],
);

/** Приоритет заявки. slaHours задаёт срок исполнения по умолчанию. */
export const ticketPriorities = pgTable(
  "ticket_priorities",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Часы на решение: подставляются в «Срок», если он не задан вручную. */
    slaHours: integer("sla_hours"),
    /** Tailwind-классы для подсветки в интерфейсе. */
    colorClass: text("color_class").notNull().default("text-slate-700"),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ticket_priorities_code_idx").on(t.code)],
);

/** Категория номенклатуры (камера, контроллер, кабель…). */
export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Родительская папка (иерархия групп номенклатуры как в 1С). null — корень. */
    parentId: integer("parent_id"),
    /** Код группы во внешней системе (1С) — для повторного импорта. */
    externalCode: text("external_code"),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("catalog_categories_code_idx").on(t.code), index("catalog_categories_parent_idx").on(t.parentId)],
);

/** Единица измерения номенклатуры (шт, м, компл…). */
export const measureUnits = pgTable(
  "measure_units",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("measure_units_code_idx").on(t.code)],
);

/** Справочник работ (виды услуг): подставляется в акт выполненных работ по заявке. */
export const workCatalog = pgTable(
  "work_catalog",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("шт"),
    /** Нормативная длительность, минут. */
    defaultMinutes: integer("default_minutes"),
    price: numeric("price", { precision: 12, scale: 2 }),
    externalCode: text("external_code"),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_catalog_code_idx").on(t.code)],
);

// ─────────────────────────── USERS / CLIENTS ───────────────────────────

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inn: text("inn"),
  contactPerson: text("contact_person"),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sites = pgTable(
  "sites",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address").notNull(),
    contactPerson: text("contact_person"),
    contactPhone: text("contact_phone"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sites_client_idx").on(t.clientId)],
);

// ─────────────────────────── TEAMS / VEHICLES ───────────────────────────

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Склады (мультисклад). Центральный и транзитный создаются автоматически; для каждой
 * бригады заводится склад вида «team» (остатки бригады = остатки её склада).
 */
export const warehouses = pgTable(
  "warehouses",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: warehouseKindEnum("kind").notNull().default("other"),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "cascade" }),
    address: text("address"),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("warehouses_code_idx").on(t.code), uniqueIndex("warehouses_team_idx").on(t.teamId)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isLead: boolean("is_lead").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [index("team_members_team_idx").on(t.teamId), index("team_members_user_idx").on(t.userId)],
);

export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  plateNumber: text("plate_number").notNull(),
  model: text("model").notNull(),
  year: integer("year"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vehicleAssignments = pgTable(
  "vehicle_assignments",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [index("vehicle_assign_team_idx").on(t.teamId), index("vehicle_assign_vehicle_idx").on(t.vehicleId)],
);

// ─────────────────────────── CATALOG / INVENTORY ───────────────────────────

/** Номенклатура: тип оборудования/материала. */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: serial("id").primaryKey(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    /** Код элемента в 1С (для сопоставления при повторном импорте). */
    externalCode: text("external_code"),
    fullName: text("full_name"),
    categoryId: integer("category_id")
      .notNull()
      .references(() => catalogCategories.id),
    /** Код единицы измерения из справочника measure_units. */
    unit: text("unit").notNull().default("шт"),
    isSerialized: boolean("is_serialized").notNull().default(false),
    manufacturer: text("manufacturer"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("catalog_sku_idx").on(t.sku)],
);

/** Конкретная физическая единица серийного оборудования. */
export const equipmentUnits = pgTable(
  "equipment_units",
  {
    id: serial("id").primaryKey(),
    catalogItemId: integer("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    serialNumber: text("serial_number").notNull(),
    macAddress: text("mac_address"),
    status: unitStatusEnum("status").notNull().default("in_warehouse"),
    locationType: locationTypeEnum("location_type").notNull().default("warehouse"),
    /** Склад (для locationType = warehouse). */
    warehouseId: integer("warehouse_id"),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
    siteId: integer("site_id").references(() => sites.id, { onDelete: "set null" }),
    ticketId: integer("ticket_id"),
    /** Документ поступления (партия), которым единица оприходована. */
    receiptDocumentId: integer("receipt_document_id"),
    installedAt: timestamp("installed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("units_serial_idx").on(t.serialNumber),
    index("units_status_idx").on(t.status),
    index("units_team_idx").on(t.teamId),
    index("units_site_idx").on(t.siteId),
  ],
);

/** Количественные остатки несерийных материалов (доступные, без резерва). */
export const stockBalances = pgTable(
  "stock_balances",
  {
    id: serial("id").primaryKey(),
    catalogItemId: integer("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    locationType: locationTypeEnum("location_type").notNull(),
    /** 0 для склада, id бригады для остатков бригады */
    teamId: integer("team_id").notNull().default(0),
    /** id склада для locationType = warehouse, 0 для остатков бригады */
    warehouseId: integer("warehouse_id").notNull().default(0),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stock_balance_uniq").on(t.catalogItemId, t.locationType, t.teamId, t.warehouseId)],
);

/** Резервы несерийных материалов под заявку. */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: serial("id").primaryKey(),
    catalogItemId: integer("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    ticketId: integer("ticket_id").notNull(),
    locationType: locationTypeEnum("location_type").notNull(),
    teamId: integer("team_id").notNull().default(0),
    warehouseId: integer("warehouse_id").notNull().default(0),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
    status: reservationStatusEnum("status").notNull().default("active"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reservations_ticket_idx").on(t.ticketId)],
);

/** Журнал складских операций (единый источник истории движения). */
export const stockTransactions = pgTable(
  "stock_transactions",
  {
    id: serial("id").primaryKey(),
    type: txTypeEnum("type").notNull(),
    catalogItemId: integer("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    unitId: integer("unit_id").references(() => equipmentUnits.id, { onDelete: "set null" }),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    fromLocationType: locationTypeEnum("from_location_type"),
    fromTeamId: integer("from_team_id"),
    toLocationType: locationTypeEnum("to_location_type"),
    toTeamId: integer("to_team_id"),
    fromWarehouseId: integer("from_warehouse_id"),
    toWarehouseId: integer("to_warehouse_id"),
    /** Складской документ (поступление/перемещение/списание), породивший операцию. */
    documentId: integer("document_id"),
    teamId: integer("team_id"),
    ticketId: integer("ticket_id"),
    clientId: integer("client_id"),
    siteId: integer("site_id"),
    actorId: integer("actor_id").references(() => users.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tx_document_idx").on(t.documentId),
    index("tx_unit_idx").on(t.unitId),
    index("tx_ticket_idx").on(t.ticketId),
    index("tx_team_idx").on(t.teamId),
    index("tx_client_idx").on(t.clientId),
    index("tx_created_idx").on(t.createdAt),
  ],
);

/**
 * Складские документы: Поступление (= партия), Перемещение, Списание.
 * Нумеруются по типу (ПН-000001, ПМ-000001, СП-000001), имеют дату и строки.
 */
export const stockDocuments = pgTable(
  "stock_documents",
  {
    id: serial("id").primaryKey(),
    type: stockDocTypeEnum("type").notNull(),
    number: text("number").notNull(),
    /** Номер входящего документа поставщика (для поступления). */
    externalNumber: text("external_number"),
    docDate: timestamp("doc_date", { withTimezone: true }).notNull().defaultNow(),
    fromWarehouseId: integer("from_warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    toWarehouseId: integer("to_warehouse_id").references(() => warehouses.id, { onDelete: "set null" }),
    supplier: text("supplier"),
    note: text("note"),
    linesCount: integer("lines_count").notNull().default(0),
    totalQuantity: numeric("total_quantity", { precision: 14, scale: 3 }).notNull().default("0"),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stock_documents_number_idx").on(t.type, t.number), index("stock_documents_date_idx").on(t.docDate)],
);

export const stockDocumentLines = pgTable(
  "stock_document_lines",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => stockDocuments.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull().default(1),
    catalogItemId: integer("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    /** Серийные номера строки (для серийного оборудования). */
    serialNumbers: text("serial_numbers")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    price: numeric("price", { precision: 12, scale: 2 }),
    note: text("note"),
  },
  (t) => [index("stock_document_lines_doc_idx").on(t.documentId), index("stock_document_lines_item_idx").on(t.catalogItemId)],
);

/**
 * Вложения чата заявки. Файлы хранятся вне public/ под случайными именами без
 * расширения; отдаются только через API с проверкой доступа и безопасными заголовками.
 */
export const ticketAttachments = pgTable(
  "ticket_attachments",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull(),
    commentId: integer("comment_id"),
    uploaderId: integer("uploader_id").references(() => users.id, { onDelete: "set null" }),
    originalName: text("original_name").notNull(),
    storedName: text("stored_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    /** image | video | audio | pdf | file — определяется по содержимому, не по расширению. */
    kind: text("kind").notNull().default("file"),
    sha256: text("sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attachments_ticket_idx").on(t.ticketId), index("attachments_comment_idx").on(t.commentId)],
);

// ─────────────────────────── TICKETS ───────────────────────────

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    number: text("number").notNull().default(""),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id),
    typeId: integer("type_id")
      .notNull()
      .references(() => ticketTypes.id),
    priorityId: integer("priority_id")
      .notNull()
      .references(() => ticketPriorities.id),
    status: ticketStatusEnum("status").notNull().default("new"),
    title: text("title").notNull(),
    description: text("description"),
    dispatcherId: integer("dispatcher_id").references(() => users.id, { onDelete: "set null" }),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    resultNote: text("result_note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tickets_status_idx").on(t.status),
    index("tickets_client_idx").on(t.clientId),
    index("tickets_site_idx").on(t.siteId),
    index("tickets_team_idx").on(t.teamId),
  ],
);

export const ticketStatusHistory = pgTable(
  "ticket_status_history",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    fromStatus: ticketStatusEnum("from_status"),
    toStatus: ticketStatusEnum("to_status").notNull(),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tsh_ticket_idx").on(t.ticketId)],
);

/** Выполненные работы по заявке. */
export const ticketWorks = pgTable(
  "ticket_works",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull().default("1"),
    unit: text("unit").notNull().default("шт"),
    durationMinutes: integer("duration_minutes"),
    performedBy: integer("performed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("works_ticket_idx").on(t.ticketId), index("works_performer_idx").on(t.performedBy)],
);

/** Установленное по заявке оборудование/материалы (= оборудование на объекте). */
export const ticketMaterials = pgTable(
  "ticket_materials",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.id),
    catalogItemId: integer("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    unitId: integer("unit_id").references(() => equipmentUnits.id, { onDelete: "set null" }),
    quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
    installedBy: integer("installed_by").references(() => users.id, { onDelete: "set null" }),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [index("materials_ticket_idx").on(t.ticketId), index("materials_site_idx").on(t.siteId)],
);

/**
 * Чат по заявке: обсуждение между диспетчерами, бригадой и (при isInternal = false)
 * заказчиком. Сообщения не удаляются вместе с автором — авторство обнуляется.
 */
export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
    /** Имя автора на момент отправки — сообщение остаётся читаемым после удаления сотрудника. */
    authorName: text("author_name").notNull().default(""),
    text: text("text").notNull(),
    /** true — внутреннее обсуждение, клиент такие сообщения не видит. */
    isInternal: boolean("is_internal").notNull().default(true),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_ticket_idx").on(t.ticketId, t.createdAt)],
);

// ─────────────────────────── RELATIONS ───────────────────────────

export const clientsRelations = relations(clients, ({ many }) => ({
  sites: many(sites),
  tickets: many(tickets),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  client: one(clients, { fields: [sites.clientId], references: [clients.id] }),
  tickets: many(tickets),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  vehicles: many(vehicleAssignments),
  tickets: many(tickets),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  client: one(clients, { fields: [tickets.clientId], references: [clients.id] }),
  site: one(sites, { fields: [tickets.siteId], references: [sites.id] }),
  team: one(teams, { fields: [tickets.teamId], references: [teams.id] }),
  ticketType: one(ticketTypes, { fields: [tickets.typeId], references: [ticketTypes.id] }),
  priority: one(ticketPriorities, { fields: [tickets.priorityId], references: [ticketPriorities.id] }),
  works: many(ticketWorks),
  materials: many(ticketMaterials),
  comments: many(ticketComments),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  client: one(clients, { fields: [users.clientId], references: [clients.id] }),
}));

export const catalogItemsRelations = relations(catalogItems, ({ one, many }) => ({
  category: one(catalogCategories, { fields: [catalogItems.categoryId], references: [catalogCategories.id] }),
  units: many(equipmentUnits),
}));

// ─────────────────────────── TYPES ───────────────────────────

export type User = typeof users.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type EquipmentUnit = typeof equipmentUnits.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type StockTransaction = typeof stockTransactions.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type TicketType = typeof ticketTypes.$inferSelect;
export type TicketPriority = typeof ticketPriorities.$inferSelect;
export type CatalogCategory = typeof catalogCategories.$inferSelect;
export type MeasureUnit = typeof measureUnits.$inferSelect;
export type TicketComment = typeof ticketComments.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;
export type StockDocument = typeof stockDocuments.$inferSelect;
export type StockDocumentLine = typeof stockDocumentLines.$inferSelect;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type WorkCatalogItem = typeof workCatalog.$inferSelect;
export type WarehouseKind = (typeof warehouseKindEnum.enumValues)[number];
export type StockDocType = (typeof stockDocTypeEnum.enumValues)[number];
export type RoleScope = (typeof roleScopeEnum.enumValues)[number];
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];
