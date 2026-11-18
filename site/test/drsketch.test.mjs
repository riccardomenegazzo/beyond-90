import test from "node:test";
import assert from "node:assert/strict";
import { drSketch, cleanDr, validDr, drNotes, drMarkdown, DR_DEFAULTS, duration } from "../drsketch.js";

const INV = { used_tib: 102, prov_tib: 180 };

test("each tier gets the replication its recovery point calls for, and the bandwidth its data needs", () => {
  const sk = drSketch({}, INV);
  assert.equal(sk.ok, true);
  assert.equal(sk.data, 102, "from the inventory when not given");
  assert.match(sk.tiers[0].mode, /^Synchronous replication, with a witness/);
  assert.match(sk.tiers[1].mode, /^Near-continuous/);
  assert.match(sk.tiers[2].mode, /^Scheduled snapshots replicated every 4 hours/);
  // tier 1: 15.3 TiB x 3% a day, the busiest hour three times the average
  const expect = Math.ceil(((15.3 * 0.03) / 24) * 3 * 1024 ** 4 * 8 / 3600 / 1e6);
  assert.equal(sk.tiers[0].mbps, expect);
  assert.equal(sk.mbps, sk.tiers.reduce((s, t) => s + t.mbps, 0));
  assert.equal(sk.steps.length, 6);
});

test("zero data loss needs close sites, and the design says so", () => {
  const far = drSketch({ latency_ms: 20 }, INV);
  assert.equal(far.tiers[0].ok, false);
  assert.match(far.tiers[0].why, /closer than about 5 ms/);
  assert.match(far.steps.at(-1), /tier 1 needs closer sites/);
  assert.match(drMarkdown(far), /not at this distance/);
});

test("what is missing or inconsistent is said plainly", () => {
  assert.match(drSketch({}, null).error, /protected data in TiB, or read an inventory/);
  assert.match(drSketch({ data_tib: 50, tiers: [{ share_pct: 50 }, { share_pct: 30 }, { share_pct: 30 }] }).error, /add up to 110%/);
  assert.equal(drSketch({ data_tib: 50 }).data, 50);
});

test("settings are cleaned, and only valid ones are stored", () => {
  assert.deepEqual(cleanDr(null), DR_DEFAULTS);
  assert.equal(cleanDr({ change_pct: 500 }).change_pct, 100);
  assert.equal(cleanDr({ tiers: [{ rpo_min: 5 }] }).tiers[0].rpo_min, 5);
  assert.equal(validDr({ data_tib: 10, tiers: DR_DEFAULTS.tiers }), true);
  for (const bad of [{ tiers: [] }, { tiers: [{}, {}, { rpo_min: -1 }] }, { latency_ms: "2" }, { toString: 1 }, [], null]) assert.equal(validDr(bad), false, JSON.stringify(bad));
});

test("notes and words follow the design", () => {
  const sk = drSketch({}, INV);
  assert.ok(drNotes(sk).some((x) => /witness in a third place/.test(x)));
  assert.ok(drNotes(sk).some((x) => /without a person/.test(x)));
  assert.equal(duration(0), "zero");
  assert.equal(duration(240), "4 hours");
  assert.equal(duration(1440), "1 day");
  assert.match(drMarkdown(sk), /\| 1 \| 15\.3 TiB \| zero \| 15 minutes \| Synchronous/);
});
