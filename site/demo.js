// Running the demo: the plan built from what the customer said, one card per part (each gap it closes, then each
// concern they raised), swiped by how it landed: right landed, up questions, left did not land, down not shown. What
// they said is written on the card, in their words. At the end: what to answer in writing, what to show differently,
// and what landed and belongs in the proof.
//
// No DOM, so Node can test it. Nothing here leaves the browser: the suggestion is a few word patterns, read locally.
import { answerSet, tally, INVITE } from "./deck.js";
import { ROLE_WORDS } from "./questions.js";
import { demoPlan } from "./forward.js";

/** How a part of the demo landed, in the order of their keys (1 to 4) and of the buttons. */
export const REACTIONS = {
  landed: { label: "Landed", tone: "good" },
  questions: { label: "Questions", tone: "mid" },
  missed: { label: "Did not land", tone: "bad" },
  skipped: { label: "Not shown", tone: "unknown" },
};
export const ORDER = Object.keys(REACTIONS);
export const DEMO = answerSet({ landed: "right", questions: "up", missed: "left", skipped: "down" });

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const lowerFirst = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const LISTEN = "Their own words back, a question about their own case, or the name of someone else who should see it: it landed. A polite nod and no question: ask.";
const PROBE = "Is this what you meant when you said it? Who else would need to see it?";

/**
 * One card per part of the demo: the gaps it closes, in the plan's order, then the concerns they raised.
 * @param {{ready:boolean, line:string, segments:object[], concerns:object[]}} plan from `demoPlan`
 */
export function demoCards(plan, time = null) {
  if (!plan || !plan.ready) return [];
  const mins = (n) => (n ? `, about ${n} minutes` : "");
  const segs = time ? plan.segments.slice(0, time.fit) : plan.segments;
  const cards = segs.filter((s) => s.key).map((s) => ({
    key: s.key, label: plan.line, part: clean(s.show), heard: clean(s.heard),
    tag: (s.role && ROLE_WORDS[s.role] ? `For ${INVITE[s.role] || ROLE_WORDS[s.role].toLowerCase()}` : s.status === "gap" ? "A real gap" : "Partly there") + mins(time && time.each),
    q: { q: s.need ? `Show that ${lowerFirst(clean(s.need))}` : `Show: ${clean(s.show)}`,
      why: s.heard ? `They said: “${clean(s.heard)}”` : s.status === "gap" ? "A real gap, heard in discovery." : "Partly there today, heard in discovery.",
      listen: LISTEN, probe: PROBE },
  }));
  for (const c of plan.concerns.filter((x) => x.key)) {
    cards.push({ key: c.key, label: "A concern they raised", tag: `Their concern${mins(time && time.concern)}`, part: clean(c.says),
      q: { q: `Answer their concern: “${clean(c.says)}”`, why: `The proof that settles it: ${clean(c.prove)}`, listen: LISTEN,
        probe: "Does this answer it, or would you want to see it on your own systems?" } });
  }
  return cards;
}

// the words that suggest how it landed: a doubt first, then a question, then a yes; the person decides
const MISSED = /\b(?:not (?:what|really|convinced|sure|for us|relevant)|doesn'?t (?:fit|apply|help|work for)|don'?t (?:need|see|get)|we (?:already )?have (?:that|this)|too (?:complex|complicated|expensive|slow|much)|confus\w*|lost (?:me|us|them)|so what|irrelevant|meh)\b/i;
const QUESTION = /\?|\b(?:how (?:does|do|would|long|much|many)|what (?:about|if|happens)|does it|can it|could it|would it|is it|which|when would|need to check|send (?:us|me)|in writing|depends)\b/i;
const LANDED = /\b(?:great|exactly|love|like (?:it|that|this)|makes sense|that'?s (?:it|what we need|good)|impressive|nice|perfect|want (?:that|this|it)|wow|convinc\w*|clear|useful|brilliant|spot on)\b/i;

/** The reaction what they said suggests, or null: the person takes it or not. */
export function demoSuggest(said) {
  const t = clean(said);
  if (!t) return null;
  if (MISSED.test(t)) return "missed";
  if (QUESTION.test(t)) return "questions";
  if (LANDED.test(t)) return "landed";
  return null;
}

/**
 * Where the demo stands: how many parts landed, and the lists that matter after it. `seenOf(card)` gives a card's
 * reaction ({a, note}) or nothing.
 */
export function demoSummary(cards, seenOf) {
  const t = tally(cards, seenOf, ORDER);
  const shown = t.total - t.counts.open - t.counts.skipped;
  const head = !shown && !t.counts.skipped ? "Nothing noted yet."
    : `${t.counts.landed} of ${plural(shown, "part shown", "parts shown")} landed${t.counts.questions ? `, ${t.counts.questions} with questions` : ""}${t.counts.missed ? `, ${t.counts.missed} did not land` : ""}${t.counts.open ? `; ${t.counts.open} not noted yet` : ""}.`;
  return { head, total: t.total, open: t.counts.open, counts: t.counts,
    tallies: [["missed", "did not land"], ["questions", "questions"], ["landed", "landed"], ["skipped", "not shown"]],
    lists: [["Questions to answer, in writing", t.under.questions], ["Did not land: ask what they expected", t.under.missed],
      ["Landed: what the proof should confirm", t.under.landed], ["Not shown: for the next meeting", t.under.skipped]] };
}

/** The demo recap, in plain text for the account team: how it landed, part by part, and what follows from it. */
export function demoRecapText(customer, cards, seenOf) {
  const s = demoSummary(cards, seenOf);
  const said = (r) => `- ${r.q}${r.note ? ` "${r.note}"` : ""}`;
  const out = [`Demo recap: ${clean(customer)}`, "", s.head];
  for (const [heading, rows] of s.lists) if (rows.length) out.push("", heading, ...rows.map(said));
  const next = s.counts.missed ? "Ask what they expected where it did not land, before planning a proof."
    : s.counts.questions ? "Answer the questions in writing, then agree what a proof would have to show."
      : s.counts.landed ? "Agree what a proof would have to show, and who signs it off." : "";
  if (next) out.push("", "Next", `- ${next}`);
  return out.join("\n");
}

/**
 * What the demo leaves for later, from the reactions kept on the workshop: what to answer and what to show again,
 * for the next meeting; and what they asked about, to prove. Parts no longer in the plan are left out.
 * @param {object[]} cards from `demoCards`
 * @param {{seen?: Record<string, {a:string, note:string}>}|undefined} demo the workshop's `demo`
 */
export function demoFollowUps(cards, demo) {
  const seen = (demo && demo.seen) || {};
  const row = (c) => ({ key: c.key, part: c.part, text: c.q.q, note: seen[c.key].note || "" });
  const of = (a) => cards.filter((c) => seen[c.key] && seen[c.key].a === a).map(row);
  return { answer: of("questions"), again: of("missed"), landed: of("landed"), noted: cards.filter((c) => seen[c.key]).length };
}

/** The demo's cards for a workshop, from the plan built from what was said. */
export const cardsFor = (catalog, w, res) => demoCards(demoPlan(catalog, w, res));

/**
 * What landed in the demo, as criteria for the proof: shown once, to be confirmed on their own systems, with what
 * they said. Only the gaps it closes (their concerns go in as criteria of their own); at most three.
 */
export function proofFromDemo(cards, demo) {
  return demoFollowUps(cards, demo).landed.filter((x) => !x.key.startsWith("c:")).slice(0, 3)
    .map((x) => ({ text: x.part, target: x.note ? `Landed in the demo: "${x.note}". Now on their own systems` : "Landed in the demo. Now on their own systems" }));
}

/**
 * The note to send the customer after the demo, in plain text: what we showed against what they told us, their
 * questions with a line for each answer, and the proof we propose. It speaks to the customer: no reaction is named
 * ("did not land" stays with the account team), and what was said in the demo appears only as their questions.
 */
export function customerNote(customer, cards, seenOf) {
  const shown = cards.filter((c) => { const s = seenOf(c); return s && s.a !== "skipped"; });
  const out = [`Thank you for your time today, ${clean(customer)}.`, ""];
  const parts = shown.filter((c) => !c.key.startsWith("c:"));
  if (parts.length) {
    out.push("What we showed, against what you told us");
    for (const c of parts) out.push(`- ${c.part}${c.heard ? `. You told us: "${c.heard}"` : ""}`);
    out.push("");
  }
  const concerns = shown.filter((c) => c.key.startsWith("c:"));
  if (concerns.length) {
    out.push("The concerns you raised");
    for (const c of concerns) out.push(`- "${c.part}" ${c.q.why.replace(/^The proof that settles it: (\w)/, (m, ch) => `We propose to prove it: ${ch.toLowerCase()}`)}`);
    out.push("");
  }
  const asked = shown.filter((c) => seenOf(c).a === "questions");
  if (asked.length) {
    out.push("Your questions, and our answers");
    for (const c of asked) {
      const said = clean(seenOf(c).note);
      out.push(`- ${said ? `"${said}"` : `Your question on: ${c.part}`}`, "  Answer: ");
    }
    out.push("");
  }
  const confirm = shown.filter((c) => !c.key.startsWith("c:") && seenOf(c).a === "landed").map((c) => c.part);
  out.push("What we propose next");
  if (confirm.length) out.push("- A proof of value on your own systems, to confirm:", ...confirm.map((t) => `  - ${t}`));
  else out.push("- A short call to agree what a proof of value on your own systems would have to show.");
  out.push("- Before it starts: the success criteria, who signs them off, and the dates.");
  return out.join("\n");
}
