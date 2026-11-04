// Snapshots in IndexedDB. Only inputs are stored, never results: results are derived and are recomputed.
// Every write goes through mergeSnapshots, so storing the same snapshot twice, or two devices' copies
// of it, cannot create a duplicate or lose a field.
import { mergeSnapshots } from "./workspace-core.js";
import { seal, openSealed, sealWorkspace } from "./vault.js";

const DB = "beyond90", STORE = "snapshots", META = "meta";
let key = null;                                      // the passphrase key, in memory only
export const setKey = (k) => { key = k; };
export const unlocked = () => key !== null;

/** The workspace text sealed with the vault's key, or null when there is no vault or it is locked. The key never leaves this module. */
export async function sealExport(text) {
  const meta = await getVault();
  return meta && key ? sealWorkspace(key, meta, text) : null;
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      if (!req.result.objectStoreNames.contains(META)) req.result.createObjectStore(META, { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Storage is not available in this browser mode."));
    req.onblocked = () => reject(new Error("Storage is blocked by another tab."));
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error("Storage failed."));
  });
}

/** Storage failures a person can act on, instead of a DOMException name. */
function friendly(e) {
  const name = (e && e.name) || "";
  if (name === "QuotaExceededError" || /quota/i.test((e && e.message) || "")) return new Error("The browser's storage is full. Delete old snapshots below, or export the workspace and clear it.");
  return e instanceof Error ? e : new Error("Storage failed.");
}

async function rawAll() {
  const db = await open();
  const req = db.transaction(STORE).objectStore(STORE).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** A stored record as a snapshot: plain ones as they are, sealed ones opened with the key (null when locked or wrong). */
async function plain(rec) {
  if (!rec.sealed) return rec;
  if (!key) return null;
  try { return await openSealed(key, rec.sealed, rec.id); } catch { return null; }
}

export async function all() {
  const out = [];
  for (const rec of await rawAll()) { const s = await plain(rec); if (s) out.push(s); }
  return mergeSnapshots(out, []);
}

/** How many saved snapshots cannot be read right now because they are sealed and the key is not here. */
export async function lockedCount() {
  let n = 0;
  for (const rec of await rawAll()) if (rec.sealed && !(await plain(rec))) n++;
  return n;
}

const wrap = async (s) => (key ? { id: s.id, sealed: await seal(key, s, s.id) } : s);

export async function getVault() {
  const db = await open();
  const req = db.transaction(META).objectStore(META).get("vault");
  return new Promise((resolve) => { req.onsuccess = () => { db.close(); resolve(req.result ? req.result.meta : null); }; req.onerror = () => { db.close(); resolve(null); }; });
}

/** Seal every plain snapshot with the key (turning protection on) or open every sealed one (turning it off), and record the state. */
export async function convertAll({ toSealed, meta }) {
  const recs = await rawAll();
  const next = [];
  for (const rec of recs) {
    const s = await plain(rec);
    if (!s) throw new Error("Some snapshots could not be opened with this passphrase; nothing was changed.");
    next.push(toSealed ? { id: s.id, sealed: await seal(key, s, s.id) } : s);
  }
  const db = await open();
  const tx = db.transaction([STORE, META], "readwrite");
  for (const r of next) tx.objectStore(STORE).put(r);
  if (toSealed) tx.objectStore(META).put({ k: "vault", meta }); else tx.objectStore(META).delete("vault");
  await done(tx);
  db.close();
}

/** Add snapshots (idempotent). Returns how many were new. */
export async function put(snapshots) {
  if ((await getVault()) && !key) throw new Error("Saved data is protected with a passphrase. Unlock it first.");
  const recs = new Map((await rawAll()).map((r) => [r.id, r]));
  const before = new Set(recs.keys());
  const merged = [];
  for (const s of snapshots) {                       // all the cryptography happens before the write: a transaction does not wait for it
    const old = recs.has(s.id) ? await plain(recs.get(s.id)) : null;
    merged.push(old ? mergeSnapshots([old], [s])[0] : s);
  }
  const wrapped = await Promise.all(merged.map(wrap));
  const db = await open();
  try {
    const tx = db.transaction(STORE, "readwrite");
    for (const w of wrapped) tx.objectStore(STORE).put(w);
    await done(tx);
  } catch (e) {
    throw friendly(e);
  } finally {
    db.close();
  }
  return snapshots.filter((s) => !before.has(s.id)).length;
}

export async function remove(id) {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await done(tx);
  db.close();
}

export async function clear() {
  const db = await open();
  const tx = db.transaction([STORE, META], "readwrite");
  tx.objectStore(STORE).clear();
  tx.objectStore(META).clear();
  await done(tx);
  db.close();
}
