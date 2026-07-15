const VERSION = "pflichtarten-v6";
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const PHOTO_CACHE = `${VERSION}-photos`;
const BASE = new URL("./", self.location);
const shellFiles = [
  "./",
  "./index.html",
  "./styles.css?v=10",
  "./species.js?v=3",
  "./taxonomy.js?v=1",
  "./features.js?v=1",
  "./features-extra.js?v=1",
  "./app.js?v=10",
  "./manifest.webmanifest?v=1",
  "./icons/icon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
].map(path => new URL(path, BASE).href);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(shellFiles)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("pflichtarten-") && !key.startsWith(VERSION)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function put(cacheName, request, response) {
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map(key => cache.delete(key)));
}

async function networkFirst(request, cacheName, fallback) {
  try { return await put(cacheName, request, await fetch(request)); }
  catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) {
      const fallbackResponse = await caches.match(fallback);
      if (fallbackResponse) return fallbackResponse;
    }
    throw new Error("Offline and not cached");
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await put(cacheName, request, await fetch(request));
  await trim(cacheName, maxEntries);
  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, new URL("./index.html", BASE).href));
    return;
  }

  if (request.destination === "image" || request.destination === "font") {
    event.respondWith(cacheFirst(request, PHOTO_CACHE, 140));
    return;
  }

  if (url.origin !== self.location.origin || url.pathname.includes("/v1/") || url.pathname.includes("/w/api.php")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || put(SHELL_CACHE, request, fetch(request))));
});
