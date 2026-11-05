// What happened to each customer at renewal, kept next to the health reading taken before it. No DOM and no storage,
// so Node can test it. Like a snapshot, an outcome is a fact: the same (customer, date) is one outcome, and two copies
// of it merge to one, so devices can exchange them in any order.

export const OUTCOMES = ["renewed", "expanded", "reduced", "churned"];
export const PARTS = ["adoption", "outcomes", "relationship", "trajectory"];
export const MAX_OUTCOMES = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isPct = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * The outcome to record, from the health reading on screen.
 * @param {{customer:string, decidedOn:string, outcome:string, note?:string, health:object, asOf:string, recordedOn?:string}} p
 */
export function makeOutcome({ customer, decidedOn, outcome, note = "", health, asOf, recordedOn = "" }) {
  const name = text(customer, 200);
  if (!name) throw new Error("There is no customer to record an outcome for.");
  if (!isDate(decidedOn)) throw new Error("Give the date the customer decided, as a date.");
  if (!OUTCOMES.includes(outcome)) throw new Error("Choose what happened: renewed, expanded, reduced or churned.");
  if (!health || health.score == null) throw new Error("This reading has no measured part, so there is nothing to compare with the outcome.");
  const components = {};
  for (const k of PARTS) {
    const c = (health.components || []).find((x) => x.id === k);
    components[k] = c && isPct(c.value) ? c.value : null;
  }
  return {
    id: `${name}|${decidedOn}`, customer: name, decided_on: decidedOn, outcome, note: text(note, 300), recorded_on: isDate(recordedOn) ? recordedOn : "",
    reading: { as_of: isDate(asOf) ? asOf : "", score: isPct(health.score) ? health.score : null, band: text(health.band, 20), components },
  };
}

/** True only for an outcome this page would have written: wrong types or values are refused wherever data comes from outside. */
export function validOutcome(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (typeof o.customer !== "string" || !o.customer || o.customer.length > 200 || !isDate(o.decided_on) || o.id !== `${o.customer}|${o.decided_on}`) return false;
  if (!OUTCOMES.includes(o.outcome) || typeof o.note !== "string" || o.note.length > 300 || typeof o.recorded_on !== "string") return false;
  const r = o.reading;
  if (!r || typeof r !== "object" || typeof r.as_of !== "string" || typeof r.band !== "string" || !(r.score === null || isPct(r.score))) return false;
  return !!r.components && typeof r.components === "object" && PARTS.every((k) => r.components[k] === null || isPct(r.components[k]));
}

export function acceptOutcomes(list) {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok = list.slice(0, MAX_OUTCOMES).filter(validOutcome);
  return { ok, rejected: list.length - ok.length };
}

/** Set union by id; when two copies differ, the one recorded later wins, then the one that sorts first: the same answer in any order. */
export function mergeOutcomes(a, b) {
  const byId = new Map();
  for (const o of [...a, ...b]) {
    const have = byId.get(o.id);
    if (!have || cmp(o.recorded_on, have.recorded_on) > 0 || (o.recorded_on === have.recorded_on && cmp(JSON.stringify(o), JSON.stringify(have)) < 0)) byId.set(o.id, o);
  }
  return [...byId.values()].sort((x, y) => cmp(x.customer, y.customer) || cmp(x.decided_on, y.decided_on));
}
