/* ManaResto — Service Worker (PWA) : app shell, catalogue et commandes hors ligne */
const VERSION = "mr-v2";
const PRECACHE = ["/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];
const ORDER_SHELL = "/pos/order/__shell__"; // clé de cache d'un écran de commande (client-side, l'id est lu dans l'URL)

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const offlineJson = () => new Response(JSON.stringify({ error: { code: "OFFLINE", message: "Hors ligne" } }), { status: 503, headers: { "Content-Type": "application/json" } });

async function networkFirst(req, cacheKey) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) cache.put(cacheKey ?? req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(cacheKey ?? req);
    if (hit) return hit;
    throw new Error("offline");
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Flux temps réel : jamais mis en cache. Auth : seul /api/auth/me (profil, permissions) est conservé.
  if (url.pathname.startsWith("/api/realtime")) return;
  if (url.pathname.startsWith("/api/auth") && url.pathname !== "/api/auth/me") return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req).catch(offlineJson));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(req).catch(() => new Response("", { status: 504 })));
    return;
  }
  if (req.mode === "navigate") {
    const isOrder = url.pathname.startsWith("/pos/order/");
    event.respondWith(
      networkFirst(req, isOrder ? ORDER_SHELL : undefined).catch(async () => {
        const cache = await caches.open(VERSION);
        return (await cache.match(isOrder ? ORDER_SHELL : req)) || (await cache.match("/pos")) || (await cache.match("/pos/login")) ||
          new Response("<!doctype html><meta charset=utf-8><title>ManaResto</title><body style=\"font-family:sans-serif;padding:2rem\"><h1>Hors ligne</h1><p>Cette page n'est pas encore disponible hors connexion. Ouvrez la caisse une première fois en ligne.</p>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }),
    );
    return;
  }
  // Chargements de route Next (RSC) : réseau seul ; en échec, Next recharge la page (servie ci-dessus)
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
