import Link from "next/link";
import { db } from "@/db";
import { clients, sites, tickets } from "@/db/schema";
import { sql, asc } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { can } from "@/lib/rbac";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const user = await requireUser(["clients.read"]);
  const rows = await db
    .select({
      id: clients.id, name: clients.name, contactPerson: clients.contactPerson, phone: clients.phone, email: clients.email, isActive: clients.isActive,
      sitesCount: sql<number>`(select count(*) from ${sites} where ${sites.clientId} = ${clients.id})::int`,
      openTickets: sql<number>`(select count(*) from ${tickets} where ${tickets.clientId} = ${clients.id} and ${tickets.status} not in ('done','closed','cancelled'))::int`,
      totalTickets: sql<number>`(select count(*) from ${tickets} where ${tickets.clientId} = ${clients.id})::int`,
    })
    .from(clients).orderBy(asc(clients.name));
  return (
    <div>
      <PageHeader title="Клиенты" subtitle={`${rows.length} клиентов`} action={can(user, "clients.manage") ? <QuickForm collapsible title="+ Новый клиент" endpoint="/clients" submitLabel="Создать" fields={[{ name: "name", label: "Название", required: true }, { name: "inn", label: "ИНН" }, { name: "contactPerson", label: "Контактное лицо" }, { name: "phone", label: "Телефон" }, { name: "email", label: "Email", type: "email" }, { name: "notes", label: "Примечание", type: "textarea" }]} /> : null} />
      <Card>
        <Table head={["Клиент", "Контакт", "Объекты", "Заявки (откр./всего)", ""]} empty={!rows.length}>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-slate-50">
              <Td><Link href={`/clients/${c.id}`} className="font-medium text-indigo-700">{c.name}</Link>{!c.isActive && <span className="ml-2 text-xs text-slate-400">(неактивен)</span>}</Td>
              <Td><div>{c.contactPerson ?? "—"}</div><div className="text-xs text-slate-500">{c.phone} {c.email}</div></Td>
              <Td>{c.sitesCount}</Td>
              <Td>{c.openTickets} / {c.totalTickets}</Td>
              <Td>
                <div className="flex items-center gap-3">
                  <Link href={`/clients/${c.id}`} className="text-xs text-indigo-600">Открыть →</Link>
                  {can(user, "clients.manage") && (
                    <ActionButton
                      endpoint={`/clients/${c.id}`}
                      method="DELETE"
                      label="удалить"
                      confirm={`Удалить клиента «${c.name}»?

Удаление возможно, только пока у клиента нет объектов и заявок.`}
                      className="text-xs text-rose-600 hover:underline"
                    />
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
