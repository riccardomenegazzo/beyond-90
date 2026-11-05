import test from "node:test";
import assert from "node:assert/strict";
import { makeOutcome, validOutcome, acceptOutcomes, mergeOutcomes, MAX_OUTCOMES } from "../outcomes.js";

const health = { score: 72, band: "watch", components: [
  { id: "adoption", value: 80 }, { id: "outcomes", value: 60 }, { id: "relationship", value: null }, { id: "trajectory", value: 70 }] };
const make = (over = {}) => makeOutcome({ customer: "Northwind", decidedOn: "2026-10-01", outcome: "renewed", health, asOf: "2026-09-01", recordedOn: "2026-10-02", ...over });

test("an outcome carries the reading it is compared with", () => {
  const o = make();
  assert.equal(o.id, "Northwind|2026-10-01");
  assert.deepEqual(o.reading.components, { adoption: 80, outcomes: 60, relationship: null, trajectory: 70 });
  assert.equal(o.reading.score, 72);
  assert.ok(validOutcome(o));
});

test("what cannot be recorded is refused in words", () => {
  assert.throws(() => make({ customer: " " }), /no customer/);
  assert.throws(() => make({ decidedOn: "yesterday" }), /date/);
  assert.throws(() => make({ outcome: "won" }), /renewed, expanded, reduced or churned/);
  assert.throws(() => make({ health: { score: null, components: [] } }), /no measured part/);
});

test("free text is cleaned and capped", () => {
  const o = make({ note: "a\u0000b\n\n" + "x".repeat(500) });
  assert.ok(!/[\u0000-\u001f]/.test(o.note) && o.note.length === 300);
});

test("values from outside are checked", () => {
  const o = make();
  for (const bad of [null, 5, [], { ...o, id: "other" }, { ...o, outcome: "won" }, { ...o, note: 5 }, { ...o, reading: null },
    { ...o, reading: { ...o.reading, score: 120 } }, { ...o, reading: { ...o.reading, components: { adoption: 1 } } },
    { ...o, reading: { ...o.reading, components: { ...o.reading.components, adoption: "80" } } }, { ...o, decided_on: "2026-13-45", id: "Northwind|2026-13-45" }]) {
    assert.equal(validOutcome(bad), false, JSON.stringify(bad));
  }
  const { ok, rejected } = acceptOutcomes([o, { nope: 1 }, null]);
  assert.equal(ok.length, 1);
  assert.equal(rejected, 2);
  assert.deepEqual(acceptOutcomes("not a list"), { ok: [], rejected: 0 });
});

test("a file with more than the limit is cut, and says how many it dropped", () => {
  const many = Array.from({ length: MAX_OUTCOMES + 5 }, (_, i) => make({ customer: "c" + i }));
  const { ok, rejected } = acceptOutcomes(many);
  assert.equal(ok.length, MAX_OUTCOMES);
  assert.equal(rejected, 5);
});

test("merging is a union that does not depend on order", () => {
  const a = make(), b = make({ outcome: "churned", recordedOn: "2026-11-01" }), c = make({ customer: "Contoso" });
  const x = mergeOutcomes([a, c], [b]), y = mergeOutcomes([b], [c, a]);
  assert.deepEqual(x, y);
  assert.equal(x.length, 2);
  assert.equal(x.find((o) => o.customer === "Northwind").outcome, "churned");
  assert.deepEqual(mergeOutcomes(x, x), x);
});
