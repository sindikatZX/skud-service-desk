import Link from "next/link";
import { db } from "@/db";
import { users, teamMembers, teams, vehicles, vehicleAssignments, clients, roles } from "@/db/schema";
import { and, eq, isNull, asc } from "drizzle-orm";
import { Card, PageHeader, Table, Td, Badge } from "@/components/ui";
import { QuickForm, ActionButton } from "@/components/QuickForm";
import { requireUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const me = await requireUser(["users.manage"]);
  const [rows, cars, clientRows, roleRows] = await Promise.all([
    db
      .select({
        id: users.id, email: users.email, fullName: users.fullName, phone: users.phone,
        roleName: roles.name, roleCode: roles.sysKey, isActive: users.isActive, teamName: teams.name, clientName: clients.name,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(teamMembers, and(eq(teamMembers.userId, users.id), isNull(teamMembers.leftAt)))
      .leftJoin(teams, eq(teams.id, teamMembers.teamId))
      .leftJoin(clients, eq(clients.id, users.clientId))
      .orderBy(asc(users.fullName)),
    db
      .select({ id: vehicles.id, plateNumber: vehicles.plateNumber, model: vehicles.model, year: vehicles.year, isActive: vehicles.isActive, teamName: teams.name })
      .from(vehicles)
      .leftJoin(vehicleAssignments, and(eq(vehicleAssignments.vehicleId, vehicles.id), isNull(vehicleAssignments.releasedAt)))
      .leftJoin(teams, eq(teams.id, vehicleAssignments.teamId))
      .orderBy(asc(vehicles.plateNumber)),
    db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name)),
    db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.isActive, true)).orderBy(asc(roles.sortOrder)),
  ]);

  return (
    <div>
      <PageHeader
        title="Сотрудники и автопарк"
        subtitle={<>Роли настраиваются в <Link href="/directories/roles" className="text-indigo-600 hover:underline">справочнике ролей</Link></>}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card
            title="Сотрудники"
            action={
              <QuickForm
                collapsible
                title="+ Сотрудник"
                endpoint="/users"
                submitLabel="Создать"
                fields={[
                  { name: "fullName", label: "ФИО", required: true },
                  { name: "email", label: "Email", type: "email", required: true },
                  { name: "password", label: "Пароль", type: "password", required: true, hint: "минимум 6 символов" },
                  { name: "phone", label: "Телефон" },
                  { name: "roleId", label: "Роль", type: "select", required: true, numeric: true, options: roleRows.map((r) => ({ value: r.id, label: r.name })) },
                  { name: "clientId", label: "Клиент (для роли портала)", type: "select", numeric: true, options: clientRows.map((c) => ({ value: c.id, label: c.name })) },
                ]}
              />
            }
          >
            <Table head={["Сотрудник", "Роль", "Бригада / клиент", "Статус", ""]} empty={!rows.length}>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <Td><div className="font-medium">{u.fullName}</div><div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div></Td>
                  <Td><Badge tone={u.roleCode === "admin" ? "rose" : u.roleCode === "technician" ? "indigo" : "slate"}>{u.roleName}</Badge></Td>
                  <Td className="text-xs">{u.teamName ?? u.clientName ?? "—"}</Td>
                  <Td>{u.isActive ? <Badge tone="green">активен</Badge> : <Badge>заблокирован</Badge>}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <ActionButton
                        endpoint={`/users/${u.id}`}
                        method="PATCH"
                        json={{ isActive: !u.isActive }}
                        label={u.isActive ? "заблокировать" : "активировать"}
                        className={`text-xs ${u.isActive ? "text-amber-600" : "text-emerald-600"} hover:underline`}
                      />
                      {u.id !== me.id && (
                        <ActionButton
                          endpoint={`/users/${u.id}`}
                          method="DELETE"
                          label="удалить"
                          confirm={`Удалить сотрудника «${u.fullName}» без возможности восстановления?\n\nЕсли за ним числятся складские операции, система предложит блокировку вместо удаления.`}
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
        <Card
          title="Автомобили"
          action={
            <QuickForm
              collapsible
              variant="secondary"
              title="+ Авто"
              endpoint="/vehicles"
              submitLabel="Добавить"
              compact
              fields={[
                { name: "model", label: "Модель", required: true, placeholder: "ГАЗель Next" },
                { name: "plateNumber", label: "Гос. номер", required: true },
                { name: "year", label: "Год", type: "number" },
              ]}
            />
          }
        >
          <Table head={["Авто", "Бригада", ""]} empty={!cars.length}>
            {cars.map((c) => (
              <tr key={c.id}>
                <Td><div className="font-medium">{c.model}</div><div className="font-mono text-xs text-slate-500">{c.plateNumber}{c.year ? ` · ${c.year}` : ""}</div></Td>
                <Td className="text-sm">{c.teamName ?? <span className="text-slate-400">свободен</span>}</Td>
                <Td>
                  <ActionButton
                    endpoint={`/vehicles/${c.id}`}
                    method="DELETE"
                    label="удалить"
                    confirm={`Удалить автомобиль ${c.plateNumber}?`}
                    className="text-xs text-rose-600 hover:underline"
                  />
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
