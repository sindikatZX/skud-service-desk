import Link from "next/link";
import { db } from "@/db";
import { sites, clients } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { Card, PageHeader, Table, Td, Badge } from "@/components/ui";
import { CsvImport } from "@/components/CsvImport";

export const dynamic = "force-dynamic";

/** Справочник объектов: все объекты обслуживания по всем клиентам, с импортом из CSV. */
export default async function SitesDirectoryPage() {
  await requireUser(["directories.manage", "sites.manage"]);
  const rows = await db
    .select({
      id: sites.id, name: sites.name, address: sites.address, contactPerson: sites.contactPerson, contactPhone: sites.contactPhone, isActive: sites.isActive,
      clientId: clients.id, clientName: clients.name,
      equipment: sql<number>`(select count(*) from ticket_materials tm where tm.site_id = ${sites.id})::int`,
      tickets: sql<number>`(select count(*) from tickets t where t.site_id = ${sites.id})::int`,
    })
    .from(sites)
    .innerJoin(clients, eq(clients.id, sites.clientId))
    .orderBy(asc(clients.name), asc(sites.name));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Справочник объектов" subtitle={`${rows.length} объектов. Добавление объекта — на странице клиента.`} action={<Link href="/directories" className="text-sm text-indigo-600">← Все справочники</Link>} />
      <div className="mb-4"><CsvImport entity="sites" compact /></div>
      <Card>
        <Table head={["Объект", "Клиент", "Адрес", "Контакт", "Заявок", "Оборуд.", "Статус"]} empty={!rows.length}>
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50">
              <Td><Link href={`/sites/${s.id}`} className="font-medium text-indigo-700">{s.name}</Link></Td>
              <Td><Link href={`/clients/${s.clientId}`} className="text-indigo-600">{s.clientName}</Link></Td>
              <Td className="text-xs">{s.address}</Td>
              <Td className="text-xs">{s.contactPerson}{s.contactPhone ? ` · ${s.contactPhone}` : ""}</Td>
              <Td>{s.tickets}</Td>
              <Td>{s.equipment}</Td>
              <Td>{s.isActive ? <Badge tone="green">активен</Badge> : <Badge>отключён</Badge>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
