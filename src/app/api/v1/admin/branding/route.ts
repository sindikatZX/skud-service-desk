import { ok, withAuth, parseBody } from "@/lib/api";
import { getBranding, updateBranding, resetBranding } from "@/lib/services/branding";
import { brandingUpdateSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

/** Оформление приложения: название, слоган, цвет, логотип. */
export const GET = withAuth(async () => ok(await getBranding()));

export const PATCH = withAuth(async (req, { user }) => {
  const b = await parseBody(req, brandingUpdateSchema);
  return ok(await updateBranding(b, user.id));
}, ["admin.maintenance", "users.manage"]);

/** Сброс к стандартному оформлению. */
export const DELETE = withAuth(async () => ok(await resetBranding()), ["admin.maintenance", "users.manage"]);
