import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/page-auth";
import { getTicketDetails } from "@/lib/services/tickets";
import { getStock, getTicketMaterials, getTicketReservations } from "@/lib/services/inventory";
import { listTeamsWithDetails } from "@/lib/services/teams";
import { listMessages } from "@/lib/services/chat";
import { getFormDictionaries } from "@/lib/services/directories";
import { can } from "@/lib/rbac";
import { Card, PageHeader, StatusBadge, Table, Td, Badge } from "@/components/ui";
import { fmtDate, fmtQty, STATUS_LABELS } from "@/lib/labels";
import { TicketActions } from "./TicketActions";
import { TicketChat } from "./TicketChat";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["tickets.read.all", "tickets.read.own"]);
  const id = Number((await params).id);
  let details;
  try {
    details = await getTicketDetails(user, id);
  } catch {
    notFound();
  }
  const { ticket: t, history, works, teamMembers, allowedTransitions } = details;
  const [materials, reservations, teams, teamStock, chat, dictionaries] = await Promise.all([
    getTicketMaterials(id),
    getTicketReservations(id),
    can(user, "tickets.assign") ? listTeamsWithDetails() : Promise.resolve([]),
    t.teamId && (can(user, "inventory.install") || can(user, "inventory.reserve")) ? getStock("team", t.teamId) : Promise.resolve(null),
    listMessages(user, id),
    can(user, "tickets.assign") ? getFormDictionaries() : Promise.resolve(null),
  ]);
  const isClosed = ["closed", "cancelled"].includes(t.status);
  const overdue = t.dueAt && new Date(t.dueAt) < new Date() && !["done", "closed", "cancelled"].includes(t.status);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${t.number} — ${t.title}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={t.status} /><span>{t.typeName}</span>·<span className={t.priorityColor}>{t.priorityName}</span>{overdue && <Badge tone="rose">Просрочена</Badge>}</span>}
        action={<Link href="/tickets" className="text-sm text-indigo-600">← К списку</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Информация">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Клиент</dt><dd><Link href={`/clients/${t.clientId}`} className="font-medium text-indigo-700">{t.clientName}</Link></dd></div>
              <div><dt className="text-xs text-slate-500">Объект</dt><dd><Link href={`/sites/${t.siteId}`} className="font-medium text-indigo-700">{t.siteName}</Link><div className="text-xs text-slate-500">{t.siteAddress}</div></dd></div>
              <div><dt className="text-xs text-slate-500">Бригада</dt><dd>{t.teamName ? <Link href={`/teams/${t.teamId}`} className="font-medium text-indigo-700">{t.teamName}</Link> : "—"}{teamMembers.length > 0 && <div className="text-xs text-slate-500">{teamMembers.map((m) => m.fullName).join(", ")}</div>}</dd></div>
              <div><dt className="text-xs text-slate-500">Диспетчер</dt><dd>{t.dispatcherName ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Выезд</dt><dd>{fmtDate(t.scheduledStart)}{t.scheduledEnd ? ` — ${fmtDate(t.scheduledEnd)}` : ""}</dd></div>
              <div><dt className="text-xs text-slate-500">Срок</dt><dd className={overdue ? "font-semibold text-rose-600" : ""}>{fmtDate(t.dueAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Начата / выполнена / закрыта</dt><dd className="text-xs">{fmtDate(t.startedAt)} / {fmtDate(t.completedAt)} / {fmtDate(t.closedAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Создана</dt><dd className="text-xs">{fmtDate(t.createdAt)}</dd></div>
            </dl>
            {t.description && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{t.description}</p>}
            {t.resultNote && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm"><div className="text-xs font-semibold text-emerald-700">Результат работ</div><p className="whitespace-pre-wrap">{t.resultNote}</p></div>}
          </Card>

          <Card title="Выполненные работы">
            <Table head={["Работа", "Кол-во", "Время", "Исполнитель", "Дата"]} empty={!works.length}>
              {works.map((w) => (
                <tr key={w.id}><Td>{w.description}</Td><Td>{fmtQty(w.quantity)} {w.unit}</Td><Td>{w.durationMinutes ? `${w.durationMinutes} мин` : "—"}</Td><Td>{w.performerName ?? "—"}</Td><Td className="whitespace-nowrap text-xs">{fmtDate(w.createdAt)}</Td></tr>
              ))}
            </Table>
          </Card>

          <Card title="Установленное оборудование и материалы">
            <Table head={["Номенклатура", "S/N", "Кол-во", "Кто", "Когда"]} empty={!materials.length}>
              {materials.map((m) => (
                <tr key={m.id}>
                  <Td><div className="font-medium">{m.name}</div><div className="text-xs text-slate-500">{m.sku}</div></Td>
                  <Td>{m.unitId ? <Link href={`/inventory/units/${m.unitId}`} className="font-mono text-xs text-indigo-600">{m.serialNumber}</Link> : "—"}</Td>
                  <Td>{fmtQty(m.quantity)} {m.unit}</Td><Td>{m.installedBy ?? "—"}</Td><Td className="whitespace-nowrap text-xs">{fmtDate(m.installedAt)}</Td>
                </tr>
              ))}
            </Table>
            {(reservations.quantities.length > 0 || reservations.units.length > 0) && (
              <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">
                <div className="mb-1 text-xs font-semibold text-amber-800">Зарезервировано под заявку</div>
                <ul className="space-y-0.5">
                  {reservations.units.map((u) => <li key={`u${u.id}`}>{u.name} — <span className="font-mono text-xs">{u.serialNumber}</span></li>)}
                  {reservations.quantities.map((q) => <li key={`q${q.id}`}>{q.name} — {fmtQty(q.quantity)} {q.unit}</li>)}
                </ul>
              </div>
            )}
          </Card>

          <TicketChat
            ticketId={t.id}
            initial={chat.map((m) => ({
              ...m,
              createdAt: m.createdAt.toISOString(),
              editedAt: m.editedAt?.toISOString() ?? null,
            }))}
            canWrite={can(user, "chat.write")}
            canInternal={can(user, "chat.internal") && user.scope !== "client"}
            readOnly={isClosed}
          />
        </div>

        <div className="space-y-4">
          <TicketActions
            ticket={{ id: t.id, status: t.status, teamId: t.teamId, priorityId: t.priorityId, typeId: t.typeId, dueAt: t.dueAt?.toISOString() ?? null, scheduledStart: t.scheduledStart?.toISOString() ?? null, scheduledEnd: t.scheduledEnd?.toISOString() ?? null, resultNote: t.resultNote }}
            allowed={allowedTransitions}
            perms={{
              assign: can(user, "tickets.assign"),
              work: can(user, "tickets.work"),
              install: can(user, "inventory.install"),
              reserve: can(user, "inventory.reserve"),
              remove: can(user, "tickets.delete"),
            }}
            types={dictionaries?.types.map((x) => ({ id: x.id, name: x.name })) ?? []}
            priorities={dictionaries?.priorities.map((x) => ({ id: x.id, name: x.name })) ?? []}
            isClosed={isClosed}
            teams={teams.map((x) => ({ id: x.id, name: x.name, members: x.members.map((m) => m.fullName).join(", ") }))}
            teamMembers={teamMembers.map((m) => ({ id: m.id, fullName: m.fullName }))}
            teamStock={teamStock ? {
              units: teamStock.units.map((u) => ({ id: u.id, name: u.name, serialNumber: u.serialNumber, status: u.status, ticketId: u.ticketId })),
              balances: teamStock.balances.map((b) => ({ catalogItemId: b.catalogItemId, name: b.name, unit: b.unit, quantity: Number(b.quantity) })),
              reservations: reservations.quantities.map((r) => ({ id: r.id, catalogItemId: r.catalogItemId, name: r.name, unit: r.unit, quantity: Number(r.quantity) })),
              reservedUnits: reservations.units.map((u) => ({ id: u.id, name: u.name, serialNumber: u.serialNumber })),
            } : null}
          />
          <Card title="История статусов">
            <ol className="space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-indigo-200 pl-3">
                  <div className="text-xs text-slate-500">{fmtDate(h.createdAt)} · {h.actorName ?? "система"}</div>
                  <div>{h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : ""}<span className="font-medium">{STATUS_LABELS[h.toStatus]}</span></div>
                  {h.comment && <div className="text-xs text-slate-600">{h.comment}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
