import test from "node:test";
import assert from "node:assert/strict";
import { weakest, headline } from "../today.js";

const stages = { L1: { value: 0.95 }, L2: { value: 0.8 }, L3: { value: 0.9 }, L4: { value: 0.99 } };

test("the weakest stage is the lowest one that has a value", () => {
  assert.deepEqual(weakest(stages), { stage: "L2", name: "Inventoried", value: 0.8 });
  assert.equal(weakest({}), null);
  assert.equal(weakest(null), null);
  assert.equal(weakest({ L1: { value: null }, L2: { value: NaN }, L3: { value: 0.5 } }).stage, "L3");
});

test("the headline says the gap, the stage, and nothing it cannot support", () => {
  const t = headline({ customer: "Acme", yield: 0.726, target: 0.9, stages });
  assert.match(t, /Acme is at 72\.6%, 17\.4 points short of its 90% target/);
  assert.match(t, /inventoried \(L2\), at 80\.0%/);
  assert.ok(!/week|day/.test(t), "no date is promised");
});

test("above target, without data, and with nothing to do", () => {
  assert.match(headline({ customer: "Acme", yield: 0.93, target: 0.9, stages }), /above its 90% target/);
  assert.match(headline({ customer: "Acme", yield: null, target: 0.9, stages }), /not enough data/);
  assert.match(headline({ customer: "Acme", yield: 0.8, target: 0.9, stages: {}, openActions: 0 }), /Nothing is waiting/);
  assert.match(headline({ customer: "Acme", yield: 0.8, target: 0, stages }), /90% target/);
});

import { firstMinute } from "../today.js";
test("the first minute has three steps and points at actions only when there are some", () => {
  const a = firstMinute(4), b = firstMinute(0);
  assert.equal(a.length, 3);
  assert.equal(a[1].to, "actions");
  assert.match(a[1].text, /4 actions/);
  assert.equal(b[1].to, "overview");
  assert.ok(a.every((s) => s.id && s.text));
});

import { rankActions, chainText } from "../today.js";
test("quick wins rank by points per hour, effect ranks as the engine does", () => {
  const acts = [{ id: "big", effect: 4, hours: 10 }, { id: "quick", effect: 1, hours: 0.5 }, { id: "mid", effect: 2, hours: 2 }];
  assert.deepEqual(rankActions(acts, "effect").map((a) => a.id), ["big", "quick", "mid"]);
  assert.deepEqual(rankActions(acts, "quick").map((a) => a.id), ["quick", "mid", "big"]);
  assert.deepEqual(rankActions(undefined), []);
});
test("the chain writes the multiplication out", () => {
  assert.equal(chainText([{ value: 0.9 }, { value: 0.5 }], 0.45), "90% × 50% = 45%");
  assert.equal(chainText([], 0), "");
});
