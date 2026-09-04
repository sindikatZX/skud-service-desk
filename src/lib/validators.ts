import { z } from "zod";
import { ALL_PERMISSIONS } from "@/lib/rbac";

/**
 * Единое место описания входных данных всех эндпоинтов `/api/v1`.
 * Роуты не парсят тело руками: `parseBody(req, schema)` / `parseQuery(req, schema)`.
 */

export const id = z.coerce.number().int().positive();
export const optionalId = z.coerce.number().int().positive().nullable().optional();
const trimmed = (max: number) => z.string().trim().max(max);
const name = (max = 200) => trimmed(max).min(1, "не может быть пустым");
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Дата из ISO-строки или datetime-local. Пустая строка → null. */
export const dateish = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

export const quantity = z.coerce.number().positive("должно быть больше нуля").max(1_000_000);

/** Код записи справочника: латиница/цифры/подчёркивание. */
export const dictCode = z
  .string()
  .trim()
  .min(1, "укажите код")
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/i, "только латинские буквы, цифры и _, начиная с буквы")
  .transform((v) => v.toLowerCase());

// ─────────────────────────── AUTH ───────────────────────────

export const loginSchema = z.object({
  email: z.string().trim().min(1, "укажите email").email("некорректный email").toLowerCase(),
  password: z.string().min(1, "укажите пароль"),
});

// ─────────────────────────── КЛИЕНТЫ / ОБЪЕКТЫ ───────────────────────────

export const clientCreateSchema = z.object({
  name: name(200),
  inn: optionalText(20),
  contactPerson: optionalText(200),
  phone: optionalText(50),
  email: optionalText(200),
  notes: optionalText(),
});
export const clientUpdateSchema = clientCreateSchema.partial().extend({ isActive: z.boolean().optional() });

export const siteCreateSchema = z.object({
  name: name(200),
  address: name(300),
  contactPerson: optionalText(200),
  contactPhone: optionalText(50),
  notes: optionalText(),
});
export const siteUpdateSchema = siteCreateSchema.partial().extend({ isActive: z.boolean().optional() });

// ─────────────────────────── СОТРУДНИКИ ───────────────────────────

export const userCreateSchema = z.object({
  email: z.string().trim().min(1, "укажите email").email("некорректный email").toLowerCase(),
  password: z.string().min(6, "минимум 6 символов"),
  fullName: name(200),
  phone: optionalText(50),
  roleId: id,
  clientId: optionalId,
});
export const userUpdateSchema = z.object({
  fullName: name(200).optional(),
  phone: optionalText(50),
  roleId: id.optional(),
  clientId: optionalId,
  isActive: z.boolean().optional(),
  password: z.string().min(6, "минимум 6 символов").optional(),
});

// ─────────────────────────── БРИГАДЫ / ТЕХНИКА ───────────────────────────

export const teamCreateSchema = z.object({ name: name(120), description: optionalText(500) });
export const teamUpdateSchema = teamCreateSchema.partial().extend({ isActive: z.boolean().optional() });
export const teamMemberSchema = z.object({ userId: id, isLead: z.boolean().optional() });
export const teamMemberRemoveSchema = z.object({ userId: id });
export const vehicleCreateSchema = z.object({
  plateNumber: name(20),
  model: name(120),
  year: z.coerce.number().int().min(1980).max(2100).nullish(),
  notes: optionalText(500),
});
export const vehicleAssignSchema = z.object({ vehicleId: id });

// ─────────────────────────── НОМЕНКЛАТУРА ───────────────────────────

export const catalogCreateSchema = z.object({
  /** Артикул не обязателен: при импорте из 1С берётся из таблицы, иначе генерируется. */
  sku: trimmed(60).optional().transform((v) => (v ? v : undefined)),
  name: name(200),
  externalCode: optionalText(60),
  fullName: optionalText(500),
  categoryId: id,
  unit: name(20).default("шт"),
  isSerialized: z.boolean().optional().default(false),
  manufacturer: optionalText(120),
  description: optionalText(),
});
export const catalogUpdateSchema = z.object({
  sku: name(60).optional(),
  name: name(200).optional(),
  externalCode: optionalText(60),
  fullName: optionalText(500),
  categoryId: id.optional(),
  unit: name(20).optional(),
  isSerialized: z.boolean().optional(),
  manufacturer: optionalText(120),
  description: optionalText(),
  isActive: z.boolean().optional(),
});

// ─────────────────────────── ЗАЯВКИ ───────────────────────────

export const ticketCreateSchema = z.object({
  clientId: id,
  siteId: id,
  title: name(300),
  description: optionalText(),
  typeId: id,
  priorityId: id,
  dueAt: dateish,
  teamId: optionalId,
  scheduledStart: dateish,
  scheduledEnd: dateish,
});

export const ticketUpdateSchema = z.object({
  title: name(300).optional(),
  description: optionalText(),
  typeId: id.optional(),
  priorityId: id.optional(),
  dueAt: dateish,
  teamId: optionalId,
  dispatcherId: optionalId,
  scheduledStart: dateish,
  scheduledEnd: dateish,
  resultNote: optionalText(),
});

export const ticketStatusSchema = z.object({
  status: z.enum(["new", "assigned", "scheduled", "in_progress", "on_hold", "done", "closed", "cancelled"]),
  comment: optionalText(1000),
});

export const ticketListQuerySchema = z.object({
  status: z.string().trim().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive().optional(),
  siteId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(200).optional(),
  overdue: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const workCreateSchema = z.object({
  description: name(500),
  quantity: z.coerce.number().positive().max(100000).optional(),
  unit: name(20).optional(),
  durationMinutes: z.coerce.number().int().min(0).max(100000).nullish(),
  performedBy: optionalId,
});

// ─────────────────────────── ЧАТ ───────────────────────────

export const chatPostSchema = z.object({
  text: z.string().trim().min(1, "сообщение не может быть пустым").max(4000),
  isInternal: z.boolean().optional(),
});
export const chatQuerySchema = z.object({
  afterId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export const chatEditSchema = z.object({ text: z.string().trim().min(1).max(4000) });

// ─────────────────────────── СКЛАД ───────────────────────────

export const receiveSchema = z
  .object({
    catalogItemId: id,
    quantity: z.coerce.number().positive().max(1_000_000).optional(),
    units: z
      .array(z.object({ serialNumber: name(120), macAddress: optionalText(60) }))
      .max(500)
      .optional(),
    note: optionalText(500),
  })
  .refine((v) => v.quantity !== undefined || (v.units?.length ?? 0) > 0, {
    message: "укажите количество или серийные номера",
    path: ["quantity"],
  });

export const issueSchema = z
  .object({
    teamId: id,
    catalogItemId: optionalId,
    unitId: optionalId,
    quantity: z.coerce.number().positive().max(1_000_000).optional(),
    note: optionalText(500),
  })
  .refine((v) => v.catalogItemId || v.unitId, { message: "укажите номенклатуру или единицу", path: ["catalogItemId"] });

export const returnSchema = issueSchema;

export const reserveSchema = z
  .object({
    ticketId: id,
    catalogItemId: optionalId,
    unitId: optionalId,
    quantity: z.coerce.number().positive().max(1_000_000).optional(),
    fromWarehouse: z.boolean().optional(),
    note: optionalText(500),
  })
  .refine((v) => v.catalogItemId || v.unitId, { message: "укажите номенклатуру или единицу", path: ["catalogItemId"] });

export const unreserveSchema = z
  .object({ reservationId: optionalId, unitId: optionalId })
  .refine((v) => v.reservationId || v.unitId, { message: "укажите резерв или единицу", path: ["reservationId"] });

export const installSchema = reserveSchema;

export const writeOffSchema = z
  .object({
    catalogItemId: optionalId,
    unitId: optionalId,
    teamId: optionalId,
    quantity: z.coerce.number().positive().max(1_000_000).optional(),
    note: optionalText(500),
  })
  .refine((v) => v.catalogItemId || v.unitId, { message: "укажите номенклатуру или единицу", path: ["catalogItemId"] });

const docLine = z.object({
  catalogItemId: optionalId,
  quantity: z.coerce.number().positive().max(1_000_000).optional(),
  units: z.array(z.object({ serialNumber: name(120), macAddress: optionalText(60) })).optional(),
  unitIds: z.array(id).optional(),
  price: z.coerce.number().min(0).max(1e9).nullish(),
  note: optionalText(300),
});

export const receiptDocSchema = z.object({
  toWarehouseId: optionalId,
  number: optionalText(40),
  externalNumber: optionalText(80),
  docDate: dateish,
  supplier: optionalText(200),
  note: optionalText(500),
  lines: z.array(docLine).min(1, "добавьте позиции"),
});

export const transferDocSchema = z.object({
  fromWarehouseId: id,
  toWarehouseId: id,
  number: optionalText(40),
  docDate: dateish,
  note: optionalText(500),
  lines: z.array(docLine).min(1, "добавьте позиции"),
});

export const writeOffDocSchema = z.object({
  fromWarehouseId: optionalId,
  number: optionalText(40),
  docDate: dateish,
  note: optionalText(500),
  lines: z.array(docLine).min(1, "добавьте позиции"),
});

export const documentsQuerySchema = z.object({
  type: z.string().trim().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  from: dateish,
  to: dateish,
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const unitUpdateSchema = z.object({
  macAddress: optionalText(60),
  notes: optionalText(500),
});

export const transactionsQuerySchema = z.object({
  unitId: z.coerce.number().int().positive().optional(),
  ticketId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().optional(),
  clientId: z.coerce.number().int().positive().optional(),
  catalogItemId: z.coerce.number().int().positive().optional(),
  type: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const stockQuerySchema = z.object({
  locationType: z.enum(["warehouse", "team"]).optional(),
  teamId: z.coerce.number().int().min(0).optional(),
  warehouseId: z.coerce.number().int().min(0).optional(),
});

// ─────────────────────────── СПРАВОЧНИКИ ───────────────────────────

const dictBase = {
  code: dictCode,
  name: name(120),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
};

export const ticketTypeCreateSchema = z.object(dictBase);
export const ticketTypeUpdateSchema = z.object({ ...dictBase, code: dictCode.optional(), name: name(120).optional() });

export const priorityCreateSchema = z.object({
  ...dictBase,
  slaHours: z.coerce.number().int().min(0).max(100000).nullish(),
  colorClass: trimmed(120).optional(),
});
export const priorityUpdateSchema = priorityCreateSchema.partial();

export const categoryCreateSchema = z.object({ ...dictBase, parentId: optionalId });
export const categoryUpdateSchema = categoryCreateSchema.partial();

export const workCatalogCreateSchema = z.object({
  ...dictBase,
  unit: trimmed(20).optional(),
  defaultMinutes: z.coerce.number().int().min(0).max(100000).nullish(),
  price: z.coerce.number().min(0).max(1e9).nullish(),
});
export const workCatalogUpdateSchema = workCatalogCreateSchema.partial();

export const warehouseCreateSchema = z.object({
  ...dictBase,
  kind: z.enum(["central", "transit", "team", "other"]).optional(),
  address: optionalText(300),
});
export const warehouseUpdateSchema = warehouseCreateSchema.partial();

/** Массовые действия над номенклатурой (галочки в списке). */
export const catalogBulkSchema = z.object({
  ids: z.array(id).min(1, "выберите позиции"),
  action: z.enum(["activate", "deactivate", "move", "delete"]),
  categoryId: optionalId,
});

/** Самостоятельное изменение учётной записи (без роли). */
export const profileUpdateSchema = z
  .object({
    fullName: name(200).optional(),
    /** undefined — поле не трогаем; пустая строка — очистить. */
    phone: z
      .string()
      .trim()
      .max(50)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
    email: z.string().trim().email("некорректный email").toLowerCase().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6, "минимум 6 символов").optional(),
  })
  .refine((v) => !v.newPassword || v.currentPassword, { message: "укажите текущий пароль", path: ["currentPassword"] })
  .refine((v) => !v.email || v.currentPassword, { message: "для смены логина укажите текущий пароль", path: ["currentPassword"] });

/** Импорт CSV: строки уже разобраны на клиенте в объекты «колонка → значение». */
export const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.string().max(2000))).min(1, "файл пуст").max(20000, "не более 20 000 строк за раз"),
  mapping: z.record(z.string(), z.string()).optional(),
  options: z.record(z.string(), z.union([z.string(), z.boolean(), z.number()])).optional(),
});

export const measureUnitCreateSchema = z.object({
  ...dictBase,
  code: z.string().trim().min(1, "укажите код").max(20),
});
export const measureUnitUpdateSchema = measureUnitCreateSchema.partial();

export const roleCreateSchema = z.object({
  code: dictCode,
  name: name(120),
  description: optionalText(500),
  scope: z.enum(["all", "team", "client"]).default("all"),
  isFieldStaff: z.boolean().optional().default(false),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).default([]),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});
export const roleUpdateSchema = roleCreateSchema.partial();

/** Тело запроса на удаление: подтверждение каскадного удаления зависимых записей. */
export const deleteQuerySchema = z.object({
  cascade: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
