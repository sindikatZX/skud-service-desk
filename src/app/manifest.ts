import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

/** Манифест PWA собирается из настроек оформления: название и цвет темы задаёт администратор. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBranding();
  const v = b.updatedAt ? `?v=${encodeURIComponent(b.updatedAt)}` : "";
  const customIcons: MetadataRoute.Manifest["icons"] = b.logoDataUrl
    ? [{ src: `/api/v1/branding/logo${v}`, sizes: "any", purpose: "any" }]
    : [];
  return {
    id: "/",
    name: `${b.appName} — заявки и обслуживание`,
    short_name: b.appName,
    description: "Управление заявками, бригадами и складом для компании по СКУД и видеонаблюдению",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#f1f5f9",
    theme_color: b.primaryColor,
    lang: "ru",
    dir: "ltr",
    categories: ["business", "productivity", "utilities"],
    prefer_related_applications: false,
    icons: [
      ...customIcons,
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Новая заявка", short_name: "Заявка", description: "Создать новую заявку", url: "/tickets/new?source=shortcut", icons: [{ src: "/icons/shortcut-new.png", sizes: "96x96", type: "image/png" }] },
      { name: "Заявки", short_name: "Заявки", description: "Список открытых заявок", url: "/tickets?status=new,assigned,scheduled,in_progress,on_hold&source=shortcut", icons: [{ src: "/icons/shortcut-list.png", sizes: "96x96", type: "image/png" }] },
      { name: "Моя бригада", short_name: "Бригада", description: "Заявки и остатки моей бригады", url: "/my-team?source=shortcut", icons: [{ src: "/icons/shortcut-team.png", sizes: "96x96", type: "image/png" }] },
    ],
  };
}
