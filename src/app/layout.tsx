import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { PwaProvider } from "@/components/PwaProvider";

export const metadata: Metadata = {
  title: { default: "СКУД•Сервис", template: "%s · СКУД•Сервис" },
  description: "Система управления заявками и техническим обслуживанием СКУД и видеонаблюдения",
  applicationName: "СКУД•Сервис",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "СКУД•Сервис" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: "/icons/favicon-32.png",
  },
  other: { "mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4338ca" },
    { media: "(prefers-color-scheme: dark)", color: "#312e81" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh bg-slate-100 text-slate-900 antialiased">
        {children}
        <PwaProvider />
      </body>
    </html>
  );
}
