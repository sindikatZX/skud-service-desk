import type { ReactNode } from "react";
import { ConfirmProvider } from "@/components/dialog";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getBranding } from "@/lib/services/branding";
import { getInstallation } from "@/lib/services/setup";
import { termsFor } from "@/lib/terms";
import { TermsProvider } from "@/components/terms-context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [branding, installation] = await Promise.all([getBranding(), getInstallation()]);
  return <AppShell user={user} branding={branding} installation={installation}><TermsProvider terms={termsFor(installation.preset)}><ConfirmProvider>{children}</ConfirmProvider></TermsProvider>
    </AppShell>;
}
