import { ok, withAuth, parseBody, forbidden, badRequest } from "@/lib/api";
import { IMPORT_TEMPLATES, runImport, templateCsv, exportCsv } from "@/lib/services/import";
import { importSchema } from "@/lib/validators";
import { canWithRole, canEditPrices, canSeePrices } from "@/lib/rbac";
import { csvResponse, datedName } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * GET  — описание шаблона; ?template=1 — скачать CSV-шаблон; ?export=1 — выгрузить справочник в CSV.
 * POST — импорт: строки CSV, разобранные на клиенте. Сопоставление — по уникальному коду.
 */
export const GET = withAuth(async (req, { user, params }) => {
  const tpl = IMPORT_TEMPLATES[params.entity];
  if (!tpl) throw badRequest("Неизвестный шаблон импорта");
  const sp = new URL(req.url).searchParams;
  if (sp.get("template") === "1") return csvResponse(templateCsv(params.entity), `template-${params.entity}.csv`);
  if (sp.get("export") === "1") {
    if (!canWithRole(user, "data.export") && !canWithRole(user, "directories.manage")) throw forbidden("Нет права на экспорт справочников");
    const { csv } = await exportCsv(params.entity, { canPrices: canSeePrices(user) });
    return csvResponse(csv, datedName(`${params.entity}`));
  }
  // Без права на цены колонка «Цена» из шаблона скрывается.
  const fields = tpl.priceField && !canEditPrices(user) ? tpl.fields.filter((f) => f.key !== tpl.priceField) : tpl.fields;
  return ok({ ...tpl, fields });
});

export const POST = withAuth(async (req, { user, params }) => {
  if (!canWithRole(user, "data.import") && !canWithRole(user, "directories.manage")) throw forbidden("Нет права на импорт");
  if ((params.entity === "employees" || params.entity === "roles") && !canWithRole(user, "users.manage")) throw forbidden("Импорт сотрудников и ролей доступен только администратору");
  const b = await parseBody(req, importSchema);
  return ok(await runImport(params.entity, b.rows, b.mapping, b.options, { actorId: user.id, canPrices: canEditPrices(user) }));
}, ["data.import", "directories.manage", "catalog.manage"]);
