import { db } from "@/db";
import { users, teamMembers, teams } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { SCOPE_LABELS } from "@/lib/rbac";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const [me] = await db.select({ fullName: users.fullName, email: users.email, phone: users.phone, createdAt: users.createdAt }).from(users).where(eq(users.id, user.id));
  const [team] = await db.select({ name: teams.name }).from(teamMembers).innerJoin(teams, eq(teams.id, teamMembers.teamId)).where(and(eq(teamMembers.userId, user.id), isNull(teamMembers.leftAt)));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Моя учётная запись" subtitle="Изменение личных данных, логина и пароля. Роль и права назначает администратор." />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone="indigo">{user.roleName}</Badge>
          <span className="text-slate-500">Область данных: {SCOPE_LABELS[user.scope]}</span>
          {team && <span className="text-slate-500">· Бригада: {team.name}</span>}
          <span className="text-slate-400">· Прав: {user.permissions.length}</span>
        </div>
      </Card>
      <ProfileForm me={{ fullName: me.fullName, email: me.email, phone: me.phone }} />
    </div>
  );
}
