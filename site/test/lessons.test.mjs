import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dealFacts, lessons, lessonsMarkdown } from "../lessons.js";
import { exampleDesk } from "../desk.js";
import { makePov, setOutcome, validPov, setCriterion, edit } from "../pov.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-18";

test("the outcome of a deal is kept with its proof of value, checked, and can be cleared", () => {
  let p = makePov({ customer: "Acme (mock)", createdOn: "2026-10-01", criteria: [{ text: "A", target: "" }] });
  p = setOutcome(p, { result: "lost", reason: "price", note: "Over budget", on: "2026-11-02" }, "2026-11-03");
  assert.equal(validPov(p), true);
  assert.deepEqual(p.outcome, { result: "lost", reason: "price", note: "Over budget", on: "2026-11-02" });
  assert.throws(() => setOutcome(p, { result: "maybe" }, "2026-11-03"));
  assert.throws(() => setOutcome(p, { result: "won", on: "2026-09-01" }, "2026-11-03"), /from the start/);
  for (const bad of [{ result: "won", reason: "luck", note: "", on: "2026-11-02" }, { result: "won", reason: "", note: "x".repeat(301), on: "2026-11-02" }, { result: "won", reason: "", note: "", on: "2026-11-02", extra: 1 }, "won"]) {
    assert.equal(validPov({ ...p, outcome: bad }), false, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal("outcome" in setOutcome(p, null, "2026-11-04"), false);
});

test("the invented desk teaches something: outcomes and reasons, objections, gaps, tests not met, time per stage", () => {
  const ex = exampleDesk(D);
  const facts = dealFacts(ex.workshops, ex.povs, CAT);
  assert.ok(facts.every((f) => f.example));
  assert.equal(lessons(facts).deals, 0, "examples are left out once there are real prospects");
  const l = lessons(facts, { includeExamples: true });
  assert.equal(l.decided, 2);
  assert.equal(l.won, 1);
  assert.equal(l.lost, 1);
  assert.equal(l.win_rate, 50);
  assert.equal(l.reasons[0].key, "price");
  assert.ok(l.objections.length >= 3);
  assert.ok(l.objections.every((o) => o.says && o.line && o.count >= 1));
  assert.ok(l.gaps.length >= 3 && l.gaps[0].count >= l.gaps.at(-1).count);
  assert.ok(l.not_met.some((t) => /recovers in the cloud/.test(t.text)));
  assert.ok(l.proofs >= 2);
  assert.equal(typeof l.cycle.to_proof, "number");
  assert.equal(l.cycle.proof, 20, "the median of 15, 20 and 21 days");
  const md = lessonsMarkdown(l);
  assert.match(md, /^# What our deals teach/);
  assert.match(md, /Won 1, lost 1, no decision 0: 50% won\./);
  assert.match(md, /## What customers push back on/);
  assert.match(md, /When not won: price \(1\)/);
});

test("facts carry only what the lessons need: no notes, no figures", () => {
  const ex = exampleDesk(D);
  const json = JSON.stringify(dealFacts(ex.workshops, ex.povs, CAT));
  assert.doesNotMatch(json, /Patient data must stay in Italy/, "notes stay out");
  assert.doesNotMatch(json, /900000|2000000/, "figures stay out");
  assert.doesNotMatch(json, /Keeping the arrays made the move affordable/, "the outcome note stays with the proof");
});

test("a deal with nothing recorded yet adds nothing but itself", () => {
  const l = lessons([{ customer: "A", example: false, started_on: "", lines: [], land: "", raised: [], gaps: [], pov: null, outcome: null }]);
  assert.equal(l.deals, 1);
  assert.equal(l.win_rate, null);
  assert.deepEqual([l.cycle.to_proof, l.cycle.proof, l.cycle.to_decision], [null, null, null]);
  assert.match(lessonsMarkdown(l), /1 prospect; 0 decisions recorded\./);
});
