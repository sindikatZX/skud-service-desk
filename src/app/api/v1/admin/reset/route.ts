import { ok, withAuth, parseBody, badRequest } from "@/lib/api";
import { resetData } from "@/lib/services/admin";
import { resetSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** Очистка несистемных данных «с чистого листа» (подтверждение: confirm = «ОЧИСТИТЬ»). */
export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, resetSchema);
  if (b.confirm !== "ОЧИСТИТЬ") throw badRequest("Для подтверждения введите слово ОЧИСТИТЬ");
  return ok(await resetData({ keepUsers: b.keepUsers, backupFirst: b.backupFirst, userId: user.id }));
}, ["admin.maintenance"]);
