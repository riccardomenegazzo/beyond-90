import test from "node:test";
import assert from "node:assert/strict";
import { planWaves, cleanWaves, validWaves, wavesMarkdown, wavesIcs, wavesLine, WAVE_DEFAULTS, RUNBOOK } from "../waves.js";

const INV = {
  vms: 620, on: 537, off: 83, vcpu_on: 2166, mem_on_gib: 7236, past_total: 141,
  clusters: [
    { name: "CL-PROD-01", vms: 220, on: 196, vcpu: 776, mem_gib: 2588, hosts: 8, past: 48 },
    { name: "CL-PROD-02", vms: 180, on: 153, vcpu: 626, mem_gib: 2060, hosts: 6, past: 36 },
    { name: "CL-VDI", vms: 90, on: 79, vcpu: 370, mem_gib: 1272, hosts: 4, past: 20 },
    { name: "CL-DR-01", vms: 70, on: 56, vcpu: 182, mem_gib: 600, hosts: 3, past: 23 },
    { name: "CL-TEST", vms: 60, on: 53, vcpu: 212, mem_gib: 716, hosts: 2, past: 14 },
  ],
  first_wave: { name: "CL-TEST", vms: 60, past: 14 },
};

test("a test wave first, from the cluster that teaches the most for the least risk, then cluster by cluster", () => {
  const p = planWaves(INV, { start: "2027-01-11" }, "2026-11-18");
  assert.equal(p.ok, true);
  assert.equal(p.waves[0].test, true);
  assert.equal(p.waves[0].cluster, "CL-TEST");
  assert.equal(p.waves[0].machines, 20);
  assert.equal(p.waves[1].cluster, "CL-TEST", "the rest of the test cluster follows");
  assert.equal(p.moved, 537, "running machines move; powered-off ones are left to retire");
  assert.equal(p.retired, 83);
  assert.ok(p.waves.every((w) => w.machines <= 50));
  assert.equal(p.waves[0].date, "2027-01-11");
  assert.equal(p.waves[1].date, "2027-01-18");
  assert.equal(p.end, p.waves.at(-1).date);
  // clusters move whole, one after another: the waves of a cluster are next to each other
  const seen = [];
  for (const w of p.waves) if (seen.at(-1) !== w.cluster) { assert.ok(!seen.includes(w.cluster), w.cluster); seen.push(w.cluster); }
  // the vCPU of the running machines all land somewhere
  assert.ok(Math.abs(p.waves.reduce((n, w) => n + w.vcpu, 0) - 2166) <= p.waves.length);
});

test("the settings change the plan, and the defaults hold without them", () => {
  const all = planWaves(INV, { include_off: true, per_wave: 100, pilot: 0, every_days: 14, start: "2027-01-04" }, "2026-11-18");
  assert.equal(all.moved, 620);
  assert.equal(all.retired, 0);
  assert.equal(all.waves[0].test, false);
  assert.equal(all.waves[1].date, "2027-01-18");
  assert.ok(all.waves.length < planWaves(INV, {}, "2026-11-18").waves.length);
  assert.equal(planWaves(INV, {}, "2026-11-18").start, "2026-12-02", "two weeks out by default");
  assert.match(wavesLine(all), /from 2027-01-04 to .*620 machines from 5 clusters\.$/);
});

test("machines beyond the listed clusters are still planned", () => {
  const inv = { ...INV, vms: 700, on: 600, vcpu_on: 2400, mem_on_gib: 8000, past_total: 150 };
  const p = planWaves(inv, {}, "2026-11-18");
  assert.equal(p.moved, 600);
  assert.ok(p.waves.some((w) => w.cluster === "Other clusters"));
});

test("plans that cannot be made say why", () => {
  assert.equal(planWaves(null, {}, "2026-11-18").ok, false);
  assert.match(planWaves({ ...INV, on: 0, clusters: INV.clusters.map((c) => ({ ...c, on: 0 })) }, {}, "2026-11-18").error, /include the powered-off/);
  const huge = { ...INV, vms: 100000, on: 100000, clusters: [{ name: "big", vms: 100000, on: 100000, vcpu: 1, mem_gib: 1, hosts: 1, past: 0 }], first_wave: null };
  assert.match(planWaves(huge, { per_wave: 5 }, "2026-11-18").error, /more than 200 waves/);
});

test("settings are cleaned, and only valid ones are stored", () => {
  assert.deepEqual(cleanWaves(null), WAVE_DEFAULTS);
  assert.equal(cleanWaves({ per_wave: 99999 }).per_wave, 1000);
  assert.equal(cleanWaves({ start: "not a date" }).start, "");
  assert.equal(validWaves({ per_wave: 40, every_days: 7, pilot: 10, include_off: true, start: "2027-01-04" }), true);
  for (const bad of [{ per_wave: 4 }, { per_wave: 10.5 }, { start: "2027-13-40" }, { include_off: "yes" }, { toString: 1 }, { __proto__x: 1 }, [], null]) {
    assert.equal(validWaves(bad), false, JSON.stringify(bad));
  }
});

test("the plan goes to the summary and to a calendar, one event per wave", () => {
  const p = planWaves(INV, { start: "2027-01-11" }, "2026-11-18");
  const md = wavesMarkdown(p);
  assert.match(md, /\| 2027-01-11 \| Test wave \| CL-TEST \| 20 \|/);
  assert.match(md, /Every wave: before,/);
  const ics = wavesIcs({ id: "ws|2026-11-18|abcdef", customer: "Kestrel; Logistics" }, p, "20261118T000000Z");
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, p.waves.length);
  assert.ok(ics.includes("SUMMARY:Kestrel\\; Logistics: Test wave\\, 20 machines from CL-TEST"), "commas and semicolons escaped");
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(RUNBOOK.every((r) => r.steps.length >= 3));
});
