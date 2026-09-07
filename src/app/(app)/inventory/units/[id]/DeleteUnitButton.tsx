"use client";
import { useState } from "react";
import { useConfirm } from "@/components/dialog";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";

/**
 * Удаление ошибочно оприходованной единицы. Установленную на объекте удалить нельзя —
 * это стёрло бы историю обслуживания, поэтому кнопка для неё не показывается.
 */
export function DeleteUnitButton({ unitId, serialNumber, status }: { unitId: number; serialNumber: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirm = useConfirm();

  if (status === "installed") return null;

  async function remove() {
    if (!(await confirm({ title: "Удалить единицу оборудования?", text: `${serialNumber} — вместе с её складскими проводками.\n\nИспользуйте это только для исправления ошибки приёмки.`, danger: true, confirmLabel: "Удалить" }))) return;
    setBusy(true); setErr(null);
    try {
      await api(`/inventory/units/${unitId}`, { method: "DELETE" });
      router.push("/inventory");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {err && <span className="max-w-xs text-xs text-rose-600">{err}</span>}
      <button onClick={remove} disabled={busy} className="text-sm text-rose-600 hover:underline disabled:opacity-50">
        {busy ? "…" : "Удалить единицу"}
      </button>
    </span>
  );
}
