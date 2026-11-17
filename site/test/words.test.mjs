import test from "node:test";
import assert from "node:assert/strict";
import { nOf, plural, verb } from "../words.js";
test("counted nouns agree", () => {
  assert.equal(nOf(1, "finding"), "1 finding");
  assert.equal(nOf(0, "finding"), "0 findings");
  assert.equal(nOf(3, "entry"), "3 entries");
  assert.equal(nOf(2, "day"), "2 days");
  assert.equal(nOf(2, "match"), "2 matches");
  assert.equal(plural("person"), "people");
  assert.equal(verb(1, "is", "are"), "is");
});
