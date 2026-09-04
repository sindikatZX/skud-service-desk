"use client";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISS_KEY = "fsm.install.dismissedAt";
const DISMISS_DAYS = 7;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as Window & { MSStream?: unknown }).MSStream;
}

/**
 * Единая точка PWA-логики:
 *  - регистрация service worker и мягкое предложение обновиться, когда готова новая версия;
 *  - баннер «Установить приложение» (Android/desktop через beforeinstallprompt, iOS — подсказка);
 *  - индикатор отсутствия сети.
 */
export function PwaProvider() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [offline, setOffline] = useState(false);
  const [installHidden, setInstallHidden] = useState(true);

  // ── Service worker ──────────────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
        // Проверяем обновления при возврате в приложение (актуально для установленного PWA).
        const onVisible = () => document.visibilityState === "visible" && reg.update().catch(() => {});
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {});
  }, []);

  // ── Установка ───────────────────────────────────────────────────
  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
    const recentlyDismissed = Date.now() - dismissedAt < DISMISS_DAYS * 86400000;
    if (recentlyDismissed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstallEvt(null); setShowIosHint(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Показываем предложение не мгновенно, а когда пользователь немного поработал.
    const timer = window.setTimeout(() => {
      setInstallHidden(false);
      if (isIos()) setShowIosHint(true);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // ── Сеть ────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    const timer = window.setTimeout(sync, 0);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  const dismissInstall = useCallback(() => {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setInstallEvt(null);
    setShowIosHint(false);
    setInstallHidden(true);
  }, []);

  const install = useCallback(async () => {
    if (!installEvt) return;
    await installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    if (outcome === "accepted") setInstallEvt(null);
    else dismissInstall();
  }, [installEvt, dismissInstall]);

  const showInstall = !installHidden && (installEvt || showIosHint);

  return (
    <>
      {offline && (
        <div role="status" className="fixed inset-x-0 top-0 z-[60] bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white shadow" style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.375rem)" }}>
          Нет подключения к сети — показаны сохранённые данные
        </div>
      )}

      {waiting && (
        <div className="fixed inset-x-3 z-[60] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white p-3 text-sm shadow-xl lg:bottom-4! lg:left-auto lg:right-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 9rem)" }}>
          <div>
            <div className="font-semibold text-slate-900">Доступно обновление</div>
            <div className="text-xs text-slate-500">Перезапустите, чтобы применить новую версию</div>
          </div>
          <button onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Обновить</button>
        </div>
      )}

      {showInstall && (
        <div className="fixed inset-x-3 z-[55] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-xl lg:bottom-4! lg:left-auto lg:right-4" style={{ bottom: "calc(env(safe-area-inset-bottom) + 9rem)" }}>
          <div className="flex items-start gap-3">
            <Image src="/icons/icon-192.png" alt="" width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900">Установить СКУД•Сервис</div>
              {installEvt ? (
                <p className="text-xs text-slate-500">Быстрый запуск с рабочего стола и работа офлайн с последними данными.</p>
              ) : (
                <p className="text-xs text-slate-500">
                  В Safari нажмите <span className="inline-block rounded border border-slate-300 px-1 leading-4">⎙</span> «Поделиться» → «На экран „Домой“».
                </p>
              )}
              <div className="mt-2 flex gap-2">
                {installEvt && <button onClick={install} className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Установить</button>}
                <button onClick={dismissInstall} className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Позже</button>
              </div>
            </div>
            <button onClick={dismissInstall} aria-label="Закрыть" className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100">✕</button>
          </div>
        </div>
      )}
    </>
  );
}
