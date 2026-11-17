// Offline support. The whole app is cached under one version name when it is installed. A new version waits
// until the page asks for it ("Update now"), then every open tab reloads at once, so a page from one build never
// asks for a worker or an engine from another.
const CACHE = "__CACHE__";
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  /*__FORCE__*/
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("message", (event) => {
  if (event.data === "activate-now") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("beyond90-") && k !== CACHE).map((k) => caches.delete(k)))));
});

// Files shared to the installed app from another app arrive here as a form. They are put in a local inbox (Cache Storage,
// this origin only), the page opens with ?shared=1, reads them through the same checks as picked files, and empties the
// inbox at once. Nothing is sent anywhere. At most 50 files of at most 20 MB, and only names the page would accept.
const INBOX = "share-inbox";
const SHARE_OK = /\.(csv|toml|xlsx)$/i;
async function receiveShare(req) {
  const inbox = await caches.open(INBOX);
  for (const k of await inbox.keys()) await inbox.delete(k);
  let n = 0;
  try {
    const form = await req.formData();
    for (const f of form.getAll("files")) {
      if (n >= 50 || !(f instanceof File) || f.size > 20 * 1024 * 1024) continue;
      const name = String(f.name || "").split(/[\\/]/).pop().slice(0, 120);
      if (!SHARE_OK.test(name)) continue;
      await inbox.put(new Request(`./share-inbox/${n}`), new Response(f, { headers: { "x-name": encodeURIComponent(name) } }));
      n++;
    }
  } catch { /* a malformed share: open the app with an empty inbox */ }
  return Response.redirect(`./index.html?shared=${n}`, 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method === "POST" && new URL(req.url).origin === location.origin && new URL(req.url).pathname.endsWith("/share-target")) {
    event.respondWith(receiveShare(req));
    return;
  }
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
