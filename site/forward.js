/**
 * The way forward: from the first meeting to the handover, what each phase of presales is for, what must be true to
 * move on (read from what is recorded), how to run it and what to avoid. And the demo, planned from what the customer
 * said: their situation in their words, the result they want shown first, then only what closes their gaps, what to
 * leave out because they have it already, and the proof to agree at the end.
 *
 * Plain functions over the workshop, its deal and its proof of value. Nothing here names a product.
 */
import { assess, displayOrder, stories, worthText, ROLE_WORDS } from "./workshop.js";
import { dealState } from "./qualify.js";
import { qualify as povReady, progress as povProgress } from "./pov.js";
import { hasCase } from "./valuecase.js";

export const PHASES = [
  { id: "discover", label: "Discovery", goal: "Know where it hurts, what it is worth to them, and who decides.",
    do: ["Prepare before the call: read what they run and what they have announced, so no question asks what a search could answer.",
      "Ask the essential questions first, value before technology, and let them talk.",
      "Go one level deeper on every answer that matters: the follow-up is where the figure or the owner is.",
      "Close by playing back what you heard, in their words, and booking the people who can answer what is still open."],
    avoid: ["Demoing to find out what they need.", "Reading the questions out like a form.", "Leaving without a date for the next meeting."] },
  { id: "demo", label: "Demo built for them", goal: "Show that what they need is possible, in their terms, in the time they have.",
    do: ["Open with their situation in three lines, and ask whether it is still right.",
      "Show the result they want first, then only the few steps that close their gaps.",
      "Keep each part to what one role cares about: the executive gets ten minutes, not an hour.",
      "End by agreeing what a proof would have to show, and who would sign it off."],
    avoid: ["A tour of every feature.", "Showing what they have already solved.", "Ending without the next step in the calendar."] },
  { id: "proof", label: "Proof of value", goal: "Prove the few things that decide it, on their systems, against criteria they signed.",
    do: ["Write the success criteria with them before the first day, and have the sponsor sign them off.",
      "Fix the window: a few weeks, a check-in every week, a review at the midpoint.",
      "Put every concern they raised in as a criterion, with how it will be measured.",
      "If it will not work, say so by the midpoint, and narrow it or stop."],
    avoid: ["An open-ended trial with no end date.", "Criteria added halfway without the sponsor.", "Testing what nobody asked to see."] },
  { id: "decision", label: "Decision", goal: "Turn the result into a decision, with the people and the dates that make it happen.",
    do: ["Hold the readout within days of the end, with the decider in the room.",
      "Go criterion by criterion: met, with the evidence; not met, with what it means.",
      "Ask for the decision, and agree the dates to a signed order: security, purchasing, legal.",
      "Give finance the case for change in their own figures."],
    avoid: ["Sending the results by email and waiting.", "Letting a successful proof stand in for the business case."] },
  { id: "handover", label: "Handover to delivery", goal: "Hand over what was proven and promised, so it stays true after go-live.",
    do: ["Give delivery what was proven, what was promised and by when, and what is still open.",
      "Keep the promises as the customer's commitments, so they are followed after go-live.",
      "Record why it was won or lost: the next deal learns from it."],
    avoid: ["Promises that live only in the head of the engineer who made them."] },
];

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const known = (deal, id, min = "known") => !!(deal && deal[id] && (deal[id].a === "known" || (min === "partly" && deal[id].a === "partly")));

/** The demo, from what was said: situation, the result first, the gaps it closes, what to leave out, the proof to agree. */
export function demoPlan(catalog, w, res = assess(catalog, w)) {
  const land = res.land;
  const deal = w.deal || {};
  const situation = [];
  for (const id of ["why_change", "why_now"]) if (deal[id] && clean(deal[id].note)) situation.push(clean(deal[id].note));
  for (const l of res.lines) {
    for (const q of [...l.gaps, ...l.partly, ...l.unknowns, ...l.solved]) {
      if (q.stage !== "value" || (!clean(q.note) && q.amount == null)) continue;
      situation.push(`${clean(q.note) || clean(q.q)}${q.amount != null ? ` (${worthText(q)})` : ""}`);
    }
  }
  if (land) for (const q of land.gaps) if (q.stage !== "value" && clean(q.note)) situation.push(clean(q.note));
  const told = land ? stories(catalog, w, res).find((x) => x.land) : null;
  const result = deal.outcome && clean(deal.outcome.note) ? clean(deal.outcome.note)
    : told && told.audiences.executive ? told.audiences.executive : land ? `What ${land.label.toLowerCase()} would look like with every gap closed.` : "";
  // only what closes their gaps, in the order of a conversation; what they have already is left out
  const segments = [];
  if (land) {
    const order = new Map(displayOrder(catalog.lines[land.profile]).map((x, i) => [x.index, i]));
    const open = [...land.gaps.map((q) => ({ ...q, status: "gap" })), ...land.partly.map((q) => ({ ...q, status: "partly" }))]
      .filter((q) => q.stage !== "value").sort((a, b) => (a.status === b.status ? 0 : a.status === "gap" ? -1 : 1) || order.get(a.index) - order.get(b.index));
    for (const q of open.slice(0, 4)) segments.push({ show: clean(q.need || q.q), heard: clean(q.note), role: q.role || "", status: q.status });
  }
  const concerns = (res.raised || []).slice(0, 2).map((o) => ({ says: clean(o.says), prove: clean(o.prove) }));
  const skip = land ? land.solved.filter((q) => q.stage !== "value").slice(0, 4).map((q) => clean(q.need || q.q)) : [];
  const close = [...(res.proof || []).slice(0, 3).map((c) => clean(c.text)), ...concerns.map((c) => c.prove)];
  const roles = [...new Set(segments.map((s) => s.role).filter((r) => ROLE_WORDS[r]))];
  return { ready: !!land, line: land ? land.label : "", situation: situation.slice(0, 4), result, segments, concerns, skip, close: [...new Set(close)].slice(0, 5), roles };
}

/** The demo plan as text: to share with the seller and the champion before the meeting. */
export function demoMarkdown(plan, w) {
  if (!plan.ready) return "";
  const out = [`# Demo plan: ${clean(w.customer)}`, "", `Built from the discovery workshop. Start with ${plan.line.toLowerCase()}.`, ""];
  let i = 0;
  out.push(`## ${++i}. Their situation, in their words (2 minutes)`, "");
  if (plan.situation.length) out.push(...plan.situation.map((s) => `- ${s}`), "", "Ask: is this still right? What has changed since we spoke?", "");
  else out.push("- Nothing in their words yet: open by asking what has changed since the last meeting.", "");
  out.push(`## ${++i}. The result first (3 minutes)`, "", plan.result, "");
  if (plan.segments.length) {
    out.push(`## ${++i}. Only what closes their gaps`, "");
    plan.segments.forEach((s, n) => {
      out.push(`${n + 1}. Show: ${s.show}${s.role ? ` (for ${ROLE_WORDS[s.role].toLowerCase()})` : ""}`);
      if (s.heard) out.push(`   - They said: "${s.heard}"`);
    });
    out.push("");
  }
  if (plan.concerns.length) {
    out.push(`## ${++i}. The concerns they raised`, "");
    for (const c of plan.concerns) out.push(`- "${c.says}": ${c.prove}`);
    out.push("");
  }
  if (plan.skip.length) out.push(`## Leave out: they have it already`, "", ...plan.skip.map((s) => `- ${s}`), "");
  out.push(`## ${++i}. Agree what a proof would have to show (5 minutes)`, "", ...(plan.close.length ? plan.close.map((c) => `- ${c}`) : ["- The criteria they would sign off, and who signs."]), "",
    "For the executive, keep to the situation, the result, the first two gaps and the proof: fifteen minutes.", "");
  return out.join("\n");
}

/**
 * Where the prospect is on the way, phase by phase: each with what must be true to move on, read from what is
 * recorded. The phase now is the first with something still to do; the ones before it are done.
 */
export function forward(catalog, w, pov, today = "") {
  const res = assess(catalog, w);
  const ds = dealState(w.deal);
  const gate = (id) => ds.passed && ["demo", "proof", "commit"].indexOf(ds.passed) >= ["demo", "proof", "commit"].indexOf(id);
  const core = w.scope.filter((p) => catalog.lines[p]).flatMap((p) => displayOrder(catalog.lines[p]).filter(({ q }) => q.core).map(({ index }) => `${p}#${index}`));
  const coreDone = core.filter((k) => w.answers[k]).length;
  const atStake = res.lines.some((l) => [...l.gaps, ...l.partly, ...l.unknowns, ...l.solved].some((q) => q.stage === "value" && (clean(q.note) || q.amount != null)));
  const pr = pov ? povProgress(pov) : null;
  const inProof = new Set(pov ? pov.criteria.filter((c) => c.status !== "dropped").map((c) => clean(c.text).toLowerCase()) : []);
  const outside = (res.raised || []).filter((o) => !inProof.has(clean(o.prove).toLowerCase()));
  const outcome = pov && pov.outcome ? pov.outcome.result : "";
  const checks = {
    discover: [
      { text: "The line to start with is known", ok: !!res.land, fix: res.waiting || "Answer a few more questions on the lines in scope.", go: "workshop" },
      { text: `The essential questions are answered (${coreDone} of ${core.length})`, ok: core.length > 0 && coreDone >= Math.ceil(core.length * 0.8), fix: "Ask the essential questions still open: narrow the questions to them.", go: "workshop" },
      { text: "Something is at stake, in their words or as a figure", ok: atStake, fix: "Ask what a day without it would cost, and note their words.", go: "workshop" },
      { text: "Ready for a demo built for them", ok: gate("demo"), fix: "Ask why they would change, the result they want, and what would convince them.", go: "wsqualify" },
    ],
    demo: [
      { text: "The demo was given", ok: !!(w.demo && w.demo.on), fix: "Plan it from what they said, under The way forward, and mark it given once it is.", go: "" },
      { text: "Ready to propose a proof of value", ok: gate("proof"), fix: "Settle what the proof gate still needs.", go: "wsqualify" },
    ],
    proof: [
      { text: "A proof of value is planned", ok: !!pov, fix: "Start it from Where to start: it opens with the line's own criteria.", go: "hurt" },
      { text: "Ready to start: criteria signed off, sponsor and champion, a realistic window, scope", ok: !!pov && povReady(pov).ready, fix: pov ? povReady(pov).items.filter((x) => !x.ok).map((x) => x.fix).join(" ") : "Plan the proof first.", go: "wspov" },
      { text: "Every concern they raised is a criterion", ok: !!pov && !outside.length, fix: outside.length ? `Add as criteria: ${outside.map((o) => `"${clean(o.says)}"`).join(", ")}.` : "Plan the proof first.", go: "wspov" },
      { text: "Every criterion has been tried", ok: !!pr && pr.total > 0 && pr.open === 0, fix: pr ? `${pr.open} of ${pr.total} still to try.` : "Plan the proof first.", go: "wspov" },
    ],
    decision: [
      { text: "The readout to the sponsor is done", ok: !!pov && (pov.stage === "done" || !!outcome), fix: "Hold the readout and mark the proof done.", go: "wspov" },
      { text: "The decider is known and has heard from us", ok: known(w.deal, "decider"), fix: "Ask the champion for a meeting with the decider before the readout.", go: "wsqualify" },
      { text: "Finance has the case for change", ok: !!(w.case && hasCase(w.case)), fix: "Ask for the cost of staying and of moving, and build the case with them.", go: "wscase" },
      { text: "The outcome is recorded", ok: !!outcome, fix: "Record won, lost or no decision, and why, on the proof of value.", go: "wspov" },
    ],
    handover: [
      { text: "Won", ok: outcome === "won", fix: outcome ? "This one was not won: what it teaches is on the presales desk." : "Not decided yet.", go: outcome ? "" : "wspov" },
    ],
  };
  // the phase now is the furthest one started; once it is done, the one after it. A phase passed with something
  // still open says so, rather than pulling the prospect back to it.
  const started = { discover: true, demo: !!(w.demo && w.demo.on) || gate("demo"), proof: !!pov, decision: !!pov && (pov.stage === "done" || !!outcome), handover: outcome === "won" };
  const done = (id) => checks[id].every((c) => c.ok);
  let at = 0;
  PHASES.forEach((ph, i) => { if (started[ph.id]) at = i; });
  if (done(PHASES[at].id) && at < PHASES.length - 1 && !(outcome && outcome !== "won")) at++;
  const phases = PHASES.map((ph, i) => ({ ...ph, checks: checks[ph.id],
    state: i < at ? (done(ph.id) ? "done" : "open") : i === at ? (done(ph.id) ? "done" : "now") : "later" }));
  return { phases, now: PHASES[at].id, closed: !!outcome && outcome !== "won", outcome, deal: ds.verdict, demo: demoPlan(catalog, w, res), today };
}
