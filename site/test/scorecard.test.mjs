import test from "node:test";
import assert from "node:assert/strict";
import { scorecard, matches, shortFingerprint } from "../scorecard.js";

const result = { customer: "Acme", as_of: "2026-11-01", yield: 0.726, level: "Bronze", input_hash: "ab12cd34ef56ab78cd90ef12ab34cd56ef78ab90cd12ef34ab56cd78ef90ab12" };
const score = { stages: { L1: { value: 0.9 }, L2: { value: 0.8 }, L3: { value: 0.7 }, L4: { value: 0.6 } } };
const bd = { open: { critical: 2, high: 5, medium: 0, low: 0 }, past_sla_total: 3, sla_days: { critical: 7, high: 30, medium: 90, low: 180 }, sla_is_default: true,
  zero_critical: { now: false, never_had: false }, focus: { raw: 40, matter: 7, share: 0.175, rule: "Open critical and high findings, and open medium findings older than their target age." }, closure: { window_days: 180, raised: 10, closed: 6, tracks_verification: false, verified: null, reopened: null } };

test("the scorecard carries the numbers, the fingerprint and what it does not prove", () => {
  const t = scorecard({ result, score, burndown: bd, today: "2026-11-11", engine: "0.36.0" });
  assert.match(t, /# Posture scorecard: Acme/); assert.match(t, /Yield 72\.6%/); assert.match(t, /\| Decided \| 60\.0% \|/);
  assert.match(t, /2 critical finding\(s\) open; 5 high open/); assert.match(t, /the default values/);
  assert.match(t, /does not record whether a later scan confirmed/); assert.match(t, /ab12cd34ef56ab78/); assert.doesNotMatch(t, /ab12cd34ef56ab78cd90/);
  assert.match(t, /not an audit/); assert.match(t, /does not show that the files are complete or true/);
});

test("verification is reported only when the customer records it; zero criticals read plainly", () => {
  const withV = { ...bd, closure: { ...bd.closure, tracks_verification: true, verified: 4, reopened: 1 }, sla_is_default: false, zero_critical: { now: true, never_had: false, days: 12 } };
  const t = scorecard({ result, score, burndown: withV, today: "2026-11-11" });
  assert.match(t, /confirmed fixed by a later scan: 4; came back: 1/); assert.match(t, /zero critical findings open for 12 days/); assert.match(t, /set for this customer/);
  assert.match(scorecard({ result: { ...result, input_hash: "" }, score, burndown: null, today: "2026-11-11" }), /No input fingerprint/);
});

test("a pasted fingerprint matches only the data it came from", () => {
  const fp = shortFingerprint(result.input_hash);
  assert.ok(matches(fp, result.input_hash)); assert.ok(matches("Fingerprint: " + fp.toUpperCase(), result.input_hash));
  assert.ok(!matches("ab12cd34ef56ab79", result.input_hash)); assert.ok(!matches("ab12", result.input_hash)); assert.ok(!matches("", result.input_hash)); assert.ok(!matches(fp, ""));
});

test("the scorecard states the focus counts and the rule behind them", () => {
  const t = scorecard({ result, score, burndown: bd, today: "2026-11-11" });
  assert.match(t, /40 finding\(s\) open, 7 that need a decision now/);
  assert.ok(!/finding\(s\) open, undefined/.test(scorecard({ result, score, burndown: { ...bd, focus: undefined }, today: "2026-11-11" })));
});
