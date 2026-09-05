import Link from "next/link";
import { db } from "@/db";
import { warehouses, catalogCategories } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/page-auth";
import { canSeePrices, canWithRole } from "@/lib/rbac";
import { Card, PageHeader, Field, inputCls } from "@/components/ui";
import { fmtQty } from "@/lib/labels";
import { fmtMoney } from "@/lib/prices";
import { stockReport, parsePeriod, periodLabel } from "@/lib/services/report-builder";
import { stockReportQuerySchema } from "@/lib/validators";
import { ReportToolbar, SortTh, PrintHeader, PrintFooter, MultiSelect, ReportForm, PeriodFields, FilterRow } from "../ReportKit";
import { getBranding } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

export default async function StockReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["reports.stock", "reports.inventory"]);
  const sp = await searchParams;
  const parsed = stockReportQuerySchema.safeParse(sp);
  const q = parsed.success ? parsed.data : stockReportQuerySchema.parse({});
  const canPrices = canSeePrices(user);
  const canExport = canWithRole(user, "reports.export");
  const [whs, cats, branding] = await Promise.all([
    db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.isActive, true)).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
    db.select({ id: catalogCategories.id, name: catalogCategories.name }).from(catalogCategories).orderBy(asc(catalogCategories.name)),
    getBranding(),
  ]);
  const period = parsePeriod(q.from, q.to);
  const rep = await stockReport({ warehouseIds: q.warehouseIds, period, q: q.q, categoryId: q.categoryId, onlyNonZero: q.onlyNonZero, sort: q.sort, dir: q.dir, canPrices });
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  const sort = q.sort ?? "name"; const dir = q.dir ?? "asc";
  const filters = [
    { label: "Склады", value: rep.warehouses.map((w) => w.name).join(", ") },
    { label: "Категория", value: cats.find((c) => c.id === q.categoryId)?.name ?? "" },
    { label: "Поиск", value: q.q ?? "" },
  ];

  return (
    <div>
      <PageHeader title="Отчёт остатков" subtitle="Начальный остаток, приход, расход и конечный остаток по складам за период" action={<Link href="/reports" className="no-print text-sm text-indigo-600">← Все отчёты</Link>} />
      <Card className="no-print mb-4">
        <ReportForm action="/reports/stock">
          {/* Ряд 1: период и категория */}
          <FilterRow>
            <PeriodFields from={q.from} to={q.to} />
            <Field label="Категория"><select name="categoryId" defaultValue={q.categoryId ?? ""} className={inputCls}><option value="">Все</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <label className="flex items-center gap-2 pt-7 text-sm">
              {/* скрытое поле идёт первым: снятый флажок даёт «0», установленный — перекрывает его «1» */}
              <input type="hidden" name="onlyNonZero" value="0" />
              <input type="checkbox" name="onlyNonZero" value="1" defaultChecked={q.onlyNonZero} className="h-4 w-4" /> Скрывать нулевые строки
            </label>
          </FilterRow>
          {/* Ряд 2: поиск */}
          <FilterRow>
            <Field label="Товар (часть наименования / артикул / код)"><input name="q" defaultValue={q.q ?? ""} className={inputCls} placeholder="камера" /></Field>
          </FilterRow>
          {/* Ряд 3: склады */}
          <FilterRow cols={2}>
            <MultiSelect name="warehouseIds[]" label="Склады (пусто — все активные)" options={whs} selected={q.warehouseIds} size={5} resizable />
          </FilterRow>
        </ReportForm>
      </Card>

      <Card className="print-area">
        <PrintHeader appName={branding.appName} title="Отчёт остатков" period={periodLabel(period)} filters={filters} user={user.fullName} />
        <div className="mb-3"><ReportToolbar csvHref={`/api/v1/reports/stock?${query}&format=csv`} resetHref="/reports/stock" canExport={canExport} rows={rep.rows.length} /></div>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-200">
                <SortTh field="warehouse" current={sort} dir={dir}>Склад</SortTh>
                <SortTh field="code" current={sort} dir={dir}>Код</SortTh>
                <SortTh field="sku" current={sort} dir={dir}>Артикул</SortTh>
                <SortTh field="name" current={sort} dir={dir}>Наименование</SortTh>
                <SortTh field="category" current={sort} dir={dir}>Категория</SortTh>
                <th className="px-3 py-2 font-medium">Ед.</th>
                <SortTh field="opening" current={sort} dir={dir} className="text-right">Нач. ост.</SortTh>
                <SortTh field="income" current={sort} dir={dir} className="text-right">Приход</SortTh>
                <SortTh field="outcome" current={sort} dir={dir} className="text-right">Расход</SortTh>
                <SortTh field="closing" current={sort} dir={dir} className="text-right">Кон. ост.</SortTh>
                {canPrices && <><th className="px-3 py-2 text-right font-medium">Цена</th><th className="px-3 py-2 text-right font-medium">Сумма</th></>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rep.totals.map((t) => (
                <FragmentRows key={t.warehouseId} t={t} rows={rep.rows.filter((r) => r.warehouseId === t.warehouseId)} canPrices={canPrices} />
              ))}
              {!rep.rows.length && <tr><td colSpan={canPrices ? 12 : 10} className="px-3 py-8 text-center text-slate-400">Нет данных за выбранный период</td></tr>}
            </tbody>
          </table>
        </div>
        <PrintFooter />
      </Card>
    </div>
  );
}

function FragmentRows({ t, rows, canPrices }: { t: { warehouseName: string; items: number; opening: number; income: number; outcome: number; closing: number; closingSum: number | null }; rows: Awaited<ReturnType<typeof stockReport>>["rows"]; canPrices: boolean }) {
  if (!rows.length) return null;
  return (
    <>
      {rows.map((r) => (
        <tr key={`${r.warehouseId}-${r.itemId}`} className="hover:bg-slate-50">
          <td className="px-3 py-1.5 text-xs text-slate-500">{r.warehouseName}</td>
          <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
          <td className="px-3 py-1.5 text-xs">{r.sku}</td>
          <td className="px-3 py-1.5 font-medium">{r.name}</td>
          <td className="px-3 py-1.5 text-xs text-slate-500">{r.category}</td>
          <td className="px-3 py-1.5 text-xs">{r.unit}</td>
          <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(r.opening)}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{r.income ? `+${fmtQty(r.income)}` : "—"}</td>
          <td className="px-3 py-1.5 text-right tabular-nums text-rose-700">{r.outcome ? `−${fmtQty(r.outcome)}` : "—"}</td>
          <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${r.closing < 0 ? "text-rose-600" : ""}`}>{fmtQty(r.closing)}</td>
          {canPrices && <><td className="px-3 py-1.5 text-right tabular-nums text-xs">{fmtMoney(r.price)}</td><td className="px-3 py-1.5 text-right tabular-nums text-xs">{fmtMoney(r.closingSum)}</td></>}
        </tr>
      ))}
      <tr className="bg-slate-50 font-semibold">
        <td className="px-3 py-1.5 text-xs" colSpan={3}>Итого: {t.warehouseName}</td>
        <td className="px-3 py-1.5 text-xs" colSpan={3}>{t.items} поз.</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(t.opening)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(t.income)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(t.outcome)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(t.closing)}</td>
        {canPrices && <><td /><td className="px-3 py-1.5 text-right tabular-nums text-xs">{fmtMoney(t.closingSum)}</td></>}
      </tr>
    </>
  );
}
