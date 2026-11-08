import test from "node:test";
import assert from "node:assert/strict";
import { makeCommitment, validCommitment, acceptCommitments, mergeCommitments, withStatus, fromCall, ledger, MAX_COMMITMENTS } from "../commitments.js";

const make = (over = {}) => makeCommitment({ customer: "Northwind", what: "Send the findings with no owner", who: "me", due: "2026-11-10", source: "call", createdOn: "2026-11-01", nonce: "abc123", ...over });

test("a commitment has a stable identity and is valid", () => {
  const c = make();
  assert.equal(c.id, "Northwind|2026-11-01|abc123");
  assert.equal(c.status, "open");
  assert.ok(validCommitment(c));
});

test("what cannot be recorded is refused in words", () => {
  assert.throws(() => make({ customer: " " }), /no customer/);
  assert.throws(() => make({ what: "  " }), /what was promised/);
  assert.throws(() => make({ createdOn: "soon" }), /date it was made/);
  assert.throws(() => make({ due: "next week" }), /due date/);
  assert.throws(() => make({ source: "email" }), /call, ours or manual/);
  assert.throws(() => make({ nonce: "X!" }), /suffix/);
});

test("free text is cleaned and capped, and a random suffix is made when none is given", () => {
  const c = makeCommitment({ customer: "A", what: "a\u0000b\n\n" + "x".repeat(500), createdOn: "2026-11-01" });
  assert.ok(c.what.length <= 300 && !/[\u0000\n]/.test(c.what));
  assert.match(c.id, /^A\|2026-11-01\|[a-z0-9]{6}$/);
  assert.notEqual(makeCommitment({ customer: "A", what: "x", createdOn: "2026-11-01" }).id, makeCommitment({ customer: "A", what: "x", createdOn: "2026-11-01" }).id);
});

test("data from outside is refused unless it is exactly what this page writes", () => {
  const good = make();
  for (const bad of [null, [], "x", { ...good, status: "won" }, { ...good, due: "tomorrow" }, { ...good, id: "other" }, { ...good, closed_on: "2026-11-02" },
    { ...good, status: "done", closed_on: "" }, { ...good, updated_on: "2026-10-01" }, { ...good, what: "" }, { ...good, who: "x".repeat(101) }, { ...good, source: "x" }]) {
    assert.equal(validCommitment(bad), false);
  }
  const r = acceptCommitments([good, { nope: 1 }, "x"]);
  assert.deepEqual([r.ok.length, r.rejected], [1, 2]);
  assert.equal(acceptCommitments("x").ok.length, 0);
  assert.equal(acceptCommitments(new Array(MAX_COMMITMENTS + 5).fill(good)).ok.length, MAX_COMMITMENTS);
});

test("closing and reopening keep the dates honest", () => {
  const done = withStatus(make(), "done", "2026-11-05");
  assert.deepEqual([done.status, done.closed_on, done.updated_on], ["done", "2026-11-05", "2026-11-05"]);
  assert.ok(validCommitment(done));
  const again = withStatus(done, "open", "2026-11-06");
  assert.equal(again.closed_on, "");
  assert.ok(validCommitment(again));
  assert.throws(() => withStatus(make(), "lost", "2026-11-05"), /open, done or dropped/);
  assert.throws(() => withStatus(make(), "done", "2026-10-01"), /today/);
});

test("merging is a union where the later update wins, in any order", () => {
  const a = make(), b = withStatus(a, "done", "2026-11-05"), other = make({ what: "Another", nonce: "zzz999" });
  const one = mergeCommitments([a, other], [b]), two = mergeCommitments([b], [other, a]);
  assert.deepEqual(one, two);
  assert.equal(one.length, 2);
  assert.equal(one.find((c) => c.id === a.id).status, "done");
  assert.deepEqual(mergeCommitments(one, one), one);
});

test("a call turns into commitments, without repeating what is already open", () => {
  const existing = [make({ what: "Send the findings", nonce: "old111" })];
  const made = fromCall({ customer: "Northwind", date: "2026-11-02", existing,
    agreed: [{ what: "send the FINDINGS", who: "me", when: "2026-11-09" }, { what: "Book the platform lead", who: "Priya", when: "bad" }, { what: "  " }],
    ours: ["Share the playbook", "Share the playbook"] });
  assert.deepEqual(made.map((c) => [c.what, c.source, c.who, c.due]), [["Book the platform lead", "call", "Priya", ""], ["Share the playbook", "ours", "us", ""]]);
  assert.ok(made.every(validCommitment));
});

test("the ledger says what is late, what is due this week and what is open without a date", () => {
  const list = [
    make({ what: "late a", due: "2026-11-01", nonce: "aaaaaa" }), make({ what: "late b", due: "2026-10-20", nonce: "bbbbbb" }),
    make({ what: "soon", due: "2026-11-12", nonce: "cccccc" }), make({ what: "later", due: "2026-12-30", nonce: "dddddd" }),
    make({ what: "undated", due: "", nonce: "eeeeee" }), make({ customer: "Contoso", what: "ours", who: "us", due: "", source: "ours", nonce: "ffffff" }),
    withStatus(make({ what: "closed lately", nonce: "gggggg" }), "done", "2026-11-04"), withStatus(make({ what: "closed long ago", nonce: "hhhhhh", createdOn: "2026-08-01" }), "done", "2026-09-01"),
  ];
  const l = ledger(list, "2026-11-08");
  assert.deepEqual(l.late.map((c) => [c.what, c.days_overdue]), [["late b", 19], ["late a", 7]]);
  assert.deepEqual(l.soon.map((c) => c.what), ["soon"]);
  assert.deepEqual(l.later.map((c) => c.what), ["later"]);
  assert.deepEqual(l.undated.map((c) => c.what).sort(), ["ours", "undated"]);
  assert.deepEqual(l.recent.map((c) => c.what), ["closed lately"]);
  assert.deepEqual(l.counts, { open: 6, overdue: 2, soon: 1, we_owe: 1, closed_30d: 1 });
  assert.equal(l.customers[0].customer, "Northwind");
  assert.equal(l.customers[0].oldest_overdue_days, 19);
  assert.equal(ledger(list, "2026-11-08", { customer: "Contoso" }).counts.open, 1);
});
