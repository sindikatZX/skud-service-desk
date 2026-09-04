import { ok, withAuth, parseBody, parseId, badRequest } from "@/lib/api";
import { backupFile, deleteBackup, restoreBackup } from "@/lib/services/admin";
import { backupRestoreSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** Скачать файл копии. */
export const GET = withAuth(async (_req, { params }) => {
  const { row, data } = await backupFile(parseId(params));
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${row.fileName}"`, "Content-Length": String(data.length), "Cache-Control": "no-store" },
  });
}, ["admin.backup"]);

/** Восстановить БД из копии (подтверждение: confirm = «ВОССТАНОВИТЬ»). */
export const POST = withAuth(async (req, { params, user }) => {
  const b = await parseBody(req, backupRestoreSchema);
  if (b.confirm !== "ВОССТАНОВИТЬ") throw badRequest("Для подтверждения введите слово ВОССТАНОВИТЬ");
  return ok(await restoreBackup(parseId(params), { backupFirst: b.backupFirst, userId: user.id }));
}, ["admin.backup"]);

export const DELETE = withAuth(async (_req, { params }) => {
  await deleteBackup(parseId(params));
  return ok({ deleted: true });
}, ["admin.backup"]);
