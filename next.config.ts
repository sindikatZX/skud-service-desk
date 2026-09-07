import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/**
 * Адреса, с которых разрешено обращаться к dev-ресурсам Next (HMR и т. п.).
 * Нужно при проверке PWA с телефона: `next dev -H 0.0.0.0`, а на телефоне
 * открыт http://<ip-компьютера>:3000 — для Next это уже сторонний источник.
 *
 * Список собирается из локальных адресов машины, поэтому смена IP роутером
 * ничего не ломает и в репозиторий не попадает чей-то конкретный адрес.
 * Дополнительные хосты можно передать через DEV_ORIGINS (через запятую).
 */
const devOrigins = [
  ...new Set([
    ...Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => Boolean(i) && i!.family === "IPv4" && !i!.internal)
      .map((i) => i.address),
    ...(process.env.DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ]),
];


const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  poweredByHeader: false,
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // Service worker и манифест не должны застревать в HTTP-кэше: иначе обновления PWA доходят с задержкой.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }, { key: "Content-Type", value: "application/manifest+json; charset=utf-8" }] },
      { source: "/icons/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
