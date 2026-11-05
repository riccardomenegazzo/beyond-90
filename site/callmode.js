// The call itself: what was covered, what was agreed, what we owe, turned into the three things that follow a call.
// No DOM, so Node can test it.
//
// Notes taken during the call are the TAM's own and never leave this module's output: the recap lists only the agenda
// items marked as covered and what was agreed, and the log line says the same.
import { recap } from "./recap.js";
import { toCsv } from "./ui.js";

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") && !Number.isNaN(Date.parse(v));
const MAX_AGREED = 12;

/** The blank state of a call: the agenda as prepared, nothing covered, nothing agreed, what we owe copied from the prep. */
export function newCall(prep) {
  return {
    items: prep.items.filter((it) => it.id !== "close").map((it) => ({ id: it.id, title: it.title, points: it.points || [], covered: false, note: "" })),
    agreed: [],
    ours: prep.items.filter((it) => it.id === "owed").flatMap((it) => it.points || []).map(clean).filter(Boolean),
  };
}

/**
 * @param {{customer:string, date:string, contact?:string, sender?:string, call:{items:object[], agreed:{what:string, who?:string, when?:string}[], ours:string[]}}} p
 * @returns {{recap:{subject:string, body:string}, csv:string, touch:{summary:string, next_step:string, next_due:string}, covered:string[], agreed:object[]}}
 */
export function callOutput({ customer, date, contact = "", sender = "", call }) {
  const covered = call.items.filter((i) => i.covered).map((i) => clean(i.title));
  const agreed = call.agreed.map((a) => ({ what: clean(a.what), who: clean(a.who), when: isDate(a.when) ? a.when : "" })).filter((a) => a.what).slice(0, MAX_AGREED);
  const ours = (call.ours || []).map(clean).filter(Boolean);
  const words = (a) => `${a.what}${a.who ? ` (${a.who}${a.when ? `, by ${a.when}` : ""})` : a.when ? ` (by ${a.when})` : ""}`;
  const summary = clean(`${covered.length ? `Covered: ${covered.join("; ")}.` : ""} ${agreed.length ? `Agreed: ${agreed.map(words).join("; ")}.` : ""}`).slice(0, 300);
  const first = agreed[0];
  const rows = [
    ...agreed.map((a) => ({ action: a.what, owner: a.who || "to agree", due: a.when, source: "agreed on the call" })),
    ...ours.map((o) => ({ action: o, owner: "us", due: "", source: "we owe" })),
  ];
  return {
    recap: recap({ customer, contact, date, covered, agreed, ours, sender }),
    csv: toCsv([{ key: "action", label: "Action" }, { key: "owner", label: "Owner" }, { key: "due", label: "Due date" }, { key: "customer", label: "Customer" }, { key: "date", label: "Call date" }, { key: "source", label: "Source" }],
      rows.map((r) => ({ ...r, customer, date }))),
    touch: { summary, next_step: first ? clean(first.what).slice(0, 200) : "", next_due: first ? first.when : "" },
    covered, agreed,
  };
}
