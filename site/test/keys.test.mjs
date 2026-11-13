import test from "node:test";
import assert from "node:assert/strict";
import { decide, stepView, typing, JUMPS, LIST } from "../keys.js";

test("g then a letter jumps; anything else after g does nothing", () => {
  let s = decide("g");
  assert.equal(s.pending, true);
  assert.deepEqual(decide("a", { pending: true }).action, { go: "actions" });
  assert.equal(decide("z", { pending: true }).action, null);
  assert.equal(decide("a").action, null);
});
test("brackets step, ? helps, / searches, modifiers are ignored", () => {
  assert.deepEqual(decide("]").action, { step: 1 });
  assert.deepEqual(decide("[").action, { step: -1 });
  assert.deepEqual(decide("?").action, { help: true });
  assert.deepEqual(decide("/").action, { search: true });
  assert.equal(decide("]", { mods: true }).action, null);
});
test("stepping wraps around the menu", () => {
  assert.equal(stepView(["a", "b", "c"], "c", 1), "a");
  assert.equal(stepView(["a", "b", "c"], "a", -1), "c");
  assert.equal(stepView(["a", "b"], "x", 1), "a");
  assert.equal(stepView([], "a", 1), null);
});
test("keys typed into a field are left alone", () => {
  assert.equal(typing({ tagName: "INPUT" }), true);
  assert.equal(typing({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(typing({ tagName: "BUTTON" }), false);
  assert.equal(typing(null), false);
});
test("every jump is listed", () => {
  for (const k of Object.keys(JUMPS)) assert.ok(LIST.some(([keys]) => keys === `g then ${k}`), k);
});
