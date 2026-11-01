// Offline support. The whole app is cached under one version name when it is installed, and a new version
// waits until every tab using the old one is closed. That avoids the case the book warns about: old and
// new code running together, a page from one build asking for a worker or an engine from another.
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
