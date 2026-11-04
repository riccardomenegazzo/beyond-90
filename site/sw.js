// Offline support. The whole app is cached under one version name when it is installed, and a new version
// waits until every tab using the old one is closed, so a page from one build never asks for a worker or an
// engine from another.
const CACHE = "__CACHE__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("beyond90-") && k !== CACHE).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.endsWith("/feed/advisories.json")) {
    // The news is rebuilt every day: ask the network first, and fall back to the copy installed with the app.
    event.respondWith(fetch(req, { cache: "no-store" }).catch(async () => (await (await caches.open(CACHE)).match(req, { ignoreSearch: true })) || Response.error()));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); }
    catch (e) {
      if (req.mode === "navigate") { const home = await cache.match("./index.html"); if (home) return home; }
      throw e;
    }
  })());
});
