import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pipeline, funnel, agenda, weeklyMarkdown, pipelineCsv, STAGES } from "../desk.js";
import { makeWorkshop, setAnswer, setPlan, setWorth } from "../workshop.js";
import { makePov, setWindow, edit as editPov } from "../pov.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-18";
const ws = (customer, nonce, answers = {}) => {
  let w = makeWorkshop({ customer, scope: ["dr-backup", "hci"], createdOn: "2026-11-02", nonce });
  for (const [p, list] of Object.entries(answers)) list.forEach((a, i) => { if (a) w = setAnswer(w, p, i, a, "", "2026-11-02"); });
  return w;
};
const DR = ["gap", "solved", "gap", "partly", "gap", "unknown", "gap", "unknown"];

test("each prospect is placed at its stage, furthest along first", () => {
  const listening = ws("Alder (mock)", "aaa111", { "dr-backup": ["gap"] });
  const agreed = ws("Birch (mock)", "bbb222", { "dr-backup": DR });
  const proving = ws("Cedar (mock)", "ccc333", { "dr-backup": DR });
  const pov = setWindow(makePov({ customer: "Cedar (mock)", createdOn: "2026-11-05", nonce: "ddd444" }), "2026-11-10", "2026-11-28", "2026-11-05");
  const opps = pipeline([listening, agreed, proving], [pov], CAT, D);
  assert.deepEqual(opps.map((o) => [o.customer, o.stage]), [["Cedar (mock)", "proof"], ["Birch (mock)", "journey"], ["Alder (mock)", "discovery"]]);
  assert.match(opps[0].next, /Proof of value ends 2026-11-28/);
  assert.equal(opps[0].pov_days_left, 10);
  assert.equal(opps[1].land, "Disaster recovery and backup");
  assert.match(opps[2].next, /at least 3/);
  const f = funnel(opps);
  assert.deepEqual(f.stages.map((s) => s.count), [1, 1, 1, 0]);
  assert.equal(STAGES.length, 4);
});

test("a finished proof is a decision, a stopped one is set apart, and a proof without a workshop still counts", () => {
  const done = editPov(makePov({ customer: "Dune (mock)", createdOn: "2026-11-01", nonce: "eee555" }), { stage: "done" }, "2026-11-12");
  const stopped = editPov(makePov({ customer: "Elm (mock)", createdOn: "2026-11-01", nonce: "fff666" }), { stage: "stopped" }, "2026-11-12");
  const opps = pipeline([], [done, stopped], CAT, D);
  assert.equal(opps.find((o) => o.customer === "Dune (mock)").stage, "decision");
  assert.equal(opps.find((o) => o.customer === "Elm (mock)").stopped, true);
  assert.equal(opps[opps.length - 1].customer, "Elm (mock)", "stopped ones go last");
  assert.equal(opps[0].workshop, null);
  assert.equal(funnel(opps).stopped, 1);
});

test("the agenda puts what is late first, then the next two weeks; nothing further out", () => {
  let w = ws("Birch (mock)", "bbb222", { "dr-backup": DR });
  w = setPlan(w, "dr-backup", 2, "together", "2026-11-12", "2026-11-02");       // late
  w = setPlan(w, "dr-backup", 4, "us", "2026-11-25", "2026-11-02");             // in two weeks
  w = setPlan(w, "dr-backup", 6, "customer", "2026-12-30", "2026-11-02");       // too far
  const pov = setWindow(makePov({ customer: "Birch (mock)", createdOn: "2026-11-05", nonce: "ggg777" }), "2026-11-20", "2026-12-20", "2026-11-05");
  const items = agenda([w], [pov], CAT, D);
  assert.deepEqual(items.map((i) => [i.on, i.late]), [["2026-11-12", true], ["2026-11-20", false], ["2026-11-25", false]]);
  const opp = pipeline([w], [], CAT, D)[0];
  assert.equal(opp.overdue, 1);
  assert.match(opp.next, /^Late since 2026-11-12/);
});

test("the weekly update and the pipeline sheet say where each stands, and a sheet cannot run a formula", () => {
  let w = ws("=HYPERLINK(\"http://x\") (mock)", "hhh888", { "dr-backup": DR });
  w = setWorth(w, "dr-backup", 0, 2000000, "day", "2026-11-02");
  w = setPlan(w, "dr-backup", 2, "together", "2026-11-12", "2026-11-02");
  const opps = pipeline([w], [], CAT, D);
  const md = weeklyMarkdown(opps, agenda([w], [], CAT, D), D);
  assert.match(md, /^# Presales update, 2026-11-18/);
  assert.match(md, /Discovery: 0\. Journey agreed: 1\./);
  assert.match(md, /## Late/);
  assert.match(md, /at stake 2,000,000 per day/);
  const csv = pipelineCsv(opps);
  assert.ok(csv.startsWith("customer,stage,start_with,"));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"") (mock)"`), "a leading = is defused and quotes are doubled");
  assert.ok(csv.endsWith("\r\n"));
});

test("an empty browser makes an empty desk, not an error", () => {
  assert.deepEqual(pipeline([], [], CAT, D), []);
  assert.deepEqual(agenda([], [], CAT, D), []);
  assert.match(weeklyMarkdown([], [], D), /Discovery: 0/);
});

test("the invented desk is four valid prospects at four stages, dated around today, all marked as examples", async () => {
  const { exampleDesk, isExampleId } = await import("../desk.js");
  const { validWorkshop } = await import("../workshop.js");
  const { validPov } = await import("../pov.js");
  const ex = exampleDesk(D);
  assert.ok(ex.workshops.every(validWorkshop) && ex.povs.every(validPov));
  assert.ok([...ex.workshops, ...ex.povs].every((x) => isExampleId(x.id) && /\(mock\)$/.test(x.customer)));
  const opps = pipeline(ex.workshops, ex.povs, CAT, D);
  const byName = Object.fromEntries(opps.map((o) => [o.customer, o]));
  assert.equal(byName["Kestrel Logistics (mock)"].stage, "proof");
  assert.equal(byName["Pietra Bank (mock)"].stage, "decision");
  assert.ok(opps.every((o) => o.example));
  const items = agenda(ex.workshops, ex.povs, CAT, D);
  assert.ok(items.some((i) => i.late) && items.some((i) => !i.late), "something late and something due");
});
