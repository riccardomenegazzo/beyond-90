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
