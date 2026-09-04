import { ok, withAuth, parseBody } from "@/lib/api";
import { maintenance, integrityCheck, integrityRepair, dbStats } from "@/lib/services/admin";
import { maintenanceSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** Состояние БД и результат проверки целостности. */
export const GET = withAuth(async () => ok({ stats: await dbStats(), integrity: await integrityCheck() }), ["admin.maintenance"]);

/** Обслуживание: vacuum | analyze | reindex | check | repair (repair — с предварительной копией). */
export const POST = withAuth(async (req, { user }) => {
  const b = await parseBody(req, maintenanceSchema);
  if (b.action === "check") return ok(await integrityCheck());
  if (b.action === "repair") return ok(await integrityRepair({ backupFirst: b.backupFirst, userId: user.id }));
  return ok(await maintenance(b.action));
}, ["admin.maintenance"]);
