/**
 * The next meeting, from what the last one left open: the questions nobody could answer, the concerns still to prove,
 * the conditions due soon, and who to bring. An agenda to copy into an invitation, or a calendar file that carries it.
 */
import { assess, journey, datedPlan, stories, WHO, ROLE_WORDS, displayOrder } from "./workshop.js";
import { calendar } from "./ics.js";
import { cardsFor, demoFollowUps } from "./demo.js";

// what each line's first sketch is worked out from, in the customer's terms, and where the workshop keeps it
const SKETCH_NEEDS = {
  euc: ["vdi", "Virtual desktops", "how many users, how many connect at once, and the kinds of worker"],
  "kubernetes-platform": ["k8s", "The container platform", "how many applications, their pods, and what each pod asks for"],
  dbaas: ["db", "Database licences", "how many databases are licensed per core, how busy they are at the busiest hour, and the cores licensed today"],
  "file-storage": ["files", "File shares", "how much file data, how fast it grows, and how much nobody opens any more"],
  "object-storage": ["obj", "Backup capacity", "how much data is protected, how much changes a day, and how long copies are kept"],
  "dr-backup": ["dr", "Recovery", "how much data to protect, the distance between the sites, and the recovery point each tier needs"],
  "private-ai": ["gpu", "GPUs", "the model and its precision, the context of a request, and how many requests at once"],
  "edge-sites": ["edge", "The sites", "how many sites of each kind, what runs at each, and their links"],
};

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/** The agenda: what to settle, what to show, what is due, and who should be there. At most five of each. */
export function nextMeeting(catalog, w, today) {
  const res = assess(catalog, w);
  const j = journey(catalog, w, res);
  const settle = res.unknowns.slice(0, 5).map((u) => ({ text: clean(u.q), line: u.label }));
  const prove = (res.raised || []).slice(0, 5).map((o) => ({ text: clean(o.says), how: clean(o.prove), line: o.label }));
  const who = (c) => (c.who ? WHO[c.who].toLowerCase() : "");
  const due = datedPlan(j).filter((c) => !today || c.by >= today).slice(0, 5).map((c) => ({ text: clean(c.need), by: c.by, who: who(c) }));
  const late = datedPlan(j).filter((c) => today && c.by < today).slice(0, 5).map((c) => ({ text: clean(c.need), by: c.by, who: who(c) }));
  const told = res.land ? stories(catalog, w, res).find((x) => x.land) : null;
  const people = told ? told.people : [];
  // the essential questions not asked yet, the line to start with first: a first meeting that missed them is not over
  const order = [...(res.land ? [res.land.profile] : []), ...w.scope.filter((p) => catalog.lines[p] && (!res.land || p !== res.land.profile))];
  const ask = order.flatMap((p) => displayOrder(catalog.lines[p]).filter(({ q, index }) => q.core && !w.answers[`${p}#${index}`])
    .map(({ q }) => ({ text: clean(q.q), line: catalog.lines[p].label, role: q.role || "" }))).slice(0, 5);
  // who can answer what is left: the roles behind the open questions, in the order they first appear
  const roles = [...new Set([...res.unknowns.slice(0, 5), ...ask].map((x) => x.role).filter((r) => ROLE_WORDS[r]))];
  // a company's request for proposal: the requirements to check are understood best by asking, in the meeting.
  // A public body takes questions only through the tender's formal channel, so nothing of its tender goes here.
  const tender = w.rfp && w.rfp.issuer === "company" && !(w.rfp.decision && w.rfp.decision.call === "no_bid") ? w.rfp.reqs.filter((r) => r.a === "check").slice(0, 5).map((r) => ({ text: clean(r.text), ref: clean(r.ref) })) : [];
  // back from the demo: what they asked about, to answer, and what did not land, to show again differently
  const fu = w.demo && w.demo.seen ? demoFollowUps(cardsFor(catalog, w, res), w.demo) : { answer: [], again: [] };
  const demo = { answer: fu.answer.slice(0, 5).map((x) => ({ text: clean(x.part), note: clean(x.note) })), again: fu.again.slice(0, 5).map((x) => ({ text: clean(x.part), note: clean(x.note) })) };
  // the figures a first sketch still needs, on the lines in scope whose sketch was not worked out with their figures yet
  const figures = w.scope.filter((p) => catalog.lines[p] && SKETCH_NEEDS[p] && !w[SKETCH_NEEDS[p][0]]).slice(0, 5).map((p) => ({ line: SKETCH_NEEDS[p][1], need: SKETCH_NEEDS[p][2] }));
  return { customer: w.customer, land: res.land ? res.land.label : "", settle, ask, prove, due, late, people, roles, tender, demo, figures,
    empty: !settle.length && !ask.length && !prove.length && !due.length && !late.length && !tender.length && !demo.answer.length && !demo.again.length };
}

/** The agenda as text: for an invitation, an email or the meeting notes. */
export function agendaText(m, when = "") {
  const out = [`Next meeting with ${clean(m.customer)}${when ? `, ${when}` : ""}`, ""];
  if (m.land) out.push(`Focus: ${m.land.toLowerCase()}.`, "");
  let i = 0;
  if (m.late.length) { out.push(`${++i}. What has slipped`); for (const c of m.late) out.push(`   - ${c.text} (was due ${c.by}${c.who ? `, ${c.who}` : ""})`); out.push(""); }
  const back = m.demo || { answer: [], again: [] };
  if (back.answer.length || back.again.length) {
    out.push(`${++i}. Back from the demo`);
    for (const x of back.answer) out.push(`   - Your questions on: ${x.text}${x.note ? ` ("${x.note}")` : ""}`);
    for (const x of back.again) out.push(`   - To show again, closer to your case: ${x.text}`);
    out.push("");
  }
  if (m.settle.length) { out.push(`${++i}. Questions to answer together`); for (const q of m.settle) out.push(`   - ${q.text}`); out.push(""); }
  if ((m.ask || []).length) { out.push(`${++i}. Questions we have not asked yet`); for (const q of m.ask) out.push(`   - ${q.text}`); out.push(""); }
  if ((m.figures || []).length) { out.push(`${++i}. The figures for a first sizing`); for (const x of m.figures) out.push(`   - ${x.line}: ${x.need}`); out.push(""); }
  if ((m.tender || []).length) { out.push(`${++i}. Your requirements we want to understand well`); for (const r of m.tender) out.push(`   - ${r.ref ? `${r.ref}: ` : ""}${r.text}`); out.push(""); }
  if (m.prove.length) { out.push(`${++i}. Your concerns, and how we will prove them`); for (const o of m.prove) out.push(`   - "${o.text}": ${o.how}`); out.push(""); }
  if (m.due.length) { out.push(`${++i}. Coming up`); for (const c of m.due) out.push(`   - ${c.text}, by ${c.by}${c.who ? ` (${c.who})` : ""}`); out.push(""); }
  out.push(`${++i}. Next steps, owners and dates`, "");
  const can = (m.roles || []).map((r) => ROLE_WORDS[r].toLowerCase());
  if (m.people.length || can.length) out.push("It helps to have in the room:", ...m.people.map((x) => `- ${x}`), ...(can.length ? [`- Someone who can answer for: ${can.join(", ")}`] : []), "");
  return out.join("\n");
}

/** One calendar event on the chosen day, carrying the agenda: for the invitation. */
export function meetingIcs(w, m, date, stamp) {
  return calendar("Next meeting", [{ uid: `${w.id.replace(/\|/g, "-")}-next-${date}`, date, summary: `${clean(w.customer)}: next meeting`, description: agendaText(m) }], stamp);
}
