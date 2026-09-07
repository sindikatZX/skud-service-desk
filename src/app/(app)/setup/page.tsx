import { requireUser } from "@/lib/page-auth";
import { PageHeader } from "@/components/ui";
import { getInstallation } from "@/lib/services/setup";
import { getBranding } from "@/lib/services/branding";
import { SetupWizard } from "./SetupWizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  await requireUser(["admin.maintenance", "users.manage"]);
  const [installation, branding] = await Promise.all([getInstallation(), getBranding()]);
  return (
    <div>
      <PageHeader
        title={installation.configured ? "Настройка системы" : "Мастер настройки"}
        subtitle="Для кого установлена система, чем она занимается и какие модули включены"
      />
      <SetupWizard
        appName={branding.appName}
        initial={{
          organization: installation.organization,
          preset: installation.preset,
          enabledModules: installation.enabledModules,
          configured: installation.configured,
        }}
      />
    </div>
  );
}
