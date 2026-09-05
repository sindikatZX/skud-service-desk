import { requireUser } from "@/lib/page-auth";
import { canWithRole } from "@/lib/rbac";
import { PageHeader } from "@/components/ui";
import { listBackups, dbStats, integrityCheck, BACKUP_DIR } from "@/lib/services/admin";
import { AdminPanel } from "./AdminPanel";
import { BrandingPanel } from "./BrandingPanel";
import { getBranding, COLOR_PRESETS } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireUser(["admin.backup", "admin.maintenance"]);
  const canBackup = canWithRole(user, "admin.backup");
  const canMaint = canWithRole(user, "admin.maintenance");
  const [backups, stats, integrity, branding] = await Promise.all([
    canBackup ? listBackups() : Promise.resolve([]),
    dbStats(),
    canMaint ? integrityCheck() : Promise.resolve(null),
    getBranding(),
  ]);
  return (
    <div>
      <PageHeader title="Администрирование" subtitle={`Оформление, резервные копии, восстановление, очистка и обслуживание · ${stats.name} · ${stats.size} · ${stats.version}`} />
      {canMaint && <div className="mb-4"><BrandingPanel branding={branding} presets={COLOR_PRESETS} /></div>}
      <AdminPanel
        canBackup={canBackup}
        canMaint={canMaint}
        backupDir={BACKUP_DIR}
        backups={backups.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() }))}
        stats={{ ...stats, tables: stats.tables.map((t) => ({ table: t.table, rows: t.rows, dead: t.dead, size: t.size, lastVacuum: (t.last_autovacuum ?? t.last_vacuum)?.toISOString() ?? null, lastAnalyze: (t.last_autoanalyze ?? t.last_analyze)?.toISOString() ?? null })) }}
        integrity={integrity ? { ...integrity, checkedAt: integrity.checkedAt.toISOString() } : null}
      />
    </div>
  );
}
