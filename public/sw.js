/**
 * Service Worker СКУД•Сервис.
 *
 * Стратегии:
 *  - /_next/static, /icons, шрифты      → cache-first (в production пути содержат хеш
 *    сборки и неизменны; в dev воркер не регистрируется — см. PwaProvider)
 *  - навигация (HTML)                    → network-first с таймаутом, fallback: кэш → /offline
 *  - GET /api/v1/*                        → network-first, последний успешный ответ хранится для офлайн-просмотра
 *  - POST/PATCH/DELETE                    → всегда сеть; при офлайне — понятная JSON-ошибка
 *
 * Версия кэша меняется при каждом релизе: старые кэши удаляются в activate.
 */
const VERSION = "fsm-v3";
const CACHE_SHELL = `${VERSION}-shell`;
const CACHE_STATIC = `${VERSION}-static`;
const CACHE_PAGES = `${VERSION}-pages`;
const CACHE_API = `${VERSION}-api`;
const ALL_CACHES = [CACHE_SHELL, CACHE_STATIC, CACHE_PAGES, CACHE_API];

const SHELL_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

const NAV_TIMEOUT_MS = 6000;
const API_TIMEOUT_MS = 10000;
/** Максимум записей в кэше страниц/API, чтобы не раздувать хранилище. */
const MAX_PAGE_ENTRIES = 60;
const MAX_API_ENTRIES = 120;

/** Пути API, которые не имеет смысла кэшировать (короткоживущие данные / опрос). */
const NO_CACHE_API = [/\/api\/v1\/tickets\/\d+\/chat\?afterId=/, /\/api\/health/, /\/api\/v1\/auth\//];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch { /* не критично */ }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "CLEAR_DATA_CACHE") {
    event.waitUntil(Promise.all([caches.delete(CACHE_API), caches.delete(CACHE_PAGES)]));
  }
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

async function putIfOk(cacheName, request, response, max) {
  if (!response || !response.ok || response.type === "opaque") return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (max) trimCache(cacheName, max);
}

function offlineJson() {
  return new Response(JSON.stringify({ ok: false, error: { code: "OFFLINE", message: "Нет подключения к сети. Повторите, когда появится связь." } }), {
    status: 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-SW-Offline": "1" },
  });
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putIfOk(CACHE_STATIC, request, response);
  return response;
}

async function handleNavigation(event) {
  const request = event.request;
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const response = preload || (await withTimeout(fetch(request), NAV_TIMEOUT_MS));
    // Редиректы (например, на /login) не кэшируем: они зависят от сессии.
    if (response.ok && !response.redirected) await putIfOk(CACHE_PAGES, request, response, MAX_PAGE_ENTRIES);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match("/offline");
    return offline || new Response("<h1>Нет сети</h1>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function handleApiGet(request) {
  const url = request.url;
  const skipCache = NO_CACHE_API.some((re) => re.test(url));
  try {
    const response = await withTimeout(fetch(request), API_TIMEOUT_MS);
    if (!skipCache) await putIfOk(CACHE_API, request, response, MAX_API_ENTRIES);
    return response;
  } catch {
    if (!skipCache) {
      const cached = await caches.match(request);
      if (cached) {
        // Помечаем, что данные из кэша — UI может показать бейдж «офлайн-копия».
        const headers = new Headers(cached.headers);
        headers.set("X-SW-Cache", "1");
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
      }
    }
    return offlineJson();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET") {
    // Мутации: только сеть, но с понятной ошибкой офлайн вместо TypeError.
    if (url.pathname.startsWith("/api/")) {
      event.respondWith(fetch(request).catch(() => offlineJson()));
    }
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(woff2?|ttf|otf)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApiGet(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  // RSC-подзапросы Next (заголовок RSC) и прочие GET того же origin — network-first без кэша.
});

/* ─── Push-уведомления (заготовка под Web Push из roadmap) ─── */
self.addEventListener("push", (event) => {
  let payload = { title: "СКУД•Сервис", body: "Новое событие по заявке", url: "/tickets" };
  try { payload = { ...payload, ...(event.data ? event.data.json() : {}) }; } catch { /* текстовый payload */ }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
      tag: payload.tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) { client.navigate(target); return client.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
