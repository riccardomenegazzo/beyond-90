import test from "node:test";
import assert from "node:assert/strict";
import { validRetention, mergeRetention, due, soon, makeExport, validExport, mergeExports, outside, receipt, MAX_EXPORTS } from "../erasure.js";

test("retention: valid dates only, later set wins, due and soon", () => {
  assert.ok(validRetention({ customer: "A", keep_until: "2026-12-31" }));
  assert.ok(!validRetention({ customer: "", keep_until: "2026-12-31" }) && !validRetention({ customer: "A", keep_until: "2026-13-40" }) && !validRetention({ customer: "A", keep_until: "soon" }) && !validRetention(null));
  const m = mergeRetention([{ customer: "A", keep_until: "2026-01-01" }], [{ customer: "A", keep_until: "2027-01-01" }, { customer: "B", keep_until: "bad" }]);
  assert.deepEqual(m, [{ customer: "A", keep_until: "2027-01-01" }]);
  const list = [{ customer: "Old", keep_until: "2026-10-01" }, { customer: "Edge", keep_until: "2026-11-09" }, { customer: "Near", keep_until: "2026-11-20" }, { customer: "Far", keep_until: "2027-06-01" }];
  assert.deepEqual(due(list, "2026-11-09").map((r) => r.customer), ["Old"]);        // the day itself is not yet past
  assert.deepEqual(soon(list, "2026-11-09", 30).map((r) => r.customer), ["Edge", "Near"]);
});

test("export log: validation, merge by id, cap, per-customer view", () => {
  const a = makeExport({ customer: "A", on: "2026-11-01", how: "file", what: "x.md", level: "full", nonce: "1" });
  const b = makeExport({ customer: "A", on: "2026-11-02", how: "copy", level: "pseudonym", nonce: "2" });
  const c = makeExport({ customer: "B", on: "2026-11-03", how: "copy", nonce: "3" });
  assert.ok([a, b, c].every(validExport));
  assert.ok(!validExport({ ...a, how: "mail" }) && !validExport({ ...a, on: "yesterday" }) && !validExport(null));
  const m = mergeExports([a, b], [b, c, { junk: 1 }]);
  assert.equal(m.length, 3);
  assert.equal(m[0].id, c.id);
  const o = outside(m, "A");
  assert.equal(o.items.length, 2);
  assert.equal(o.withNames, 1);
  const many = Array.from({ length: MAX_EXPORTS + 5 }, (_, i) => makeExport({ customer: "A", on: "2026-01-01", how: "copy", nonce: String(i) }));
  assert.equal(mergeExports(many, []).length, MAX_EXPORTS);
});

test("receipt says what was removed, what is left, and what it cannot reach", () => {
  const out = outside([makeExport({ customer: "A", on: "2026-11-01", how: "file", what: "report.md", level: "full", nonce: "1" })], "A");
  const text = receipt({ customer: "A", on: "2026-11-09", removed: { snapshots: 3, outcomes: 1, commitments: 2, retention: 1, aliases: 5, exports: 1 }, remaining: 0, outsideCopies: out });
  assert.match(text, /snapshots: 3/);
  assert.match(text, /found 0 record/);
  assert.match(text, /report\.md/);
  assert.match(text, /not independent proof/);
  assert.match(text, /downloaded/);
  const none = receipt({ customer: "A", on: "2026-11-09", removed: {}, remaining: 0, outsideCopies: outside([], "A"), locked: 2 });
  assert.match(none, /no record of anything leaving/);
  assert.match(none, /2 sealed record/);
});
