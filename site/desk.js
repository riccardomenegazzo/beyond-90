// The presales desk: every prospect in one place, from the first discovery meeting to the decision.
//
// A pre-sales engineer carries many opportunities at once, each at a different point: still listening, a journey agreed,
// a proof of value running, a decision due. This module reads the workshops and proofs of value kept in this browser and
// answers the questions of a Monday morning: where is each one, what is due this week, what is late, and what do I tell
// the account team. Pure functions over plain records; the page and the tests share them.

import { assess, journey, datedPlan, exampleWorkshop, makeWorkshop, setAnswer, setPlan, setWorth, setRaised, setDeal, setChannel, setAlt, setRfpMeta, setRequirement, setBidAnswer } from "./workshop.js";
import { hasCase } from "./valuecase.js";
import { rfpState, notBidding, withRequirements, parseRequirements, EXAMPLE_TENDER, KEYWORDS } from "./rfp.js";
import { registrationOf, channelState, KINDS, ROUTES, ACTIVITIES } from "./partners.js";
import { dealState } from "./qualify.js";
import { forward, PHASES } from "./forward.js";
import { progress, makePov, setCriterion, setOutcome, edit as editPov } from "./pov.js";

export const STAGES = [
  { id: "discovery", label: "Discovery", hint: "Still listening: not enough answers to say where to start." },
  { id: "journey", label: "Journey agreed", hint: "We know where to start and what would need to be true." },
  { id: "proof", label: "Proof of value", hint: "A proof of value is planned or running." },
  { id: "decision", label: "Decision", hint: "The proof is done: the result is with the customer." },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
export const OUTCOME_WORDS = { won: "Won", lost: "Lost", none: "No decision" };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/** One opportunity per customer name: its newest workshop and newest proof of value, read together. */
/**
 * What could stop this deal, read from what is already recorded; each says what to do. "high" first: it can lose the deal
 * on its own. Nothing is guessed: no figure, no sponsor or no date counts only where the stage needs one.
 */
/**
 * How much evidence of a technical win the deal holds, out of 100: a checklist read from what is recorded, not a
 * probability. Each item says what it is worth; what is missing says what would raise it.
 */
export function evidenceOf({ w, p, res, plan, pr, overdue }) {
  const raised = res ? res.raised || [] : [];
  const inProof = new Set(p ? p.criteria.filter((c) => c.status !== "dropped").map((c) => String(c.text).trim().toLowerCase()) : []);
  const counted = pr ? pr.total : 0;
  const items = [
    [10, "The line to start with is known", !!(res && res.land)],
    [10, "What is at stake is in the customer's words", !!(w && Object.values(w.answers).some((a) => a.amount != null))],
    [10, "The conditions have owners and dates", plan.length > 0],
    [10, "No agreed condition is late", plan.length > 0 && !overdue],
    [10, "A sponsor is named for the proof of value", !!(p && String(p.sponsor || "").trim())],
    [5, "At least three success criteria are agreed", counted >= 3],
    [25, "Success criteria met", pr && counted ? pr.met / counted : 0],
    [10, "Every concern the customer raised is in the proof of value", !!(p && raised.length && raised.every((o) => inProof.has(String(o.prove).trim().toLowerCase())))],
    [10, "Finance has a case for change", !!(w && w.case && hasCase(w.case))],
  ];
  let score = 0;
  const have = [], missing = [];
  for (const [worth, label, got] of items) {
    const part = typeof got === "number" ? got : got ? 1 : 0;
    score += worth * part;
    if (part >= 1) have.push(label);
    else missing.push(typeof got === "number" && counted ? `${label}: ${pr.met} of ${counted}` : label);
  }
  return { score: Math.round(score), have, missing };
}

/** How the demo went, from what was noted on its cards: the day it was given, and how many parts landed. Null without one. */
export function demoOf(w) {
  if (!w || !w.demo) return null;
  const seen = Object.values(w.demo.seen || {});
  return { on: w.demo.on || "", shown: seen.filter((x) => x.a !== "skipped").length, landed: seen.filter((x) => x.a === "landed").length,
    missed: seen.filter((x) => x.a === "missed").length, questions: seen.filter((x) => x.a === "questions").length };
}

// the first sketch each line has, and what it is called in a sentence
const SKETCH_OF = { euc: ["vdi", "virtual desktops"], "kubernetes-platform": ["k8s", "the container platform"], dbaas: ["db", "database licences"],
  "file-storage": ["files", "file shares"], "object-storage": ["obj", "backup capacity"], "dr-backup": ["dr", "recovery"], "private-ai": ["gpu", "GPUs"], "edge-sites": ["edge", "the sites"] };
/** The words a snapshot may carry for the sketches a deal has: nothing else gets through. */
export const SKETCH_WORDS = Object.values(SKETCH_OF).map((x) => x[1]);
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function risksOf({ w, p, res, pr, stage, overdue, today }) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  // parts of the demo that did not land, before a proof is planned: a proof built on them would test the wrong thing
  const dm = demoOf(w);
  if (dm && dm.missed && !p) add("watch", `${dm.missed} part${dm.missed === 1 ? "" : "s"} of the demo did not land: ask what they expected before planning a proof.`);
  const later = stage === "proof" || stage === "decision";
  if (overdue) add("high", `${overdue} agreed condition${overdue === 1 ? " is" : "s are"} late: agree a new date with its owner, or say why it slipped.`);
  if (p) {
    if (!String(p.sponsor || "").trim()) add("high", "No sponsor named for the proof of value: nobody is there to sign the result.");
    if (stage === "proof" && !p.end) add("watch", "The proof of value has no end date: a test without one drifts.");
    if (stage === "proof" && p.end && pr.open) {
      const left = days(today, p.end);
      if (left <= 7) add("high", `The proof of value ends ${left < 0 ? `${-left} day${left === -1 ? "" : "s"} ago` : left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`} with ${pr.open} criteri${pr.open === 1 ? "on" : "a"} not yet tried.`);
    }
    const notReady = pr.ready_total - pr.ready;
    if (stage === "proof" && p.start && p.start <= today && notReady) add("watch", `${notReady} item${notReady === 1 ? "" : "s"} of the first-day checklist ${notReady === 1 ? "is" : "are"} not done.`);
    if (stage === "decision" && (pr.verdict === "not met" || pr.not_met)) add("high", `The proof of value ended ${pr.verdict}: agree with the sponsor what it means before the decision.`);
  }
  if (w && res) {
    const inProof = new Set(p ? p.criteria.filter((c) => c.status !== "dropped").map((c) => String(c.text).trim().toLowerCase()) : []);
    const raised = res.raised || [];
    const outside = raised.filter((o) => !inProof.has(String(o.prove).trim().toLowerCase()));
    if (p && outside.length) add("high", `${outside.length} concern${outside.length === 1 ? "" : "s"} the customer raised ${outside.length === 1 ? "is" : "are"} not in the proof of value: add ${outside.length === 1 ? "it" : "them"} as criteria.`);
    if ((stage === "journey" || later) && !Object.values(w.answers).some((a) => a.amount != null)) add("watch", "Nothing is at stake in the customer's words yet: ask what a day without it would cost.");
    if (later && !(w.case && hasCase(w.case))) add("watch", "Finance has no case for change yet: ask for the cost of staying and of moving.");
    if (later && w.inventory && !w.sizing) add("watch", "The sizing sketch still uses the defaults: agree the assumptions with the customer.");
    const unsized = later ? (w.scope || []).filter((x) => SKETCH_OF[x] && !w[SKETCH_OF[x][0]]).map((x) => SKETCH_OF[x][1]) : [];
    if (unsized.length) add("watch", `No first sketch worked out with their figures for ${andList(unsized)}: do it before the results go to finance.`);
    if (res.unknowns.length >= 3) add("watch", `${res.unknowns.length} questions nobody could answer: book the people who can.`);
    // the partner's protection: a registration that lapses leaves the deal open to anyone
    const reg = registrationOf(w.channel, today);
    if (reg && reg.status === "expired") add("high", `${reg.lead.name}'s deal registration ran out on ${reg.until}: renew it, or the deal is unprotected.`);
    else if (reg && reg.status === "expiring") add("high", `${reg.lead.name}'s deal registration runs out in ${reg.days} day${reg.days === 1 ? "" : "s"}: ask for an extension.`);
    // the deal itself: a proof can be won and the deal still lost without the decider, and without a date it slips
    const deal = w.deal || {};
    const known = (id) => deal[id] && deal[id].a === "known";
    if (later && !known("decider")) add("high", "We have not heard from who decides: the proof can be won and the deal still lost.");
    // a tender: a mandatory requirement not met can exclude the bid; the deadline for questions is the last chance to fix it
    if (w.rfp && w.rfp.reqs.length && !notBidding(w)) {
      const t = rfpState(null, w, today);
      const dl = t.deadlines;
      if (t.must_no.length) add("high", `${t.must_no.length} mandatory requirement${t.must_no.length === 1 ? " of the tender is" : "s of the tender are"} not met: ask whether an equivalent is accepted, or decide not to bid.`);
      if (dl.questions_in != null && dl.questions_in >= 0 && dl.questions_in <= 7 && t.must_no.length + t.clarify.length) add("high", `Questions to the contracting authority are due ${dl.questions_in === 0 ? "today" : `in ${dl.questions_in} day${dl.questions_in === 1 ? "" : "s"}`}, with ${t.must_no.length + t.clarify.length} requirement${t.must_no.length + t.clarify.length === 1 ? "" : "s"} to raise.`);
      if (dl.due_in != null && dl.due_in >= 0 && dl.due_in <= 10 && t.open + t.check) add("high", `The bid is due ${dl.due_in === 0 ? "today" : `in ${dl.due_in} day${dl.due_in === 1 ? "" : "s"}`} with ${t.open + t.check} requirement${t.open + t.check === 1 ? "" : "s"} still open or to check.`);
    }
    // what else they weigh: doing nothing without a date is the usual way a deal is lost to no one
    const alts = w.alts || [];
    if (alts.includes("wait") && !known("why_now")) add("high", "They are weighing doing nothing, and no date makes this urgent: find the date that cannot move, or agree when to talk again.");
    else if ((stage === "journey" || later) && !known("why_now")) add("watch", "No date makes this urgent: ask what happens if nothing is decided this year.");
    if (later && alts.some((a) => a !== "wait") && !known("alternatives")) add("watch", "They weigh other options and we do not know how we compare: ask what each would have to show.");
  }
  const touched = [w && w.updated_on, p && p.updated_on].filter(Boolean).sort().pop();
  if (touched && days(touched, today) > 21) add("watch", `Not touched for ${days(touched, today)} days.`);
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));
}

export function pipeline(workshops, povs, catalog, today) {
  const by = new Map();
  const slot = (name) => { if (!by.has(name)) by.set(name, { customer: name, workshops: [], povs: [] }); return by.get(name); };
  for (const w of workshops || []) slot(w.customer).workshops.push(w);
  for (const p of povs || []) slot(p.customer).povs.push(p);
  const out = [];
  for (const o of by.values()) {
    const w = [...o.workshops].sort((a, b) => cmp(b.updated_on, a.updated_on))[0] || null;
    const p = [...o.povs].sort((a, b) => cmp(b.updated_on, a.updated_on))[0] || null;
    const res = w && catalog ? assess(catalog, w) : null;
    const j = w && res ? journey(catalog, w, res) : null;
    const plan = datedPlan(j);
    const pr = p ? progress(p) : null;
    let stage = "discovery";
    if (res && res.land) stage = "journey";
    if (p && (p.stage === "planned" || p.stage === "running")) stage = "proof";
    if (p && p.stage === "done") stage = "decision";
    // closed: stopped, or with its outcome recorded (won, lost, no decision); either way off the live pipeline
    const outcome = p && p.outcome ? p.outcome.result : "";
    const stopped = !!(p && (p.stage === "stopped" || outcome));
    const overdue = plan.filter((c) => c.by < today);
    const upcoming = plan.filter((c) => c.by >= today);
    // the next thing to do, in the order a presales engineer would look: what is late, what the proof needs, what is next
    let next = "";
    if (overdue.length) next = `Late since ${overdue[0].by}: ${overdue[0].need}`;
    else if (stage === "proof" && p.end) next = `Proof of value ends ${p.end}${pr.open ? `: ${pr.open} criteria not yet tried` : ""}`;
    else if (stage === "proof") next = "Agree the dates of the proof of value";
    else if (upcoming.length) next = `By ${upcoming[0].by}: ${upcoming[0].need}`;
    else if (stage === "decision") next = `Hand over the result: ${pr.verdict}`;
    else if (w && res && (stage === "journey" || stage === "discovery")) {
      // what moves this prospect on, from the way forward: the first thing still to do in the phase it is in
      const fw = forward(catalog, w, p, today);
      const ph = fw.phases.find((x) => x.id === fw.now);
      const c = ph.checks.find((x) => !x.ok);
      next = c ? `${ph.label}: ${c.fix}` : stage === "journey" ? "Start the proof of value, or give the conditions an owner and a date" : res.waiting || "Ask the next questions";
    }
    // the deal around the technical work: who sells it with us, how far it is qualified, which phase it is in
    const reg = w ? registrationOf(w.channel, today) : null;
    const ds = w ? dealState(w.deal) : null;
    const fwd = w && catalog && !stopped ? forward(catalog, w, p, today) : null;
    out.push({
      customer: o.customer, stage, stopped, outcome, workshop: w ? w.id : null, pov: p ? p.id : null,
      partner: reg ? reg.lead.name : "", partner_kind: reg ? reg.lead.kind : "", route: w && w.channel && w.channel.route ? w.channel.route : "",
      registration: reg && reg.status !== "none" ? { status: reg.status, until: reg.until, days: reg.days } : null,
      qualified: ds && ds.answered ? ds.verdict : "", qualified_gate: ds ? ds.passed : "",
      phase: fwd ? PHASES.find((ph) => ph.id === fwd.now).label : "",
      updated_on: [w && w.updated_on, p && p.updated_on].filter(Boolean).sort().pop() || "",
      coverage: res ? res.coverage : 0, answered: res ? res.answered : 0, total: res ? res.total : 0,
      land: res && res.land ? res.land.label : "", unknowns: res ? res.unknowns.length : 0,
      need: j ? j.need : 0, done: j ? j.done : 0, stakes: j ? j.stakes.map((x) => x.text) : [],
      inventory: w && w.inventory ? { vms: w.inventory.vms, clusters: w.inventory.clusters.length } : null,
      pov_verdict: pr ? pr.verdict : "", pov_met: pr ? pr.met : 0, pov_total: pr ? pr.total : 0,
      pov_end: p ? p.end || "" : "", pov_days_left: p && p.end ? days(today, p.end) : null,
      overdue: overdue.length, next, example: isExampleId(w && w.id) || isExampleId(p && p.id), demo: demoOf(w),
      // the first sketches worked out with the customer's figures, on the lines in scope
      sketched: w ? (w.scope || []).filter((x) => SKETCH_OF[x] && w[SKETCH_OF[x][0]]).map((x) => SKETCH_OF[x][1]) : [],
      risks: stopped ? [] : risksOf({ w, p, res, pr, stage, overdue: overdue.length, today }),
      evidence: evidenceOf({ w, p, res, plan, pr, overdue: overdue.length }),
    });
  }
  // furthest along first, then the most recently touched
  return out.sort((a, b) => Number(a.stopped) - Number(b.stopped) || STAGE_INDEX[b.stage] - STAGE_INDEX[a.stage] || cmp(b.updated_on, a.updated_on) || cmp(a.customer, b.customer));
}

/** How many opportunities stand at each stage, stopped ones apart. */
export function funnel(opps) {
  const live = opps.filter((o) => !o.stopped);
  return { stages: STAGES.map((s) => ({ ...s, count: live.filter((o) => o.stage === s.id).length })), stopped: opps.filter((o) => o.stopped && !o.outcome).length,
    won: opps.filter((o) => o.outcome === "won").length, lost: opps.filter((o) => o.outcome === "lost").length, none: opps.filter((o) => o.outcome === "none").length };
}

/** What is due in the next `span` days, and what is already late: dated conditions, and the start and end of each proof. */
export function agenda(workshops, povs, catalog, today, span = 14) {
  const horizon = new Date(Date.parse(today + "T00:00:00Z") + span * 86400000).toISOString().slice(0, 10);
  const items = [];
  for (const w of workshops || []) {
    const j = journey(catalog, w, assess(catalog, w));
    for (const c of datedPlan(j)) {
      if (c.by <= horizon) items.push({ on: c.by, customer: w.customer, what: c.need, kind: "condition", who: c.who || "", late: c.by < today, workshop: w.id });
    }
  }
  // a partner's deal registration that runs out: on live deals only, from the newest workshop of each prospect
  const closed = new Set((povs || []).filter((p) => p.stage === "stopped" || p.outcome).map((p) => p.customer));
  const newest = new Map();
  for (const w of workshops || []) { const had = newest.get(w.customer); if (!had || w.updated_on > had.updated_on) newest.set(w.customer, w); }
  for (const w of newest.values()) {
    const reg = registrationOf(w.channel, today);
    if (!reg || reg.status === "none" || closed.has(w.customer) || reg.until > horizon) continue;
    items.push({ on: reg.until, customer: w.customer, what: `${reg.lead.name}'s deal registration ${reg.until < today ? "ran out" : "runs out"}`, kind: "registration", who: "", late: reg.until < today, workshop: w.id });
  }
  // a tender's deadlines: questions to the contracting authority, and the bid itself
  for (const w of newest.values()) {
    if (!w.rfp || closed.has(w.customer) || notBidding(w)) continue;
    const name = w.rfp.title ? `"${w.rfp.title}"` : "the tender";
    if (w.rfp.questions_due && w.rfp.questions_due >= today && w.rfp.questions_due <= horizon) items.push({ on: w.rfp.questions_due, customer: w.customer, what: `Questions on ${name} due to the contracting authority`, kind: "tender", who: "", late: false, workshop: w.id });
    if (w.rfp.due && w.rfp.due <= horizon && w.rfp.due >= shiftDay(today, -3)) items.push({ on: w.rfp.due, customer: w.customer, what: w.rfp.due < today ? `Bid for ${name} was due` : `Bid for ${name} due`, kind: "tender", who: "", late: w.rfp.due < today, workshop: w.id });
  }
  for (const p of povs || []) {
    if (p.stage === "done" || p.stage === "stopped") continue;
    if (p.start && p.start >= today && p.start <= horizon) items.push({ on: p.start, customer: p.customer, what: "Proof of value starts", kind: "pov", late: false });
    if (p.end && p.end <= horizon) items.push({ on: p.end, customer: p.customer, what: p.end < today ? "Proof of value was due to end" : "Proof of value ends", kind: "pov", late: p.end < today });
  }
  return items.sort((a, b) => Number(b.late) - Number(a.late) || cmp(a.on, b.on) || cmp(a.customer, b.customer));
}

/** The note for the account team, Monday morning: where each opportunity stands, what is next, what is at risk. */
export function weeklyMarkdown(opps, items, today) {
  const f = funnel(opps);
  const out = [`# Presales update, ${today}`, "", f.stages.map((s) => `${s.label}: ${s.count}`).join(". ") + "." + (f.won + f.lost + f.none ? ` Closed: won ${f.won}, lost ${f.lost}, no decision ${f.none}.` : "") + (f.stopped ? ` Stopped: ${f.stopped}.` : ""), ""];
  const late = items.filter((i) => i.late);
  if (late.length) {
    out.push("## Late", "");
    for (const i of late) out.push(`- **${i.customer}**: ${i.what} (since ${i.on})`);
    out.push("");
  }
  const soon = items.filter((i) => !i.late);
  if (soon.length) {
    out.push("## Next two weeks", "");
    for (const i of soon) out.push(`- ${i.on}, **${i.customer}**: ${i.what}${i.who ? ` (owner: ${i.who})` : ""}`);
    out.push("");
  }
  const risky = opps.filter((o) => !o.stopped && o.risks.some((r) => r.level === "high"));
  if (risky.length) {
    out.push("## What could stop a deal", "");
    for (const o of risky) for (const r of o.risks.filter((x) => x.level === "high")) out.push(`- **${o.customer}**: ${r.text}`);
    out.push("");
  }
  for (const s of STAGES) {
    const list = opps.filter((o) => o.stage === s.id && !o.stopped);
    if (!list.length) continue;
    out.push(`## ${s.label}`, "");
    for (const o of list) {
      const bits = [o.land ? `start with ${o.land.toLowerCase()}` : "", o.stakes.length ? `at stake ${o.stakes.join(", ")}` : "",
        o.demo && (o.demo.on || o.demo.shown) ? `demo ${o.demo.on ? `given ${o.demo.on}` : "run"}${o.demo.shown ? `, ${o.demo.landed} of ${o.demo.shown} parts landed${o.demo.missed ? `, ${o.demo.missed} did not` : ""}` : ""}` : "",
        o.sketched && o.sketched.length ? `first sketches for ${andList(o.sketched)}` : "",
        o.pov_total ? `proof ${o.pov_met} of ${o.pov_total} criteria met` : "", o.unknowns ? `${o.unknowns} question${o.unknowns === 1 ? "" : "s"} nobody could answer` : "",
        o.evidence ? `evidence of a technical win ${o.evidence.score}/100` : "", o.partner ? `with ${o.partner}` : "", o.qualified ? o.qualified.toLowerCase() : ""].filter(Boolean);
      out.push(`- **${o.customer}**${bits.length ? `: ${bits.join("; ")}` : ""}. Next: ${o.next || "nothing planned"}.`);
    }
    out.push("");
  }
  const closed = opps.filter((o) => o.outcome);
  if (closed.length) out.push("## Closed", "", ...closed.map((o) => `- ${o.customer}: ${OUTCOME_WORDS[o.outcome]}`), "");
  const stopped = opps.filter((o) => o.stopped && !o.outcome);
  if (stopped.length) out.push("## Stopped", "", ...stopped.map((o) => `- ${o.customer}`), "");
  out.push("_From Beyond 90: workshops and proofs of value kept in this browser._", "");
  return out.join("\n");
}

const csvCell = (v) => { const t = String(v == null ? "" : v); const safe = /^[=+\-@\t\r]/.test(t) ? "'" + t : t; return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

/** The pipeline as a sheet, for a CRM import or a forecast call. Cells that a spreadsheet would run as formulas are defused. */
export function pipelineCsv(opps) {
  const head = ["customer", "stage", "start_with", "answered", "questions", "at_stake", "unknowns", "conditions_to_make_true", "already_true", "proof_met", "proof_criteria", "proof_ends", "next", "risks", "evidence", "updated_on",
    "partner", "partner_kind", "route_to_purchase", "registration_until", "qualification", "phase"];
  const rows = opps.map((o) => [o.customer, o.outcome ? OUTCOME_WORDS[o.outcome].toLowerCase() : o.stopped ? "stopped" : o.stage, o.land, o.answered, o.total, o.stakes.join("; "), o.unknowns, o.need, o.done, o.pov_met, o.pov_total, o.pov_end, o.next, (o.risks || []).map((r) => r.text).join(" "), o.evidence ? o.evidence.score : "", o.updated_on,
    o.partner || "", o.partner_kind ? KINDS[o.partner_kind].toLowerCase() : "", o.route ? ROUTES[o.route].toLowerCase() : "", o.registration ? o.registration.until : "", o.qualified || "", o.phase || ""]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}


// ------------------------------------------------------------------ an invented desk, for showing the method in a minute

const shiftDay = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const isExampleId = (id) => /\|example\d$/.test(id || "");

/**
 * Four invented prospects at four stages, dated around today so the agenda has something late and something due:
 * one still listening, one with a journey agreed, one in a proof of value, one with a result handed over.
 */
export function exampleDesk(today) {
  const ago = (n) => shiftDay(today, -n);
  // in proof of value: the filled-in example workshop, started ten days ago, with dates on two of its conditions
  let kestrel = exampleWorkshop(ago(10));
  kestrel = setPlan(kestrel, "dr-backup", 2, "together", ago(2), ago(10));
  kestrel = setPlan(kestrel, "dr-backup", 4, "us", shiftDay(today, 6), ago(10));
  let kpov = makePov({ customer: kestrel.customer, createdOn: ago(5), nonce: "example5", start: ago(3), end: shiftDay(today, 11),
    problem: "Recovery is planned on paper but has never been tested, and an administrator account can delete the backups",
    criteria: [{ text: "A test failover of a business application meets the agreed recovery time and point", target: "Run the plan in test mode and record time and data lost" },
      { text: "Systems are restored from a copy the attacker's admin account could not delete", target: "Try to delete the copies with an admin account, then restore" },
      { text: "A missed recovery point reaches a named owner within minutes", target: "Pause replication for one machine and watch who is told" }] });
  kpov = editPov(kpov, { stage: "running", sponsor: "Head of infrastructure (mock)", champion: "Backup lead (mock)" }, ago(3));
  kpov = setCriterion(kpov, "c3", { status: "met", evidence: "Alert reached the on-call owner in 4 minutes" }, ago(1));
  // journey agreed: a hybrid-cloud conversation, one condition already late
  let valle = makeWorkshop({ customer: "Valle Health (mock)", scope: ["hybrid-cloud", "dr-backup", "hci"], createdOn: ago(14), nonce: "example2" });
  ["gap", "gap", "partly", "gap", "gap", "partly", "gap", "unknown"].forEach((a, i) => { valle = setAnswer(valle, "hybrid-cloud", i, a, i === 1 ? "Patient data must stay in Italy, and the auditors ask for proof" : "", ago(14)); });
  ["partly", "solved", "solved", "partly"].forEach((a, i) => { valle = setAnswer(valle, "dr-backup", i, a, "", ago(14)); });
  valle = setWorth(valle, "hybrid-cloud", 0, 900000, "year", ago(14));
  valle = setPlan(valle, "hybrid-cloud", 2, "customer", ago(4), ago(14));
  valle = setPlan(valle, "hybrid-cloud", 4, "together", shiftDay(today, 9), ago(14));
  valle = setRaised(valle, "hybrid-cloud", 1, true, ago(14));
  for (const [id, a, note] of [["why_change", "known", "The auditors found patient data copied outside Italy"], ["why_now", "known", "The audit follow-up is due in March"],
    ["outcome", "partly", "Prove where every copy lives, on demand"], ["proof", "partly", "A recovery test the auditors can watch"]]) valle = setDeal(valle, id, a, note, ago(14));
  // the same integrator as Kestrel, with a registration about to run out
  valle = setChannel(valle, { partners: [{ name: "Verdi Sistemi (mock)", kind: "integrator", lead: true, reg: { on: ago(80), until: shiftDay(today, 6) }, skills: ["hci", "dr-backup"] }],
    route: "reseller", split: { discovery: "both", demo: "us", sizing: "p0", proof: "both", proposal: "p0", delivery: "p0", support: "p0" } }, ago(14));
  // a public tender for the recovery site, half answered: questions due in four days, the bid in fifteen
  valle = { ...valle, rfp: withRequirements(null, parseRequirements(EXAMPLE_TENDER), [...valle.scope, ...Object.keys(KEYWORDS).filter((k) => !valle.scope.includes(k))]) };
  valle = setRfpMeta(valle, { title: "Recovery site and data platform (mock)", issuer: "public", questions_due: shiftDay(today, 4), due: shiftDay(today, 15), pages: 30 }, ago(10));
  for (const [id, patch] of [["r1", { a: "yes", note: "Three nodes a site, two copies of every block: one node can fail" }], ["r2", { a: "yes", note: "Included, with live migration" }],
    ["r3", { a: "yes", note: "One node at a time, from the console" }], ["r5", { a: "yes", note: "Tier 1 every 15 minutes, tier 2 hourly, to the second site" }],
    ["r6", { a: "partly", note: "Immutable copies for 30 days on the backup target; administrators cannot shorten it" }], ["r7", { a: "check", who: "specialist" }],
    ["r9", { a: "no", note: "Object lock on a separate appliance" }], ["r11", { who: "partner" }], ["r16", { a: "yes", note: "Every copy and the management plane stay in Italy" }]]) {
    valle = setRequirement(valle, id, patch, ago(10));
  }
  // the bid review, half done: known to the customer, terms fine, the references still to find
  for (const [id, a] of [["standing", "yes"], ["known", "partly"], ["fair", "yes"], ["value", "yes"], ["terms", "yes"]]) valle = setBidAnswer(valle, id, a, ago(10));
  // still listening: a first meeting about AI on their own infrastructure
  let orsa = makeWorkshop({ customer: "Orsa Manufacturing (mock)", scope: ["private-ai", "kubernetes-platform", "object-storage"], createdOn: ago(1), nonce: "example3" });
  ["gap", "unknown"].forEach((a, i) => { orsa = setAnswer(orsa, "private-ai", i, a, i === 0 ? "Quality inspection on the line, with images that cannot leave the plant" : "", ago(1)); });
  orsa = setRaised(orsa, "private-ai", 0, true, ago(1));
  orsa = setDeal(orsa, "why_change", "partly", "Defects found late cost a shift of rework", ago(1));
  // brought by a service provider that would run it as a service; nothing registered yet
  orsa = setChannel(orsa, { partners: [{ name: "Lago Cloud (mock)", kind: "service_provider", lead: true, skills: ["kubernetes-platform", "object-storage"] }], route: "service",
    split: { discovery: "both", delivery: "p0", support: "p0" } }, ago(1));
  // decision: a proof of value finished, the result with the customer
  let pietra = makePov({ customer: "Pietra Bank (mock)", createdOn: ago(40), nonce: "example4", start: ago(30), end: ago(9),
    criteria: [{ text: "A representative application group is migrated within its window", target: "Time it end to end" },
      { text: "A rollback completes within the agreed time", target: "Fail a cutover on purpose and roll back" }] });
  pietra = setCriterion(pietra, "c1", { status: "met", evidence: "Back in service in 3 h 10 min, window 4 h" }, ago(12));
  pietra = setCriterion(pietra, "c2", { status: "met", evidence: "Rolled back in 38 minutes" }, ago(10));
  pietra = editPov(pietra, { stage: "done", summary: "Both criteria met; the migration plan goes to the steering committee." }, ago(8));
  // decided: one won on a migration, one lost on price; what the desk learns from across deals
  let brina = makeWorkshop({ customer: "Brina Retail (mock)", scope: ["platform-migration", "hci", "dr-backup"], createdOn: ago(95), nonce: "example6" });
  ["gap", "gap", "partly", "gap", "unknown", "gap"].forEach((a, i) => { brina = setAnswer(brina, "platform-migration", i, a, "", ago(95)); });
  ["gap", "partly", "gap"].forEach((a, i) => { brina = setAnswer(brina, "dr-backup", i, a, "", ago(95)); });
  brina = setRaised(setRaised(brina, "platform-migration", 0, true, ago(95)), "hci", 2, true, ago(95));
  for (const [id, a] of [["why_change", "known"], ["why_now", "known"], ["outcome", "known"], ["decider", "known"], ["criteria", "known"], ["process", "known"], ["paper", "partly"], ["proof", "known"], ["champion", "known"], ["alternatives", "known"]]) brina = setDeal(brina, id, a, "", ago(60));
  brina = setAlt(setAlt(brina, "renew", true, ago(95)), "three_tier", true, ago(95));
  brina = setChannel(brina, { partners: [{ name: "Verdi Sistemi (mock)", kind: "integrator", lead: true, reg: { on: ago(100), until: ago(10) }, skills: ["platform-migration", "hci", "dr-backup"] }],
    route: "reseller", split: { discovery: "both", proof: "both", delivery: "p0" } }, ago(95));
  let bpov = makePov({ customer: brina.customer, createdOn: ago(70), nonce: "example6", start: ago(60), end: ago(40),
    criteria: [{ text: "A representative application group is migrated within its window", target: "Time it end to end" },
      { text: "A rollback completes within the agreed time", target: "Fail a cutover on purpose and roll back" },
      { text: "Test machines run with their disks still on the existing array, at the agreed performance", target: "Compare with the baseline" }] });
  for (const [id, ev] of [["c1", "Back in service in 2 h 40 min, window 4 h"], ["c2", "Rolled back in 31 minutes"], ["c3", "Within 5% of the baseline"]]) bpov = setCriterion(bpov, id, { status: "met", evidence: ev }, ago(42));
  bpov = setOutcome(editPov(bpov, { stage: "done", sponsor: "IT director (mock)", summary: "All three criteria met; the existing arrays stay until their support ends." }, ago(40)), { result: "won", reason: "technical", note: "Keeping the arrays made the move affordable this year", on: ago(25) }, ago(25));
  let ardesia = makeWorkshop({ customer: "Ardesia Logistics (mock)", scope: ["dr-backup", "hybrid-cloud"], createdOn: ago(120), nonce: "example7" });
  ["gap", "gap", "gap", "unknown", "gap"].forEach((a, i) => { ardesia = setAnswer(ardesia, "dr-backup", i, a, "", ago(120)); });
  ["gap", "partly", "unknown"].forEach((a, i) => { ardesia = setAnswer(ardesia, "hybrid-cloud", i, a, "", ago(120)); });
  ardesia = setRaised(setRaised(ardesia, "dr-backup", 1, true, ago(120)), "hybrid-cloud", 1, true, ago(120));
  // lost on price: the budget holder was never met, and nobody knew how the options would be compared
  for (const [id, a] of [["why_change", "known"], ["why_now", "partly"], ["outcome", "known"], ["decider", "unknown"], ["criteria", "unknown"], ["paper", "unknown"], ["proof", "known"], ["champion", "partly"], ["alternatives", "partly"]]) ardesia = setDeal(ardesia, id, a, "", ago(100));
  ardesia = setAlt(ardesia, "public_cloud", true, ago(120));
  ardesia = setChannel(ardesia, { partners: [{ name: "Lago Cloud (mock)", kind: "service_provider", lead: true, reg: { on: ago(125), until: ago(35) }, skills: ["hybrid-cloud"] }],
    route: "service", split: { discovery: "us", proof: "p0", delivery: "p0" } }, ago(120));
  let apov = makePov({ customer: ardesia.customer, createdOn: ago(100), nonce: "example7", start: ago(90), end: ago(75),
    criteria: [{ text: "A business application recovers in the cloud within the agreed time", target: "Run the recovery plan in test mode" },
      { text: "A copy an administrator cannot delete is restored", target: "Try to delete, then restore" }] });
  apov = setCriterion(setCriterion(apov, "c1", { status: "not_met", evidence: "Recovered in 3 h, target 1 h: the cloud cluster took too long to grow" }, ago(76)), "c2", { status: "met", evidence: "Delete refused; restore in 40 minutes" }, ago(76));
  apov = setOutcome(editPov(apov, { stage: "done", sponsor: "COO (mock)", summary: "One criterion met, one not: recovery in the cloud was too slow." }, ago(75)), { result: "lost", reason: "price", note: "A standing second site cost more than the budget for this year", on: ago(60) }, ago(60));
  return { workshops: [kestrel, valle, orsa, brina, ardesia], povs: [kpov, pietra, bpov, apov] };
}

/**
 * The partners across every deal on the desk: for each, the live deals and their stages, the ones it leads, the
 * steps it owns, registrations running out, what was won and lost with it, and the lines it is asked to deliver
 * without the skills. What a presales engineer brings to the review with the partner or the channel manager.
 */
export function partnerReview(workshops, povs, catalog, today) {
  const opps = pipeline(workshops, povs, catalog, today);
  const byCustomer = new Map(opps.map((o) => [o.customer, o]));
  const latest = new Map();
  for (const w of workshops || []) { const had = latest.get(w.customer); if (!had || w.updated_on > had.updated_on) latest.set(w.customer, w); }
  const out = new Map();
  for (const w of latest.values()) {
    if (!w.channel) continue;
    const o = byCustomer.get(w.customer);
    const st = catalog ? channelState(catalog, w, today) : null;
    w.channel.partners.forEach((p, i) => {
      const key = p.name.trim().toLowerCase();
      if (!out.has(key)) out.set(key, { name: p.name, kinds: new Set(), deals: [], won: 0, lost: 0, expiring: [], lines: new Set(), example: true });
      const x = out.get(key);
      x.kinds.add(KINDS[p.kind]);
      x.example = x.example && !!(o && o.example);
      const lead = st ? st.lead === p : !!p.lead;
      const owns = ACTIVITIES.filter((a) => (w.channel.split || {})[a.id] === `p${i}` || ((w.channel.split || {})[a.id] === "both" && lead)).map((a) => a.label.toLowerCase());
      const outcome = o ? o.outcome : "";
      if (outcome === "won") x.won++;
      else if (outcome === "lost") x.lost++;
      const live = !(o && o.stopped);
      if (live) x.deals.push({ customer: w.customer, stage: o ? o.stage : "discovery", lead, owns });
      if (lead && live) {
        const reg = registrationOf(w.channel, today);
        if (reg && (reg.status === "expired" || reg.status === "expiring")) x.expiring.push({ customer: w.customer, until: reg.until, status: reg.status, days: reg.days });
        if (reg && reg.status === "none" && p.kind !== "distributor") x.expiring.push({ customer: w.customer, until: "", status: "none", days: null });
      }
      if (st && live) for (const g of st.gaps) if (g.partner === p.name) g.lines.forEach((l) => x.lines.add(l));
    });
  }
  return [...out.values()].map((x) => ({ ...x, kinds: [...x.kinds], lines: [...x.lines] }))
    .sort((a, b) => b.deals.length - a.deals.length || b.expiring.length - a.expiring.length || a.name.localeCompare(b.name));
}

/** The partner review as text: one section per partner, for the meeting with them or with the channel manager. */
export function partnerReviewMarkdown(list, today) {
  const out = [`# Partner review, ${today}`, ""];
  if (!list.length) return out.concat(["No partner on any deal yet.", ""]).join("\n");
  for (const x of list) {
    out.push(`## ${x.name}`, "", `${x.kinds.join(", ")}. ${x.deals.length} live deal${x.deals.length === 1 ? "" : "s"}, ${x.deals.filter((d) => d.lead).length} led by them; won ${x.won}, lost ${x.lost}.`, "");
    for (const d of x.deals) out.push(`- ${d.customer}: ${d.stage}${d.lead ? ", they lead" : ""}${d.owns.length ? `; they own ${d.owns.join(", ")}` : ""}`);
    if (x.deals.length) out.push("");
    if (x.expiring.length) out.push("Registrations to act on:", "", ...x.expiring.map((e) => `- ${e.customer}: ${e.status === "none" ? "not registered" : e.status === "expired" ? `ran out on ${e.until}` : `runs out on ${e.until}`}`), "");
    if (x.lines.length) out.push(`Skills to line up: ${x.lines.join(", ")}.`, "");
  }
  out.push("_Prepared with Beyond 90. It names your customers and every partner: share each partner's section only with that partner._", "");
  return out.join("\n");
}
