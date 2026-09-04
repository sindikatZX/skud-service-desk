import { ok, withAuth, parseBody, parseId, badRequest } from "@/lib/api";
import type { ZodType } from "zod";
import {
  updateTicketType, deleteTicketType,
  updatePriority, deletePriority,
  updateCategory, deleteCategory,
  updateMeasureUnit, deleteMeasureUnit,
  updateRole, deleteRole,
} from "@/lib/services/directories";
import {
  ticketTypeUpdateSchema, priorityUpdateSchema, categoryUpdateSchema, measureUnitUpdateSchema, roleUpdateSchema,
} from "@/lib/validators";

type Handler = {
  schema: ZodType<Record<string, unknown>>;
  update: (id: number, patch: never) => Promise<unknown>;
  remove: (id: number) => Promise<void>;
};

const HANDLERS: Record<string, Handler> = {
  "ticket-types": { schema: ticketTypeUpdateSchema as ZodType<Record<string, unknown>>, update: updateTicketType as Handler["update"], remove: deleteTicketType },
  priorities: { schema: priorityUpdateSchema as ZodType<Record<string, unknown>>, update: updatePriority as Handler["update"], remove: deletePriority },
  categories: { schema: categoryUpdateSchema as ZodType<Record<string, unknown>>, update: updateCategory as Handler["update"], remove: deleteCategory },
  "measure-units": { schema: measureUnitUpdateSchema as ZodType<Record<string, unknown>>, update: updateMeasureUnit as Handler["update"], remove: deleteMeasureUnit },
  roles: { schema: roleUpdateSchema as ZodType<Record<string, unknown>>, update: updateRole as Handler["update"], remove: deleteRole },
};

function handlerFor(dict: string): Handler {
  const h = HANDLERS[dict];
  if (!h) throw badRequest(`Неизвестный справочник «${dict}»`);
  return h;
}

export const PATCH = withAuth(async (req, { params }) => {
  const h = handlerFor(params.dict);
  const body = await parseBody(req, h.schema);
  return ok(await h.update(parseId(params), body as never));
}, ["directories.manage"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await handlerFor(params.dict).remove(parseId(params));
  return ok({ deleted: true });
}, ["directories.manage"]);
