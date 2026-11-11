import test from "node:test";
import assert from "node:assert/strict";
import { validSla, applySla, preset, PRESETS } from "../sla.js";

const D = { critical: 3, high: 14, medium: 30, low: 90 };

test("only sensible target ages are accepted", () => {
  assert.ok(validSla(D));
  for (const bad of [null, {}, { ...D, high: 2 }, { ...D, low: 0 }, { ...D, critical: 1.5 }, { ...D, low: 731 }, { ...D, medium: "30" }]) assert.ok(!validSla(bad));
  assert.ok(PRESETS.every((p) => validSla(p.days)));
  assert.equal(preset(PRESETS[1].days), "strict");
  assert.equal(preset(D), "strict");
  assert.equal(preset({ critical: 5, high: 20, medium: 40, low: 100 }), "custom");
});

test("the table is added, and replaced when it is already there", () => {
  const base = '[customer]\nname = "A"\n\n[settings]\nentitlement_target = 0.8\n';
  const once = applySla(base, D);
  assert.match(once, /\[settings\.sla_days\]\ncritical = 3\nhigh = 14\nmedium = 30\nlow = 90\n$/);
  assert.match(once, /entitlement_target = 0.8/);
  const twice = applySla(once, { critical: 7, high: 30, medium: 90, low: 180 });
  assert.equal((twice.match(/\[settings\.sla_days\]/g) || []).length, 1);
  assert.match(twice, /critical = 7/); assert.doesNotMatch(twice, /critical = 3/);
});

test("a table in the middle is removed without taking its neighbours, and an inline table goes too", () => {
  const t = '[settings]\nsla_days = { critical = 9 }\nx = 1\n\n[settings.sla_days]\ncritical = 7\nhigh = 30\n\n[other]\nk = 2\n';
  const r = applySla(t, D);
  assert.match(r, /\[other\]\nk = 2/); assert.match(r, /x = 1/); assert.doesNotMatch(r, /critical = 9|critical = 7/);
  assert.equal((r.match(/critical =/g) || []).length, 1);
});

test("a bad value is refused and the text is untouched by it", () => {
  assert.throws(() => applySla("[customer]\n", { ...D, critical: 0 }));
  assert.match(applySla("", D), /^\n?\[settings\.sla_days\]|^\n\[settings\.sla_days\]/);
});
