import test from "node:test";
import assert from "node:assert/strict";
import { accountsFirst, accountsAnswer, whyAccount, findingsFirst, findingsAnswer, whyFinding } from "../triage.js";

const T = { unit: "account", units: "accounts" };
const row = (o) => ({ id: "a", connected: true, issues: 0, open_critical: 0, owner: "x", ...o });

test("unconnected units come first, then critical findings, then gaps", () => {
  const rows = [row({ id: "gaps", issues: 4 }), row({ id: "crit", open_critical: 1 }), row({ id: "off", connected: false }), row({ id: "fine" })];
  assert.deepEqual(accountsFirst(rows).map((r) => r.id), ["off", "crit", "gaps"]);
});
test("a healthy estate gets no worklist", () => { assert.deepEqual(accountsFirst([row({}), row({ id: "b" })]), []); });
test("answers are plain, singular and plural", () => {
  assert.match(accountsAnswer([row({ connected: false })], T).lead, /^1 of 1 account are not connected/);
  assert.match(accountsAnswer([row({}), row({ id: "b" })], T).lead, /^All 2 accounts are connected/);
  assert.match(accountsAnswer([], T).lead, /No accounts/);
  assert.equal(whyAccount(row({ connected: false })), "not connected, so it counts against L1");
});
test("findings: worst severity, then no owner, then oldest", () => {
  const rows = [
    { id: "f1", severity: "high", state: "unowned", age_days: 10 },
    { id: "f2", severity: "critical", state: "no_decision", age_days: 5 },
    { id: "f3", severity: "critical", state: "unowned", age_days: 2 },
    { id: "f4", severity: "critical", state: "ok", age_days: 99 },
    { id: "f5", severity: "critical", state: "unowned", age_days: 40 },
  ];
  assert.deepEqual(findingsFirst(rows).map((r) => r.id), ["f5", "f3", "f2"]);
  assert.match(whyFinding(rows[2]), /critical, 2 days old: has no owner/);
});
test("findings answer counts only what needs a person", () => {
  assert.match(findingsAnswer({ total: 10, states: { unowned: 2, ok: 8 } }).lead, /^2 of 10 findings/);
  assert.match(findingsAnswer({ total: 4, states: { ok: 4 } }).lead, /^All 4/);
  assert.match(findingsAnswer({ total: 0, states: {} }).lead, /No open finding/);
});
