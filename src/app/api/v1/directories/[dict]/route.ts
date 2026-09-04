import { ok, withAuth, parseBody, badRequest } from "@/lib/api";
import type { ZodType } from "zod";
import {
  listTicketTypes, createTicketType,
  listPriorities, createPriority,
  listCategories, createCategory,
  listMeasureUnits, createMeasureUnit,
  listRoles, createRole,
  listWorkCatalog, createWorkCatalog,
  listWarehousesDict, createWarehouseDict,
} from "@/lib/services/directories";
import {
  ticketTypeCreateSchema, priorityCreateSchema, categoryCreateSchema, measureUnitCreateSchema, roleCreateSchema,
  workCatalogCreateSchema, warehouseCreateSchema,
} from "@/lib/validators";

/**
 * Единая точка входа для всех справочников: /api/v1/directories/{dict}.
 * dict — ticket-types | priorities | categories | measure-units | roles.
 */
type Handler = {
  list: () => Promise<unknown>;
  schema: ZodType<Record<string, unknown>>;
  create: (input: never) => Promise<unknown>;
};

const HANDLERS: Record<string, Handler> = {
  "ticket-types": { list: listTicketTypes, schema: ticketTypeCreateSchema as ZodType<Record<string, unknown>>, create: createTicketType as Handler["create"] },
  priorities: { list: listPriorities, schema: priorityCreateSchema as ZodType<Record<string, unknown>>, create: createPriority as Handler["create"] },
  categories: { list: listCategories, schema: categoryCreateSchema as ZodType<Record<string, unknown>>, create: createCategory as Handler["create"] },
  "measure-units": { list: listMeasureUnits, schema: measureUnitCreateSchema as ZodType<Record<string, unknown>>, create: createMeasureUnit as Handler["create"] },
  roles: { list: listRoles, schema: roleCreateSchema as ZodType<Record<string, unknown>>, create: createRole as Handler["create"] },
  works: { list: listWorkCatalog, schema: workCatalogCreateSchema as ZodType<Record<string, unknown>>, create: createWorkCatalog as Handler["create"] },
  warehouses: { list: () => listWarehousesDict(), schema: warehouseCreateSchema as ZodType<Record<string, unknown>>, create: createWarehouseDict as Handler["create"] },
};

function handlerFor(dict: string): Handler {
  const h = HANDLERS[dict];
  if (!h) throw badRequest(`Неизвестный справочник «${dict}»`);
  return h;
}

// Читать справочники может любой авторизованный пользователь: они нужны для форм.
export const GET = withAuth(async (_req, { params }) => ok(await handlerFor(params.dict).list()));

export const POST = withAuth(async (req, { params }) => {
  const h = handlerFor(params.dict);
  const body = await parseBody(req, h.schema);
  return ok(await h.create(body as never), { status: 201 });
}, ["directories.manage"]);
