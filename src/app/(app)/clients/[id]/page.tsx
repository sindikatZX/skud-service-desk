import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, sites } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { serviceHistory } from "@/lib/services/tickets";
import { Card, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";
import { fmtDate } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["clients.read", "tickets.read.own"]);
  const id = Number((await params).id);
  if (user.scope === "client" && user.clientId !== id) notFound();
  const [c] = await db.select().from(clients).where(eq(clients.id, id));
  if (!c) notFound();
  const [clientSites, history] = await Promise.all([db.select().from(sites).where(eq(sites.clientId, id)).orderBy(asc(sites.name)), serviceHistory(user, { clientId: id })]);
  return (
    <div>
      <PageHeader title={c.name} subtitle={<>{c.inn && <>ИНН {c.inn} · </>}{c.contactPerson} {c.phone} {c.email}</>} action={<Link href="/clients" className="text-sm text-indigo-600">← Клиенты</Link>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title="Объекты" action={can(user, "sites.manage") ? <QuickForm collapsible variant="secondary" title="+ Объект" endpoint={`/clients/${id}/sites`} submitLabel="Добавить" compact fields={[{ name: "name", label: "Название", required: true }, { name: "address", label: "Адрес", required: true }, { name: "contactPerson", label: "Контакт" }, { name: "contactPhone", label: "Телефон" }]} /> : null}>
            {clientSites.length ? (
              <ul className="divide-y divide-slate-100 text-sm">{clientSites.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-2 py-2">
                  <div>
                    <Link href={`/sites/${s.id}`} className="font-medium text-indigo-700">{s.name}</Link>
                    <div className="text-xs text-slate-500">{s.address}</div>
                    {s.contactPerson && <div className="text-xs text-slate-500">{s.contactPerson} {s.contactPhone}</div>}
                  </div>
                  {can(user, "sites.manage") && (
                    <ActionButton
                      endpoint={`/sites/${s.id}`}
                      method="DELETE"
                      label="удалить"
                      confirm={`Удалить объект «${s.name}»?

Если по объекту есть заявки или установленное оборудование, удаление будет отклонено.`}
                      className="shrink-0 text-xs text-rose-600 hover:underline"
                    />
                  )}
                </li>
              ))}</ul>
            ) : <p className="text-sm text-slate-400">Объектов нет</p>}
          </Card>
          {c.notes && <Card title="Примечание"><p className="whitespace-pre-wrap text-sm">{c.notes}</p></Card>}
          {can(user, "clients.manage") && <QuickForm title="Редактировать клиента" endpoint={`/clients/${id}`} method="PATCH" compact fields={[{ name: "name", label: "Название", defaultValue: c.name, required: true }, { name: "inn", label: "ИНН", defaultValue: c.inn ?? "" }, { name: "contactPerson", label: "Контакт", defaultValue: c.contactPerson ?? "" }, { name: "phone", label: "Телефон", defaultValue: c.phone ?? "" }, { name: "email", label: "Email", defaultValue: c.email ?? "" }, { name: "isActive", label: "Активен", type: "checkbox", defaultValue: c.isActive }]} />}
        </div>
        <Card title="История обслуживания" className="lg:col-span-2" action={can(user, "tickets.create") ? <Link href="/tickets/new" className="text-sm text-indigo-600">+ Заявка</Link> : null}>
          <Table head={["№", "Заявка", "Объект", "Бригада", "Дата", "Статус"]} empty={!history.length}>
            {history.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td><Link href={`/tickets/${t.id}`} className="font-mono text-xs text-indigo-600">{t.number}</Link></Td>
                <Td><div className="font-medium">{t.title}</div><div className="text-xs text-slate-500">{t.typeName}</div></Td>
                <Td className="text-xs">{t.siteName}</Td><Td>{t.teamName ?? "—"}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtDate(t.completedAt ?? t.scheduledStart ?? t.createdAt)}</Td>
                <Td><StatusBadge status={t.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
