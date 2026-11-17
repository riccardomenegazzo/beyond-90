import test from "node:test";
import assert from "node:assert/strict";
import { nextStep } from "../next.js";

const score = { terms: { units: "clusters" }, end_to_end: { total: 12, through: 3, first_break: { L1: 1, L2: 0, L3: 6, L4: 2 } }, relationship: { reliability: { overdue_open: [] } } };
const dash = { actions: [{ id: "a4", leak: "L4", title: "Own findings", effect: 4, unlocks: 0 }, { id: "a3", leak: "L3", title: "Turn on snapshots", effect: 2.1, unlocks: 9 }, { id: "a1", leak: "L1", title: "Connect 1 cluster", effect: 2, unlocks: 0 }],
  findings: { states: { unowned: 3 } } };

test("each suggestion comes from the data and says where it goes", () => {
  const o = nextStep("overview", { dash, score });
  assert.equal(o.open, "stop:L3"); assert.match(o.text, /Most clusters stop first at L3 \(6 of 12\)/);
  assert.equal(nextStep("accounts", { dash, score }).open, "a1");
  assert.match(nextStep("accounts", { dash, score }).text, /\+2\.0 pts/);
  assert.equal(nextStep("findings", { dash, score }).open, "a4");
  assert.equal(nextStep("onboarding", { dash, score }).open, "stop:L1");
  assert.equal(nextStep("actions", { dash, score }).go, "prep");
});
test("what you owe comes first when a promise is late, and done actions are skipped", () => {
  const late = { ...score, relationship: { reliability: { overdue_open: [{}, {}] } } };
  assert.equal(nextStep("prep", { dash, score: late }).go, "commitments");
  assert.match(nextStep("prep", { dash, score: late }).text, /2 promises are past/);
  assert.equal(nextStep("accounts", { dash, score, done: new Set(["a1"]) }).open, "a3");
});
test("no data or an unknown view gives nothing", () => {
  assert.equal(nextStep("today", { dash, score }), null);
  assert.equal(nextStep("overview", {}), null);
  assert.equal(nextStep("findings", { dash: { ...dash, findings: { states: {} } }, score }), null);
});

import { answers } from "../next.js";
test("the search box answers from the data, with words to find them by", () => {
  const late = { ...score, relationship: { reliability: { overdue_open: [{}] } } };
  const a = answers({ dash: { ...dash, burndown: { open: { critical: 1 } } }, score: late });
  const labels = a.map((x) => x.label);
  assert.ok(labels.includes("6 clusters stop at L3 switched on"));
  assert.ok(labels.includes("1 promise is overdue"));
  assert.ok(labels.includes("1 critical finding is open"));
  assert.ok(labels.includes("3 findings past triage need an owner or a decision"));
  assert.equal(a.find((x) => x.label.startsWith("6 clusters")).open, "stop:L3");
  assert.equal(a.filter((x) => x.label.startsWith("Action:")).length, 3);
  assert.deepEqual(answers({}), []);
});
