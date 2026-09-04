import { ok, withAuth } from "@/lib/api";

export const GET = withAuth(async (_req, { user }) => ok({ user, permissions: user.permissions }));
