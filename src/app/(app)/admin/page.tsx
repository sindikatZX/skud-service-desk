import { requireUser } from "@/lib/page-auth";
import { canWithRole } from "@/lib/rbac";
import Link from "next/link";
import { PageHeader, Card, Badge, btnCls, btnSecondaryCls } from "@/components/ui";
import { getInstallation, presetById } from "@/lib/services/setup";
import { MODULES } from "@/lib/modules";
import { listBackups, dbStats, integrityCheck, BACKUP_DIR } from "@/lib/services/admin";
import { AdminPanel } from "./AdminPanel";
import { BrandingPanel } from "./BrandingPanel";
import { getBranding, COLOR_PRESETS } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser(["admin.backup", "admin.maintenance"]);
  const canBackup = canWithRole(user, "admin.backup");
  const canMaint = canWithRole(user, "admin.maintenance");
  const [backups, stats, integrity, branding, installation] = await Promise.all([
    canBackup ? listBackups() : Promise.resolve([]),
    dbStats(),
    canMaint ? integrityCheck() : Promise.resolve(null),
    getBranding(),
    getInstallation(),
  ]);
  return (
    <div>
      <PageHeader
        title="Администрирование"
        subtitle={`Оформление, резервные копии, восстановление, очистка и обслуживание · ${stats.name} · ${stats.size} · ${stats.version}`}
        action={canMaint ? <Link href="/setup" className={btnSecondaryCls}>Модули и назначение системы</Link> : null}
      />
      {canMaint && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Состав системы</div>
              <p className="mt-0.5 text-sm text-slate-500">
                {presetById(installation.preset).name} · модулей включено: {installation.enabledModules.length} из {MODULES.length}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MODULES.map((m) => (
                  <Badge key={m.id} tone={installation.enabledModules.includes(m.id) ? "green" : "slate"}>{m.name}</Badge>
                ))}
              </div>
            </div>
            <Link href="/setup" className={btnCls}>Настроить</Link>
          </div>
        </Card>
      )}
      {canMaint && <div className="mb-4"><BrandingPanel branding={branding} presets={COLOR_PRESETS} /></div>}
      <AdminPanel
        canBackup={canBackup}
        canMaint={canMaint}
        backupDir={BACKUP_DIR}
        backups={backups.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() }))}
        stats={stats}
        integrity={integrity ? { ...integrity, checkedAt: integrity.checkedAt.toISOString() } : null}
      />
    </div>
  );
}
