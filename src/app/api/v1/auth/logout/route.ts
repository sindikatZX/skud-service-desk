import { ok } from "@/lib/api";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { recordAudit } from "@/lib/services/audit";

export async function POST() {
  const user = await getCurrentUser();
  await clearSessionCookie();
  if (user) await recordAudit({ user, action: "logout", entity: "session", summary: "Вышел из системы", method: "POST", path: "/api/v1/auth/logout", status: 200 });
  return ok({ loggedOut: true });
}
