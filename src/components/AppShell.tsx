import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/auth";
import { can, canAnyWithRole } from "@/lib/rbac";
import type { IconName } from "@/components/icons";
import { Icon } from "@/components/icons";
import { NavLinks, BottomNav, MobileHeader, LogoutButton } from "@/components/NavClient";
import { BrandLogo } from "@/components/BrandLogo";
import type { Branding } from "@/lib/services/branding";

export type NavItem = { href: string; label: string; icon: IconName; short?: string };

export function navFor(user: SessionUser): NavItem[] {
  const items: NavItem[] = [];
  const isClient = user.scope === "client";
  const isField = user.scope === "team";
  if (!isClient) items.push({ href: "/", label: "Главная", icon: "home" });
  items.push({ href: "/tickets", label: "Заявки", icon: "tickets" });
  if (isField) items.push({ href: "/my-team", label: "Моя бригада", icon: "team", short: "Бригада" });
  if (can(user, "clients.read") && !isField) items.push({ href: "/clients", label: "Клиенты", icon: "clients" });
  if (can(user, "teams.read") && !isField) items.push({ href: "/teams", label: "Бригады", icon: "truck" });
  if (can(user, "inventory.read.all")) items.push({ href: "/inventory", label: "Склад", icon: "warehouse" });
  if (can(user, "catalog.read") && !isField) items.push({ href: "/catalog", label: "Товары", icon: "catalog", short: "Товары" });
  if (can(user, "users.manage")) items.push({ href: "/employees", label: "Сотрудники", icon: "users", short: "Люди" });
  if (can(user, "directories.manage")) items.push({ href: "/directories", label: "Справочники", icon: "settings", short: "Настройки" });
  if (canAnyWithRole(user, ["reports.view", "reports.inventory", "reports.stock", "reports.movements", "reports.works"])) items.push({ href: "/reports", label: "Отчёты", icon: "chart" });
  if (canAnyWithRole(user, ["admin.backup", "admin.maintenance"])) items.push({ href: "/admin", label: "Администрирование", icon: "shield", short: "Админ" });
  items.push({ href: "/profile", label: "Моя учётная запись", icon: "user", short: "Профиль" });
  return items;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
}

export function AppShell({ user, branding, children }: { user: SessionUser; branding: Branding; children: ReactNode }) {
  const items = navFor(user);
  const homeHref = user.scope === "client" ? "/tickets" : "/";
  const profile = { fullName: user.fullName, roleName: user.roleName, email: user.email, initials: initials(user.fullName) };

  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900 lg:flex">
      {/* ── Десктопная боковая панель ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <BrandLogo src={branding.logoDataUrl} size={36} className="shrink-0 rounded-xl" />
          <div className="min-w-0">
            <div className="truncate text-base font-bold leading-tight tracking-tight text-indigo-700">{branding.appName}</div>
            {branding.tagline && <div className="truncate text-[11px] text-slate-500">{branding.tagline}</div>}
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          <NavLinks items={items} variant="side" />
        </nav>
        <div className="border-t border-slate-200 p-4 text-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{profile.initials}</div>
            <div className="min-w-0">
              <Link href="/profile" className="block truncate font-medium hover:text-indigo-700">{user.fullName}</Link>
              <div className="truncate text-xs text-slate-500">{user.roleName}</div>
            </div>
          </div>
          <LogoutButton className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600">
            <Icon name="logout" size={14} /> Выйти
          </LogoutButton>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-1 flex-col">
        {/* ── Мобильная шапка ── */}
        <MobileHeader homeHref={homeHref} profile={profile} appName={branding.appName} logo={branding.logoDataUrl} />

        <main className="flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-4 sm:px-6 lg:pb-8">{children}</main>

        {/* ── Нижняя навигация (мобильная) ── */}
        <BottomNav items={items} profile={profile} />
      </div>
    </div>
  );
}
