import test from "node:test";
import assert from "node:assert/strict";
import { sketch, clean, validAssumptions, sketchMarkdown, designNotes, DEFAULTS, PROTECTION, factorOf } from "../sizing.js";
import { makePov } from "../pov.js";

const INV = { vcpu_on: 2000, mem_on_gib: 8000, used_tib: 100, prov_tib: 180 };

test("the sketch does the whiteboard arithmetic and names what decides", () => {
  const sk = sketch(INV, { growth_pct: 0, vcpu_per_core: 4, node_cores: 64, overhead_cores: 14, node_mem_gib: 1024, overhead_mem_gib: 24,
    node_raw_tib: 50, protection: "copies2", reduction: 1, fill_pct: 80, spare_nodes: 1 });
  assert.ok(sk.ok);
  // compute: 2000 / (50 cores x 4) = 10; memory: 8000 / 1000 = 8; storage: 100 x 2 / 0.8 = 250 TiB / 50 = 5
  assert.deepEqual(sk.by, { compute: 10, memory: 8, storage: 5 });
  assert.equal(sk.decided, "compute");
  assert.equal(sk.nodes, 11, "plus one spare");
  assert.equal(sk.need.raw_tib, 250);
  assert.equal(sk.use.cpu, 100);
  assert.equal(sk.steps.length, 7);
  // what a per-core subscription counts: every physical core, the spare servers included
  assert.equal(sk.cores, sk.nodes * sk.assumptions.node_cores);
  assert.match(sk.steps[6], new RegExp(`^Counted per core, for a subscription priced that way: ${sk.nodes} servers x ${sk.assumptions.node_cores} cores = [\\d,]+ physical cores, the spare servers included\\.`));
});

test("three copies cost more raw storage and need five servers at least; data reduction counts only when given", () => {
  const two = sketch(INV, { protection: "copies2" }), three = sketch(INV, { protection: "copies3" });
  assert.ok(three.need.raw_tib > two.need.raw_tib * 1.4);
  assert.equal(sketch({ vcpu_on: 4, mem_on_gib: 8, used_tib: 0.1 }, { protection: "copies3", spare_nodes: 0 }).nodes, 5);
  assert.equal(sketch({ vcpu_on: 4, mem_on_gib: 8, used_tib: 0.1 }, {}).nodes, 3);
  assert.equal(sketch({ vcpu_on: 4, mem_on_gib: 8, used_tib: 0.1 }, {}).decided, "minimum");
  assert.ok(sketch(INV, { reduction: 2 }).need.raw_tib < two.need.raw_tib);
  assert.equal(PROTECTION.copies3.hot, 3);
});

test("provisioned storage is used when the export has no used figure", () => {
  const sk = sketch({ ...INV, used_tib: null }, {});
  assert.match(sk.steps[0], /180 TiB provisioned/);
});

test("assumptions are kept in range, and nonsense is refused or clamped", () => {
  assert.equal(clean({ vcpu_per_core: 99 }).vcpu_per_core, 16);
  assert.equal(clean({ fill_pct: "abc" }).fill_pct, DEFAULTS.fill_pct);
  assert.equal(clean({ protection: "raid0" }).protection, "copies2");
  assert.ok(validAssumptions(clean({})));
  assert.equal(validAssumptions({ vcpu_per_core: 99 }), false);
  assert.equal(validAssumptions({ unknown: 1 }), false);
  assert.equal(validAssumptions({ protection: "raid0" }), false);
  // another server to compare with: all three of what it holds, in range, or nothing
  assert.deepEqual(clean({ alt: { node_cores: 96, node_mem_gib: 2048, node_raw_tib: 60 } }).alt, { node_cores: 96, node_mem_gib: 2048, node_raw_tib: 60 });
  assert.equal(clean({ alt: { node_cores: 96, node_mem_gib: 2048 } }).alt, undefined, "half a server is not compared");
  assert.equal(clean({ alt: { node_cores: 9999, node_mem_gib: 2048, node_raw_tib: 60 } }).alt.node_cores, 512);
  assert.ok(validAssumptions(clean({ alt: { node_cores: 96, node_mem_gib: 2048, node_raw_tib: 60 } })));
  for (const bad of [{ node_cores: 96 }, [], { node_cores: 96, node_mem_gib: 2048, node_raw_tib: 60, x: 1 }, { node_cores: 2, node_mem_gib: 2048, node_raw_tib: 60 }]) {
    assert.equal(validAssumptions({ alt: bad }), false, JSON.stringify(bad));
  }
  assert.equal(sketch(INV, { node_cores: 8, overhead_cores: 8 }).ok, false);
});

test("the summary says it is a sketch, not a sizing", () => {
  const md = sketchMarkdown(sketch(INV, {}));
  assert.match(md, /A first sizing sketch: \d+ servers, decided by/);
  assert.match(md, /Not a sizing/);
  assert.equal(sketchMarkdown({ ok: false }), "");
});

test("a proof of value starts with the kind of product's own checklist, then the steps every proof needs", () => {
  const p = makePov({ customer: "X", createdOn: "2026-11-18", nonce: "abc123", readiness: ["Recovery point and time agreed for the workloads in the test", "Read-only access agreed, and who approves it"] });
  assert.equal(p.readiness[0].text, "Recovery point and time agreed for the workloads in the test");
  assert.equal(p.readiness.filter((r) => r.text === "Read-only access agreed, and who approves it").length, 1, "no repeats");
  assert.ok(p.readiness.length <= 20);
  assert.equal(makePov({ customer: "X", createdOn: "2026-11-18", nonce: "abc123" }).readiness.length, 6);
});

test("erasure coding costs 1.25x or 1.5x on cold data only, and needs room for its strip plus one server", () => {
  assert.equal(factorOf("ec1", 100), 1.25);
  assert.equal(factorOf("ec1", 0), 2);
  assert.equal(factorOf("ec1", 50), 1.625);
  assert.equal(factorOf("ec2", 100), 1.5);
  const tiny = { vcpu_on: 4, mem_on_gib: 8, used_tib: 0.1 };
  assert.equal(sketch(tiny, { protection: "ec1", spare_nodes: 0 }).nodes, 6, "4 + 1 strip, plus one to rebuild on");
  assert.equal(sketch(tiny, { protection: "ec2", spare_nodes: 0 }).nodes, 8);
  assert.ok(sketch(INV, { protection: "ec1", cold_pct: 80 }).need.raw_tib < sketch(INV, { protection: "copies2" }).need.raw_tib);
  assert.match(sketch(INV, { protection: "ec2" }).steps[4], /50% cold data erasure coded/);
});

test("design notes follow the assumptions", () => {
  assert.ok(designNotes({}).some((x) => /largest server/.test(x)));
  assert.ok(designNotes({ protection: "ec1" }).some((x) => /no longer written to/.test(x)));
  assert.ok(designNotes({ reduction: 2 }).some((x) => /measure it/.test(x)));
  assert.ok(designNotes({ vcpu_per_core: 8 }).some((x) => /high ratio/.test(x)));
  assert.match(sketchMarkdown(sketch(INV, {})), /Design notes:/);
});

test("only the table's own names are accepted, never inherited ones", () => {
  for (const bad of ["toString", "__proto__", "constructor", "hasOwnProperty"]) {
    assert.equal(validAssumptions({ protection: bad }), false, bad);
    assert.equal(validAssumptions({ [bad]: 1 }), false, bad);
    assert.equal(clean({ protection: bad }).protection, "copies2", bad);
  }
  assert.equal(validAssumptions(JSON.parse('{"__proto__": {"fill_pct": 10}}')), false);
  assert.equal(sketch(INV, { protection: "toString" }).ok, true);
  assert.deepEqual(clean(null), DEFAULTS);
});

test("the same estate on another server: fewer larger servers or more smaller ones, and the physical cores each way", async () => {
  const { otherLine } = await import("../sizing.js");
  const base = sketch(INV, {});
  assert.equal(base.other, null);
  const big = sketch(INV, { alt: { node_cores: 128, node_mem_gib: 2048, node_raw_tib: 60 } });
  assert.equal(big.nodes, base.nodes, "the servers as assumed are unchanged");
  assert.ok(big.other.nodes < big.nodes, "larger servers: fewer of them");
  assert.equal(big.other.cores, big.other.nodes * 128);
  assert.equal(big.other.nodes, sketch(INV, { node_cores: 128, node_mem_gib: 2048, node_raw_tib: 60 }).nodes, "sized exactly as the sketch would size that server");
  assert.match(otherLine(big), /^Compared with a server of 128 cores, 2,048 GiB and 60 TiB: \d+ servers instead of \d+, [\d,]+ physical cores instead of [\d,]+, decided by (compute|memory|storage|the minimum for the copies) \(the servers as assumed: 64 cores, 1,024 GiB, 30 TiB\)\.$/);
  assert.match(sketchMarkdown(big), /Compared with a server of 128 cores/);
  assert.doesNotMatch(sketchMarkdown(base), /Compared with/);
});
