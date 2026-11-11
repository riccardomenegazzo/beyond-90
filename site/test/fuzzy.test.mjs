import test from "node:test";
import assert from "node:assert/strict";
import { distance, rank } from "../fuzzy.js";

const labels = ["Risk burn-down", "Actions", "Accounts", "Proof of value", "Prep a call", "Posture scorecard", "Download interactions.csv", "Findings"];

test("distance counts a swap of neighbours as one slip", () => {
  assert.equal(distance("acitons", "actions"), 1);
  assert.equal(distance("finding", "findings"), 1);
  assert.equal(distance("abc", "xyz"), 3);
  assert.ok(distance("short", "muchlongerword") > 2);
});

test("an empty query keeps everything in its order", () => {
  assert.deepEqual(rank("", labels), labels);
  assert.deepEqual(rank("  ", labels), labels);
});

test("whole words rank above prefixes, prefixes above fragments", () => {
  assert.equal(rank("actions", labels)[0], "Actions");
  assert.equal(rank("acc", labels)[0], "Accounts");
  assert.equal(rank("burn", labels)[0], "Risk burn-down");
  assert.ok(rank("ount", labels).includes("Accounts"));
});

test("a slip of the keys still finds it", () => {
  assert.equal(rank("acitons", labels)[0], "Actions");
  assert.equal(rank("scorcard", labels)[0], "Posture scorecard");
  assert.equal(rank("findigns", labels)[0], "Findings");
});

test("letters in order find an abbreviation", () => {
  assert.equal(rank("rbd", labels)[0], "Risk burn-down");
  assert.equal(rank("pov", labels)[0], "Proof of value");
});

test("every word must match, and nonsense matches nothing", () => {
  assert.deepEqual(rank("risk call", labels), []);
  assert.deepEqual(rank("zzzzqx", labels), []);
  assert.deepEqual(rank("prep call", labels), ["Prep a call"]);
});

test("it can rank objects by a field, and does not change the list it is given", () => {
  const items = [{ label: "Actions" }, { label: "Accounts" }];
  const copy = items.slice();
  assert.deepEqual(rank("acc", items, (x) => x.label), [{ label: "Accounts" }]);
  assert.deepEqual(items, copy);
});
