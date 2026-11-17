// Actions marked done, kept per customer so the mark survives a reload and so newer data can check it. An action is
// marked against the data it was read from (`data_as_of`): when newer data still holds the same action, the work is
// not finished, and the page says so; when the action is gone from newer data, the data confirms it.
// No DOM and no storage. Like the other facts, a mark merges: the copy updated later wins. Undo keeps the record with
// active false, so an undo is not brought back by an older copy in a merge.

export const MAX_DONE = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

export function makeDone({ customer, action, title, points = 0, dataAsOf, today }) {
  const name = text(customer, 200), act = text(action, 200), t = text(title, 300);
  if (!name) throw new Error("There is no customer to keep this for.");
  if (!act || !t) throw new Error("Say which action was done.");
  if (!isDate(dataAsOf) || !isDate(today)) throw new Error("A mark needs the date of the data and today's date.");
  const p = Number(points);
  return { id: `${name}|${act}`, customer: name, action: act, title: t, points: Number.isFinite(p) ? Math.round(p * 10) / 10 : 0,
    data_as_of: dataAsOf, done_on: today, updated_on: today, active: true };
}

export function withDone(rec, active, today) {
  if (!isDate(today)) throw new Error("Give today's date.");
  return { ...rec, active: !!active, updated_on: today < rec.updated_on ? rec.updated_on : today, done_on: active ? today : rec.done_on };
}

export function validDone(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  if (typeof d.customer !== "string" || !d.customer || d.customer.length > 200) return false;
  if (typeof d.action !== "string" || !d.action || d.action.length > 200 || typeof d.title !== "string" || !d.title || d.title.length > 300) return false;
  if (typeof d.points !== "number" || !Number.isFinite(d.points) || Math.abs(d.points) > 1000 || typeof d.active !== "boolean") return false;
  if (!isDate(d.data_as_of) || !isDate(d.done_on) || !isDate(d.updated_on) || d.updated_on < d.done_on) return false;
  return d.id === `${d.customer}|${d.action}`;
}

export function acceptDone(list) {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok = list.slice(0, MAX_DONE).filter(validDone);
  return { ok, rejected: list.length - ok.length };
}

export function mergeDone(a, b) {
  const byId = new Map();
  for (const x of [...a, ...b]) {
    const have = byId.get(x.id);
    if (!have || cmp(x.updated_on, have.updated_on) > 0 || (x.updated_on === have.updated_on && cmp(JSON.stringify(x), JSON.stringify(have)) < 0)) byId.set(x.id, x);
  }
  return [...byId.values()].sort((x, y) => cmp(x.customer, y.customer) || cmp(x.action, y.action));
}

/**
 * Read the marks for one customer against the data on screen:
 * - done: marked on this data, so the action is hidden from the list and counted in the estimate;
 * - stillOpen: marked on older data, and the newer data still has the action: the work did not land;
 * - confirmed: marked earlier, and the action is gone from the data.
 */
export function readMarks(records, customer, actions, asOf) {
  const here = new Map((actions || []).map((a) => [a.id, a]));
  const mine = (records || []).filter((r) => r.customer === customer && r.active);
  const done = new Set(), stillOpen = [], confirmed = [];
  for (const r of mine) {
    if (!here.has(r.action)) { if (r.data_as_of < asOf) confirmed.push(r); continue; }
    if (r.data_as_of >= asOf) done.add(r.action);
    else stillOpen.push({ ...r, now: here.get(r.action) });
  }
  return { done, stillOpen, confirmed };
}
