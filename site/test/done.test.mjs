import test from "node:test";
import assert from "node:assert/strict";
import { makeDone, withDone, validDone, acceptDone, mergeDone, readMarks } from "../done.js";

const mk = (o = {}) => makeDone({ customer: "Acme", action: "l3_adopt:a", title: "Adopt X on 3 accounts", points: 2.14, dataAsOf: "2026-10-31", today: "2026-11-02", ...o });

test("a mark is valid, rounded, and keyed by customer and action", () => {
  const d = mk();
  assert.ok(validDone(d));
  assert.equal(d.id, "Acme|l3_adopt:a");
  assert.equal(d.points, 2.1);
  assert.throws(() => mk({ action: "" }), /which action/);
  assert.throws(() => mk({ dataAsOf: "31/10/2026" }), /date/);
  assert.equal(validDone({ ...d, id: "Other|l3_adopt:a" }), false);
  assert.equal(validDone({ ...d, active: "yes" }), false);
});

test("undo keeps the record, and the later copy wins a merge", () => {
  const d = mk(), u = withDone(d, false, "2026-11-03");
  assert.equal(u.active, false);
  assert.deepEqual(mergeDone([d], [u]).map((x) => x.active), [false]);
  assert.deepEqual(mergeDone([u], [d]).map((x) => x.active), [false]);
  assert.equal(acceptDone([d, { junk: 1 }]).rejected, 1);
});

test("marks are read against the data: done on this data, still open in newer data, or confirmed gone", () => {
  const recs = [mk({ action: "a" }), mk({ action: "b" }), mk({ action: "c" }), mk({ customer: "Other", action: "a" }), withDone(mk({ action: "d" }), false, "2026-11-03")];
  const acts = [{ id: "a" }, { id: "b" }, { id: "d" }];
  const same = readMarks(recs, "Acme", acts, "2026-10-31");
  assert.deepEqual([...same.done].sort(), ["a", "b"]);
  assert.equal(same.stillOpen.length, 0);
  const newer = readMarks(recs, "Acme", acts, "2026-11-30");
  assert.deepEqual(newer.stillOpen.map((x) => x.action).sort(), ["a", "b"]);
  assert.deepEqual(newer.confirmed.map((x) => x.action), ["c"]);
  assert.equal(newer.done.size, 0);
});
