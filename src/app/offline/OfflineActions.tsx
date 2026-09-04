"use client";
import { useEffect, useState } from "react";
import { btnCls, btnSecondaryCls } from "@/components/ui";

export function OfflineActions() {
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    const timer = window.setTimeout(sync, 0);
    // Как только сеть вернулась — автоматически повторяем переход.
    const onOnline = () => { setOnline(true); window.location.reload(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", onOnline); window.removeEventListener("offline", sync); };
  }, []);

  async function retry() {
    setChecking(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok && !res.headers.get("X-SW-Offline")) { window.location.reload(); return; }
    } catch { /* остаёмся офлайн */ }
    setChecking(false);
  }

  return (
    <div className="mt-5 space-y-2">
      <div className={`text-xs font-medium ${online ? "text-emerald-600" : "text-amber-600"}`}>{online ? "Сеть появилась — обновляем…" : "Соединение отсутствует"}</div>
      <button onClick={retry} disabled={checking} className={`${btnCls} w-full`}>{checking ? "Проверяем…" : "Повторить"}</button>
      <button onClick={() => window.history.back()} className={`${btnSecondaryCls} w-full`}>← Назад</button>
    </div>
  );
}
