import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { sites, clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { serviceHistory } from "@/lib/services/tickets";
import { getSiteEquipment } from "@/lib/services/inventory";
import { Card, PageHeader, StatusBadge, Table, Td, UnitStatusBadge } from "@/components/ui";
import { QuickForm } from "@/components/QuickForm";
import { fmtDate, fmtQty } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["clients.read", "tickets.read.own"]);
  const id = Number((await params).id);
  const [row] = await db.select({ site: sites, clientName: clients.name }).from(sites).innerJoin(clients, eq(clients.id, sites.clientId)).where(eq(sites.id, id));
  if (!row) notFound();
  if (user.scope === "client" && user.clientId !== row.site.clientId) notFound();
  const s = row.site;
  const [equipment, history] = await Promise.all([getSiteEquipment(id), serviceHistory(user, { siteId: id })]);
  return (
    <div>
      <PageHeader title={s.name} subtitle={<>{s.address} · <Link href={`/clients/${s.clientId}`} className="text-indigo-600">{row.clientName}</Link>{s.contactPerson && <> · {s.contactPerson} {s.contactPhone}</>}</>} action={<Link href={`/clients/${s.clientId}`} className="text-sm text-indigo-600">← Клиент</Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Установленное оборудование (${equipment.length})`}>
          <Table head={["Оборудование", "S/N / MAC", "Кол-во", "Заявка", "Установлено"]} empty={!equipment.length}>
            {equipment.map((e) => (
              <tr key={e.id}>
                <Td><div className="font-medium">{e.name}</div><div className="text-xs text-slate-500">{e.category} · {e.sku}</div></Td>
                <Td>{e.unitId ? <><Link href={`/inventory/units/${e.unitId}`} className="font-mono text-xs text-indigo-600">{e.serialNumber}</Link>{e.macAddress && <div className="font-mono text-[10px] text-slate-500">{e.macAddress}</div>}{e.unitStatus && e.unitStatus !== "installed" && <UnitStatusBadge status={e.unitStatus} />}</> : "—"}</Td>
                <Td>{fmtQty(e.quantity)} {e.unit}</Td>
                <Td><Link href={`/tickets/${e.ticketId}`} className="font-mono text-xs text-indigo-600">{e.ticketNumber}</Link></Td>
                <Td className="text-xs"><div>{fmtDate(e.installedAt, false)}</div><div className="text-slate-500">{e.installedBy}</div></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-4">
          <Card title="История заявок">
            <Table head={["№", "Заявка", "Бригада", "Дата", "Статус"]} empty={!history.length}>
              {history.map((t) => (
                <tr key={t.id}><Td><Link href={`/tickets/${t.id}`} className="font-mono text-xs text-indigo-600">{t.number}</Link></Td><Td><div className="font-medium">{t.title}</div><div className="text-xs text-slate-500">{t.typeName}</div></Td><Td>{t.teamName ?? "—"}</Td><Td className="whitespace-nowrap text-xs">{fmtDate(t.completedAt ?? t.createdAt, false)}</Td><Td><StatusBadge status={t.status} /></Td></tr>
              ))}
            </Table>
          </Card>
          {can(user, "sites.manage") && <QuickForm title="Редактировать объект" endpoint={`/sites/${id}`} method="PATCH" compact fields={[{ name: "name", label: "Название", defaultValue: s.name, required: true }, { name: "address", label: "Адрес", defaultValue: s.address, required: true }, { name: "contactPerson", label: "Контакт", defaultValue: s.contactPerson ?? "" }, { name: "contactPhone", label: "Телефон", defaultValue: s.contactPhone ?? "" }, { name: "notes", label: "Примечание", type: "textarea", defaultValue: s.notes ?? "" }]} />}
        </div>
      </div>
    </div>
  );
}
