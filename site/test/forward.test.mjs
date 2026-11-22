import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHASES, forward, demoPlan, demoMarkdown, demoTime, DEMO_LENGTHS, demoAudience } from "../forward.js";
import { makeWorkshop, exampleWorkshop, setDemo, setDeal, setAnswer, setChannel, validWorkshop, assess } from "../workshop.js";
import { makePov, edit as editPov, setOutcome, setCriterion } from "../pov.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";

test("five phases, each with its purpose, how to run it and what to avoid", () => {
  assert.deepEqual(PHASES.map((p) => p.id), ["discover", "demo", "proof", "decision", "handover"]);
  for (const p of PHASES) assert.ok(p.goal && p.do.length >= 3 && p.avoid.length >= 1, p.id);
  assert.doesNotMatch(JSON.stringify(PHASES), /nutanix|vmware|broadcom/i);
});

test("a new workshop is at discovery, with what to settle first and no demo plan yet", () => {
  const w = makeWorkshop({ customer: "Acme (mock)", scope: ["hci"], createdOn: D, nonce: "abcdef" });
  const f = forward(CAT, w, null, D);
  assert.equal(f.now, "discover");
  assert.equal(f.phases[0].state, "now");
  assert.ok(f.phases.slice(1).every((p) => p.state === "later"));
  assert.ok(f.phases[0].checks.every((c) => !c.ok && c.fix));
  assert.match(f.phases[0].checks[1].text, /\(0 of \d+\)/);
  assert.equal(f.demo.ready, false);
  assert.equal(demoMarkdown(f.demo, w), "");
});

test("the example is ready for a demo: the plan opens with their words and the result, and leaves out what they have", () => {
  const w = exampleWorkshop(D);
  const f = forward(CAT, w, null, D);
  assert.equal(f.now, "demo");
  const p = f.demo;
  assert.ok(p.ready);
  assert.ok(p.situation.some((s) => /renewal triples the cost/i.test(s)), "the reason to change, in their words");
  assert.match(p.result, /four hours/);
  assert.ok(p.segments.length >= 1 && p.segments.length <= 4 && p.segments.every((s) => s.show));
  // the gaps come before what is only partly there
  const firstPartly = p.segments.findIndex((s) => s.status === "partly");
  if (firstPartly > 0) assert.ok(p.segments.slice(0, firstPartly).every((s) => s.status === "gap"));
  assert.ok(p.close.length >= 1);
  const md = demoMarkdown(p, w);
  assert.match(md, /^# Demo plan: Kestrel Logistics \(mock\)/);
  for (const h of ["Their situation, in their words", "The result first", "Agree what a proof would have to show"]) assert.ok(md.includes(h), h);
  assert.match(md, /fifteen minutes/);
});

test("the way forward follows the demo, the proof and the outcome, and says what a passed phase left open", () => {
  let w = exampleWorkshop(D);
  w = setDemo(w, D, D);
  assert.ok(validWorkshop(w));
  assert.throws(() => setDemo(w, "2020-01-01", D));
  assert.equal(validWorkshop({ ...w, demo: { on: D, extra: 1 } }), false);
  let f = forward(CAT, w, null, D);
  assert.equal(f.phases[1].checks[0].ok, true);
  assert.equal(f.now, "demo", "the demo is given, but the proof gate is not passed yet");
  let pov = makePov({ customer: w.customer, createdOn: D, nonce: "abcdef", start: "2026-12-01", end: "2026-12-19", criteria: [{ text: "Restore the order system in under four hours", target: "Timed" }] });
  f = forward(CAT, w, pov, D);
  assert.equal(f.now, "proof", "a planned proof moves the way forward on, even with the deal not fully qualified");
  assert.equal(f.phases[1].state, "open");
  const concern = f.phases[2].checks.find((c) => /concern/.test(c.text));
  assert.equal(concern.ok, false);
  assert.match(concern.fix, /Add as criteria: "/);
  pov = editPov(pov, { stage: "done", sponsor: "CIO (mock)" }, D);
  pov = setCriterion(pov, pov.criteria[0].id, { status: "met", evidence: "3h40" }, D);
  f = forward(CAT, w, pov, D);
  assert.equal(f.now, "decision");
  assert.equal(f.phases.find((p) => p.id === "decision").checks.find((c) => /decider/.test(c.text)).ok, false);
  w = setDeal(w, "decider", "known", "Met the CIO on the 3rd", D);
  pov = setOutcome(pov, { result: "won", reason: "technical", note: "", on: D }, D);
  f = forward(CAT, w, pov, D);
  assert.equal(f.now, "handover");
  assert.equal(f.closed, false);
  // won, but the integrator delivering it has no skills on two of the four lines: the handover is not done yet
  const deliver = f.phases[4].checks.find((c) => /Delivery has an owner/.test(c.text));
  assert.equal(f.phases[4].state, "now");
  assert.equal(deliver.ok, false);
  assert.equal(deliver.go, "wspartners");
  w = setChannel(w, { ...w.channel, partners: w.channel.partners.map((p) => (p.lead ? { ...p, skills: [...w.scope] } : p)) }, D);
  f = forward(CAT, w, pov, D);
  assert.equal(f.phases[4].state, "done");
  // with no partner on the deal, the partner checks are not asked at all
  assert.ok(forward(CAT, setChannel(w, null, D), pov, D).phases.every((ph) => ph.checks.every((c) => !/partner|Delivery has an owner/.test(c.text))));
  const lost = forward(CAT, w, setOutcome(pov, { result: "lost", reason: "price", note: "", on: D }, D), D);
  assert.equal(lost.closed, true);
  assert.equal(lost.now, "decision");
});

test("a demo plan without a qualified deal falls back on the line's message and still leaves out what is solved", () => {
  let w = makeWorkshop({ customer: "Acme (mock)", scope: ["dr-backup"], createdOn: D, nonce: "abcdef" });
  for (let i = 0; i < 8; i++) w = setAnswer(w, "dr-backup", i, i % 3 ? "gap" : "solved", i === 1 ? "A day down costs 2M" : "", D);
  const p = demoPlan(CAT, w, assess(CAT, w));
  assert.ok(p.ready && p.result.length > 20, p.result);
  assert.ok(p.skip.length >= 1, "what they have already is left out");
  assert.ok(p.situation.some((s) => /2M/.test(s)), JSON.stringify(p.situation));
});

test("the demo, timed: the minutes of each part from the length of the meeting, and what waits when it does not fit", () => {
  const p = demoPlan(CAT, exampleWorkshop(D));
  assert.deepEqual(DEMO_LENGTHS, [30, 45, 60]);
  assert.equal(p.segments.length, 4);
  assert.equal(p.concerns.length, 2);
  assert.deepEqual(demoTime(p, 45), { length: 45, situation: 2, result: 3, close: 5, concern: 3, each: 7, fit: 4, later: [], spare: 1 });
  assert.deepEqual([demoTime(p, 60).each, demoTime(p, 60).spare], [10, 4], "never more than ten minutes a part: the rest is for their questions");
  assert.deepEqual([demoTime(p, 30).each, demoTime(p, 30).fit], [3, 4]);
  const short = demoTime(p, 20);
  assert.equal(short.fit, 1);
  assert.deepEqual(short.later, p.segments.slice(1).map((s) => s.key), "the last gaps wait first");
  assert.equal(demoTime(p, 15).fit, 0);
  const md = demoMarkdown(p, exampleWorkshop(D), 20);
  assert.match(md, /A 20-minute meeting, with about 1 minutes? left|A 20-minute meeting\./);
  assert.match(md, /Only what closes their gaps \(about \d+ minutes each\)/);
  assert.match(md, /Not in 20 minutes: keep for the next meeting\n\n- /);
  assert.match(md, /The concerns they raised \(3 minutes each\)/);
});

test("the demo plan says who should be there: the executive sponsor, then the people each part is for", () => {
  const p = demoPlan(CAT, exampleWorkshop(D));
  const who = demoAudience(p);
  assert.equal(who[0], "the executive sponsor");
  assert.ok(who.includes("the architect") && who.includes("the security team"), who.join("; "));
  assert.equal(new Set(who).size, who.length);
  assert.match(demoMarkdown(p, exampleWorkshop(D)), /\nWho should be there: the executive sponsor, the architect, /);
  assert.deepEqual(demoAudience({ roles: [] }), ["the executive sponsor"]);
});
