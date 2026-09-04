import Link from "next/link";
import { notFound } from "next/navigation";
import { getUnitHistory } from "@/lib/services/inventory";
import { Card, PageHeader, UnitStatusBadge } from "@/components/ui";
import { DeleteUnitButton } from "./DeleteUnitButton";
import { fmtDate, TX_LABELS, LOC_LABELS } from "@/lib/labels";
import { can } from "@/lib/rbac";

import { requireUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["inventory.read.all", "inventory.read.team", "clients.read"]);
  const id = Number((await params).id);
  const r = await getUnitHistory(id);
  if (!r) notFound();
  const { unit: u, history } = r;
  const steps = [...history].reverse();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`${u.name} · ${u.serialNumber}`} subtitle={<span className="flex flex-wrap items-center gap-2"><UnitStatusBadge status={u.status} /><span>{u.category} · {u.sku}{u.manufacturer ? ` · ${u.manufacturer}` : ""}</span></span>} action={
        <div className="flex items-center gap-3">
          {can(user, "inventory.writeoff") && <DeleteUnitButton unitId={u.id} serialNumber={u.serialNumber} status={u.status} />}
          <Link href="/inventory" className="text-sm text-indigo-600">← Склад</Link>
        </div>
      } />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Текущее состояние">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-xs text-slate-500">Серийный номер</dt><dd className="font-mono">{u.serialNumber}</dd></div>
            <div><dt className="text-xs text-slate-500">MAC</dt><dd className="font-mono">{u.macAddress ?? "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Местонахождение</dt><dd>{LOC_LABELS[u.locationType]}{u.teamName && <> · <Link href={`/teams/${u.teamId}`} className="text-indigo-600">{u.teamName}</Link></>}</dd></div>
            {u.siteId && <div><dt className="text-xs text-slate-500">Объект</dt><dd><Link href={`/sites/${u.siteId}`} className="text-indigo-600">{u.siteName}</Link><div className="text-xs text-slate-500">{u.clientName} · {u.siteAddress}</div></dd></div>}
            {u.ticketId && <div><dt className="text-xs text-slate-500">Заявка</dt><dd><Link href={`/tickets/${u.ticketId}`} className="text-indigo-600">#{u.ticketId}</Link></dd></div>}
            <div><dt className="text-xs text-slate-500">Установлена</dt><dd>{fmtDate(u.installedAt)}</dd></div>
            <div><dt className="text-xs text-slate-500">Поступила</dt><dd>{fmtDate(u.createdAt)}</dd></div>
          </dl>
        </Card>
        <Card title="Жизненный цикл единицы" className="md:col-span-2">
          <ol className="relative ml-2 border-l-2 border-indigo-200 pl-5">
            {steps.map((h) => (
              <li key={h.id} className="mb-5 last:mb-0">
                <span className="absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white bg-indigo-500" />
                <div className="text-xs text-slate-500">{fmtDate(h.createdAt)} · {h.actorName ?? "система"}</div>
                <div className="font-semibold">{TX_LABELS[h.type]}</div>
                <div className="text-sm text-slate-600">
                  {h.fromLocationType && <>{h.fromLocationType === "team" ? h.fromTeamName ?? "бригада" : LOC_LABELS[h.fromLocationType]} → </>}
                  {h.toLocationType && <>{h.toLocationType === "team" ? h.toTeamName ?? "бригада" : h.toLocationType === "site" ? `объект ${h.siteName ?? ""}` : LOC_LABELS[h.toLocationType]}</>}
                  {h.ticketId && <> · заявка <Link href={`/tickets/${h.ticketId}`} className="text-indigo-600">{h.ticketNumber}</Link></>}
                  {h.clientName && <> · {h.clientName}</>}
                </div>
                {h.note && <div className="text-xs text-slate-400">{h.note}</div>}
              </li>
            ))}
            {!steps.length && <li className="text-sm text-slate-400">Истории нет</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
