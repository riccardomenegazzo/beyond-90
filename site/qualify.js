/**
 * Qualify the deal: ten questions that are the same for every product line, asked alongside the technical ones.
 * They say whether there is a reason to change, a date that makes it urgent, a measured outcome, someone who decides,
 * criteria, the steps to a choice and to a signed order, the proof that would convince, a champion, and the
 * alternatives (staying as they are among them). Each is known, partly known, or not yet; together they say whether
 * the deal is ready for a demo built for this customer, for a proof of value, or for a date in the forecast.
 *
 * The tags name the same idea in the words most sales methods use (MEDDPICC among them), so a seller and a sales
 * engineer read one list. Nothing here is product-specific, and nothing leaves the browser.
 */

export const DEAL = [
  { id: "why_change", tag: "Pain", q: "What happens if nothing changes in the next twelve months, and who feels it?",
    why: "If staying as they are costs nothing, doing nothing wins.",
    listen: "A cost, a risk or a missed goal with someone's name on it is pain. 'It would be nice' is interest, not a reason to buy.",
    probe: "What has this already cost them this year?" },
  { id: "why_now", tag: "Event", q: "Which date makes this a decision for this year: a renewal, an end of support, an audit, a move, a budget?",
    why: "Without a date that matters to them, the decision slips to next year.",
    listen: "A date with a consequence is urgency. 'Sometime next year' means the deal has no clock.",
    probe: "What happens on that date if nothing has been decided?" },
  { id: "outcome", tag: "Metrics", q: "What result would the sponsor show a year from now, and how would it be measured?",
    why: "A measured outcome is what the business case and the proof are built on.",
    listen: "Hours saved, a recovery time, a cost per month: a number they already track. 'More agility' cannot be proven.",
    probe: "Where is that number measured today, and what is it now?" },
  { id: "decider", tag: "Economic buyer", q: "Who decides, who signs, and have we heard from them directly?",
    why: "A champion without the decider's ear can win the proof and still lose the deal.",
    listen: "A name and a meeting we had is known. 'My manager will decide', with no meeting, is not yet.",
    probe: "What does the decider need to hear to say yes, and when do we see them?" },
  { id: "criteria", tag: "Decision criteria", q: "How will the options be compared: which criteria, who wrote them, and which weigh most?",
    why: "Criteria written before we arrived decide the result.",
    listen: "Criteria shaped with us include what we prove best. Criteria copied from another supplier's datasheet are a warning.",
    probe: "Which criterion would rule an option out on its own?" },
  { id: "process", tag: "Decision process", q: "What are the steps to a choice (architecture board, security review, a pilot), who takes part, and when?",
    why: "Steps nobody mentioned are where deals stall.",
    listen: "Steps with dates and owners can be planned together. 'We will see' means a step will surprise us.",
    probe: "The last time they bought something this size, which step took longest?" },
  { id: "paper", tag: "Paper process", q: "What happens after the choice: budget approval, procurement, legal, and how long does each take?",
    why: "A technical win that misses the budget cycle waits a year.",
    listen: "Budget allocated and the purchasing steps known is a deal that can close. Budget 'to be found' is a project not yet funded.",
    probe: "Is the budget approved, and in which year's plan?" },
  { id: "proof", tag: "Technical validation", q: "What would convince them: a demo built for them, a proof on their own systems, a reference, and who must see it?",
    why: "Agreeing the proof and its audience before showing anything keeps it short and decisive.",
    listen: "Written success criteria and the decider at the readout end in a decision. An open-ended trial ends in a shrug.",
    probe: "If the proof met every criterion, would they move to an order, and who would say so?" },
  { id: "champion", tag: "Champion", q: "Who inside gains if this succeeds, and will carry it into the rooms we are not in?",
    why: "Most of the decision happens without us; someone has to make the case there.",
    listen: "A champion shares what is going on inside, gets us meetings and has something to win. A friendly contact who does none of that is a coach.",
    probe: "What did they do for us last week that we could not have done ourselves?" },
  { id: "alternatives", tag: "Competition", q: "What else are they weighing: another supplier, building it themselves, or staying as they are?",
    why: "Staying as they are is the most common competitor, and the one most often forgotten.",
    listen: "Knowing the alternatives tells us what to prove and what to leave alone. 'Nobody else' is rarely true.",
    probe: "If they did nothing this year, what would the budget go to instead?" },
];

export const DEAL_IDS = DEAL.map((d) => d.id);
export const STATES = { known: { label: "Known", weight: 1 }, partly: { label: "Partly", weight: 0.5 }, unknown: { label: "Not yet", weight: 0 } };

// what must be at least partly or fully known to move on; each gate includes the ones before it
const AT_LEAST = { partly: ["partly", "known"], known: ["known"] };
export const GATES = [
  { id: "demo", label: "Ready for a demo built for them", needs: { why_change: "partly", outcome: "partly", proof: "partly" },
    then: "Show the result they described first, then only what closes their gaps; end by agreeing what a proof would have to show." },
  { id: "proof", label: "Ready to propose a proof of value", needs: { why_change: "known", why_now: "known", outcome: "known", decider: "partly", criteria: "known", proof: "known", champion: "partly" },
    then: "Write the success criteria with them, get the sponsor to sign them off, fix a window, and put the decider in the readout." },
  { id: "commit", label: "Ready to put a date in the forecast", needs: { why_change: "known", why_now: "known", outcome: "known", decider: "known", criteria: "known", process: "known", paper: "known", proof: "known", champion: "known", alternatives: "partly" },
    then: "Agree the dates from the readout to the signed order with the champion, and check them with the decider." },
];

const MAX_NOTE = 300;
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

/** A deal record as stored: only known questions, each with a state, a short note and the day it was last set. */
export function validDeal(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const entries = Object.entries(d);
  if (!entries.length || entries.length > DEAL.length) return false;
  return entries.every(([k, v]) => DEAL_IDS.includes(k) && v && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(STATES, v.a)
    && typeof v.note === "string" && v.note.length <= MAX_NOTE && isDate(v.on) && Object.keys(v).every((x) => ["a", "note", "on"].includes(x)));
}

/** One answer set or cleared (no state clears it, note included). Returns the new record, or null when nothing is left. */
export function withDealAnswer(deal, id, a, note, today) {
  if (!DEAL_IDS.includes(id)) throw new Error("Not a qualification question.");
  if (a && !Object.hasOwn(STATES, a)) throw new Error("Known, partly, or not yet.");
  if (!isDate(today)) throw new Error("Give today's date.");
  const next = { ...(deal || {}) };
  if (!a) delete next[id];
  else next[id] = { a, note: String(note == null ? "" : note).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_NOTE), on: today };
  return Object.keys(next).length ? next : null;
}

/** Where the deal stands: each question with its answer, a score, the furthest gate passed and what the next one needs. */
export function dealState(deal) {
  const d = deal || {};
  const items = DEAL.map((x) => ({ ...x, a: d[x.id] ? d[x.id].a : "", note: d[x.id] ? d[x.id].note : "", on: d[x.id] ? d[x.id].on : "" }));
  const answered = items.filter((x) => x.a).length;
  const score = Math.round((items.reduce((n, x) => n + (x.a ? STATES[x.a].weight : 0), 0) / DEAL.length) * 100);
  const met = (g) => Object.entries(g.needs).every(([id, min]) => AT_LEAST[min].includes(d[id] ? d[id].a : ""));
  let passed = null;
  for (const g of GATES) { if (met(g)) passed = g; else break; }
  const next = GATES[passed ? GATES.indexOf(passed) + 1 : 0] || null;
  const missing = next ? Object.entries(next.needs).filter(([id, min]) => !AT_LEAST[min].includes(d[id] ? d[id].a : ""))
    .map(([id, min]) => { const x = items.find((i) => i.id === id); return { id, tag: x.tag, q: x.q, probe: x.probe, a: x.a, min }; }) : [];
  const verdict = passed ? passed.label : answered ? "Keep discovering" : "Not qualified yet";
  return { items, answered, score, passed: passed ? passed.id : "", verdict, next: next ? { id: next.id, label: next.label, then: next.then } : null, missing,
    then: passed ? passed.then : "Ask why they would change, what result they want, and what would convince them: then a demo can be built for them." };
}

const cell = (t) => String(t || "").replace(/\|/g, "/").replace(/\n/g, " ");

/** For the seller and the meeting summary: never for the customer readout. */
export function dealMarkdown(deal) {
  const s = dealState(deal);
  if (!s.answered) return "";
  const out = ["## The deal", "", `${s.verdict}. ${s.answered} of ${DEAL.length} qualification questions answered, ${s.score} out of 100.`, "",
    "| Question | Known | What we heard |", "|---|---|---|"];
  for (const x of s.items) out.push(`| ${cell(x.tag)}: ${cell(x.q)} | ${x.a ? STATES[x.a].label : "Not asked"} | ${cell(x.note)} |`);
  out.push("");
  if (s.next && s.missing.length) {
    out.push(`To be ${s.next.label.charAt(0).toLowerCase() + s.next.label.slice(1)}, find out:`, "");
    for (const m of s.missing) out.push(`- ${m.tag}: ${m.probe}`);
    out.push("");
  }
  return out.join("\n");
}
