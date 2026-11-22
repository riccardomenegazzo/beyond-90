import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileSketch, cleanFiles, validFiles, fileNotes, fileMarkdown, FILE_DEFAULTS } from "../filesketch.js";

test("growth compounds, the share nobody opens goes to a cheaper tier, and snapshots keep what changed", () => {
  const sk = fileSketch({});
  assert.equal(sk.ok, true);
  // 100 x 1.2^3 = 172.8; 40% cold = 69.1, 103.7 stays; 0.5% a day = 0.52, 30 dailies + 4 weeklies of 3.63 = 30.1
  assert.deepEqual([sk.grown, sk.cold, sk.hot, sk.snaps], [172.8, 69.1, 103.7, 30.1]);
  // (103.7 + 30.1) / 1.5 = 89.2, below 80% = 111.5 usable, twice = 222.9 raw; the cold tier 69.1 / 1.5 = 46.1
  assert.deepEqual([sk.usable, sk.raw, sk.cold_tib], [111.5, 222.9, 46.1]);
  assert.ok(fileSketch({ cold_pct: 0 }).usable > sk.usable);
  assert.equal(fileSketch({ cold_pct: 0 }).cold_tib, 0);
});

test("a weekly snapshot never keeps more than the data itself, and nothing is sized without data", () => {
  const churn = fileSketch({ change_pct: 50, daily_days: 0, weekly_weeks: 2, cold_pct: 0, growth_pct: 0 });
  assert.equal(churn.snaps, 200, "two weekly snapshots of at most the whole 100 TiB");
  assert.equal(fileSketch({ data_tib: 0 }).ok, false);
  assert.match(fileMarkdown(fileSketch({ data_tib: 0 })), /Give the file data in TiB/);
});

test("settings are kept within their limits, and only known ones in range are valid", () => {
  assert.equal(cleanFiles({ years: 40 }).years, 10);
  assert.equal(cleanFiles({ reduction: 0.5 }).reduction, 1);
  assert.equal(cleanFiles({ cold_pct: "x" }).cold_pct, FILE_DEFAULTS.cold_pct);
  assert.equal(validFiles(cleanFiles({ data_tib: 30 })), true);
  assert.equal(validFiles({ data_tib: 30, shares: 4 }), false);
  assert.equal(validFiles({ data_tib: "30" }), false);
  assert.equal(validFiles(undefined), false);
});

test("the notes follow the design, and the markdown carries the capacity, each step and the notes", () => {
  const notes = fileNotes(fileSketch({})).join(" ");
  assert.match(notes, /scan of last-access times/);
  assert.match(notes, /Snapshots are not a backup/);
  assert.doesNotMatch(notes, /file servers today/);
  const more = fileNotes(fileSketch({ reduction: 3, protection: 1.1, servers_today: 14 })).join(" ");
  assert.match(more, /3:1 reduction is optimistic/);
  assert.match(more, /Below 1.3x/);
  assert.match(more, /14 file servers today become one place/);
  assert.ok(fileMarkdown(fileSketch({})).startsWith("### A first file storage sketch\n\n**111.5 TiB usable, 222.9 TiB raw**, and 46.1 TiB on a cheaper tier."));
});

test("the workshop keeps it, and the journey and the handover carry it when file storage is in scope", async () => {
  const { makeWorkshop, setFiles, validWorkshop, summaryMarkdown, assess } = await import("../workshop.js");
  const { handoverMarkdown } = await import("../delivery.js");
  let w = makeWorkshop({ customer: "Riva Engineering (mock)", scope: ["file-storage", "hci"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setFiles(w, { data_tib: 40 }, "2026-11-02");
  assert.equal(validWorkshop(w), true);
  assert.equal(validWorkshop({ ...w, files: { data_tib: -1 } }), false);
  assert.throws(() => setFiles(w, { data_tib: "lots" }, "2026-11-02"), /file storage/);
  assert.equal(setFiles(w, null, "2026-11-02").files, undefined);
  const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
  const withFiles = { ...cat, lines: { ...cat.lines, "file-storage": { ...cat.lines.hci, label: "File storage", questions: [] } } };
  const sk = fileSketch({ data_tib: 40 });
  assert.match(handoverMarkdown(withFiles, w, null, "2026-11-20"), new RegExp(`File storage: ${sk.usable} TiB usable`));
  assert.match(summaryMarkdown(withFiles, w, assess(withFiles, w)), /### A first file storage sketch/);
  assert.doesNotMatch(handoverMarkdown(withFiles, { ...w, scope: ["hci"] }, null, "2026-11-20"), /File storage:/);
});
