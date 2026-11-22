// The readout of a proof of value, criterion by criterion: the same cards as the questions, one per criterion not
// dropped, swiped by what was seen: right met, up partly met, left not met, down dropped (with the sponsor). The
// evidence is written on the card, and suggests a result; the person decides. At the end: what was not met and what it
// means, what is only partly there, and what was met with its evidence.
//
// No DOM, so Node can test it. Nothing here leaves the browser: the suggestion is a few word patterns, read locally.
import { answerSet, tally } from "./deck.js";
import { STATUS_TEXT } from "./pov.js";
import { calendar, addDays } from "./ics.js";

/** The results a criterion can be given here, in the order of their keys (1 to 4) and of the buttons. */
export const RESULTS = {
  met: { label: "Met", tone: "good" },
  partly: { label: "Partly met", tone: "mid" },
  not_met: { label: "Not met", tone: "bad" },
  dropped: { label: "Dropped", tone: "unknown" },
};
export const ORDER = Object.keys(RESULTS);
export const READOUT = answerSet({ met: "right", partly: "up", not_met: "left", dropped: "down" });

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One card per criterion still counted, in the plan's order. */
export function readoutCards(p) {
  const counted = p.criteria.filter((c) => c.status !== "dropped");
  return counted.map((c, i) => ({
    key: c.id, label: `Criterion ${i + 1} of ${counted.length}`, tag: c.target ? "Signed-off target" : "No target yet",
    q: { q: clean(c.text), why: c.target ? `How we will know: ${clean(c.target)}` : "No target was written: agree with the sponsor what counts before calling it.",
      listen: "The evidence: a number against the target, a screen, a log, and who saw it.",
      probe: "Does the sponsor agree? If not met: what does it mean for the decision, and what would they need to see?" },
  }));
}

/** A criterion's result as the deck reads it: nothing while it has not been tried. */
export const resultOf = (p) => (card) => {
  const c = p.criteria.find((x) => x.id === card.key);
  return c && c.status !== "open" ? { a: c.status, note: c.evidence || "" } : null;
};

// the words that suggest a result: a failure first, then a qualifier, then a pass; the person decides
const NOT_MET = /\b(?:fail\w*|not (?:met|reached|working|shown|possible)|did ?n[o']t|could ?n[o']t|can ?n[o']t|missed|over (?:the )?(?:[\w.]+ )?target|broke|crash\w*|timed? ?out)\b/i;
const PARTLY = /\b(?:partly|partial\w*|some of|except|only|almost|nearly|but|half|most of|workaround|next week)\b/i;
const MET = /\b(?:met|pass\w*|worked|works|done|under (?:the )?(?:[\w.]+ )?target|within|achieved|succeeded|confirmed|signed off|as agreed)\b/i;

/** The result the evidence suggests, or null. */
export function readoutSuggest(said) {
  const t = clean(said);
  if (!t) return null;
  if (NOT_MET.test(t)) return "not_met";
  if (PARTLY.test(t)) return "partly";
  if (MET.test(t)) return "met";
  return null;
}

/** Where the readout stands, for the end of the deck. */
export function readoutSummary(cards, answerOf) {
  const t = tally(cards, answerOf, ORDER);
  const counted = t.total - t.counts.dropped;
  const head = t.counts.open === t.total ? "Nothing tried yet."
    : `${t.counts.met} of ${plural(counted, "criterion", "criteria")} met${t.counts.partly ? `, ${t.counts.partly} partly` : ""}${t.counts.not_met ? `, ${t.counts.not_met} not met` : ""}${t.counts.open ? `; ${t.counts.open} not tried yet` : ""}.`;
  return { head, total: t.total, open: t.counts.open, counts: t.counts,
    tallies: [["not_met", "not met"], ["partly", "partly met"], ["met", "met"], ["dropped", "dropped"]],
    lists: [["Not met: what it means for the decision", t.under.not_met], ["Partly met: what is still needed", t.under.partly],
      ["Met, with the evidence", t.under.met], ["Dropped, with the sponsor", t.under.dropped]] };
}

/** The readout in plain text, for the account team: the result, criterion by criterion, and the decision to ask for. */
export function readoutText(p, cards, answerOf) {
  const s = readoutSummary(cards, answerOf);
  const out = [`Proof of value readout: ${clean(p.customer)}`, "", s.head];
  for (const [heading, rows] of s.lists) if (rows.length) out.push("", heading, ...rows.map((r) => `- ${r.q}${r.note ? `: ${r.note}` : ""}`));
  const open = cards.filter((c) => !answerOf(c));
  if (open.length) out.push("", STATUS_TEXT.open, ...open.map((c) => `- ${c.q.q}`));
  const next = s.counts.not_met ? "Agree with the sponsor what the criteria not met mean for the decision, before asking for it."
    : s.open ? "Try what is still open before the readout." : "Ask for the decision, and agree the dates to a signed order.";
  out.push("", "Next", `- ${next}`);
  return out.join("\n");
}

/** The day the readout is due by the mutual plan (three days after the window ends), or a week from today without one. */
export const readoutDay = (p, today) => (p.end && /^\d{4}-\d{2}-\d{2}$/.test(p.end) && addDays(p.end, 3) >= today ? addDays(p.end, 3) : addDays(today, 7));

/**
 * The readout's agenda, for the sponsor: what we set out to prove, each criterion with how we will know, what it
 * means, and the decision with the dates to a signed order; who should be there. No result is in it: it is the agenda,
 * sent before the meeting.
 */
export function readoutAgenda(p, when = "") {
  const counted = p.criteria.filter((c) => c.status !== "dropped");
  const each = Math.max(3, Math.min(8, Math.round(30 / Math.max(1, counted.length))));
  const out = [`Proof of value readout: ${clean(p.customer)}${when ? `, ${when}` : ""}`, ""];
  out.push(`1. What we set out to prove${p.problem ? `: ${clean(p.problem)}` : ""} (5 minutes)`);
  out.push(`2. Criterion by criterion, with the evidence (about ${each} minutes each)`);
  for (const c of counted) out.push(`   - ${clean(c.text)}${c.target ? ` (how we will know: ${clean(c.target)})` : ""}`);
  out.push("3. What the result means for you, including anything not met (10 minutes)");
  out.push("4. The decision, and the dates to a signed order: security, purchasing, legal (10 minutes)", "");
  const who = [p.sponsor ? `the sponsor (${clean(p.sponsor)})` : "the sponsor", p.champion ? `the champion (${clean(p.champion)})` : "", "whoever decides"].filter(Boolean);
  out.push(`Who should be there: ${who.join(", ")}.`);
  return out.join("\n");
}

/** One calendar event on the chosen day, carrying the readout's agenda: for the invitation. */
export function readoutIcs(p, date, stamp) {
  return calendar("Readout", [{ uid: `${p.id.replace(/[^A-Za-z0-9-]/g, "-")}-readout-${date}`, date, summary: `${clean(p.customer)}: proof of value readout`, description: readoutAgenda(p) }], stamp);
}
