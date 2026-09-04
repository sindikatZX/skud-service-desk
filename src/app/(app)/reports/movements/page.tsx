import Link from "next/link";
import { db } from "@/db";
import { warehouses, catalogItems } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { canSeePrices, canWithRole } from "@/lib/rbac";
import { Card, PageHeader, Field, inputCls } from "@/components/ui";
import { fmtQty, fmtDate, TX_LABELS } from "@/lib/labels";
import { fmtMoney } from "@/lib/prices";
import { movementsReport, parsePeriod, periodLabel, MOVEMENT_TYPES } from "@/lib/services/report-builder";
import { movementsReportQuerySchema } from "@/lib/validators";
import { ReportToolbar, SortTh, PrintHeader, PrintFooter, MultiSelect, ReportForm } from "../ReportKit";

export const dynamic = "force-dynamic";

export default async function MovementsReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["reports.movements", "reports.inventory"]);
  const sp = await searchParams;
  const parsed = movementsReportQuerySchema.safeParse(sp);
  const q = parsed.success ? parsed.data : movementsReportQuerySchema.parse({});
  const canPrices = canSeePrices(user);
  const canExport = canWithRole(user, "reports.export");
  const [whs, items] = await Promise.all([
    db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.isActive, true)).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
    db.select({ id: catalogItems.id, name: catalogItems.name, sku: catalogItems.sku }).from(catalogItems).orderBy(asc(catalogItems.name)),
  ]);
  const period = parsePeriod(q.from, q.to);
  const rep = await movementsReport({ types: q.types, period, itemIds: q.itemIds, q: q.q, warehouseIds: q.warehouseIds, sort: q.sort, dir: q.dir, limit: q.limit, canPrices });
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const sort = q.sort ?? "date"; const dir = q.dir ?? "desc";
  const filters = [
    { label: "Операции", value: q.types.map((t) => TX_LABELS[t] ?? t).join(", ") },
    { label: "Склады", value: whs.filter((w) => q.warehouseIds.includes(w.id)).map((w) => w.name).join(", ") },
    { label: "Товары", value: items.filter((i) => q.itemIds.includes(i.id)).map((i) => i.name).join(", ") },
    { label: "Поиск", value: q.q ?? "" },
  ];

  return (
    <div>
      <PageHeader title="Движение товаров" subtitle="Поступления, перемещения, установки, списания и выдачи бригадам за период" action={<Link href="/reports" className="no-print text-sm text-indigo-600">← Все отчёты</Link>} />
      <Card className="no-print mb-4">
        <ReportForm action="/reports/movements">
          <div className="grid gap-2">
            <Field label="Период с"><input type="date" name="from" defaultValue={q.from ?? ""} className={inputCls} /></Field>
            <Field label="по"><input type="date" name="to" defaultValue={q.to ?? ""} className={inputCls} /></Field>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Виды движений (пусто — все)</span>
            <div className="grid grid-cols-2 gap-1 text-sm">
              {MOVEMENT_TYPES.map((t) => <label key={t} className="flex items-center gap-1.5"><input type="checkbox" name="types[]" value={t} defaultChecked={q.types.includes(t)} className="h-4 w-4" />{TX_LABELS[t]}</label>)}
            </div>
          </div>
          <MultiSelect name="warehouseIds[]" label="Склады (откуда или куда)" options={whs} selected={q.warehouseIds} />
          <div className="grid gap-2">
            <MultiSelect name="itemIds[]" label="Товары из списка" options={items.map((i) => ({ value: i.id, label: `${i.name} (${i.sku})` }))} selected={q.itemIds} size={4} />
            <Field label="Или часть наименования"><input name="q" defaultValue={q.q ?? ""} className={inputCls} placeholder="кабель" /></Field>
          </div>
        </ReportForm>
      </Card>

      <Card className="print-area">
        <PrintHeader title="Движение товаров" period={periodLabel(period)} filters={filters} user={user.fullName} />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {rep.byType.map((t) => <span key={t.type} className="rounded-full bg-slate-100 px-2 py-0.5">{t.label}: <b>{t.count}</b> опер., {fmtQty(t.quantity)} ед.</span>)}
          </div>
          <div className="ml-auto"><ReportToolbar csvHref={`/api/v1/reports/movements?${query}&format=csv`} resetHref="/reports/movements" canExport={canExport} rows={rep.rows.length} /></div>
        </div>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <SortTh field="date" current={sort} dir={dir}>Дата</SortTh>
                <SortTh field="type" current={sort} dir={dir}>Операция</SortTh>
                <SortTh field="item" current={sort} dir={dir}>Товар</SortTh>
                <SortTh field="quantity" current={sort} dir={dir} className="text-right">Кол-во</SortTh>
                <SortTh field="from" current={sort} dir={dir}>Откуда</SortTh>
                <SortTh field="to" current={sort} dir={dir}>Куда</SortTh>
                <SortTh field="document" current={sort} dir={dir}>Документ / заявка</SortTh>
                <SortTh field="actor" current={sort} dir={dir}>Исполнитель</SortTh>
                {canPrices && <th className="px-3 py-2 text-right font-medium">Сумма</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rep.rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs">{fmtDate(r.date)}</td>
                  <td className="px-3 py-1.5 text-xs">{r.typeLabel}</td>
                  <td className="px-3 py-1.5"><div className="font-medium">{r.name}</div><div className="text-[11px] text-slate-500">{r.code} · {r.sku}{r.serialNumber ? ` · S/N ${r.serialNumber}` : ""}</div></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(r.quantity)} {r.unit}</td>
                  <td className="px-3 py-1.5 text-xs">{r.from}</td>
                  <td className="px-3 py-1.5 text-xs">{r.to}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.documentId ? <Link href={`/inventory/documents/${r.documentId}`} className="font-mono text-indigo-600">{r.document}</Link> : null}
                    {r.ticketId ? <Link href={`/tickets/${r.ticketId}`} className="ml-1 font-mono text-indigo-600">{r.ticketNumber}</Link> : null}
                    {r.clientName ? <div className="text-[11px] text-slate-500">{r.clientName}{r.siteName ? ` · ${r.siteName}` : ""}</div> : null}
                    {r.note && <div className="text-[11px] text-slate-400">{r.note}</div>}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{r.actor ?? "—"}</td>
                  {canPrices && <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmtMoney(r.sum)}</td>}
                </tr>
              ))}
              {!rep.rows.length && <tr><td colSpan={canPrices ? 9 : 8} className="px-3 py-8 text-center text-slate-400">Движений по заданным условиям нет</td></tr>}
            </tbody>
          </table>
        </div>
        <PrintFooter />
      </Card>
    </div>
  );
}
