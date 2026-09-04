import Link from "next/link";
import { requireUser } from "@/lib/page-auth";
import { listDocuments } from "@/lib/services/inventory";
import { listWarehouses } from "@/lib/services/warehouses";
import { Card, PageHeader, Table, Td, Badge, inputCls } from "@/components/ui";
import { fmtDate, fmtQty, DOC_TYPE_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

const TONE: Record<string, "green" | "indigo" | "rose"> = { receipt: "green", transfer: "indigo", writeoff: "rose" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser(["inventory.read.all", "inventory.read.team"]);
  const sp = await searchParams;
  const [rows, whs] = await Promise.all([
    listDocuments({ type: sp.type || undefined, warehouseId: sp.warehouseId ? Number(sp.warehouseId) : undefined, from: sp.from ? new Date(sp.from) : null, to: sp.to ? new Date(sp.to + "T23:59:59") : null, q: sp.q || undefined, limit: 500 }),
    listWarehouses({ includeInactive: true }),
  ]);
  return (
    <div>
      <PageHeader title="Складские документы" subtitle={`Поступления (партии), перемещения и списания · ${rows.length} документов`} action={<Link href="/inventory" className="text-sm text-indigo-600">← Склады</Link>} />
      <Card className="mb-4">
        <form className="grid gap-2 sm:grid-cols-6">
          <select name="type" defaultValue={sp.type ?? ""} className={inputCls}><option value="">Все типы</option>{Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select name="warehouseId" defaultValue={sp.warehouseId ?? ""} className={inputCls}><option value="">Все склады</option>{whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <input name="from" type="date" defaultValue={sp.from ?? ""} className={inputCls} />
          <input name="to" type="date" defaultValue={sp.to ?? ""} className={inputCls} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="№ документа / поставщик" className={inputCls} />
          <div className="flex gap-2"><button className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Фильтр</button><Link href="/inventory/documents" className="rounded-xl border border-slate-300 px-4 py-2 text-sm">Сброс</Link></div>
        </form>
      </Card>
      <Card>
        <Table head={["Дата", "Номер", "Тип", "Откуда → Куда", "Позиций", "Кол-во", "Поставщик / вх. №", "Кто"]} empty={!rows.length}>
          {rows.map((d) => (
            <tr key={d.id} className="hover:bg-slate-50">
              <Td className="whitespace-nowrap text-xs">{fmtDate(d.docDate)}</Td>
              <Td><Link href={`/inventory/documents/${d.id}`} className="font-mono font-medium text-indigo-700">{d.number}</Link></Td>
              <Td><Badge tone={TONE[d.type]}>{DOC_TYPE_LABELS[d.type]}</Badge></Td>
              <Td className="text-xs">{d.fromWarehouseName ?? (d.type === "receipt" ? "Поставщик" : "—")}{" → "}{d.toWarehouseName ?? (d.type === "writeoff" ? "Списание" : "—")}</Td>
              <Td>{d.linesCount}</Td>
              <Td>{fmtQty(d.totalQuantity)}</Td>
              <Td className="text-xs">{d.supplier}{d.externalNumber ? ` · ${d.externalNumber}` : ""}{d.note && <div className="text-slate-400">{d.note}</div>}</Td>
              <Td className="text-xs">{d.actorName ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
