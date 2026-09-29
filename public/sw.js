/* ManaResto — Service Worker : app shell + catalogue hors ligne */
const VERSION = "mr-v1";
const SHELL = ["/", "/pos", "/pos/login", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // Flux temps réel et authentification : jamais mis en cache
  if (url.pathname.startsWith("/api/realtime") || url.pathname.startsWith("/api/auth")) return;
  // API GET : réseau d'abord, cache en secours (catalogue, plan de salle, commandes ouvertes)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: { code: "OFFLINE", message: "Hors ligne" } }), { status: 503, headers: { "Content-Type": "application/json" } }))),
    );
    return;
  }
  // Ressources statiques Next : cache d'abord
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; })));
    return;
  }
  // Pages : réseau d'abord, app shell en secours
  event.respondWith(fetch(req).then((res) => { if (res.ok && req.mode === "navigate") caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => caches.match(req).then((r) => r || caches.match("/pos"))));
});
