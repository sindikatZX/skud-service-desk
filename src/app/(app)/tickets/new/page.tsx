import { db } from "@/db";
import { clients, sites } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { getFormDictionaries } from "@/lib/services/directories";
import { PageHeader } from "@/components/ui";
import { TicketForm } from "./TicketForm";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const user = await requireUser(["tickets.create"]);
  const clientRows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(user.scope === "client" ? eq(clients.id, user.clientId ?? -1) : eq(clients.isActive, true))
    .orderBy(asc(clients.name));
  const siteRows = await db
    .select({ id: sites.id, clientId: sites.clientId, name: sites.name, address: sites.address })
    .from(sites)
    .where(eq(sites.isActive, true))
    .orderBy(asc(sites.name));
  const teams = can(user, "tickets.assign") ? (await listTeamsWithDetails()).filter((t) => t.isActive) : [];
  const { types, priorities } = await getFormDictionaries();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Новая заявка" />
      <TicketForm
        clients={clientRows}
        sites={siteRows.filter((s) => clientRows.some((c) => c.id === s.clientId))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        types={types.map((t) => ({ id: t.id, name: t.name }))}
        priorities={priorities.map((p) => ({ id: p.id, name: p.name, slaHours: p.slaHours }))}
        canAssign={can(user, "tickets.assign")}
      />
    </div>
  );
}
