// Snapshots in IndexedDB. Only inputs are stored, never results: results are derived and are recomputed.
// Every write goes through mergeSnapshots, so storing the same snapshot twice, or two devices' copies
// of it, cannot create a duplicate or lose a field.
import { mergeSnapshots } from "./workspace-core.js";
import { mergeOutcomes, validOutcome } from "./outcomes.js";
import { mergeCommitments, validCommitment } from "./commitments.js";
import { MAX_EXPORTS, mergeRetention, validRetention, mergeExports, validExport } from "./erasure.js";
import { mergePovs, validPov } from "./pov.js";
import { mergeAsks, validAsk } from "./asks.js";
import { emptyTable, validTable, dropCustomer } from "./aliases.js";
import { seal, openSealed, sealWorkspace } from "./vault.js";

const DB = "beyond90", STORE = "snapshots", META = "meta", OUTCOMES = "outcomes", COMMITMENTS = "commitments";
const RETENTION = "retention", EXPORTS = "exports", ALIASES = "aliases", POVS = "povs", ASKS = "asks";
const FACTS = [OUTCOMES, COMMITMENTS, RETENTION, EXPORTS, POVS, ASKS];   // customer facts: sealed under an opaque slot, never under their own id
const ALL_STORES = [STORE, META, OUTCOMES, COMMITMENTS, RETENTION, EXPORTS, ALIASES, POVS, ASKS];
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
    const req = indexedDB.open(DB, 6);
    req.onupgradeneeded = () => {
      for (const name of ALL_STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: name === META ? "k" : "id" });
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

async function rawAll(name = STORE) {
  const db = await open();
  const req = db.transaction(name).objectStore(name).getAll();
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
  for (const name of [STORE, ...FACTS, ALIASES]) for (const rec of await rawAll(name)) if (rec.sealed && !(await plain(rec))) n++;
  return n;
}

const wrap = async (s) => (key ? { id: s.id, sealed: await seal(key, s, s.id) } : s);

export async function getVault() {
  const db = await open();
  const req = db.transaction(META).objectStore(META).get("vault");
  return new Promise((resolve) => { req.onsuccess = () => { db.close(); resolve(req.result ? req.result.meta : null); }; req.onerror = () => { db.close(); resolve(null); }; });
}

/** Seal every plain record with the key (turning protection on) or open every sealed one (turning it off), and record the state. */
export async function convertAll({ toSealed, meta }) {
  const next = [];
  for (const rec of await rawAll()) {
    const s = await plain(rec);
    if (!s) throw new Error("Some snapshots could not be opened with this passphrase; nothing was changed.");
    next.push(toSealed ? { id: s.id, sealed: await seal(key, s, s.id) } : s);
  }
  const facts = {};
  for (const name of FACTS) {
    facts[name] = [];
    for (const rec of await rawAll(name)) {
      const f = await plain(rec);
      if (!f) throw new Error("Some saved records could not be opened with this passphrase; nothing was changed.");
      facts[name].push(await slot(name, f, toSealed));
    }
  }
  const table = await readAliases();
  if (table === false) throw new Error("The alias table could not be opened with this passphrase; nothing was changed.");
  const tableRec = table ? await wrapTable(table, toSealed) : null;
  const db = await open();
  const tx = db.transaction(ALL_STORES.filter((n) => n !== META), "readwrite");
  for (const r of next) tx.objectStore(STORE).put(r);
  for (const name of FACTS) { tx.objectStore(name).clear(); for (const r of facts[name]) tx.objectStore(name).put(r); }
  tx.objectStore(ALIASES).clear();
  if (tableRec) tx.objectStore(ALIASES).put(tableRec);
  await done(tx);
  const tx2 = db.transaction(META, "readwrite");
  if (toSealed) tx2.objectStore(META).put({ k: "vault", meta }); else tx2.objectStore(META).delete("vault");
  await done(tx2);
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
  const tx = db.transaction(ALL_STORES, "readwrite");
  for (const name of ALL_STORES) tx.objectStore(name).clear();
  await done(tx);
  db.close();
}

// ---- customer facts: outcomes, promises, retention dates and the export log.
// A sealed fact is stored under a random slot, not under its own id (which contains the customer's name), so the
// database alone does not say who has records here. Plain ones (no passphrase) keep their id as the slot.

const newSlot = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/** The stored record for a fact: sealed under a fresh slot, or plain under its own id. */
async function slot(name, fact, sealed) {
  const id = ID_OF[name](fact);
  if (!sealed || !key) return { ...fact, id };
  const s = newSlot();
  return { id: s, sealed: await seal(key, fact, s) };
}

const ID_OF = { [OUTCOMES]: (o) => o.id, [COMMITMENTS]: (c) => c.id, [RETENTION]: (r) => r.customer, [EXPORTS]: (e) => e.id, [POVS]: (p) => p.id, [ASKS]: (a) => a.id };
const VALID = { [OUTCOMES]: validOutcome, [COMMITMENTS]: validCommitment, [RETENTION]: validRetention, [EXPORTS]: validExport, [POVS]: validPov, [ASKS]: validAsk };
const MERGE = { [OUTCOMES]: mergeOutcomes, [COMMITMENTS]: mergeCommitments, [RETENTION]: mergeRetention, [EXPORTS]: mergeExports, [POVS]: mergePovs, [ASKS]: mergeAsks };

/** Every readable fact of a store with the slot it lives in. */
async function openFacts(name) {
  const out = [];
  for (const rec of await rawAll(name)) {
    const f = await plain(rec);
    if (f && VALID[name](f)) out.push({ slot: rec.id, fact: f, sealed: !!rec.sealed });
  }
  return out;
}

// Retention records have no id of their own; a plain one carries its customer as the stored id.
const stripId = (name, f) => { if (name !== RETENTION) return f; const { id, ...rest } = f; return rest; };

async function factsAll(name) {
  return MERGE[name]((await openFacts(name)).map((x) => stripId(name, x.fact)), []);
}

/** Add or update facts (idempotent; the merge rule of each store decides which copy wins). Returns how many were new. */
async function factsPut(name, list) {
  if ((await getVault()) && !key) throw new Error("Saved data is protected with a passphrase. Unlock it first.");
  const have = new Map((await openFacts(name)).map((x) => [ID_OF[name](x.fact), x]));
  const writes = [], gone = [];
  let added = 0;
  for (const f of list) {
    const id = ID_OF[name](f);
    const old = have.get(id);
    if (!old) added++;
    const merged = old ? MERGE[name]([old.fact], [f])[0] : f;
    writes.push(await slot(name, merged, !!key));
    if (old) gone.push(old.slot);
  }
  const db = await open();
  try {
    const tx = db.transaction(name, "readwrite");
    for (const g of gone) tx.objectStore(name).delete(g);
    for (const w of writes) tx.objectStore(name).put(w);
    await done(tx);
  } catch (e) {
    throw friendly(e);
  } finally {
    db.close();
  }
  return added;
}

async function factsRemove(name, id) {
  const hit = (await openFacts(name)).filter((x) => ID_OF[name](x.fact) === id);
  const db = await open();
  const tx = db.transaction(name, "readwrite");
  for (const x of hit) tx.objectStore(name).delete(x.slot);
  await done(tx);
  db.close();
}

/** Move any sealed fact still stored under its own id (made before slots existed) to a random slot. Needs the key. */
export async function reslot() {
  if (!key) return 0;
  let moved = 0;
  for (const name of FACTS) {
    const old = (await openFacts(name)).filter((x) => x.sealed && x.slot === ID_OF[name](x.fact));
    if (!old.length) continue;
    const fresh = [];
    for (const x of old) fresh.push(await slot(name, x.fact, true));
    const db = await open();
    const tx = db.transaction(name, "readwrite");
    for (const x of old) tx.objectStore(name).delete(x.slot);
    for (const r of fresh) tx.objectStore(name).put(r);
    await done(tx);
    db.close();
    moved += old.length;
  }
  return moved;
}

export const outcomesAll = () => factsAll(OUTCOMES);
export const outcomePut = (list) => factsPut(OUTCOMES, list);
export const outcomeRemove = (id) => factsRemove(OUTCOMES, id);
export const commitmentsAll = () => factsAll(COMMITMENTS);
export const commitmentPut = (list) => factsPut(COMMITMENTS, list);
export const commitmentRemove = (id) => factsRemove(COMMITMENTS, id);
export const povsAll = () => factsAll(POVS);
export const povPut = (list) => factsPut(POVS, list);
export const povRemove = (id) => factsRemove(POVS, id);
export const asksAll = () => factsAll(ASKS);
export const askPut = (list) => factsPut(ASKS, list);
export const askRemove = (id) => factsRemove(ASKS, id);
export const retentionAll = () => factsAll(RETENTION);
export const retentionPut = (list) => factsPut(RETENTION, list);
export const retentionRemove = (customer) => factsRemove(RETENTION, customer);
export const exportsAll = () => factsAll(EXPORTS);
/** Log what left the page. The log keeps the newest MAX_EXPORTS entries; older ones are deleted, not just hidden. */
export async function exportsPut(list) {
  const added = await factsPut(EXPORTS, list);
  const rows = (await openFacts(EXPORTS)).sort((a, b) => b.fact.on.localeCompare(a.fact.on) || a.fact.id.localeCompare(b.fact.id));
  if (rows.length > MAX_EXPORTS) {
    const db = await open();
    const tx = db.transaction(EXPORTS, "readwrite");
    for (const r of rows.slice(MAX_EXPORTS)) tx.objectStore(EXPORTS).delete(r.slot);
    await done(tx);
    db.close();
  }
  return added;
}

// ---- the alias table: which real name got which alias. It is the key to the pseudonyms, so it is sealed like any customer fact.

const TABLE_ID = "table";
async function wrapTable(table, sealed) {
  return sealed && key ? { id: TABLE_ID, sealed: await seal(key, table, TABLE_ID) } : { id: TABLE_ID, ...table };
}

/** The saved table, an empty one when there is none, or false when it is sealed and cannot be opened now. */
async function readAliases() {
  const rec = (await rawAll(ALIASES))[0];
  if (!rec) return null;
  const t = await plain(rec);
  if (!t) return false;
  const { id, ...rest } = t;
  return validTable(rest) ? rest : null;
}

export async function aliasTable() {
  const t = await readAliases();
  if (t === false) throw new Error("The alias table is sealed. Unlock the saved data first.");
  return t || emptyTable();
}

export async function saveAliasTable(table) {
  if ((await getVault()) && !key) throw new Error("Saved data is protected with a passphrase. Unlock it first.");
  if (!validTable(table)) throw new Error("The alias table is not valid.");
  const rec = await wrapTable(table, !!key);
  const db = await open();
  const tx = db.transaction(ALIASES, "readwrite");
  tx.objectStore(ALIASES).put(rec);
  await done(tx);
  db.close();
}

// ---- erasing one customer

/** Which customers this browser holds anything for (readable records only), sorted. */
export async function customersHeld() {
  const names = new Set();
  for (const s of await all()) names.add(s.customer);
  for (const o of await outcomesAll()) names.add(o.customer);
  for (const c of await commitmentsAll()) names.add(c.customer);
  for (const r of await retentionAll()) names.add(r.customer);
  for (const p of await povsAll()) names.add(p.customer);
  for (const a of await asksAll()) names.add(a.customer);
  names.delete("");
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Counts of readable records for one customer, and how many sealed records could not be read (so could not be checked). */
export async function countFor(customer) {
  const snaps = (await all()).filter((s) => s.customer === customer).length;
  const [o, c, r, e, pv, ak] = await Promise.all([outcomesAll(), commitmentsAll(), retentionAll(), exportsAll(), povsAll(), asksAll()]);
  const table = await aliasTable();
  return {
    snapshots: snaps,
    outcomes: o.filter((x) => x.customer === customer).length,
    commitments: c.filter((x) => x.customer === customer).length,
    retention: r.filter((x) => x.customer === customer).length,
    exports: e.filter((x) => x.customer === customer).length,
    povs: pv.filter((x) => x.customer === customer).length,
    asks: ak.filter((x) => x.customer === customer).length,
    aliases: table.entries.filter((x) => x.c === customer).length,
  };
}

/**
 * Remove everything this browser holds for one customer: snapshots, outcomes, promises, retention date, export log entries
 * and alias entries. Refuses when the vault is locked (it could not see what to remove). Returns what was removed and what a
 * second look still finds. Other customers' records are not touched.
 */
export async function eraseCustomer(customer) {
  if ((await getVault()) && !key) throw new Error("Unlock the saved data first: sealed records cannot be identified without the passphrase.");
  const before = await countFor(customer);
  const snapIds = (await all()).filter((s) => s.customer === customer).map((s) => s.id);
  const slots = {};
  for (const name of FACTS) slots[name] = (await openFacts(name)).filter((x) => x.fact.customer === customer).map((x) => x.slot);
  const table = await aliasTable();
  const trimmed = dropCustomer(table, customer);
  const tableRec = table.entries.length ? await wrapTable(trimmed, !!key) : null;
  const db = await open();
  try {
    const tx = db.transaction([STORE, ...FACTS, ALIASES], "readwrite");
    for (const id of snapIds) tx.objectStore(STORE).delete(id);
    for (const name of FACTS) for (const sl of slots[name]) tx.objectStore(name).delete(sl);
    if (tableRec) tx.objectStore(ALIASES).put(tableRec);
    await done(tx);
  } finally {
    db.close();
  }
  const after = await countFor(customer);
  const remaining = after.snapshots + after.outcomes + after.commitments + after.retention + after.exports + after.povs + after.asks + after.aliases;
  return { before, remaining, locked: await lockedCount() };
}

/** The health weights the person applied, or null for the defaults. Plain numbers: nothing about a customer. */
export async function getWeights() {
  const db = await open();
  const req = db.transaction(META).objectStore(META).get("weights");
  return new Promise((resolve) => { req.onsuccess = () => { db.close(); resolve(req.result ? req.result.weights : null); }; req.onerror = () => { db.close(); resolve(null); }; });
}
export async function setWeights(weights) {
  const db = await open();
  const tx = db.transaction(META, "readwrite");
  if (weights) tx.objectStore(META).put({ k: "weights", weights }); else tx.objectStore(META).delete("weights");
  await done(tx);
  db.close();
}
