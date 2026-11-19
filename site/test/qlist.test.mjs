import test from "node:test";
import assert from "node:assert/strict";
import { tally, nextOpen } from "../qlist.js";

const items = [
  { id: "a", group: "g1", a: "yes" }, { id: "b", group: "g1", a: "" }, { id: "c", group: "g2", a: "no" },
  { id: "d", group: "g2", a: "" }, { id: "e", group: "g2", a: "partly" },
];
const tones = { yes: "good", partly: "mid", no: "bad" };

test("each group counts its answers, with the tone of each in order; empty groups are left out", () => {
  assert.deepEqual(tally(items, [{ key: "g1", label: "One" }, { key: "g2", label: "Two" }, { key: "g3", label: "None" }], tones), [
    { key: "g1", label: "One", total: 2, done: 1, tones: ["good", "open"] },
    { key: "g2", label: "Two", total: 3, done: 2, tones: ["bad", "open", "mid"] },
  ]);
});

test("the next question still open: after this one, else from the top, else none", () => {
  assert.equal(nextOpen(items, "a").id, "b");
  assert.equal(nextOpen(items, "b").id, "d");
  assert.equal(nextOpen(items, "d").id, "b", "wraps to the first still open");
  assert.equal(nextOpen([{ id: "x", a: "" }], "x"), null, "the only one open is the one just answered");
  assert.equal(nextOpen(items.map((x) => ({ ...x, a: "yes" })), "a"), null);
});
