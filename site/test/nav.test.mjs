import test from "node:test";
import assert from "node:assert/strict";
import { navBadges, stageBars, togglePin, pinnedViews, MAX_PINS } from "../nav.js";

const score = {
  terms: { units: "accounts" },
  stages: { L1: { value: 0.9, numerator: 109, denominator: 121 }, L2: { value: 0.97 }, L3: { value: 0.92 }, L4: { value: 0.89 } },
  relationship: { reliability: { overdue_open: [{}, {}] } },
};
const dash = { actions: new Array(41), findings: { states: { unowned: 13, no_decision: 8, ok: 200, in_window: 9 } }, burndown: { open: { critical: 11 } }, onboarding: { stalled: [] } };

test("badges count only what waits, with a tone", () => {
  const b = navBadges({ score, dash });
  assert.deepEqual(Object.keys(b).sort(), ["accounts", "actions", "burndown", "commitments", "findings"]);
  assert.equal(b.findings.n, 21);
  assert.equal(b.accounts.n, 12);
  assert.equal(b.burndown.tone, "bad");
  assert.match(b.commitments.label, /2 promises overdue/);
});
test("no data, no badges", () => { assert.deepEqual(navBadges({}), {}); });
test("stage bars mark the weakest stage", () => {
  const s = stageBars(score);
  assert.deepEqual(s.map((r) => r.id), ["L1", "L2", "L3", "L4"]);
  assert.deepEqual(s.filter((r) => r.weakest).map((r) => r.id), ["L4"]);
});
test("pins toggle and keep a limit", () => {
  assert.deepEqual(togglePin(["a"], "b"), ["a", "b"]);
  assert.deepEqual(togglePin(["a", "b"], "a"), ["b"]);
  const many = Array.from({ length: MAX_PINS }, (_, i) => `v${i}`);
  assert.equal(togglePin(many, "new").length, MAX_PINS);
  assert.equal(togglePin(many, "new").at(-1), "new");
  assert.deepEqual(togglePin("junk", "a"), ["a"]);
});
test("pinned views keep their order and drop unknown ids", () => {
  const groups = [{ views: [{ id: "a" }, { id: "b" }] }, { views: [{ id: "c" }] }];
  assert.deepEqual(pinnedViews(["c", "x", "a"], groups).map((v) => v.id), ["c", "a"]);
});
