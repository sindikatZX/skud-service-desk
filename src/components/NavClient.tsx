"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { NavItem } from "@/components/AppShell";

export function NavLinks({ items, variant }: { items: NavItem[]; variant: "side" | "bottom" }) {
  const path = usePathname();
  return (
    <>
      {items.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        if (variant === "side")
          return (
            <Link key={it.href} href={it.href} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`}>
              <span className="w-5 text-center text-base">{it.icon}</span>{it.label}
            </Link>
          );
        return (
          <Link key={it.href} href={it.href} className={`flex flex-col items-center py-2 text-[11px] ${active ? "text-indigo-700" : "text-slate-500"}`}>
            <span className="text-lg leading-none">{it.icon}</span>
            <span className="mt-0.5">{it.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function LogoutButton({ compact }: { compact?: boolean }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <button onClick={logout} className={compact ? "rounded-lg border border-slate-300 px-2 py-1 text-xs" : "mt-2 text-xs text-indigo-600 hover:underline"}>
      Выйти
    </button>
  );
}
