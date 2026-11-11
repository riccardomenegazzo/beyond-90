import test from "node:test";
import assert from "node:assert/strict";
import { makeAsk, validAsk, acceptAsks, mergeAsks, withAskStatus, digest, digestMarkdown, MAX_ASKS } from "../asks.js";

const mk = (o = {}) => makeAsk({ customer: "A", kind: "feature", title: "Export to ticketing", createdOn: "2026-11-01", nonce: "abc123", ...o });

test("an ask is made, validated field by field, and refused when wrong", () => {
  const a = mk({ atStake: 120000.4, ref: "TCK-1", detail: "  needs\nit " });
  assert.ok(validAsk(a));
  assert.equal(a.at_stake, 120000);
  assert.equal(a.detail, "needs it");
  assert.equal(a.id, "A|2026-11-01|abc123");
  assert.throws(() => mk({ kind: "wish" }));
  assert.throws(() => mk({ title: " " }));
  assert.throws(() => mk({ customer: "" }));
  assert.throws(() => mk({ atStake: -1 }));
  assert.throws(() => mk({ createdOn: "soon" }));
  for (const bad of [null, [], { ...a, at_stake: 1.5 }, { ...a, kind: "x" }, { ...a, status: "closed" }, { ...a, status: "done", closed_on: "" }, { ...a, closed_on: "2026-11-02" }, { ...a, id: "B|2026-11-01|abc123" }, { ...a, title: "x".repeat(121) }, { ...a, updated_on: "2026-10-01" }]) assert.ok(!validAsk(bad));
});

test("accept drops invalid ones, counts them and caps the list", () => {
  const r = acceptAsks([mk(), { junk: 1 }, mk({ nonce: "zzz999" })]);
  assert.equal(r.ok.length, 2); assert.equal(r.rejected, 1);
  assert.equal(acceptAsks("no").ok.length, 0);
  const many = Array.from({ length: MAX_ASKS + 3 }, (_, i) => mk({ nonce: String(100000 + i) }));
  assert.equal(acceptAsks(many).ok.length, MAX_ASKS);
});

test("merge converges in any order; later update wins; status closes and reopens", () => {
  const a = mk(), b = withAskStatus(a, "shared", "2026-11-03"), c = withAskStatus(a, "done", "2026-11-05");
  assert.deepEqual(mergeAsks([a, b], [c]), mergeAsks([c], [b, a]));
  assert.equal(mergeAsks([a, b], [c])[0].status, "done");
  assert.equal(c.closed_on, "2026-11-05");
  assert.equal(withAskStatus(c, "open", "2026-11-06").closed_on, "");
  assert.throws(() => withAskStatus(a, "gone", "2026-11-03"));
  assert.throws(() => withAskStatus(a, "done", "2026-10-01"));
});

test("the digest groups the same ask across customers and counts each customer's figure once", () => {
  const list = [
    mk({ customer: "A", atStake: 100, nonce: "a00001" }), mk({ customer: "A", title: "export to  ticketing!", atStake: 300, nonce: "a00002" }),
    mk({ customer: "B", atStake: 50, nonce: "b00001" }), mk({ customer: "C", title: "Other thing", kind: "blocker", nonce: "c00001" }),
    mk({ customer: "D", kind: "escalation", title: "Scan stuck", createdOn: "2026-10-20", nonce: "d00001" }),
    withAskStatus(mk({ customer: "E", nonce: "e00001" }), "done", "2026-11-02"),
    withAskStatus(mk({ customer: "F", nonce: "f00001" }), "shared", "2026-11-02"),
  ];
  const d = digest(list, "2026-11-10");
  const t = d.themes[0];
  assert.equal(t.customers.join(), "A,B,F");
  assert.equal(t.at_stake, 350);
  assert.equal(t.shared, 1);
  assert.equal(d.themes[1].title, "Other thing");
  assert.equal(d.escalations.length, 1);
  assert.equal(d.escalations[0].age_days, 21);
  assert.equal(d.counts.customers, 5);
  const md = digestMarkdown(d, "2026-11-10");
  assert.match(md, /Export to ticketing/); assert.match(md, /3 customers/); assert.match(md, /not something the page measured/);
  assert.match(digestMarkdown(digest([], "2026-11-10"), "2026-11-10"), /Nothing is open/);
});
