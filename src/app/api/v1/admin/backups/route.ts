import { ok, withAuth, parseBody, badRequest } from "@/lib/api";
import { createBackup, listBackups, importBackupFile, dbStats } from "@/lib/services/admin";
import { backupCreateSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** Список резервных копий + состояние БД. */
export const GET = withAuth(async () => ok({ backups: await listBackups(), stats: await dbStats() }), ["admin.backup", "admin.maintenance"]);

/** Создать копию (JSON {note}) или загрузить файл копии (multipart, поле file). */
export const POST = withAuth(async (req, { user }) => {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw badRequest("Файл не передан");
    if (file.size > 512 * 1024 * 1024) throw badRequest("Файл слишком большой");
    const buf = Buffer.from(await file.arrayBuffer());
    return ok(await importBackupFile(buf, file.name, user.id), { status: 201 });
  }
  const b = await parseBody(req, backupCreateSchema);
  return ok(await createBackup({ reason: "manual", note: b.note, userId: user.id }), { status: 201 });
}, ["admin.backup"]);
