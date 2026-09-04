import { ok, withAuth, parseBody, forbidden, badRequest } from "@/lib/api";
import { IMPORT_TEMPLATES, runImport, templateCsv } from "@/lib/services/import";
import { importSchema } from "@/lib/validators";
import { canWithRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** Описание шаблона; ?template=1 — скачать CSV-шаблон. */
export const GET = withAuth(async (req, { params }) => {
  const tpl = IMPORT_TEMPLATES[params.entity];
  if (!tpl) throw badRequest("Неизвестный шаблон импорта");
  if (new URL(req.url).searchParams.get("template") === "1") {
    return new Response(templateCsv(params.entity), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="template-${params.entity}.csv"` },
    });
  }
  return ok(tpl);
});

/** Импорт: строки CSV, разобранные на клиенте. */
export const POST = withAuth(async (req, { user, params }) => {
  if (!canWithRole(user, "data.import") && !canWithRole(user, "directories.manage")) throw forbidden("Нет права на импорт");
  const b = await parseBody(req, importSchema);
  return ok(await runImport(params.entity, b.rows, b.mapping, b.options, user.id));
}, ["data.import", "directories.manage", "catalog.manage"]);
