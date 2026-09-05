import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getBranding } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const branding = await getBranding();
  return <AppShell user={user} branding={branding}>{children}</AppShell>;
}
