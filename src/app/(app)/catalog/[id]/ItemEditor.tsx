"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { useConfirm } from "@/components/dialog";
import { QuickForm } from "@/components/QuickForm";
import { Card, Badge, btnSecondaryCls, btnDangerCls, FormMessage } from "@/components/ui";

export type EditableItem = {
  id: number;
  name: string;
  sku: string;
  externalCode: string | null;
  fullName: string | null;
  categoryId: number;
  unit: string;
  manufacturer: string | null;
  description: string | null;
  isActive: boolean;
  isSerialized: boolean;
  price: string | null;
};

/**
 * Редактирование позиции номенклатуры.
 *
 * Вид учёта (серийный / количественный) показываем, но не даём переключать, когда
 * по позиции уже есть остатки: сервер такую правку всё равно отклонит, а объяснить
 * причину лучше до нажатия, чем после.
 */
export function ItemEditor({
  item,
  categories,
  units,
  manage,
  editPrices,
  locked,
}: {
  item: EditableItem;
  categories: { id: number; label: string }[];
  units: { code: string; name: string }[];
  manage: boolean;
  editPrices: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(json: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/catalog/${item.id}`, { method: "PATCH", json });
      setMsg({ ok: true, text: done });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: "Удалить позицию?", text: "Позицию с остатками или движениями удалить нельзя — вместо этого её можно отключить.", danger: true, confirmLabel: "Удалить" }))) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/catalog/${item.id}`, { method: "DELETE" });
      router.push("/catalog");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <Card
      title="Карточка позиции"
      action={
        <span className="flex items-center gap-2">
          <Badge tone={item.isActive ? "green" : "slate"}>{item.isActive ? "активна" : "отключена"}</Badge>
          {item.isSerialized ? <Badge tone="indigo">серийный учёт</Badge> : <Badge>кол-во, {item.unit}</Badge>}
        </span>
      }
    >
      <QuickForm
        endpoint={`/catalog/${item.id}`}
        method="PATCH"
        submitLabel="Сохранить изменения"
        fields={[
          { name: "name", label: "Наименование", required: true, defaultValue: item.name },
          { name: "sku", label: "Артикул", required: true, defaultValue: item.sku },
          { name: "externalCode", label: "Код 1С", nullable: true, defaultValue: item.externalCode ?? "" },
          { name: "categoryId", label: "Папка", type: "select", required: true, numeric: true, options: categories.map((c) => ({ value: c.id, label: c.label })), defaultValue: item.categoryId },
          { name: "unit", label: "Ед. изм.", type: "select", required: true, options: units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })), defaultValue: item.unit },
          { name: "manufacturer", label: "Производитель", nullable: true, defaultValue: item.manufacturer ?? "" },
          ...(editPrices ? [{ name: "price", label: "Цена, ₽", type: "number" as const, step: "0.01", nullable: true, defaultValue: item.price ?? "" }] : []),
          { name: "fullName", label: "Полное наименование", nullable: true, defaultValue: item.fullName ?? "", hint: "для печатных форм, если отличается от короткого" },
          { name: "description", label: "Описание", type: "textarea", nullable: true, defaultValue: item.description ?? "" },
        ]}
      />

      {msg && (
        <div className="mt-3">
          <FormMessage ok={msg.ok} onHide={() => setMsg(null)}>
            {msg.text}
          </FormMessage>
        </div>
      )}

      {manage && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button type="button" className={btnSecondaryCls} disabled={busy} onClick={() => run({ isActive: !item.isActive }, item.isActive ? "Позиция отключена" : "Позиция включена")}>
            {item.isActive ? "Отключить позицию" : "Включить позицию"}
          </button>
          <button type="button" className={btnDangerCls} disabled={busy} onClick={remove}>
            Удалить позицию
          </button>
          <span className="text-xs text-slate-500">
            {locked
              ? "Вид учёта не меняется: по позиции уже есть остатки или движения."
              : "Пока по позиции нет движений, вид учёта можно сменить, заведя её заново."}
          </span>
        </div>
      )}
    </Card>
  );
}
