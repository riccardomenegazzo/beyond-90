// Snapshots in IndexedDB. Only inputs are stored, never results: results are derived and are recomputed.
// Every write goes through mergeSnapshots, so storing the same snapshot twice, or two devices' copies
// of it, cannot create a duplicate or lose a field.
import { mergeSnapshots } from "./workspace-core.js";

const DB = "beyond90", STORE = "snapshots";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
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

export async function all() {
  const db = await open();
  const req = db.transaction(STORE).objectStore(STORE).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(mergeSnapshots(req.result, [])); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Add snapshots (idempotent). Returns how many were new. */
export async function put(snapshots) {
  const before = new Set((await all()).map((s) => s.id));
  const db = await open();
  const tx = db.transaction(STORE, "readwrite"), os = tx.objectStore(STORE);
  const existing = new Map();
  await Promise.all(snapshots.map((s) => new Promise((resolve) => {
    const r = os.get(s.id);
    r.onsuccess = () => { if (r.result) existing.set(s.id, r.result); resolve(); };
    r.onerror = () => resolve();
  })));
  for (const s of snapshots) os.put(existing.has(s.id) ? mergeSnapshots([existing.get(s.id)], [s])[0] : s);
  await done(tx);
  db.close();
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
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await done(tx);
  db.close();
}
