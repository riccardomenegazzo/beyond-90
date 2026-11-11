// What customers ask of the product or of us that is not a promise we made: a feature they need, something blocking their
// adoption, an escalation. Kept across customers so the same ask from several of them shows up as one line with what is
// at stake. No DOM and no storage. Like a promise, an ask is a fact that merges: the copy updated later wins.
// "Today" is always passed in.

export const KINDS = ["feature", "blocker", "escalation"];
export const KIND_TEXT = { feature: "Feature request", blocker: "Adoption blocker", escalation: "Escalation" };
export const STATUSES = ["open", "shared", "done", "declined"];
export const MAX_ASKS = 5000;
const OPEN = ["open", "shared"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONCE = /^[a-z0-9]{6,12}$/;
const MAX_STAKE = 1e10;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function randomNonce() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

export function makeAsk({ customer, kind, title, detail = "", atStake = 0, ref = "", createdOn, nonce = "" }) {
  const name = text(customer, 200), t = text(title, 120);
  if (!name) throw new Error("There is no customer to keep this for.");
  if (!KINDS.includes(kind)) throw new Error("The kind must be feature, blocker or escalation.");
  if (!t) throw new Error("Say what is being asked.");
  if (!isDate(createdOn)) throw new Error("An ask needs the date it was raised.");
  const stake = Number(atStake) || 0;
  if (!(stake >= 0 && stake <= MAX_STAKE)) throw new Error("What is at stake must be a number, or empty.");
  const n = nonce || randomNonce();
  if (!NONCE.test(n)) throw new Error("The identifier suffix must be 6 to 12 lowercase letters or digits.");
  return { id: `${name}|${createdOn}|${n}`, customer: name, kind, title: t, detail: text(detail, 500), at_stake: Math.round(stake), ref: text(ref, 60), status: "open", created_on: createdOn, updated_on: createdOn, closed_on: "" };
}

export function validAsk(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  if (typeof a.customer !== "string" || !a.customer || a.customer.length > 200) return false;
  if (!KINDS.includes(a.kind) || !STATUSES.includes(a.status)) return false;
  if (typeof a.title !== "string" || !a.title || a.title.length > 120 || typeof a.detail !== "string" || a.detail.length > 500 || typeof a.ref !== "string" || a.ref.length > 60) return false;
  if (!Number.isInteger(a.at_stake) || a.at_stake < 0 || a.at_stake > MAX_STAKE) return false;
  if (!isDate(a.created_on) || !isDate(a.updated_on) || a.updated_on < a.created_on) return false;
  if (OPEN.includes(a.status) ? a.closed_on !== "" : !isDate(a.closed_on)) return false;
  const m = /^(.*)\|(\d{4}-\d{2}-\d{2})\|([a-z0-9]+)$/.exec(a.id || "");
  return !!m && m[1] === a.customer && m[2] === a.created_on && NONCE.test(m[3]);
}

export function acceptAsks(list) {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok = list.slice(0, MAX_ASKS).filter(validAsk);
  return { ok, rejected: list.length - ok.length };
}

export function mergeAsks(a, b) {
  const byId = new Map();
  for (const x of [...a, ...b]) {
    const have = byId.get(x.id);
    if (!have || cmp(x.updated_on, have.updated_on) > 0 || (x.updated_on === have.updated_on && cmp(JSON.stringify(x), JSON.stringify(have)) < 0)) byId.set(x.id, x);
  }
  return [...byId.values()].sort((x, y) => cmp(x.customer, y.customer) || cmp(x.created_on, y.created_on) || cmp(x.id, y.id));
}

export function withAskStatus(a, status, today) {
  if (!STATUSES.includes(status)) throw new Error("The status must be open, shared, done or declined.");
  if (!isDate(today) || today < a.created_on) throw new Error("Give today's date.");
  return { ...a, status, updated_on: today, closed_on: OPEN.includes(status) ? "" : today };
}

const key = (t) => t.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The asks still in play, grouped by what is being asked (the same words, ignoring case and punctuation), so an ask
 * raised by three customers is one line with three names. At stake is each customer's own figure counted once.
 * Escalations are listed apart, oldest first.
 */
export function digest(list, today) {
  const live = list.filter((a) => OPEN.includes(a.status));
  const groups = new Map();
  for (const a of live) {
    if (a.kind === "escalation") continue;
    const k = key(a.title);
    const g = groups.get(k) || { title: a.title, kinds: {}, byCustomer: new Map(), shared: 0 };
    g.kinds[a.kind] = (g.kinds[a.kind] || 0) + 1;
    g.byCustomer.set(a.customer, Math.max(g.byCustomer.get(a.customer) || 0, a.at_stake));
    if (a.status === "shared") g.shared += 1;
    groups.set(k, g);
  }
  const themes = [...groups.values()].map((g) => ({
    title: g.title,
    kind: Object.entries(g.kinds).sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))[0][0],
    customers: [...g.byCustomer.keys()].sort(cmp),
    at_stake: [...g.byCustomer.values()].reduce((s, v) => s + v, 0),
    shared: g.shared,
  })).sort((x, y) => y.customers.length - x.customers.length || y.at_stake - x.at_stake || cmp(x.title, y.title));
  const escalations = live.filter((a) => a.kind === "escalation").map((a) => ({ ...a, age_days: days(a.created_on, today) }))
    .sort((x, y) => y.age_days - x.age_days || cmp(x.id, y.id));
  return { themes, escalations, counts: { open: live.length, themes: themes.length, escalations: escalations.length, customers: new Set(live.map((a) => a.customer)).size } };
}

const money = (n) => (n ? n.toLocaleString("en-US") : "not given");

/** A text for the product team: what customers keep asking for, who, and what is in play. Nothing is sent by this page. */
export function digestMarkdown(d, today) {
  const lines = [`# What customers are asking for (${today})`, ""];
  if (!d.themes.length && !d.escalations.length) return lines.concat("Nothing is open.", "").join("\n");
  if (d.themes.length) {
    lines.push("## Requests and blockers, by how many customers ask", "");
    for (const t of d.themes) lines.push(`- **${t.title}** (${KIND_TEXT[t.kind].toLowerCase()}): ${t.customers.length} customer${t.customers.length === 1 ? "" : "s"} (${t.customers.join(", ")}); at stake, as each customer's own figure: ${money(t.at_stake)}${t.shared ? `; ${t.shared} already passed on` : ""}`);
    lines.push("");
  }
  if (d.escalations.length) {
    lines.push("## Escalations, oldest first", "");
    for (const e of d.escalations) lines.push(`- ${e.customer}: ${e.title}, ${e.age_days} day${e.age_days === 1 ? "" : "s"} open${e.ref ? ` (${e.ref})` : ""}${e.detail ? ` - ${e.detail}` : ""}`);
    lines.push("");
  }
  lines.push("At stake is the figure the account manager typed for each ask, not something the page measured.", "");
  return lines.join("\n");
}

export const CSV_COLUMNS = [
  { key: "customer", label: "Customer" }, { key: "kind", label: "Kind" }, { key: "title", label: "Ask" }, { key: "detail", label: "Detail" },
  { key: "at_stake", label: "At stake" }, { key: "ref", label: "Reference" }, { key: "status", label: "Status" }, { key: "created_on", label: "Raised on" }, { key: "closed_on", label: "Closed on" },
];
