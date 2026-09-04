import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.46', '192.168.1.46:3000'],
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
