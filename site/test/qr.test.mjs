import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { qrMatrix } from "../qr.js";

const digest = (m) => createHash("sha256").update(m.map((r) => r.join("")).join("\n")).digest("hex");

// These two matrices were decoded with an independent reader (OpenCV) when they were recorded, along with codes of
// every version from 1 to 15; a change to the encoder that alters them must be checked the same way again.
test("the codes are the ones an independent reader decoded", () => {
  assert.equal(digest(qrMatrix("https://riccardomenegazzo.github.io/beyond-90/")), "fde9b6eb7cace297bb45d2c6f7065d032213a4a913251912c0b0de4442babd1e");
  assert.equal(digest(qrMatrix("Città già più 🙂 Beyond 90")), "a2a26e7b822be74b22d6056e57639dc9248397551c31f63830de1aec52a3f67c");
});

test("a code has the size of its version, finder patterns in three corners and the dark module", () => {
  const m = qrMatrix("A");
  assert.equal(m.length, 21);
  for (const [r, c] of [[0, 0], [0, 14], [14, 0]]) {
    assert.deepEqual(m[r].slice(c, c + 7), [1, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(m[r + 2].slice(c, c + 7), [1, 0, 1, 1, 1, 0, 1]);
  }
  assert.equal(m[21 - 8][8], 1);
  assert.equal(qrMatrix("x".repeat(390)).length, 77);
});

test("text too long for a code is refused, not truncated", () => {
  assert.throws(() => qrMatrix("x".repeat(1000)), RangeError);
});
