import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { catalogItems, catalogCategories } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser, requireModule } from "@/lib/page-auth";
import { can, canWithRole, canSeePrices, canEditPrices } from "@/lib/rbac";
import { Card, PageHeader, Badge, SummaryList, Table, Td } from "@/components/ui";
import { getFormDictionaries } from "@/lib/services/directories";
import { itemStockBreakdown, listTransactions } from "@/lib/services/inventory";
import { auditFor } from "@/lib/services/audit";
import { fmtDate, fmtQty, TX_LABELS, UNIT_STATUS_LABELS } from "@/lib/labels";
import { fmtMoney } from "@/lib/prices";
import { ItemEditor } from "./ItemEditor";

export const dynamic = "force-dynamic";

/**
 * Карточка товара — единственное место, где позицию редактируют целиком.
 *
 * В списке номенклатуры осталась быстрая правка цены (это делают часто и пачками),
 * всё остальное — здесь, рядом с остатками и историей: изменение наименования или
 * единицы измерения видно вместе с тем, что по этой позиции уже лежит на складах.
 */
export default async function CatalogItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["catalog.read"]);
  await requireModule("catalog");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const [item] = await db.select().from(catalogItems).where(eq(catalogItems.id, id));
  if (!item) notFound();

  const manage = can(user, "catalog.manage");
  const showPrices = canSeePrices(user);
  const editPrices = canEditPrices(user);
  const showAudit = canWithRole(user, "audit.view");

  const [cats, { units }, stock, moves, history] = await Promise.all([
    db.select({ id: catalogCategories.id, name: catalogCategories.name, parentId: catalogCategories.parentId }).from(catalogCategories).orderBy(asc(catalogCategories.name)),
    getFormDictionaries(),
    itemStockBreakdown(id),
    listTransactions({ catalogItemId: id, limit: 30 }),
    showAudit ? auditFor("catalog_item", id, 20) : Promise.resolve([]),
  ]);

  const path = (cid: number | null): string => {
    const c = cats.find((x) => x.id === cid);
    return c ? (c.parentId ? `${path(c.parentId)} / ${c.name}` : c.name) : "";
  };

  const installed = stock.units.filter((u) => u.status === "installed").length;
  const free = stock.units.filter((u) => u.status !== "installed" && u.status !== "written_off").length;

  return (
    <div>
      <PageHeader
        title={item.name}
        subtitle={
          <>
            <span className="font-mono">{item.code}</span> · артикул {item.sku}
            {item.externalCode ? ` · 1С: ${item.externalCode}` : ""} · {path(item.categoryId)}
          </>
        }
        action={
          <Link href="/catalog" className="text-sm text-indigo-600">
            ← Номенклатура
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {manage || editPrices ? (
            <ItemEditor
              item={{
                id: item.id,
                name: item.name,
                sku: item.sku,
                externalCode: item.externalCode,
                fullName: item.fullName,
                categoryId: item.categoryId,
                unit: item.unit,
                manufacturer: item.manufacturer,
                description: item.description,
                isActive: item.isActive,
                isSerialized: item.isSerialized,
                price: showPrices ? item.price : null,
              }}
              categories={cats.map((c) => ({ id: c.id, label: path(c.id) }))}
              units={units.map((u) => ({ code: u.symbol, name: u.name }))}
              manage={manage}
              editPrices={editPrices}
              locked={stock.units.length > 0 || stock.places.length > 0}
            />
          ) : (
            <Card title="Свойства позиции">
              <SummaryList
                rows={[
                  { key: "name", label: "Наименование", value: item.name },
                  { key: "sku", label: "Артикул", value: item.sku },
                  { key: "cat", label: "Папка", value: path(item.categoryId) },
                  { key: "unit", label: "Единица измерения", value: item.unit },
                  { key: "kind", label: "Вид учёта", value: item.isSerialized ? "серийный (S/N)" : "количественный" },
                  { key: "man", label: "Производитель", value: item.manufacturer ?? "—" },
                  ...(showPrices ? [{ key: "price", label: "Цена", value: item.price ? fmtMoney(item.price) : "—" }] : []),
                  { key: "descr", label: "Описание", value: item.description ?? "—" },
                ]}
              />
            </Card>
          )}

          <Card title="Остатки по местам хранения">
            {item.isSerialized ? (
              <Table
                dense
                head={["Серийный номер", "Состояние", "Где", "Заявка"]}
                empty={!stock.units.length}
                emptyText="Единиц этой позиции на учёте нет"
              >
                {stock.units.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <Td dense className="font-mono text-xs">
                      <Link href={`/inventory/units/${u.id}`} className="text-indigo-600">
                        {u.serialNumber}
                      </Link>
                      {u.macAddress ? <div className="text-[11px] text-slate-400">{u.macAddress}</div> : null}
                    </Td>
                    <Td dense>
                      <Badge tone={u.status === "installed" ? "green" : u.status === "reserved" ? "amber" : u.status === "written_off" ? "rose" : "slate"}>
                        {UNIT_STATUS_LABELS[u.status] ?? u.status}
                      </Badge>
                    </Td>
                    <Td dense className="text-xs">{u.place}</Td>
                    <Td dense className="text-xs">{u.ticketId ? <Link href={`/tickets/${u.ticketId}`} className="text-indigo-600">заявка #{u.ticketId}</Link> : "—"}</Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Table dense head={["Место хранения", "Остаток", "В резерве", "Свободно"]} empty={!stock.places.length} emptyText="Остатков нет">
                {stock.places.map((p) => (
                  <tr key={p.key} className="hover:bg-slate-50">
                    <Td dense>{p.name}</Td>
                    <Td dense numeric>{fmtQty(p.quantity)} {item.unit}</Td>
                    <Td dense numeric>{p.reserved ? `${fmtQty(p.reserved)} ${item.unit}` : "—"}</Td>
                    <Td dense numeric>{fmtQty(p.quantity - p.reserved)} {item.unit}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Движение (последние 30)">
            <Table dense head={["Когда", "Операция", "Кол-во", "Откуда → Куда", "Документ / заявка", "Кто"]} empty={!moves.length} emptyText="Движений не было">
              {moves.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <Td dense className="whitespace-nowrap text-xs">{fmtDate(m.createdAt)}</Td>
                  <Td dense className="text-xs">{TX_LABELS[m.type] ?? m.type}</Td>
                  <Td dense numeric>{fmtQty(m.quantity)} {m.serialNumber ? `· ${m.serialNumber}` : m.unit}</Td>
                  <Td dense className="text-xs">
                    {m.fromWarehouseName ?? m.fromTeamName ?? "—"} → {m.toWarehouseName ?? m.toTeamName ?? (m.toLocationType === "site" ? (m.siteName ?? "объект") : "—")}
                  </Td>
                  <Td dense className="text-xs">
                    {m.documentId ? <Link href={`/inventory/documents/${m.documentId}`} className="font-mono text-indigo-600">{m.documentNumber}</Link> : null}
                    {m.ticketId ? <Link href={`/tickets/${m.ticketId}`} className="ml-1 font-mono text-indigo-600">{m.ticketNumber}</Link> : null}
                  </Td>
                  <Td dense className="text-xs">{m.actorName ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          {showAudit && (
            <Card
              title="История изменений карточки"
              action={
                <Link href={`/audit?entity=catalog_item&q=${encodeURIComponent(item.name)}`} className="text-sm text-indigo-600">
                  весь журнал →
                </Link>
              }
            >
              <Table dense head={["Когда", "Кто", "Что изменил"]} empty={!history.length} emptyText="Карточку не редактировали">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <Td dense className="whitespace-nowrap text-xs">{fmtDate(h.at)}</Td>
                    <Td dense className="text-xs">{h.actorName}</Td>
                    <Td dense className="text-xs">{h.summary}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Сводка">
            <SummaryList
              rows={[
                { key: "kind", label: "Вид учёта", value: item.isSerialized ? "серийный (S/N)" : `количественный, ${item.unit}` },
                ...(item.isSerialized
                  ? [
                      { key: "free", label: "Единиц на руках и складах", value: String(free) },
                      { key: "inst", label: "Установлено на объектах", value: String(installed) },
                    ]
                  : [
                      { key: "total", label: "Всего на остатках", value: `${fmtQty(stock.totalQuantity)} ${item.unit}` },
                      { key: "res", label: "В резерве под заявки", value: `${fmtQty(stock.totalReserved)} ${item.unit}` },
                      { key: "avail", label: "Свободно", value: `${fmtQty(stock.totalQuantity - stock.totalReserved)} ${item.unit}` },
                    ]),
                ...(showPrices ? [{ key: "price", label: "Цена", value: item.price ? fmtMoney(item.price) : "не задана" }] : []),
                { key: "state", label: "Состояние", value: item.isActive ? "активна" : "отключена" },
              ]}
            />
          </Card>

          <Card title="Где посмотреть ещё">
            <ul className="space-y-1.5 text-sm">
              <li>
                <Link href={`/reports/movements?itemIds[]=${item.id}`} className="text-indigo-600">
                  Отчёт движения по позиции
                </Link>
              </li>
              <li>
                <Link href={`/reports/stock?itemIds[]=${item.id}`} className="text-indigo-600">
                  Остатки по складам
                </Link>
              </li>
              <li>
                <Link href="/inventory" className="text-indigo-600">
                  Складские операции
                </Link>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
