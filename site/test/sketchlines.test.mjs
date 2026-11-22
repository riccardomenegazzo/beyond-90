import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorkshop, setVdi, setK8s, setDb, setFiles, setReadoutSketches, sketchLines, validWorkshop, readoutHtml, assess } from "../workshop.js";
import { vdiSketch } from "../vdisketch.js";

const D = "2026-11-02";
const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const all = { ...cat, lines: { ...cat.lines, euc: { ...cat.lines.hci, label: "Virtual desktops", questions: [] }, "kubernetes-platform": { ...cat.lines.hci, label: "Kubernetes", questions: [] },
  "file-storage": { ...cat.lines.hci, label: "File storage", questions: [] } } };

test("one line for each sketch worked out with their figures, on a line in scope; none left at its defaults", () => {
  let w = makeWorkshop({ customer: "Lumen Insurance (mock)", scope: ["euc", "dbaas", "kubernetes-platform"], createdOn: "2026-11-01", nonce: "abcdef" });
  assert.deepEqual(sketchLines(w), [], "nothing discussed yet");
  w = setVdi(w, { users: 2000 }, D);
  w = setDb(w, { databases: 60 }, D);
  w = setFiles(w, { data_tib: 40 }, D);           // file storage is not in scope: left out
  const lines = sketchLines(w);
  assert.deepEqual(lines.map((x) => x.what), ["Virtual desktops", "Databases"]);
  const vs = vdiSketch({ users: 2000 });
  assert.equal(lines[0].text, `About ${vs.hosts} hosts for 1600 desktops at once, 1 of them kept free, and ${vs.usable_tib} TiB of storage.`);
  assert.match(lines[1].text, /^About \d+ processor cores to license, on \d+ hosts kept for the databases: \d+ fewer than today\.$/);
  w = setK8s(w, { apps: 10 }, D);
  assert.ok(sketchLines(w).some((x) => x.what === "Container platform" && /workers in 2 clusters/.test(x.text)));
});

test("the readout shows them only when asked, with what they are and are not", () => {
  let w = makeWorkshop({ customer: "Lumen Insurance (mock)", scope: ["euc", "file-storage"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setVdi(w, { users: 500 }, D);
  w = setFiles(w, { data_tib: 40 }, D);
  assert.doesNotMatch(readoutHtml(all, w, assess(all, w)), /First orders of magnitude/);
  w = setReadoutSketches(w, true, D);
  assert.equal(w.readout_sketches, true);
  assert.equal(validWorkshop(w), true);
  const html = readoutHtml(all, w, assess(all, w));
  assert.match(html, /<h2>First orders of magnitude<\/h2>/);
  assert.match(html, /<td>Virtual desktops<\/td><td>About \d+ hosts for 400 desktops at once/);
  assert.match(html, /<td>File shares<\/td><td>About [\d.]+ TiB on the fast tier/);
  assert.match(html, /not a quote, and not a final sizing/);
  const off = setReadoutSketches(w, false, D);
  assert.equal(off.readout_sketches, undefined);
  assert.doesNotMatch(readoutHtml(all, off, assess(all, off)), /First orders of magnitude/);
  assert.equal(validWorkshop({ ...w, readout_sketches: "yes" }), false);
  assert.equal(validWorkshop({ ...w, readout_sketches: false }), false);
});

test("the invented example shows its first sketches, and puts them in its readout", async () => {
  const { exampleWorkshop } = await import("../workshop.js");
  const w = exampleWorkshop("2026-11-02");
  assert.equal(validWorkshop(w), true);
  assert.equal(w.readout_sketches, true);
  assert.deepEqual(sketchLines(w).map((x) => x.what), ["Recovery", "Backups", "Databases"]);
  assert.match(readoutHtml(cat, w, assess(cat, w)), /First orders of magnitude/);
});

test("each sketch worked out with their figures becomes a test of the proof of value, with the figure it would confirm", async () => {
  const { sketchProofs, exampleWorkshop } = await import("../workshop.js");
  const w = exampleWorkshop("2026-11-02");
  const proofs = sketchProofs(w);
  assert.deepEqual(proofs.map((p) => p.text.split(" ").slice(0, 3).join(" ")), ["The databases' busy", "A week of", "A test failover"]);
  assert.match(proofs[0].target, /^Licence sketch: \d+ cores on \d+ hosts$/);
  assert.ok(proofs.every((p) => p.text.length <= 200 && p.target.length <= 200));
  assert.deepEqual(sketchProofs({ ...w, scope: ["hci"] }), [], "not for lines out of scope");
  let d = makeWorkshop({ customer: "Lumen (mock)", scope: ["euc"], createdOn: "2026-11-01", nonce: "abcdef" });
  assert.deepEqual(sketchProofs(d), [], "nothing worked out yet");
  d = setVdi(d, { users: 600 }, D);
  assert.match(sketchProofs(d)[0].target, /^Sizing: \d+ hosts for 480 desktops at once$/);
});

test("the sizing and the plan in waves, once worked out with their figures, are a line of the readout and a test of the proof", async () => {
  const { sketchProofs, setInventory, setSizing, setWaves } = await import("../workshop.js");
  const { summarise, readInventory } = await import("../inventory.js");
  const csv = readFileSync(new URL("../../examples/inventory/kestrel-vinfo.csv", import.meta.url), "utf-8");
  let w = makeWorkshop({ customer: "Kestrel (mock)", scope: ["hci", "platform-migration"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setInventory(w, { ...summarise(readInventory(csv)), imported_on: D }, D);
  assert.deepEqual(sketchLines(w), [], "an inventory alone is not a sketch discussed with them");
  assert.deepEqual(sketchProofs(w), []);
  w = setSizing(w, { growth_pct: 30 }, D);
  w = setWaves(w, { start: "2027-01-11", per_wave: 60, every_days: 7, pilot: 20, include_off: false, link_mbps: 2000 }, D);
  assert.equal(validWorkshop(w), true);
  const lines = sketchLines(w);
  assert.deepEqual(lines.map((x) => x.what), ["Your platform", "The move"]);
  assert.match(lines[0].text, /^About \d+ servers \([\d,]+ physical cores\), 1 of them kept free for a failure, for the machines you run today\.$/);
  const withToday = sketchLines(setSizing(w, { growth_pct: 30, today_cores_per_host: 40 }, D))[0].text;
  assert.match(withToday, /^About \d+ servers \([\d,]+ physical cores, [\d,]+ (fewer|more) than today\), 1 of them kept free/);
  assert.match(lines[1].text, /^\d+ waves from 2027-01-11 to \d{4}-\d{2}-\d{2}, 537 machines; about [\d.]+ TiB copied ahead of the cutovers, the largest wave in about \d+ hours\.$/);
  const proofs = sketchProofs(w);
  assert.equal(proofs.length, 2);
  assert.match(proofs[0].target, /^Sizing sketch: \d+ servers, decided by (compute|memory|storage|the minimum for the copies)$/);
  assert.match(proofs[1].text, /^The test wave copies its data ahead over the real link/);
  assert.match(proofs[1].target, /^Plan in waves: the test wave copies [\d.]+ TiB in (about \d+ hours?|under an hour)$/);
  assert.ok(proofs.every((p) => p.text.length <= 200 && p.target.length <= 200));
  // a summary read before the data per cluster was kept: the plan without the copy
  const older = { ...w, inventory: { ...w.inventory, clusters: w.inventory.clusters.map(({ tib, tib_on, ...c }) => c) } };
  assert.match(sketchLines(older)[1].text, /^\d+ waves from 2027-01-11 to \d{4}-\d{2}-\d{2}, 537 machines\.$/);
  assert.match(sketchProofs(older)[1].target, /^Plan in waves: \d+ waves from 2027-01-11 to/);
});
