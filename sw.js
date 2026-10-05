/* Poptani Labs service worker — offline fallback for the installed app.
   Strategy: network-first for same-origin GETs, cache fallback when offline.
   Nothing cross-origin is cached. Bump CACHE when the app shell changes. */
const CACHE = "poptanilabs-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png"]))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((hit) => {
          if (hit) return hit;
          // navigation while offline → fall back to cached homepage
          if (e.request.mode === "navigate") return caches.match("/");
          return Response.error();
        })
      )
  );
});
