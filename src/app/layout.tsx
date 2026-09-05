import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PwaProvider } from "@/components/PwaProvider";
import { getBranding } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

/** Название и иконки берутся из настроек оформления (Администрирование → Оформление). */
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  const v = b.updatedAt ? `?v=${encodeURIComponent(b.updatedAt)}` : "";
  const customIcon = b.logoDataUrl ? [{ url: `/api/v1/branding/logo${v}` }] : [];
  return {
    title: { default: b.appName, template: `%s · ${b.appName}` },
    description: "Система управления заявками и техническим обслуживанием СКУД и видеонаблюдения",
    applicationName: b.appName,
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: b.appName },
    formatDetection: { telephone: false, email: false, address: false },
    icons: {
      icon: [
        ...customIcon,
        { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon.svg", type: "image/svg+xml" },
      ],
      apple: [{ url: b.logoDataUrl ? `/api/v1/branding/logo${v}` : "/icons/apple-touch-icon.png", sizes: "180x180" }],
      shortcut: b.logoDataUrl ? `/api/v1/branding/logo${v}` : "/icons/favicon-32.png",
    },
    other: { "mobile-web-app-capable": "yes" },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return {
    themeColor: b.primaryColor,
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    viewportFit: "cover",
    colorScheme: "light",
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const b = await getBranding();
  return (
    <html lang="ru">
      <head>
        {/* Основной цвет оформления: остальные оттенки вычисляются в globals.css */}
        <style>{`:root{--brand:${b.primaryColor};}`}</style>
      </head>
      <body className="min-h-dvh bg-slate-100 text-slate-900 antialiased">
        {children}
        <PwaProvider />
      </body>
    </html>
  );
}
