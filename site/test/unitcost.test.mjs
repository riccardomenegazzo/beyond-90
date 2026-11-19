import test from "node:test";
import assert from "node:assert/strict";
import { unitSketch, cleanUnit, validUnit, unitNotes, unitMarkdown, UNIT_DEFAULTS, FIELDS } from "../unitcost.js";

const FIG = { machines: 500, hardware: 1500000, hardware_years: 5, licences_year: 240000, support_year: 60000, power_year: 45000, space_year: 30000, people_fte: 3, fte_cost: 70000 };

test("one machine's cost, all in, with every part shown", () => {
  const sk = unitSketch(FIG, null);
  assert.equal(sk.ok, true);
  const year = 300000 + 240000 + 60000 + 45000 + 30000 + 210000;
  assert.equal(sk.total, year);
  assert.ok(Math.abs(sk.month - year / 500 / 12) < 1e-9);
  assert.deepEqual(sk.parts.map((p) => p.key), ["hardware", "licences_year", "support_year", "power_year", "space_year", "people"]);
  assert.ok(Math.abs(sk.parts.reduce((s, p) => s + p.share, 0) - 100) < 1e-9);
  assert.match(sk.steps.join(" "), /Divided among 500 machines and twelve months: 148 a machine a month/);
});

test("the machines can come from the inventory", () => {
  const sk = unitSketch({ licences_year: 120000 }, { on: 400 });
  assert.equal(sk.machines, 400);
  assert.equal(Math.round(sk.month), 25);
  assert.match(sk.steps.join(" "), /running in the inventory/);
});

test("idle machines raise what each working one really costs", () => {
  const sk = unitSketch({ ...FIG, idle_pct: 20 }, null);
  assert.equal(sk.idle, 100);
  assert.ok(Math.abs(sk.used_month - sk.total / 400 / 12) < 1e-9);
  assert.match(unitNotes(sk).join(" "), /needs an owner's decision/);
});

test("a public cloud machine and a provider's tenant are set beside it", () => {
  const sk = unitSketch({ ...FIG, cloud_month: 210, tenant_vms: 20, tenant_price: 3500 }, null);
  assert.ok(Math.abs(sk.cloud.diff - (210 - sk.month)) < 1e-9);
  assert.ok(sk.cloud.year > 0);
  assert.ok(Math.abs(sk.tenant.cost - sk.month * 20) < 1e-9);
  assert.ok(Math.abs(sk.tenant.margin - ((3500 - sk.tenant.cost) / 3500) * 100) < 1e-9);
  const md = unitMarkdown(sk);
  assert.match(md, /^### What one machine costs/);
  assert.match(md, /public-cloud machine at 210 a month/);
  assert.match(md, /standard tenant of 20 machines/);
  const thin = unitSketch({ ...FIG, tenant_vms: 20, tenant_price: 3100 }, null);
  assert.match(unitNotes(thin).join(" "), /thin margin per tenant/);
  const noPrice = unitSketch({ ...FIG, tenant_vms: 20 }, null);
  assert.equal(noPrice.tenant.margin, null);
  assert.match(noPrice.steps.at(-1), /price below which it loses money/);
});

test("people left out are pointed out", () => {
  const sk = unitSketch({ machines: 100, licences_year: 50000 }, null);
  assert.match(unitNotes(sk).join(" "), /People are missing/);
  assert.doesNotMatch(unitNotes(unitSketch(FIG, null)).join(" "), /People are missing/);
});

test("what is missing is said plainly", () => {
  assert.match(unitSketch({ licences_year: 1000 }, null).error, /number of machines running/);
  assert.match(unitSketch({ machines: 10 }, null).error, /at least one cost/);
  assert.match(unitMarkdown(unitSketch({}, null)), /What one machine costs/);
});

test("figures are cleaned, and only valid ones are stored", () => {
  assert.deepEqual(cleanUnit(null), UNIT_DEFAULTS);
  assert.equal(cleanUnit({ hardware_years: 30 }).hardware_years, 10);
  assert.equal(cleanUnit({ machines: 12.4 }).machines, 12);
  assert.equal(cleanUnit({ licences_year: "" }).licences_year, undefined);
  assert.equal(validUnit(cleanUnit(FIG)), true);
  for (const bad of [{ machines: 1.5 }, { idle_pct: 95 }, { licences_year: "1" }, { price: 1 }, { toString: 1 }, [], null]) assert.equal(validUnit(bad), false, JSON.stringify(bad));
  assert.equal(FIELDS.flatMap((g) => g.fields).length, 13);
});
