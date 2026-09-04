import Link from "next/link";
import { Card, Table, Td, UnitStatusBadge } from "@/components/ui";
import { fmtQty } from "@/lib/labels";
import type { getStock } from "@/lib/services/inventory";
import type { ReactNode } from "react";

type Stock = Awaited<ReturnType<typeof getStock>>;

export function StockView({ stock, title, unitAction, balanceAction }: { stock: Stock; title?: string; unitAction?: (u: Stock["units"][number]) => ReactNode; balanceAction?: (b: Stock["balances"][number]) => ReactNode }) {
  return (
    <div className="space-y-4">
      <Card title={`${title ?? "Серийное оборудование"} (${stock.units.length})`}>
        <Table head={["Оборудование", "S/N / MAC", "Статус", "Заявка", ""]} empty={!stock.units.length}>
          {stock.units.map((u) => (
            <tr key={u.id}>
              <Td><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.category} · {u.sku}</div></Td>
              <Td><Link href={`/inventory/units/${u.id}`} className="font-mono text-xs text-indigo-600">{u.serialNumber}</Link>{u.macAddress && <div className="font-mono text-[10px] text-slate-500">{u.macAddress}</div>}</Td>
              <Td><UnitStatusBadge status={u.status} /></Td>
              <Td>{u.ticketId ? <Link href={`/tickets/${u.ticketId}`} className="text-xs text-indigo-600">#{u.ticketId}</Link> : "—"}</Td>
              <Td>{unitAction?.(u)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={`Материалы (${stock.balances.length})`}>
        <Table head={["Материал", "Категория", "Доступно", ""]} empty={!stock.balances.length}>
          {stock.balances.map((b) => (
            <tr key={b.catalogItemId}><Td><div className="font-medium">{b.name}</div><div className="text-xs text-slate-500">{b.sku}</div></Td><Td className="text-xs">{b.category}</Td><Td className="font-semibold">{fmtQty(b.quantity)} {b.unit}</Td><Td>{balanceAction?.(b)}</Td></tr>
          ))}
        </Table>
      </Card>
      {stock.reservations.length > 0 && (
        <Card title={`Резервы материалов под заявки (${stock.reservations.length})`}>
          <Table head={["Материал", "Кол-во", "Заявка"]}>
            {stock.reservations.map((r) => (
              <tr key={r.id}><Td>{r.name}</Td><Td>{fmtQty(r.quantity)} {r.unit}</Td><Td><Link href={`/tickets/${r.ticketId}`} className="text-xs text-indigo-600">{r.ticketNumber} — {r.ticketTitle}</Link></Td></tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
