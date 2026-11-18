// The presales desk: every prospect in one place, from the first discovery meeting to the decision.
//
// A pre-sales engineer carries many opportunities at once, each at a different point: still listening, a journey agreed,
// a proof of value running, a decision due. This module reads the workshops and proofs of value kept in this browser and
// answers the questions of a Monday morning: where is each one, what is due this week, what is late, and what do I tell
// the account team. Pure functions over plain records; the page and the tests share them.

import { assess, journey, datedPlan, exampleWorkshop, makeWorkshop, setAnswer, setPlan, setWorth } from "./workshop.js";
import { hasCase } from "./valuecase.js";
import { progress, makePov, setCriterion, edit as editPov } from "./pov.js";

export const STAGES = [
  { id: "discovery", label: "Discovery", hint: "Still listening: not enough answers to say where to start." },
  { id: "journey", label: "Journey agreed", hint: "We know where to start and what would need to be true." },
  { id: "proof", label: "Proof of value", hint: "A proof of value is planned or running." },
  { id: "decision", label: "Decision", hint: "The proof is done: the result is with the customer." },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/** One opportunity per customer name: its newest workshop and newest proof of value, read together. */
/**
 * What could stop this deal, read from what is already recorded; each says what to do. "high" first: it can lose the deal
 * on its own. Nothing is guessed: no figure, no sponsor or no date counts only where the stage needs one.
 */
export function risksOf({ w, p, res, pr, stage, overdue, today }) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
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
    if (res.unknowns.length >= 3) add("watch", `${res.unknowns.length} questions nobody could answer: book the people who can.`);
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
    const stopped = !!(p && p.stage === "stopped");
    const overdue = plan.filter((c) => c.by < today);
    const upcoming = plan.filter((c) => c.by >= today);
    // the next thing to do, in the order a presales engineer would look: what is late, what the proof needs, what is next
    let next = "";
    if (overdue.length) next = `Late since ${overdue[0].by}: ${overdue[0].need}`;
    else if (stage === "proof" && p.end) next = `Proof of value ends ${p.end}${pr.open ? `: ${pr.open} criteria not yet tried` : ""}`;
    else if (stage === "proof") next = "Agree the dates of the proof of value";
    else if (upcoming.length) next = `By ${upcoming[0].by}: ${upcoming[0].need}`;
    else if (stage === "decision") next = `Hand over the result: ${pr.verdict}`;
    else if (stage === "journey") next = "Start the proof of value, or give the conditions an owner and a date";
    else if (res) next = res.waiting || "Ask the next questions";
    out.push({
      customer: o.customer, stage, stopped, workshop: w ? w.id : null, pov: p ? p.id : null,
      updated_on: [w && w.updated_on, p && p.updated_on].filter(Boolean).sort().pop() || "",
      coverage: res ? res.coverage : 0, answered: res ? res.answered : 0, total: res ? res.total : 0,
      land: res && res.land ? res.land.label : "", unknowns: res ? res.unknowns.length : 0,
      need: j ? j.need : 0, done: j ? j.done : 0, stakes: j ? j.stakes.map((x) => x.text) : [],
      inventory: w && w.inventory ? { vms: w.inventory.vms, clusters: w.inventory.clusters.length } : null,
      pov_verdict: pr ? pr.verdict : "", pov_met: pr ? pr.met : 0, pov_total: pr ? pr.total : 0,
      pov_end: p ? p.end || "" : "", pov_days_left: p && p.end ? days(today, p.end) : null,
      overdue: overdue.length, next, example: isExampleId(w && w.id) || isExampleId(p && p.id),
      risks: stopped ? [] : risksOf({ w, p, res, pr, stage, overdue: overdue.length, today }),
    });
  }
  // furthest along first, then the most recently touched
  return out.sort((a, b) => Number(a.stopped) - Number(b.stopped) || STAGE_INDEX[b.stage] - STAGE_INDEX[a.stage] || cmp(b.updated_on, a.updated_on) || cmp(a.customer, b.customer));
}

/** How many opportunities stand at each stage, stopped ones apart. */
export function funnel(opps) {
  const live = opps.filter((o) => !o.stopped);
  return { stages: STAGES.map((s) => ({ ...s, count: live.filter((o) => o.stage === s.id).length })), stopped: opps.length - live.length };
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
  const out = [`# Presales update, ${today}`, "", f.stages.map((s) => `${s.label}: ${s.count}`).join(". ") + "." + (f.stopped ? ` Stopped: ${f.stopped}.` : ""), ""];
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
        o.pov_total ? `proof ${o.pov_met} of ${o.pov_total} criteria met` : "", o.unknowns ? `${o.unknowns} question${o.unknowns === 1 ? "" : "s"} nobody could answer` : ""].filter(Boolean);
      out.push(`- **${o.customer}**${bits.length ? `: ${bits.join("; ")}` : ""}. Next: ${o.next || "nothing planned"}.`);
    }
    out.push("");
  }
  const stopped = opps.filter((o) => o.stopped);
  if (stopped.length) out.push("## Stopped", "", ...stopped.map((o) => `- ${o.customer}`), "");
  out.push("_From Beyond 90: workshops and proofs of value kept in this browser._", "");
  return out.join("\n");
}

const csvCell = (v) => { const t = String(v == null ? "" : v); const safe = /^[=+\-@\t\r]/.test(t) ? "'" + t : t; return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };

/** The pipeline as a sheet, for a CRM import or a forecast call. Cells that a spreadsheet would run as formulas are defused. */
export function pipelineCsv(opps) {
  const head = ["customer", "stage", "start_with", "answered", "questions", "at_stake", "unknowns", "conditions_to_make_true", "already_true", "proof_met", "proof_criteria", "proof_ends", "next", "risks", "updated_on"];
  const rows = opps.map((o) => [o.customer, o.stopped ? "stopped" : o.stage, o.land, o.answered, o.total, o.stakes.join("; "), o.unknowns, o.need, o.done, o.pov_met, o.pov_total, o.pov_end, o.next, (o.risks || []).map((r) => r.text).join(" "), o.updated_on]);
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
  // still listening: a first meeting about AI on their own infrastructure
  let orsa = makeWorkshop({ customer: "Orsa Manufacturing (mock)", scope: ["private-ai", "kubernetes-platform", "object-storage"], createdOn: ago(1), nonce: "example3" });
  ["gap", "unknown"].forEach((a, i) => { orsa = setAnswer(orsa, "private-ai", i, a, i === 0 ? "Quality inspection on the line, with images that cannot leave the plant" : "", ago(1)); });
  // decision: a proof of value finished, the result with the customer
  let pietra = makePov({ customer: "Pietra Bank (mock)", createdOn: ago(40), nonce: "example4", start: ago(30), end: ago(9),
    criteria: [{ text: "A representative application group is migrated within its window", target: "Time it end to end" },
      { text: "A rollback completes within the agreed time", target: "Fail a cutover on purpose and roll back" }] });
  pietra = setCriterion(pietra, "c1", { status: "met", evidence: "Back in service in 3 h 10 min, window 4 h" }, ago(12));
  pietra = setCriterion(pietra, "c2", { status: "met", evidence: "Rolled back in 38 minutes" }, ago(10));
  pietra = editPov(pietra, { stage: "done", summary: "Both criteria met; the migration plan goes to the steering committee." }, ago(8));
  return { workshops: [kestrel, valle, orsa], povs: [kpov, pietra] };
}
