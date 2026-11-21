import test from "node:test";
import assert from "node:assert/strict";
import { mmss, validClock, reading, pace, LENGTHS } from "../pace.js";

const c45 = { start: 1_000_000, minutes: 45 };

test("the clock reads as minutes and seconds, and a kept clock is checked before use", () => {
  assert.equal(mmss(0), "0:00");
  assert.equal(mmss(425), "7:05");
  assert.equal(mmss(-190), "3:10");
  assert.deepEqual(LENGTHS, [30, 45, 60]);
  assert.ok(validClock(c45));
  assert.ok(!validClock({ start: 1, minutes: 2 }));
  assert.ok(!validClock({ start: "x", minutes: 45 }));
  assert.ok(!validClock(null));
});

test("a reading gives the seconds gone and left, below zero once over", () => {
  assert.deepEqual(reading(c45, c45.start + 600_000), { elapsed: 600, left: 2100, timeShare: 600 / 2700 });
  assert.equal(reading(c45, c45.start + 50 * 60_000).left, -300);
  assert.equal(reading(c45, c45.start - 5000).elapsed, 0);
});

test("on pace while the essentials asked keep up with the time gone, with a little slack", () => {
  const p = pace(c45, 15 * 60, 10, 3);          // a third of the time, 30% of the essentials
  assert.equal(p.state, "on");
  assert.equal(p.line, "On pace: 7 essential questions left, 30 minutes to go.");
});

test("behind says how many are left in how long, and how long each can take", () => {
  assert.equal(pace(c45, 30 * 60, 10, 4).line, "Behind: 6 essential questions in 15 minutes, about 2 minutes each.");
  assert.equal(pace(c45, 43 * 60, 10, 5).line, "Behind: 5 essential questions in 2 minutes, less than a minute each.");
  assert.equal(pace(c45, 44 * 60, 2, 1).line, "Behind: 1 essential question in 1 minute, about 1 minute each.");
});

test("over time, all asked, or no essentials at all each say so", () => {
  assert.equal(pace(c45, 46 * 60, 10, 8).state, "over");
  assert.match(pace(c45, 46 * 60, 10, 8).line, /^Over time, with 2 essential questions still open/);
  assert.equal(pace(c45, 46 * 60, 10, 10).state, "done");
  assert.equal(pace(c45, 5 * 60, 0, 0).state, "none");
});
