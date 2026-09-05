import { getBranding, dataUrlToBuffer } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

/**
 * Логотип как файл (для favicon и манифеста PWA). Без авторизации — как и стандартные
 * иконки в /public. Если свой логотип не задан, отдаём стандартную иконку.
 */
export async function GET(req: Request) {
  const b = await getBranding();
  const parsed = b.logoDataUrl ? dataUrlToBuffer(b.logoDataUrl) : null;
  if (!parsed) {
    const url = new URL("/icons/icon-192.png", req.url);
    return Response.redirect(url, 302);
  }
  return new Response(new Uint8Array(parsed.data), {
    headers: {
      "Content-Type": parsed.mime,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
