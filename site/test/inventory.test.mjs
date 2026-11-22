import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, num, readInventory, summarise, validSummary, notesFor } from "../inventory.js";

const EXAMPLE = readFileSync(new URL("../../examples/inventory/kestrel-vinfo.csv", import.meta.url), "utf-8");

test("CSV is read with quotes, any common delimiter, a BOM and either line ending", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a;b\n1;2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]], "blank lines are skipped");
});

test("numbers are read as exports write them", () => {
  assert.equal(num("2048"), 2048);
  assert.equal(num("1,024"), 1024);
  assert.equal(num("1.024"), 1024);
  assert.equal(num("1 024,5"), 1024.5);
  assert.equal(num("12,5"), 12.5);
  assert.ok(Number.isNaN(num("lots")) && Number.isNaN(num("")));
});

test("a vInfo-style export: MiB columns, templates left out, power states read", () => {
  const csv = "VM,Powerstate,Template,CPUs,Memory,Provisioned MiB,In Use MiB,OS according to the configuration file,Cluster,Host,Datacenter\n"
    + "a,poweredOn,False,4,16384,102400,51200,Microsoft Windows Server 2012 R2 (64-bit),C1,h1,DC\n"
    + "b,poweredOff,False,2,8192,51200,10240,Red Hat Enterprise Linux 8 (64-bit),C1,h2,DC\n"
    + "t,poweredOff,True,2,8192,51200,10240,Microsoft Windows Server 2022 (64-bit),C1,h1,DC\n";
  const r = readInventory(csv);
  assert.ok(r.ok);
  assert.equal(r.templates, 1);
  const s = summarise(r);
  assert.equal(s.vms, 2); assert.equal(s.on, 1); assert.equal(s.off, 1);
  assert.equal(s.vcpu_on, 4); assert.equal(s.mem_on_gib, 16);
  assert.equal(s.prov_tib, 0.1); assert.equal(s.hosts, 2); assert.equal(s.datacenters, 1);
  assert.deepEqual(s.past, { "Windows Server 2012 R2 or older": 1 });
  assert.ok(!("a" in s) && !JSON.stringify(s).includes('"a"'), "no machine names are kept");
});

test("a hand-made sheet in GB works too, and a file without CPUs or memory is refused", () => {
  const s = summarise(readInventory("name,vcpus,memory_gb,disk_gb,os,cluster\nx,8,32,200,Ubuntu 18.04,K\ny,4,16,100,Ubuntu 22.04,K\n"));
  assert.equal(s.mem_on_gib, 48);
  assert.equal(s.past_total, 1);
  assert.equal(readInventory("name,owner\nx,y\n").ok, false);
  assert.equal(readInventory("just a header\n").ok, false);
});

test("the invented export reads into a plausible estate, with a small low-risk cluster to start", () => {
  const s = summarise(readInventory(EXAMPLE));
  assert.equal(s.vms, 620);
  assert.equal(s.templates, 1);
  assert.equal(s.clusters.length, 5);
  assert.equal(s.first_wave.name, "CL-TEST");
  // the data on each cluster, for what each wave copies ahead: the running machines' share of it, and all of it
  assert.ok(s.clusters.every((c) => c.tib_on <= c.tib && c.tib > 0));
  assert.ok(Math.abs(s.clusters.reduce((n, c) => n + c.tib, 0) - (s.used_tib == null ? s.prov_tib : s.used_tib)) < 0.5);
  assert.ok(!validSummary({ ...s, imported_on: "2026-11-18", clusters: [{ ...s.clusters[0], tib: -1 }] }));
  const { tib, tib_on, ...older } = s.clusters[0];
  assert.ok(tib >= tib_on && validSummary({ ...s, imported_on: "2026-11-18", clusters: [older] }), "a summary stored before keeps working");
  assert.ok(s.past_total > 0 && s.off > 0);
  assert.ok(validSummary({ ...s, imported_on: "2026-11-18" }));
});

test("a stored summary is checked field by field", () => {
  const s = { ...summarise(readInventory(EXAMPLE)), imported_on: "2026-11-18" };
  for (const bad of [{ ...s, vms: -1 }, { ...s, vms: "5" }, { ...s, imported_on: "today" }, { ...s, clusters: [{ name: 5 }] },
    { ...s, clusters: Array(201).fill(s.clusters[0]) }, { ...s, past: { ["x".repeat(61)]: 1 } }, { ...s, first_wave: { name: "x" } }, null, []]) {
    assert.equal(validSummary(bad), false);
  }
});

test("the notes land on the migration questions they answer", () => {
  const qs = JSON.parse(readFileSync(new URL("../../src/beyond90/data/profiles/platform-migration/discovery.json", import.meta.url), "utf-8")).questions;
  const n = notesFor(summarise(readInventory(EXAMPLE)));
  assert.match(qs[2].q, /How many virtual machines/);
  assert.match(qs[4].q, /migrated anything yet/);
  assert.match(qs[6].q, /backup, monitoring and security tools/);
  assert.match(qs[8].q, /servers and storage arrays/);
  assert.match(n[2], /620 virtual machines on 5 clusters/);
  assert.match(n[4], /CL-TEST/);
  assert.match(n[8], /hosts/);
});
