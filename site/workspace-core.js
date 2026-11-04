// The browser app's data model, with no DOM and no storage so it can be tested under Node.
//
// Principles (Kleppmann and Riccomini, Designing Data-Intensive Applications, 2nd ed., early release):
//  - the customer's files are the system of record; scores, plans and reports are derived and are never stored
//  - a snapshot is an immutable fact, named by the hash of its content, so saving twice is a no-op
//  - a workspace file is read by old and new versions of this page: unknown fields are kept, newer major versions are refused
//  - two workspaces merge by set union of snapshots, which is commutative, associative and idempotent,
//    so devices can exchange files in any order and agree without a server
//
// The fingerprint algorithm is the same as src/beyond90/provenance.py; test/ checks both give one answer.

const INPUT_FILES = [
  "customer.toml", "accounts.csv", "inventory.csv", "activations.csv", "findings.csv",
  "teams.csv", "entitlements.csv", "contacts.csv", "commitments.csv", "interactions.csv", "connectors.csv",
];
const PERSONAL_FILES = ["contacts.csv", "commitments.csv", "interactions.csv"];
export const WORKSPACE_FORMAT = "beyond90-workspace";
const WORKSPACE_VERSION = 1;
export const MAX_SNAPSHOTS = 1000;        // a workspace is a person's working set, not a database; a file past this is refused, not half read

const enc = new TextEncoder();

function normalizeText(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function baseName(name) {
  return String(name).split(/[\\/]/).pop();
}

/** Keep only the files that are inputs, by base name. Anything else must not change an identity. */
function inputsOnly(files) {
  const out = {};
  for (const [name, text] of Object.entries(files)) {
    const base = baseName(name);
    if (INPUT_FILES.includes(base)) out[base] = text;
  }
  return out;
}

export async function fingerprint(files) {
  const only = inputsOnly(files);
  const names = Object.keys(only).sort();
  let body = "";
  for (const n of names) body += `${n}\t${await sha256Hex(normalizeText(only[n]))}\n`;
  return sha256Hex(body);
}

/** Read the customer's name and date without parsing TOML. Used only to find related snapshots. */
export function peekCustomer(files) {
  const t = files["customer.toml"] || "";
  const name = /^\s*name\s*=\s*"([^"\n]*)"/m.exec(t);
  const asOf = /^\s*as_of\s*=\s*"?(\d{4}-\d{2}-\d{2})/m.exec(t);
  return { customer: name ? name[1] : "", asOf: asOf ? asOf[1] : "" };
}

export async function makeSnapshot(files, { customer, asOf, includePersonal = false, savedOn = "" }) {
  let kept = inputsOnly(files);
  const excluded = !includePersonal && PERSONAL_FILES.some((n) => n in kept);
  if (!includePersonal) for (const n of PERSONAL_FILES) delete kept[n];
  return { id: await fingerprint(kept), customer, as_of: asOf, personal_excluded: excluded, saved_on: savedOn, files: kept };
}

/** A snapshot is trusted only if its name matches its content; checked wherever data enters from outside. */
async function verifySnapshot(s) {
  try {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !s.files || typeof s.files !== "object" || Array.isArray(s.files)) return false;
    if (!Object.values(s.files).every((t) => typeof t === "string")) return false;
    for (const k of ["customer", "as_of"]) if (typeof s[k] !== "string") return false;   // they are sorted and compared as text
    return (await fingerprint(s.files)) === s.id;
  } catch { return false; }
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stable = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => cmp(a, b))) : x));

function mergeOne(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === "__proto__") continue;                    // a key that would change the object's type, not add a field
    if (!Object.hasOwn(out, k)) out[k] = v;
    else if (k === "saved_on") out[k] = [out[k], v].filter(Boolean).sort()[0] || "";   // keep the earliest, and an empty value never wins
    else if (stable(out[k]) !== stable(v)) out[k] = cmp(stable(out[k]), stable(v)) <= 0 ? out[k] : v;   // a deterministic pick, whatever the order
  }
  return out;
}

/** Set union by id. Commutative, associative and idempotent, so the order of imports never matters. */
export function mergeSnapshots(a, b) {
  const byId = new Map();
  for (const s of [...a, ...b]) byId.set(s.id, byId.has(s.id) ? mergeOne(byId.get(s.id), s) : s);
  return [...byId.values()].sort((x, y) => cmp(x.customer, y.customer) || cmp(x.as_of, y.as_of) || cmp(x.id, y.id));
}

export function serializeWorkspace(snapshots, { engine = "", extra = {} } = {}) {
  return JSON.stringify({ ...extra, format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, exported_with: engine, snapshots: mergeSnapshots(snapshots, []) }, null, 1) + "\n";
}

/** Parse a workspace file. Throws a message a person can act on; returns the snapshots and any unknown top-level fields. */
export function parseWorkspace(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error("This is not a JSON file."); }
  if (!doc || doc.format !== WORKSPACE_FORMAT) throw new Error("This is not a Beyond 90 workspace file.");
  if (!Number.isInteger(doc.version) || doc.version < 1) throw new Error("The workspace file has no valid version.");
  if (doc.version > WORKSPACE_VERSION) throw new Error(`This workspace was written by a newer version of Beyond 90 (format ${doc.version}); this page reads format ${WORKSPACE_VERSION}. Open the newer page to read it.`);
  if (!Array.isArray(doc.snapshots)) throw new Error("The workspace file has no snapshots list.");
  if (doc.snapshots.length > MAX_SNAPSHOTS) throw new Error(`The workspace file holds ${doc.snapshots.length} snapshots; this page reads at most ${MAX_SNAPSHOTS}. Split it by customer.`);
  const { format, version, exported_with, snapshots, ...unknown } = doc;    
  return { snapshots, unknown };
}

/** Keep the snapshots whose content matches their name; report the rest instead of silently trusting them. */
export async function acceptSnapshots(list) {
  const ok = [], rejected = [];
  for (const s of list) ((await verifySnapshot(s)) ? ok : rejected).push(s);
  return { ok, rejected: rejected.length };
}

/** Snapshots of one customer older than a date, newest first. The default thing to compare with. */
export function previousOf(snapshots, customer, asOf, excludeId = "") {
  return snapshots.filter((s) => s.customer === customer && s.as_of < asOf && s.id !== excludeId).sort((a, b) => cmp(b.as_of, a.as_of) || cmp(a.id, b.id));
}
