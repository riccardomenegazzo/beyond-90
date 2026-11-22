import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pipeline, funnel, agenda, weeklyMarkdown, pipelineCsv, STAGES } from "../desk.js";
import { makeWorkshop, setAnswer, setPlan, setWorth, exampleWorkshop, setDemo, setDemoSeen } from "../workshop.js";
import { makePov, setWindow, edit as editPov } from "../pov.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-18";
const ws = (customer, nonce, answers = {}) => {
  let w = makeWorkshop({ customer, scope: ["dr-backup", "hci"], createdOn: "2026-11-02", nonce });
  for (const [p, list] of Object.entries(answers)) list.forEach((a, i) => { if (a) w = setAnswer(w, p, i, a, "", "2026-11-02"); });
  return w;
};
const DR = ["gap", "solved", "gap", "partly", "gap", "unknown", "gap", "unknown"];

test("each prospect is placed at its stage, furthest along first", () => {
  const listening = ws("Alder (mock)", "aaa111", { "dr-backup": ["gap"] });
  const agreed = ws("Birch (mock)", "bbb222", { "dr-backup": DR });
  const proving = ws("Cedar (mock)", "ccc333", { "dr-backup": DR });
  const pov = setWindow(makePov({ customer: "Cedar (mock)", createdOn: "2026-11-05", nonce: "ddd444" }), "2026-11-10", "2026-11-28", "2026-11-05");
  const opps = pipeline([listening, agreed, proving], [pov], CAT, D);
  assert.deepEqual(opps.map((o) => [o.customer, o.stage]), [["Cedar (mock)", "proof"], ["Birch (mock)", "journey"], ["Alder (mock)", "discovery"]]);
  assert.match(opps[0].next, /Proof of value ends 2026-11-28/);
  assert.equal(opps[0].pov_days_left, 10);
  assert.equal(opps[1].land, "Disaster recovery and backup");
  assert.match(opps[2].next, /at least 3/);
  const f = funnel(opps);
  assert.deepEqual(f.stages.map((s) => s.count), [1, 1, 1, 0]);
  assert.equal(STAGES.length, 4);
});

test("a finished proof is a decision, a stopped one is set apart, and a proof without a workshop still counts", () => {
  const done = editPov(makePov({ customer: "Dune (mock)", createdOn: "2026-11-01", nonce: "eee555" }), { stage: "done" }, "2026-11-12");
  const stopped = editPov(makePov({ customer: "Elm (mock)", createdOn: "2026-11-01", nonce: "fff666" }), { stage: "stopped" }, "2026-11-12");
  const opps = pipeline([], [done, stopped], CAT, D);
  assert.equal(opps.find((o) => o.customer === "Dune (mock)").stage, "decision");
  assert.equal(opps.find((o) => o.customer === "Elm (mock)").stopped, true);
  assert.equal(opps[opps.length - 1].customer, "Elm (mock)", "stopped ones go last");
  assert.equal(opps[0].workshop, null);
  assert.equal(funnel(opps).stopped, 1);
});

test("the agenda puts what is late first, then the next two weeks; nothing further out", () => {
  let w = ws("Birch (mock)", "bbb222", { "dr-backup": DR });
  w = setPlan(w, "dr-backup", 2, "together", "2026-11-12", "2026-11-02");       // late
  w = setPlan(w, "dr-backup", 4, "us", "2026-11-25", "2026-11-02");             // in two weeks
  w = setPlan(w, "dr-backup", 6, "customer", "2026-12-30", "2026-11-02");       // too far
  const pov = setWindow(makePov({ customer: "Birch (mock)", createdOn: "2026-11-05", nonce: "ggg777" }), "2026-11-20", "2026-12-20", "2026-11-05");
  const items = agenda([w], [pov], CAT, D);
  assert.deepEqual(items.map((i) => [i.on, i.late]), [["2026-11-12", true], ["2026-11-20", false], ["2026-11-25", false]]);
  const opp = pipeline([w], [], CAT, D)[0];
  assert.equal(opp.overdue, 1);
  assert.match(opp.next, /^Late since 2026-11-12/);
});

test("the weekly update and the pipeline sheet say where each stands, and a sheet cannot run a formula", () => {
  let w = ws("=HYPERLINK(\"http://x\") (mock)", "hhh888", { "dr-backup": DR });
  w = setWorth(w, "dr-backup", 0, 2000000, "day", "2026-11-02");
  w = setPlan(w, "dr-backup", 2, "together", "2026-11-12", "2026-11-02");
  const opps = pipeline([w], [], CAT, D);
  const md = weeklyMarkdown(opps, agenda([w], [], CAT, D), D);
  assert.match(md, /^# Presales update, 2026-11-18/);
  assert.match(md, /Discovery: 0\. Journey agreed: 1\./);
  assert.match(md, /## Late/);
  assert.match(md, /at stake 2,000,000 per day/);
  assert.doesNotMatch(md, /first sketches/, "no sketch worked out yet");
  const withSketches = pipeline([{ ...w, dr: { data_tib: 40 }, obj: { data_tib: 40 } }], [], CAT, D);
  assert.deepEqual(withSketches[0].sketched, ["recovery"], "only the lines in scope count");
  assert.match(weeklyMarkdown(withSketches, [], D), /first sketches for recovery/);
  const sized2 = pipeline([{ ...w, scope: [...w.scope, "hci"], sizing: { growth_pct: 30 } }], [], CAT, D);
  assert.ok(sized2[0].sketched.includes("the servers"), "the sizing sketch counts once worked out with their figures");
  const csv = pipelineCsv(opps);
  assert.ok(csv.startsWith("customer,stage,start_with,"));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"") (mock)"`), "a leading = is defused and quotes are doubled");
  assert.ok(csv.endsWith("\r\n"));
});

test("an empty browser makes an empty desk, not an error", () => {
  assert.deepEqual(pipeline([], [], CAT, D), []);
  assert.deepEqual(agenda([], [], CAT, D), []);
  assert.match(weeklyMarkdown([], [], D), /Discovery: 0/);
});

test("the invented desk is valid prospects at every stage and two decided, dated around today, all marked as examples", async () => {
  const { exampleDesk, isExampleId } = await import("../desk.js");
  const { validWorkshop } = await import("../workshop.js");
  const { validPov } = await import("../pov.js");
  const ex = exampleDesk(D);
  assert.ok(ex.workshops.every(validWorkshop) && ex.povs.every(validPov));
  assert.ok([...ex.workshops, ...ex.povs].every((x) => isExampleId(x.id) && /\(mock\)$/.test(x.customer)));
  const opps = pipeline(ex.workshops, ex.povs, CAT, D);
  const byName = Object.fromEntries(opps.map((o) => [o.customer, o]));
  assert.equal(byName["Kestrel Logistics (mock)"].stage, "proof");
  assert.equal(byName["Pietra Bank (mock)"].stage, "decision");
  assert.ok(opps.every((o) => o.example));
  assert.equal(byName["Brina Retail (mock)"].outcome, "won");
  assert.equal(byName["Ardesia Logistics (mock)"].outcome, "lost");
  assert.ok(byName["Ardesia Logistics (mock)"].stopped && byName["Ardesia Logistics (mock)"].risks.length === 0, "a decided deal is off the live pipeline");
  const f = funnel(opps);
  assert.equal(f.won, 1);
  assert.equal(f.lost, 1);
  const items = agenda(ex.workshops, ex.povs, CAT, D);
  assert.ok(items.some((i) => i.late) && items.some((i) => !i.late), "something late and something due");
});

import { risksOf } from "../desk.js";

test("what could stop a deal is read from what is recorded, the risks that can lose it first", () => {
  const today = "2026-11-20";
  const pov = { sponsor: "", end: "2026-11-24", start: "2026-11-10", stage: "running", criteria: [{ text: "A", status: "met" }, { text: "B", status: "open" }], readiness: [{ done: false }], updated_on: today };
  const pr = { open: 1, ready: 0, ready_total: 1, verdict: "in progress", not_met: 0 };
  const w = { answers: {}, updated_on: today };
  const res = { raised: [{ prove: "Something not in the proof" }], unknowns: [{}, {}, {}] };
  const r = risksOf({ w, p: pov, res, pr, stage: "proof", overdue: 2, today });
  const text = r.map((x) => x.text).join(" | ");
  assert.equal(r[0].level, "high");
  assert.match(text, /2 agreed conditions are late/);
  assert.match(text, /No sponsor named/);
  assert.match(text, /ends in 4 days with 1 criterion not yet tried/);
  assert.match(text, /1 concern the customer raised is not in the proof of value/);
  assert.match(text, /first-day checklist/);
  assert.match(text, /Nothing is at stake/);
  assert.match(text, /Finance has no case for change/);
  assert.match(text, /3 questions nobody could answer/);
  assert.match(text, /We have not heard from who decides/);
  assert.match(text, /No date makes this urgent/);
  const deal = { decider: { a: "known", note: "", on: today }, why_now: { a: "known", note: "", on: today } };
  const calm = risksOf({ w: { answers: { "x#1": { a: "gap", note: "", amount: 5, per: "day" } }, updated_on: today, case: { stay_run: 1, move_run: 1 }, deal },
    p: { ...pov, sponsor: "Dana", end: "2026-12-30", criteria: [{ text: "Something not in the proof", status: "open" }], readiness: [] }, res: { raised: [{ prove: "Something not in the proof" }], unknowns: [] },
    pr: { ...pr, ready_total: 0 }, stage: "proof", overdue: 0, today });
  assert.deepEqual(calm, []);
  assert.match(risksOf({ w: { answers: {}, updated_on: "2026-10-01" }, p: null, res: { raised: [], unknowns: [] }, pr: null, stage: "discovery", overdue: 0, today }).map((x) => x.text).join(), /Not touched for 50 days/);
  // at the proof, a line with a first sketch that was never worked out with their figures
  const sized = (scope, more = {}, stage = "proof") => risksOf({ w: { answers: {}, updated_on: today, scope, ...more }, p: null, res: { raised: [], unknowns: [] }, pr: null, stage, overdue: 0, today })
    .map((x) => x.text).filter((t) => t.startsWith("No first sketch"));
  assert.deepEqual(sized(["euc", "dbaas", "hci"]), ["No first sketch worked out with their figures for virtual desktops, database licences and the servers: do it before the results go to finance."]);
  assert.deepEqual(sized(["euc", "dbaas"], { vdi: { users: 900 } }), ["No first sketch worked out with their figures for database licences: do it before the results go to finance."]);
  assert.deepEqual(sized(["euc"], {}, "discovery"), [], "in discovery it is too early to ask");
  // the servers and the move: the sizing and the plan in waves, from the inventory
  assert.deepEqual(sized(["hci", "platform-migration"]), ["No first sketch worked out with their figures for the servers and the move: do it before the results go to finance."]);
  assert.deepEqual(sized(["hci", "platform-migration"], { sizing: { growth_pct: 30 }, waves: { per_wave: 40 } }), []);
  assert.deepEqual(sized(["cnapp"]), [], "lines without a sketch of their own");
});

import { evidenceOf } from "../desk.js";

test("the evidence of a technical win is a checklist out of 100, with what would raise it", () => {
  const none = evidenceOf({ w: null, p: null, res: null, plan: [], pr: null, overdue: 0 });
  assert.equal(none.score, 0);
  assert.equal(none.missing.length, 9);
  const w = { answers: { "x#0": { a: "gap", note: "", amount: 5, per: "day" } }, case: { stay_run: 100, move_run: 80 } };
  const res = { land: { label: "X" }, raised: [{ prove: "Prove A" }] };
  const p = { sponsor: "Dana", criteria: [{ text: "Prove A", status: "met" }, { text: "B", status: "met" }, { text: "C", status: "open" }, { text: "D", status: "open" }] };
  const pr = { total: 4, met: 2 };
  const e = evidenceOf({ w, p, res, plan: [{ by: "2026-12-01" }], pr, overdue: 0 });
  assert.equal(e.score, 88, "half the criteria met counts half of 25: 87.5, rounded");
  assert.deepEqual(e.missing, ["Success criteria met: 2 of 4"]);
  const late = evidenceOf({ w, p, res, plan: [{ by: "2026-10-01" }], pr, overdue: 1 });
  assert.ok(late.missing.includes("No agreed condition is late"));
  assert.equal(late.score, e.score - 10);
});

test("the next step of a prospect without dates comes from the way forward", async () => {
  const { makeWorkshop, setAnswer, setDeal } = await import("../workshop.js");
  const day = "2026-11-19";
  let w = makeWorkshop({ customer: "Tessera (mock)", scope: ["dr-backup"], createdOn: day, nonce: "abcdef" });
  ["gap", "gap", "gap", "partly"].forEach((a, i) => { w = setAnswer(w, "dr-backup", i, a, "", day); });
  let [o] = pipeline([w], [], CAT, day);
  assert.equal(o.stage, "journey");
  assert.match(o.next, /^Discovery: /);
  for (const id of ["why_change", "outcome", "proof"]) w = setDeal(w, id, "partly", "", day);
  [o] = pipeline([w], [], CAT, day);
  assert.match(o.next, /^Demo built for them: Plan it from what they said/);
});

test("the partner review gathers each partner across the desk: deals, registrations to act on, wins and skills", async () => {
  const { exampleDesk, partnerReview, partnerReviewMarkdown } = await import("../desk.js");
  const day = "2026-11-19";
  const ex = exampleDesk(day);
  const list = partnerReview(ex.workshops, ex.povs, CAT, day);
  const verdi = list.find((x) => x.name === "Verdi Sistemi (mock)");
  const lago = list.find((x) => x.name === "Lago Cloud (mock)");
  assert.ok(verdi && lago);
  assert.equal(verdi.deals.length, 2, "Kestrel and Valle are live; Brina is won and off the live list");
  assert.equal(verdi.won, 1);
  assert.equal(lago.lost, 1);
  assert.ok(verdi.expiring.some((e) => e.customer === "Valle Health (mock)" && e.status === "expiring"));
  assert.ok(lago.expiring.some((e) => e.customer === "Orsa Manufacturing (mock)" && e.status === "none"));
  assert.ok(list.every((x) => x.example));
  const md = partnerReviewMarkdown(list, day);
  assert.match(md, /^# Partner review, 2026-11-19/);
  assert.match(md, /## Verdi Sistemi \(mock\)\n\nSystems integrator\. 2 live deals, 2 led by them; won 1, lost 0\./);
  assert.match(md, /Valle Health \(mock\): runs out on /);
  const opps = pipeline(ex.workshops, ex.povs, CAT, day);
  const valle = opps.find((o) => o.customer === "Valle Health (mock)");
  assert.ok(valle.risks.some((r) => r.level === "high" && /registration runs out in 6 days/.test(r.text)));
  assert.equal(partnerReviewMarkdown([], day).includes("No partner on any deal yet."), true);
});

test("each opportunity carries who it is sold with, how far it is qualified and its phase, in the note and the sheet", async () => {
  const { exampleDesk, agenda, weeklyMarkdown, pipelineCsv } = await import("../desk.js");
  const day = "2026-11-19";
  const ex = exampleDesk(day);
  const opps = pipeline(ex.workshops, ex.povs, CAT, day);
  const kestrel = opps.find((o) => o.customer === "Kestrel Logistics (mock)");
  assert.equal(kestrel.partner, "Verdi Sistemi (mock)");
  assert.equal(kestrel.partner_kind, "integrator");
  assert.equal(kestrel.route, "distribution");
  assert.equal(kestrel.qualified, "Ready for a demo built for them");
  assert.ok(kestrel.phase.length > 0);
  const brina = opps.find((o) => o.customer === "Brina Retail (mock)");
  assert.equal(brina.phase, "", "a decided deal has no phase left on the way");
  const items = agenda(ex.workshops, ex.povs, CAT, day);
  const reg = items.find((i) => i.kind === "registration");
  assert.ok(reg && reg.customer === "Valle Health (mock)" && /Verdi Sistemi \(mock\)'s deal registration runs out/.test(reg.what) && !reg.late);
  assert.ok(!items.some((i) => i.kind === "registration" && /Brina|Ardesia/.test(i.customer)), "registrations of decided deals are not on the agenda");
  const note = weeklyMarkdown(opps, items, day);
  assert.match(note, /with Verdi Sistemi \(mock\)/);
  assert.match(note, /deal registration runs out/);
  const csv = pipelineCsv(opps).split("\r\n");
  assert.match(csv[0], /,partner,partner_kind,route_to_purchase,registration_until,qualification,phase$/);
  const valleRow = csv.find((r) => r.startsWith("Valle Health (mock)"));
  assert.match(valleRow, /Verdi Sistemi \(mock\),systems integrator,through a reseller,2026-11-25,Keep discovering|Verdi Sistemi \(mock\),systems integrator,through a reseller,2026-11-25,Ready for a demo built for them/);
});

test("what the deals teach includes the qualification the deals not won left open, and the routes they took", async () => {
  const { exampleDesk } = await import("../desk.js");
  const { dealFacts, lessons, lessonsMarkdown } = await import("../lessons.js");
  const ex = exampleDesk("2026-11-19");
  const l = lessons(dealFacts(ex.workshops, ex.povs, CAT), { includeExamples: true });
  assert.equal(l.not_established.of, 1);
  assert.ok(l.not_established.tags.some((t) => t.tag === "Economic buyer" && t.count === 1));
  assert.deepEqual(l.routes.map((r) => [r.key, r.won, r.count]).sort(), [["reseller", 1, 1], ["service", 0, 1]]);
  const md = lessonsMarkdown(l);
  assert.match(md, /## What the deals not won had not established\n\n- /);
  assert.match(md, /Through a reseller: 1 won of 1/);
  assert.match(md, /Led by a systems integrator: 1 won of 1/);
});

test("the desk knows how the demo went: in the Monday note, and as a risk while parts did not land and no proof is planned", () => {
  let w = exampleWorkshop(D);
  w = setDemoSeen(w, "dr-backup#2", "landed", "", D);
  w = setDemoSeen(w, "dr-backup#4", "missed", "We have that", D);
  w = setDemoSeen(w, "dr-backup#6", "skipped", "", D);
  w = setDemo(w, D, D);
  const [o] = pipeline([w], [], CAT, D);
  assert.deepEqual(o.demo, { on: D, shown: 2, landed: 1, missed: 1, questions: 0 });
  assert.ok(o.risks.some((r) => r.level === "watch" && /^1 part of the demo did not land/.test(r.text)), JSON.stringify(o.risks));
  assert.match(weeklyMarkdown([o], [], D), new RegExp(`demo given ${D}, 1 of 2 parts landed, 1 did not`));
  assert.doesNotMatch(weeklyMarkdown([o], [], D), /We have that/, "what was said stays out of the note");
  const pov = makePov({ customer: w.customer, createdOn: D, nonce: "abcdef" });
  const [withProof] = pipeline([w], [pov], CAT, D);
  assert.ok(!withProof.risks.some((r) => /did not land/.test(r.text)), "once a proof is planned, the proof carries it");
  assert.equal(pipeline([exampleWorkshop(D)], [], CAT, D)[0].demo, null);
});
