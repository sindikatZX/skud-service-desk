import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { NavLinks, LogoutButton } from "@/components/NavClient";

export type NavItem = { href: string; label: string; icon: string };

export function navFor(user: SessionUser): NavItem[] {
  const items: NavItem[] = [];
  const isClient = user.scope === "client";
  const isField = user.scope === "team";
  if (!isClient) items.push({ href: "/", label: "Главная", icon: "▦" });
  items.push({ href: "/tickets", label: "Заявки", icon: "☰" });
  if (isField) items.push({ href: "/my-team", label: "Моя бригада", icon: "⛟" });
  if (can(user, "clients.read") && !isField) items.push({ href: "/clients", label: "Клиенты", icon: "◫" });
  if (can(user, "teams.read") && !isField) items.push({ href: "/teams", label: "Бригады", icon: "⛟" });
  if (can(user, "inventory.read.all")) items.push({ href: "/inventory", label: "Склад", icon: "▤" });
  if (can(user, "catalog.read") && !isField) items.push({ href: "/catalog", label: "Номенклатура", icon: "≣" });
  if (can(user, "users.manage")) items.push({ href: "/employees", label: "Сотрудники", icon: "☺" });
  if (can(user, "directories.manage")) items.push({ href: "/directories", label: "Справочники", icon: "⚙" });
  if (can(user, "reports.view") || can(user, "reports.inventory")) items.push({ href: "/reports", label: "Отчёты", icon: "◔" });
  return items;
}

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const items = navFor(user);
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-lg font-bold tracking-tight text-indigo-700">СКУД•Сервис</div>
          <div className="text-xs text-slate-500">Service Desk / FSM</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          <NavLinks items={items} variant="side" />
        </nav>
        <div className="border-t border-slate-200 p-4 text-sm">
          <div className="font-medium">{user.fullName}</div>
          <div className="text-xs text-slate-500">{user.roleName}</div>
          <LogoutButton />
        </div>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <Link href={user.scope === "client" ? "/tickets" : "/"} className="text-base font-bold text-indigo-700">СКУД•Сервис</Link>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>{user.fullName.split(" ")[0]} · {user.roleName}</span>
            <LogoutButton compact />
          </div>
        </header>
        <main className="flex-1 px-4 py-4 pb-24 sm:px-6 lg:pb-8">{children}</main>
        <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-flow-col auto-cols-fr border-t border-slate-200 bg-white lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <NavLinks items={items.slice(0, 5)} variant="bottom" />
        </nav>
      </div>
    </div>
  );
}
