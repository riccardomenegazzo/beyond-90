import test from "node:test";
import assert from "node:assert/strict";
import { objSketch, cleanObj, validObj, objNotes, objMarkdown, OBJ_DEFAULTS } from "../objsketch.js";

test("what the retention holds, reduced, protected and with room to grow; and the nightly bandwidth", () => {
  const sk = objSketch({}, { used_tib: 102 });
  assert.equal(sk.ok, true);
  assert.equal(sk.data, 102);
  const day = 102 * 0.03;
  const logical = 102 + 30 * day + 12 * Math.min(102, 7 * day) + 12 * Math.min(102, 30 * day);
  assert.equal(sk.logical, Math.round(logical * 10) / 10);
  assert.equal(sk.usable, Math.round(((logical / 2) * 1.2 / 0.8) * 10) / 10);
  assert.equal(sk.raw, Math.round(((logical / 2) * 1.2 / 0.8 * 1.5) * 10) / 10);
  assert.ok(sk.gbps > 0.4 && sk.gbps < 0.5);
  assert.equal(sk.steps.length, 5);
});

test("longer retention and less reduction need more; a full is never counted larger than the data", () => {
  const base = objSketch({ data_tib: 50 });
  assert.ok(objSketch({ data_tib: 50, monthly_months: 84 }).usable > base.usable);
  assert.ok(objSketch({ data_tib: 50, reduction: 1 }).usable > base.usable);
  const churn = objSketch({ data_tib: 10, change_pct: 50, monthly_months: 1, weekly_weeks: 0, daily_days: 0 });
  assert.equal(churn.logical, 20, "one full plus one monthly, capped at the data");
});

test("what is missing is said, and only valid settings are stored", () => {
  assert.match(objSketch({}, null).error, /protected data in TiB, or read an inventory/);
  assert.deepEqual(cleanObj(null), OBJ_DEFAULTS);
  assert.equal(cleanObj({ reduction: 50 }).reduction, 20);
  assert.equal(validObj({ data_tib: 20, reduction: 3 }), true);
  for (const bad of [{ reduction: 0.5 }, { data_tib: "20" }, { toString: 1 }, [], null]) assert.equal(validObj(bad), false, JSON.stringify(bad));
});

test("the notes follow the assumptions", () => {
  assert.ok(objNotes(objSketch({ data_tib: 10, reduction: 5 })).some((x) => /optimistic/.test(x)));
  assert.ok(objNotes(objSketch({ data_tib: 10, protection: 1.1 })).some((x) => /Below 1\.3x/.test(x)));
  assert.ok(objNotes(objSketch({ data_tib: 10, monthly_months: 84 })).some((x) => /colder tier/.test(x)));
  assert.match(objMarkdown(objSketch({ data_tib: 10 })), /TiB usable/);
});
