import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/page-auth";
import { getDocument } from "@/lib/services/inventory";
import { Card, PageHeader, Table, Td, Badge } from "@/components/ui";
import { fmtDate, fmtQty, DOC_TYPE_LABELS, TX_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["inventory.read.all", "inventory.read.team"]);
  const id = Number((await params).id);
  const d = await getDocument(id);
  if (!d) notFound();
  const { doc, lines, transactions } = d;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`${DOC_TYPE_LABELS[doc.type]} ${doc.number}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>от {fmtDate(doc.docDate)}</span>{doc.type === "receipt" && <Badge tone="green">Партия</Badge>}</span>}
        action={<Link href="/inventory/documents" className="text-sm text-indigo-600">← Все документы</Link>}
      />
      <Card className="mb-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-slate-500">Откуда</dt><dd>{doc.fromWarehouseName ?? (doc.type === "receipt" ? doc.supplier || "Поставщик" : "—")}</dd></div>
          <div><dt className="text-xs text-slate-500">Куда</dt><dd>{doc.toWarehouseName ?? (doc.type === "writeoff" ? "Списание" : "—")}</dd></div>
          <div><dt className="text-xs text-slate-500">Оформил</dt><dd>{doc.actorName ?? "—"} · {fmtDate(doc.createdAt)}</dd></div>
          {doc.externalNumber && <div><dt className="text-xs text-slate-500">Вх. номер</dt><dd>{doc.externalNumber}</dd></div>}
          {doc.supplier && <div><dt className="text-xs text-slate-500">Поставщик</dt><dd>{doc.supplier}</dd></div>}
          {doc.note && <div className="sm:col-span-3"><dt className="text-xs text-slate-500">Примечание</dt><dd>{doc.note}</dd></div>}
        </dl>
      </Card>
      <Card title={`Позиции (${lines.length}) · всего ${fmtQty(doc.totalQuantity)}`} className="mb-4">
        <Table head={["№", "Номенклатура", "Кол-во", "Серийные номера", "Цена"]} empty={!lines.length}>
          {lines.map((l) => (
            <tr key={l.id}>
              <Td className="text-xs text-slate-500">{l.lineNo}</Td>
              <Td><div className="font-medium">{l.name}</div><div className="text-xs text-slate-500">{l.sku}</div></Td>
              <Td className="whitespace-nowrap">{fmtQty(l.quantity)} {l.unit}</Td>
              <Td className="font-mono text-xs">{l.serialNumbers.length ? l.serialNumbers.join(", ") : "—"}</Td>
              <Td>{l.price ? fmtQty(l.price) : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Проводки документа">
        <Table head={["Операция", "Позиция", "S/N", "Кол-во", "Когда"]} empty={!transactions.length}>
          {transactions.map((x) => (
            <tr key={x.id}>
              <Td className="text-xs">{TX_LABELS[x.type]}</Td>
              <Td className="text-sm">{x.itemName}</Td>
              <Td>{x.unitId ? <Link href={`/inventory/units/${x.unitId}`} className="font-mono text-xs text-indigo-600">{x.serialNumber}</Link> : "—"}</Td>
              <Td>{fmtQty(x.quantity)} {x.unit}</Td>
              <Td className="whitespace-nowrap text-xs">{fmtDate(x.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
