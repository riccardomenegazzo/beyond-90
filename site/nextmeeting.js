/**
 * The next meeting, from what the last one left open: the questions nobody could answer, the concerns still to prove,
 * the conditions due soon, and who to bring. An agenda to copy into an invitation, or a calendar file that carries it.
 */
import { assess, journey, datedPlan, stories, WHO } from "./workshop.js";
import { calendar } from "./ics.js";

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
  return { customer: w.customer, land: res.land ? res.land.label : "", settle, prove, due, late, people,
    empty: !settle.length && !prove.length && !due.length && !late.length };
}

/** The agenda as text: for an invitation, an email or the meeting notes. */
export function agendaText(m, when = "") {
  const out = [`Next meeting with ${clean(m.customer)}${when ? `, ${when}` : ""}`, ""];
  if (m.land) out.push(`Focus: ${m.land.toLowerCase()}.`, "");
  let i = 0;
  if (m.late.length) { out.push(`${++i}. What has slipped`); for (const c of m.late) out.push(`   - ${c.text} (was due ${c.by}${c.who ? `, ${c.who}` : ""})`); out.push(""); }
  if (m.settle.length) { out.push(`${++i}. Questions to answer together`); for (const q of m.settle) out.push(`   - ${q.text}`); out.push(""); }
  if (m.prove.length) { out.push(`${++i}. Your concerns, and how we will prove them`); for (const o of m.prove) out.push(`   - "${o.text}": ${o.how}`); out.push(""); }
  if (m.due.length) { out.push(`${++i}. Coming up`); for (const c of m.due) out.push(`   - ${c.text}, by ${c.by}${c.who ? ` (${c.who})` : ""}`); out.push(""); }
  out.push(`${++i}. Next steps, owners and dates`, "");
  if (m.people.length) out.push("It helps to have in the room:", ...m.people.map((x) => `- ${x}`), "");
  return out.join("\n");
}

/** One calendar event on the chosen day, carrying the agenda: for the invitation. */
export function meetingIcs(w, m, date, stamp) {
  return calendar("Next meeting", [{ uid: `${w.id.replace(/\|/g, "-")}-next-${date}`, date, summary: `${clean(w.customer)}: next meeting`, description: agendaText(m) }], stamp);
}
