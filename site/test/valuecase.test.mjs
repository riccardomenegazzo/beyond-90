import test from "node:test";
import assert from "node:assert/strict";
import { buildCase, cleanCase, validCase, caseLine, caseMarkdown, caseSteps, hasCase, hourlyFrom, CASE_DEFAULTS, money } from "../valuecase.js";

const A = { stay_run: 1200000, stay_uplift_pct: 50, renewal_in_months: 6, stay_refresh: 900000, refresh_in_months: 18,
  move_run: 1000000, move_once: 600000, move_hardware: 0, ops_hours_now: 160, ops_hours_after: 60, hour_cost: 80,
  downtime_cost_hour: 50000, downtime_hours_now: 12, downtime_hours_after: 4 };

test("staying and moving are added up month by month, each line on its own", () => {
  const c = buildCase(A);
  assert.equal(c.ok, true);
  assert.equal(c.months, 36);
  // staying: 6 months at 100k, 30 months at 150k; a 900k refresh; 160 h x 80 x 36; 12 h x 50k x 3
  const stay = 6 * 100000 + 30 * 150000 + 900000 + 160 * 80 * 36 + 12 * 50000 * 3;
  const move = 36 * (1000000 / 12) + 600000 + 60 * 80 * 36 + 4 * 50000 * 3;
  assert.equal(c.stay, Math.round(stay));
  assert.equal(c.move, Math.round(move));
  assert.equal(c.saving, Math.round(stay - move));
  assert.equal(c.rows.find((r) => r.label === "Hardware").stay, 900000);
  assert.equal(c.rows.find((r) => r.label === "The move itself").move, 600000);
  assert.equal(c.rows.reduce((n, r) => n + r.stay, 0), c.stay);
  assert.equal(c.rows.reduce((n, r) => n + r.move, 0), c.move);
  assert.ok(c.payback >= 1 && c.payback <= 36);
  assert.ok(c.moveCum[c.payback - 1] <= c.stayCum[c.payback - 1]);
  if (c.payback > 1) assert.ok(c.moveCum[c.payback - 2] > c.stayCum[c.payback - 2]);
  assert.match(caseLine(c), /less by moving, with the move paid back by month \d+\./);
});

test("a case that does not pay back says so plainly", () => {
  const c = buildCase({ stay_run: 100000, move_run: 120000, move_once: 50000 });
  assert.ok(c.saving < 0);
  assert.equal(c.payback, null);
  assert.match(caseLine(c), /moving costs .* more over this horizon/);
});

test("a refresh beyond the horizon is not counted, and blanks count as nothing", () => {
  const c = buildCase({ stay_run: 120000, stay_refresh: 500000, refresh_in_months: 40, move_run: 120000 });
  assert.equal(c.stay, 360000);
  assert.equal(c.rows.some((r) => r.label === "Hardware"), false);
  assert.equal(buildCase({}).ok, false);
  assert.equal(caseLine(buildCase({})), "Not enough figures yet.");
  assert.equal(hasCase({ hour_cost: 80, ops_hours_now: 10 }), true);
  assert.equal(hasCase({ hour_cost: 80 }), false);
});

test("the horizon changes the case", () => {
  assert.equal(buildCase({ ...A, years: 5 }).months, 60);
  assert.equal(cleanCase({ years: 99 }).years, 7);
  assert.equal(cleanCase({ years: 0 }).years, 1);
});

test("figures are cleaned, and only valid ones are stored", () => {
  assert.deepEqual(cleanCase(null), CASE_DEFAULTS);
  assert.equal(cleanCase({ stay_uplift_pct: -5 }).stay_uplift_pct, 0);
  assert.equal("stay_run" in cleanCase({ stay_run: "" }), false);
  assert.equal(validCase({ ...A, years: 3, in_readout: true }), true);
  for (const bad of [{ stay_run: -1 }, { stay_run: "1" }, { years: 2.5 }, { years: 9 }, { in_readout: 1 }, { toString: 1 }, { unknown: 3 }, { stay_run: Infinity }, [], null]) {
    assert.equal(validCase(bad), false, JSON.stringify(bad));
  }
});

test("the arithmetic is written out, for whoever checks it", () => {
  const c = buildCase(A);
  const steps = caseSteps(c);
  assert.ok(steps.some((x) => /rising 50% from month 7/.test(x)));
  assert.ok(steps.some((x) => /refresh of 900,000 in month 19/.test(x)));
  const md = caseMarkdown(c);
  assert.match(md, /\| \*\*Total over 3 years\*\* \|/);
  assert.match(md, /It is not a quote\./);
  assert.equal(money(1234567.6), "1,234,568");
});

test("figures heard in the workshop are offered as the cost of an hour down", () => {
  const h = hourlyFrom([{ amount: 2400000, per: "day", what: "a day down" }, { amount: 5000, per: "hour" }, { amount: 9, per: "month" }]);
  assert.deepEqual(h.map((x) => x.hourly), [100000, 5000]);
});
