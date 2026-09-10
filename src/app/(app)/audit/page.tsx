import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { listAudit, auditActors, AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from "@/lib/services/audit";
import { auditQuerySchema } from "@/lib/validators";
import { Card, PageHeader, Table, Td, Badge, inputCls, Field, PeriodFields, btnFilterCls, btnFilterResetCls } from "@/components/ui";
import { fmtDate } from "@/lib/labels";
import { AuditDetails } from "./AuditDetails";

export const dynamic = "force-dynamic";

const TONE: Record<string, "green" | "indigo" | "rose" | "amber" | "slate"> = {
  create: "green",
  update: "indigo",
  delete: "rose",
  operation: "amber",
  login: "slate",
  logout: "slate",
  denied: "rose",
};

/** Ссылка на объект действия — чтобы из журнала можно было перейти к тому, что изменили. */
function hrefFor(entity: string, entityId: number | null) {
  if (!entityId) return null;
  const map: Record<string, string> = {
    ticket: "/tickets",
    client: "/clients",
    site: "/sites",
    team: "/teams",
    user: "/employees",
    catalog_item: "/catalog",
    inventory: "/inventory/documents",
  };
  const base = map[entity];
  return base ? `${base}/${entityId}` : null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser(["audit.view"]);
  const sp = await searchParams;
  const parsed = auditQuerySchema.safeParse(sp);
  const q = parsed.success ? parsed.data : auditQuerySchema.parse({});
  const limit = q.limit ?? 100;
  const offset = q.offset ?? 0;

  const [log, actors] = await Promise.all([
    listAudit({
      from: q.from ?? null,
      // «по» включительно: пользователь выбирает день, а не миг до полуночи
      to: sp.to ? new Date(`${sp.to}T23:59:59`) : null,
      actorId: q.actorId,
      action: q.action,
      entity: q.entity,
      q: q.q,
      limit,
      offset,
    }),
    auditActors(),
  ]);

  /** Ссылка на другую страницу журнала с сохранением текущего отбора. */
  const pageHref = (nextOffset: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "offset") p.set(k, v);
    if (nextOffset) p.set("offset", String(nextOffset));
    const qs = p.toString();
    return qs ? `/audit?${qs}` : "/audit";
  };
  const shown = log.rows.length;
  const entities = Object.entries(AUDIT_ENTITY_LABELS).sort((a, b) => a[1].localeCompare(b[1], "ru"));

  return (
    <div>
      <PageHeader title="Журнал действий" subtitle={`Кто и что сделал в системе${log.total ? ` · записей: ${log.total}` : ""}`} />

      <Card className="mb-4">
        <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <PeriodFields from={sp.from} to={sp.to} className="sm:col-span-2" />
          <Field label="Сотрудник">
            <select name="actorId" defaultValue={sp.actorId ?? ""} className={inputCls}>
              <option value="">Все сотрудники</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                  {a.roleName ? ` — ${a.roleName}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Действие">
            <select name="action" defaultValue={sp.action ?? ""} className={inputCls}>
              <option value="">Любое действие</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Раздел">
            <select name="entity" defaultValue={sp.entity ?? ""} className={inputCls}>
              <option value="">Все разделы</option>
              {entities.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Поиск">
            <input name="q" defaultValue={sp.q ?? ""} placeholder="товар, номер, фамилия" className={inputCls} />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <button className={btnFilterCls}>Применить</button>
            <Link href="/audit" className={btnFilterResetCls}>
              Сбросить
            </Link>
          </div>
        </form>
      </Card>

      <Card>
        <Table dense head={["Когда", "Кто", "Действие", "Что сделал", "Объект", "Откуда"]} empty={!shown} emptyText="За выбранный период действий нет">
          {log.rows.map((r) => {
            const href = hrefFor(r.entity, r.entityId);
            return (
              <tr key={r.id} className="align-top hover:bg-slate-50">
                <Td dense className="whitespace-nowrap text-xs">
                  {fmtDate(r.at)}
                </Td>
                <Td dense className="text-xs">
                  <div className="font-medium text-slate-800">{r.actorName}</div>
                  {r.actorRole && <div className="text-[11px] text-slate-500">{r.actorRole}</div>}
                </Td>
                <Td dense>
                  <Badge tone={TONE[r.action] ?? "slate"}>{AUDIT_ACTION_LABELS[r.action as keyof typeof AUDIT_ACTION_LABELS] ?? r.action}</Badge>
                </Td>
                <Td dense>
                  <div className="text-slate-800">{r.summary}</div>
                  <AuditDetails details={r.details} />
                </Td>
                <Td dense className="text-xs">
                  <div>{AUDIT_ENTITY_LABELS[r.entity] ?? r.entity}</div>
                  {r.entityLabel && <div className="text-[11px] text-slate-500">{r.entityLabel}</div>}
                  {href && (
                    <Link href={href} className="text-[11px] text-indigo-600">
                      открыть →
                    </Link>
                  )}
                </Td>
                <Td dense className="text-[11px] text-slate-400">
                  <div>{r.ip ?? "—"}</div>
                  <div className="font-mono">
                    {r.method} {r.path}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>

        {log.total > limit && (
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              Показаны {offset + 1}–{offset + shown} из {log.total}
            </span>
            <div className="flex gap-2">
              <Link href={pageHref(Math.max(0, offset - limit))} aria-disabled={offset === 0} className={`${btnFilterResetCls} ${offset === 0 ? "pointer-events-none opacity-40" : ""}`}>
                ← Новее
              </Link>
              <Link
                href={pageHref(offset + limit)}
                aria-disabled={offset + shown >= log.total}
                className={`${btnFilterResetCls} ${offset + shown >= log.total ? "pointer-events-none opacity-40" : ""}`}
              >
                Раньше →
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
