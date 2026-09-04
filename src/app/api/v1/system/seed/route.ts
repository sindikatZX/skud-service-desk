import { ok, withAuth } from "@/lib/api";
import { seedIfEmpty } from "@/db/seed";
/** Загрузка демо-данных (только если БД пуста). */
export const POST = withAuth(async () => ok({ seeded: await seedIfEmpty() }), ["users.manage"]);
