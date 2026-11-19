import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exampleDesk, pipeline } from "../desk.js";
import { dealFacts } from "../lessons.js";
import { snapshotFrom, validSnapshot, readSnapshots, teamView, teamMarkdown, KIND } from "../team.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";
const snap = (by) => {
  const ex = exampleDesk(D);
  return snapshotFrom(pipeline(ex.workshops, ex.povs, CAT, D), dealFacts(ex.workshops, ex.povs, CAT), by, D);
};

test("a desk snapshot carries stages, risks, outcomes and lessons, and nothing personal", () => {
  const s = snap("Giulia R.");
  assert.equal(s.kind, KIND);
  assert.equal(validSnapshot(s), true);
  assert.equal(s.deals.length, 6);
  const json = JSON.stringify(s);
  for (const leak of ["Patient data must stay in Italy", "900000", "2000000", "Head of infrastructure (mock)", "IT director (mock)", "Keeping the arrays made the move affordable"]) {
    assert.ok(!json.includes(leak), `kept out: ${leak}`);
  }
  assert.ok(s.deals.some((d) => d.closed === "won") && s.deals.some((d) => d.risks.length));
  assert.ok(s.deals.every((d) => Number.isInteger(d.evidence)));
  const older = { ...s, deals: s.deals.map(({ evidence, ...d }) => d) };
  assert.equal(validSnapshot(older), true, "a snapshot from before the evidence is still read");
  assert.equal(validSnapshot({ ...s, deals: [{ ...s.deals[0], evidence: 101 }] }), false);
});

test("the manager reads the team together: pipelines, deals that could be lost, and what the deals teach", () => {
  const t = teamView([snap("Giulia R."), snap("Marco B.")], { includeExamples: true });
  assert.deepEqual(t.engineers.map((e) => e.name), ["Giulia R.", "Marco B."]);
  assert.equal(t.engineers[0].won, 1);
  assert.equal(t.engineers[0].lost, 1);
  assert.ok(t.engineers[0].live >= 3);
  assert.equal(t.lessons.decided, 4);
  assert.equal(t.lessons.win_rate, 50);
  assert.ok(t.risky.length >= 2 && t.risky.every((r) => r.engineer && r.risk));
  const md = teamMarkdown(t, D);
  assert.match(md, /^# Presales team review, 2026-11-19/);
  assert.match(md, /\| Giulia R\. \| \d+ \| \d+ \| \d+ \| \d+ \| \d+ \| 1 \| 1 \| \d+ \| \d+\/100 \|/);
  assert.ok(Number.isInteger(t.engineers[0].evidence));
  assert.match(md, /## What customers push back on, across the team/);
  assert.equal(teamView([snap("A")]).deals, 0, "invented examples are left out unless asked");
});

test("files are checked field by field, and anything unexpected is refused whole", () => {
  const good = snap("Giulia R.");
  const files = [
    { name: "giulia.json", text: JSON.stringify(good) },
    { name: "notjson.json", text: "{nope" },
    { name: "other.json", text: JSON.stringify({ kind: "something-else" }) },
    { name: "extra.json", text: JSON.stringify({ ...good, secret: 1 }) },
    { name: "deal.json", text: JSON.stringify({ ...good, deals: [{ ...good.deals[0], notes: "x" }] }) },
    { name: "stage.json", text: JSON.stringify({ ...good, deals: [{ ...good.deals[0], stage: "won" }] }) },
    { name: "big.json", text: "x".repeat(2_000_001) },
  ];
  const r = readSnapshots(files);
  assert.equal(r.ok.length, 1);
  assert.deepEqual(r.refused.map((x) => x.name), ["notjson.json", "other.json", "extra.json", "deal.json", "stage.json", "big.json"]);
  assert.match(r.refused[0].why, /not a JSON file/);
  for (const bad of [{ ...good, as_of: "" }, { ...good, deals: Array(501).fill(good.deals[0]) }, { ...good, deals: [{ ...good.deals[0], pov: { ...good.deals.find((d) => d.pov).pov, met: 30 } }] }]) {
    assert.equal(validSnapshot(bad), false);
  }
  assert.equal(readSnapshots(Array.from({ length: 41 }, () => ({ name: "a", text: JSON.stringify(good) }))).refused.at(-1).why, "at most 40 files at a time");
});

test("two invented engineers, for a demonstration", async () => {
  const { exampleTeam } = await import("../team.js");
  const team = exampleTeam(CAT, D);
  assert.equal(team.length, 2);
  assert.ok(team.every(validSnapshot));
  assert.ok(team[1].deals.every((d) => / North \(mock\)$/.test(d.customer)));
  const t = teamView(team, { includeExamples: true });
  assert.equal(t.engineers.length, 2);
  assert.ok(t.deals >= 9);
});
