"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import type { NavItem } from "@/components/AppShell";
import { Icon } from "@/components/icons";

type Profile = { fullName: string; roleName: string; email: string; initials: string };

const MAX_BOTTOM = 4; // primary-вкладки в нижней навигации; остальное — в «Ещё»

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/") || path.startsWith(href + "?");
}

/** Ссылки боковой панели (desktop). */
export function NavLinks({ items, variant = "side" }: { items: NavItem[]; variant?: "side" | "sheet" }) {
  const path = usePathname();
  return (
    <>
      {items.map((it) => {
        const active = isActive(path, it.href);
        if (variant === "sheet")
          return (
            <Link key={it.href} href={it.href} className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 active:bg-slate-100"}`}>
              <span className={`grid h-11 w-11 place-items-center rounded-2xl ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}><Icon name={it.icon} size={22} /></span>
              <span className="leading-tight">{it.label}</span>
            </Link>
          );
        return (
          <Link key={it.href} href={it.href} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`}>
            <Icon name={it.icon} size={18} className={active ? "text-indigo-600" : "text-slate-400"} />
            {it.label}
          </Link>
        );
      })}
    </>
  );
}

/** Нижняя навигация для мобильных: до 4 разделов + «Ещё» со шторкой. */
export function BottomNav({ items, profile }: { items: NavItem[]; profile: Profile }) {
  const path = usePathname();
  // Храним путь, на котором открыли шторку: при переходе она закрывается сама, без setState в эффекте.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const setOpen = (v: boolean) => setOpenAt(v ? path : null);
  const needMore = items.length > MAX_BOTTOM + 1;
  const primary = needMore ? items.slice(0, MAX_BOTTOM) : items;
  const rest = needMore ? items.slice(MAX_BOTTOM) : [];
  const restActive = rest.some((it) => isActive(path, it.href));

  // Блокируем скролл фона при открытой шторке
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <nav aria-label="Основная навигация" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid auto-cols-fr grid-flow-col">
          {primary.map((it) => {
            const active = isActive(path, it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${active ? "text-indigo-700" : "text-slate-500 active:text-slate-800"}`}>
                <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active ? "bg-indigo-100" : ""}`}><Icon name={it.icon} size={21} strokeWidth={active ? 2.2 : 1.9} /></span>
                <span className="truncate">{it.short ?? it.label}</span>
              </Link>
            );
          })}
          {needMore && (
            <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${restActive || open ? "text-indigo-700" : "text-slate-500 active:text-slate-800"}`}>
              <span className={`grid h-7 w-12 place-items-center rounded-full ${restActive || open ? "bg-indigo-100" : ""}`}><Icon name="more" size={21} strokeWidth={2.4} /></span>
              <span>Ещё</span>
            </button>
          )}
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Все разделы">
          <button type="button" aria-label="Закрыть" className="sheet-backdrop absolute inset-0" onClick={() => setOpen(false)} />
          <div className="sheet-panel absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300" />
            <div className="flex items-center gap-3 px-5 pb-3 pt-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{profile.initials}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{profile.fullName}</div>
                <div className="truncate text-xs text-slate-500">{profile.roleName} · {profile.email}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Закрыть" className="tap-target grid place-items-center rounded-full text-slate-400 active:bg-slate-100"><Icon name="close" size={20} /></button>
            </div>
            <div className="grid grid-cols-4 gap-1 px-3 pb-2">
              <NavLinks items={items} variant="sheet" />
            </div>
            <div className="mx-4 mt-2 border-t border-slate-200 pt-3">
              <LogoutButton className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 active:bg-slate-50">
                <Icon name="logout" size={18} /> Выйти из аккаунта
              </LogoutButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Мобильная шапка: «Назад» на вложенных экранах, бренд, аватар с меню. */
export function MobileHeader({ homeHref, profile }: { homeHref: string; profile: Profile }) {
  const path = usePathname();
  const router = useRouter();
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const menu = menuAt === path;
  const setMenu = (v: boolean | ((prev: boolean) => boolean)) => setMenuAt((typeof v === "function" ? v(menu) : v) ? path : null);
  const segments = path.split("/").filter(Boolean);
  const nested = segments.length > 1 || (segments.length === 1 && !["tickets", "clients", "teams", "inventory", "catalog", "employees", "directories", "reports", "my-team"].includes(segments[0]));
  function back() {
    if (window.history.length > 1) router.back();
    else router.push(segments.length > 1 ? `/${segments[0]}` : homeHref);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur lg:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex h-14 items-center justify-between px-2">
        <div className="flex min-w-0 items-center">
          {nested ? (
            <button type="button" onClick={back} aria-label="Назад" className="tap-target grid place-items-center rounded-full text-slate-700 active:bg-slate-100"><Icon name="back" size={22} /></button>
          ) : (
            <span className="w-2" />
          )}
          <Link href={homeHref} className="flex items-center gap-2 px-1 text-base font-bold text-indigo-700">
            <Image src="/icons/icon-192.png" alt="" width={28} height={28} unoptimized className="h-7 w-7 rounded-lg" />
            <span>СКУД•Сервис</span>
          </Link>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu} aria-label="Профиль" className="tap-target grid place-items-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{profile.initials}</span>
          </button>
          {menu && (
            <>
              <button type="button" aria-label="Закрыть" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="truncate text-sm font-semibold">{profile.fullName}</div>
                  <div className="truncate text-xs text-slate-500">{profile.roleName}</div>
                  <div className="truncate text-xs text-slate-400">{profile.email}</div>
                </div>
                <LogoutButton className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-700 active:bg-slate-50">
                  <Icon name="logout" size={16} /> Выйти
                </LogoutButton>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function LogoutButton({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      // Сбрасываем офлайн-кэш данных, чтобы следующий пользователь не увидел чужие страницы.
      navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_DATA_CACHE" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }
  return (
    <button type="button" onClick={logout} disabled={busy} className={className ?? "mt-2 text-xs text-indigo-600 hover:underline"}>
      {children ?? "Выйти"}
    </button>
  );
}
