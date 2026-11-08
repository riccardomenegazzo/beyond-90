// What the TAM and the customer have promised each other, kept across customers. No DOM and no storage, so Node can test
// it. Like a snapshot or an outcome, a commitment is a fact that merges: the copy updated later wins, so devices can
// exchange them in any order. "Today" is always passed in; nothing here reads a clock.

export const STATUSES = ["open", "done", "dropped"];
export const SOURCES = ["call", "ours", "manual"];
export const MAX_COMMITMENTS = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONCE = /^[a-z0-9]{6,12}$/;
const SOON_DAYS = 7, RECENT_DAYS = 30;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function randomNonce() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

/**
 * @param {{customer:string, what:string, who?:string, due?:string, source?:string, createdOn:string, nonce?:string}} p
 */
export function makeCommitment({ customer, what, who = "", due = "", source = "manual", createdOn, nonce = "" }) {
  const name = text(customer, 200), thing = text(what, 300);
  if (!name) throw new Error("There is no customer to keep this commitment for.");
  if (!thing) throw new Error("Say what was promised.");
  if (!isDate(createdOn)) throw new Error("A commitment needs the date it was made.");
  if (due && !isDate(due)) throw new Error("Give the due date as a date, or leave it empty.");
  if (!SOURCES.includes(source)) throw new Error("The source must be call, ours or manual.");
  const n = nonce || randomNonce();
  if (!NONCE.test(n)) throw new Error("The identifier suffix must be 6 to 12 lowercase letters or digits.");
  return { id: `${name}|${createdOn}|${n}`, customer: name, what: thing, who: text(who, 100), due, status: "open", source, created_on: createdOn, updated_on: createdOn, closed_on: "" };
}

/** True only for a commitment this page would have written: wrong types or values are refused wherever data comes from outside. */
export function validCommitment(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (typeof c.customer !== "string" || !c.customer || c.customer.length > 200) return false;
  if (typeof c.what !== "string" || !c.what || c.what.length > 300 || typeof c.who !== "string" || c.who.length > 100) return false;
  if (!isDate(c.created_on) || !isDate(c.updated_on) || c.updated_on < c.created_on) return false;
  if (!(c.due === "" || isDate(c.due)) || !STATUSES.includes(c.status) || !SOURCES.includes(c.source)) return false;
  if (c.status === "open" ? c.closed_on !== "" : !isDate(c.closed_on)) return false;
  const m = /^(.*)\|(\d{4}-\d{2}-\d{2})\|([a-z0-9]+)$/.exec(c.id || "");
  return !!m && m[1] === c.customer && m[2] === c.created_on && NONCE.test(m[3]);
}

export function acceptCommitments(list) {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok = list.slice(0, MAX_COMMITMENTS).filter(validCommitment);
  return { ok, rejected: list.length - ok.length };
}

/** Set union by id; when two copies differ, the one updated later wins, then the one that sorts first: the same answer in any order. */
export function mergeCommitments(a, b) {
  const byId = new Map();
  for (const c of [...a, ...b]) {
    const have = byId.get(c.id);
    if (!have || cmp(c.updated_on, have.updated_on) > 0 || (c.updated_on === have.updated_on && cmp(JSON.stringify(c), JSON.stringify(have)) < 0)) byId.set(c.id, c);
  }
  return [...byId.values()].sort((x, y) => cmp(x.customer, y.customer) || cmp(x.created_on, y.created_on) || cmp(x.id, y.id));
}

/** The same commitment with a new status. Reopening clears the closing date. */
export function withStatus(c, status, today) {
  if (!STATUSES.includes(status)) throw new Error("The status must be open, done or dropped.");
  if (!isDate(today) || today < c.created_on) throw new Error("Give today's date.");
  return { ...c, status, updated_on: today, closed_on: status === "open" ? "" : today };
}

/**
 * Commitments from a finished call: what was agreed (with who and by when) and what we owe. One already open with the
 * same words for the same customer is not added twice.
 * @returns {object[]} new commitments only
 */
export function fromCall({ customer, agreed, ours, date, existing = [] }) {
  const have = new Set(existing.filter((c) => c.status === "open" && c.customer === text(customer, 200)).map((c) => c.what.toLowerCase()));
  const out = [];
  const add = (p) => {
    let c;
    try { c = makeCommitment({ customer, createdOn: date, ...p }); } catch { return; }
    if (have.has(c.what.toLowerCase())) return;
    have.add(c.what.toLowerCase());
    out.push(c);
  };
  for (const a of agreed || []) add({ what: a.what, who: a.who, due: isDate(a.when) ? a.when : "", source: "call", nonce: "" });
  for (const o of ours || []) add({ what: o, who: "us", due: "", source: "ours" });
  return out;
}

/** The ledger as of a day: what is late, what is due this week, what is open without a date, what closed lately. */
export function ledger(list, today, { customer = "" } = {}) {
  const mine = customer ? list.filter((c) => c.customer === customer) : list;
  const open = mine.filter((c) => c.status === "open");
  const late = open.filter((c) => c.due && c.due < today).map((c) => ({ ...c, days_overdue: days(c.due, today) }))
    .sort((a, b) => b.days_overdue - a.days_overdue || cmp(a.customer, b.customer) || cmp(a.id, b.id));
  const byDue = (a, b) => cmp(a.due, b.due) || cmp(a.customer, b.customer) || cmp(a.id, b.id);
  const soon = open.filter((c) => c.due && c.due >= today && days(today, c.due) <= SOON_DAYS).sort(byDue);
  const later = open.filter((c) => c.due && days(today, c.due) > SOON_DAYS).sort(byDue);
  const undated = open.filter((c) => !c.due).sort((a, b) => cmp(a.created_on, b.created_on) || cmp(a.id, b.id));
  const recent = mine.filter((c) => c.status !== "open" && c.closed_on && days(c.closed_on, today) >= 0 && days(c.closed_on, today) <= RECENT_DAYS)
    .sort((a, b) => cmp(b.closed_on, a.closed_on) || cmp(a.id, b.id));
  const per = new Map();
  for (const c of open) {
    const r = per.get(c.customer) || { customer: c.customer, open: 0, overdue: 0, oldest_overdue_days: 0 };
    r.open += 1;
    if (c.due && c.due < today) { r.overdue += 1; r.oldest_overdue_days = Math.max(r.oldest_overdue_days, days(c.due, today)); }
    per.set(c.customer, r);
  }
  const customers = [...per.values()].sort((a, b) => b.overdue - a.overdue || b.oldest_overdue_days - a.oldest_overdue_days || cmp(a.customer, b.customer));
  const owed = open.filter((c) => c.source === "ours" || /^us$/i.test(c.who)).length;
  return { late, soon, later, undated, recent, customers, counts: { open: open.length, overdue: late.length, soon: soon.length, we_owe: owed, closed_30d: recent.length } };
}

/** One line per commitment for a spreadsheet; the cell guard is the caller's csv helper. */
export const CSV_COLUMNS = [
  { key: "customer", label: "Customer" }, { key: "what", label: "What" }, { key: "who", label: "Who" }, { key: "due", label: "Due" },
  { key: "status", label: "Status" }, { key: "source", label: "Source" }, { key: "created_on", label: "Made on" }, { key: "closed_on", label: "Closed on" },
];
