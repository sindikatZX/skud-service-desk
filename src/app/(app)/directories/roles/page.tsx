import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { PageHeader } from "@/components/ui";
import { listRoles } from "@/lib/services/directories";
import { RoleManager, type RoleRow } from "./RoleManager";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requireUser(["directories.manage"]);
  const roles = (await listRoles()) as RoleRow[];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Роли и права"
        subtitle="Новая роль — это набор прав плюс область видимости данных. Права проверяются во всех разделах и в API."
        action={<Link href="/directories" className="text-sm text-indigo-600">← Все справочники</Link>}
      />
      <RoleManager roles={roles} />
    </div>
  );
}
