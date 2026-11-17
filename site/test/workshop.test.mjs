import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ANSWERS, makeWorkshop, validWorkshop, acceptWorkshops, mergeWorkshops, setAnswer, rename, setScope, lineState, assess, journey, summaryMarkdown, MAX_WORKSHOPS } from "../workshop.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-17";
const mk = (o = {}) => makeWorkshop({ customer: "Halden", scope: ["hci", "dr-backup", "dbaas", "object-storage"], createdOn: D, nonce: "abc123", ...o });
const fill = (w, profile, answers) => answers.reduce((x, a, i) => (a ? setAnswer(x, profile, i, a, "", D) : x), w);

test("a workshop starts valid, with its lines and no answers", () => {
  const w = mk();
  assert.ok(validWorkshop(w));
  assert.equal(w.id, "ws|2026-11-17|abc123");
  assert.deepEqual(w.answers, {});
  assert.throws(() => mk({ customer: " " }));
  assert.throws(() => mk({ scope: [] }));
  assert.throws(() => mk({ scope: ["../etc"] }));
  assert.throws(() => mk({ createdOn: "today" }));
});

test("the id does not carry the customer's name, so renaming keeps it", () => {
  const w = rename(mk(), "Halden Group", D);
  assert.equal(w.customer, "Halden Group");
  assert.equal(w.id, mk().id);
  assert.ok(!w.id.includes("Halden"));
  assert.throws(() => rename(mk(), "", D));
});

test("answers are recorded, replaced and cleared", () => {
  let w = setAnswer(mk(), "dr-backup", 0, "gap", "A day down costs a lot", D);
  assert.deepEqual(w.answers["dr-backup#0"], { a: "gap", note: "A day down costs a lot" });
  w = setAnswer(w, "dr-backup", 0, "partly", "", D);
  assert.equal(w.answers["dr-backup#0"].a, "partly");
  w = setAnswer(w, "dr-backup", 0, "", "", D);
  assert.equal(w.answers["dr-backup#0"], undefined);
  assert.throws(() => setAnswer(mk(), "dr-backup", 0, "maybe", "", D));
  assert.throws(() => setAnswer(mk(), "dr-backup", -1, "gap", "", D));
  assert.throws(() => setAnswer(mk(), "Dr Backup", 0, "gap", "", D));
  assert.equal(setAnswer(mk(), "hci", 1, "gap", "x".repeat(400), D).answers["hci#1"].note.length, 300);
});

test("validation refuses what this page would not write", () => {
  const w = setAnswer(mk(), "hci", 0, "gap", "", D);
  assert.ok(validWorkshop(w));
  for (const bad of [
    { ...w, id: "ws|2026-11-18|abc123" }, { ...w, id: "Halden|2026-11-17|abc123" }, { ...w, customer: "" },
    { ...w, updated_on: "2026-11-01" }, { ...w, scope: [] }, { ...w, scope: ["hci", "hci"] },
    { ...w, answers: { "hci#0": { a: "maybe", note: "" } } }, { ...w, answers: { "<b>#0": { a: "gap", note: "" } } },
    { ...w, answers: { "hci#0": { a: "gap", note: "x".repeat(301) } } }, { ...w, answers: [] }, null, [],
  ]) assert.equal(validWorkshop(bad), false, JSON.stringify(bad).slice(0, 80));
  const { ok, rejected } = acceptWorkshops([w, { ...w, customer: "" }, "nope"]);
  assert.equal(ok.length, 1);
  assert.equal(rejected, 2);
  assert.equal(acceptWorkshops(Array(MAX_WORKSHOPS + 5).fill(w)).ok.length, MAX_WORKSHOPS);
  assert.deepEqual(acceptWorkshops("x"), { ok: [], rejected: 0 });
});

test("merging keeps the newest copy of each workshop", () => {
  const a = mk(), b = setAnswer(mk(), "hci", 0, "gap", "", "2026-11-18");
  assert.deepEqual(mergeWorkshops([a], [b]), [b]);
  assert.deepEqual(mergeWorkshops([b], [a]), [b]);
  assert.equal(mergeWorkshops([a], [mk({ nonce: "zzz999" })]).length, 2);
});

test("pain counts gaps fully, partly half, unknown most of the way, and value questions double", () => {
  const q = CAT.lines["dr-backup"].questions;
  assert.equal(q[0].stage, "value");
  const allGap = lineState(CAT, "dr-backup", fill(mk(), "dr-backup", q.map(() => "gap")).answers);
  assert.equal(allGap.pain, 1);
  assert.equal(allGap.gaps.length, q.length);
  const solved = lineState(CAT, "dr-backup", fill(mk(), "dr-backup", q.map(() => "solved")).answers);
  assert.equal(solved.pain, 0);
  // one value gap (weight 2) and one stage question solved (weight 1): 2 / 3
  const mixed = lineState(CAT, "dr-backup", fill(mk(), "dr-backup", ["gap", "", "solved"]).answers);
  assert.ok(Math.abs(mixed.pain - 2 / 3) < 1e-9);
  assert.equal(mixed.answered, 2);
  assert.equal(ANSWERS.unknown.weight > ANSWERS.partly.weight, true);
});

test("the first line is the one that hurts most, once enough was heard", () => {
  let w = mk();
  assert.equal(assess(CAT, w).land, null);
  assert.match(assess(CAT, w).waiting, /at least 3/);
  w = fill(w, "hci", ["partly", "solved", "solved", "partly", "solved", "gap", "solved", "partly"]);
  w = fill(w, "dr-backup", ["gap", "gap", "gap", "partly", "gap", "unknown", "gap", "unknown"]);
  w = fill(w, "dbaas", ["gap", "gap"]);                       // hurts, but heard twice: not enough to start there
  const res = assess(CAT, w);
  assert.equal(res.land.profile, "dr-backup");
  assert.equal(res.proof.length >= 3, true);
  assert.equal(res.unknowns.length, 2);
  assert.ok(res.unknowns.every((u) => u.profile === "dr-backup"));
  // after recovery: object storage, because of the link, before lines that only hurt
  assert.equal(res.expand[0].profile, "object-storage");
  assert.ok(res.expand[0].why);
  assert.ok(res.expand.some((e) => e.profile === "dbaas"));
  assert.equal(res.answered, 18);
});

test("a line out of scope is neither scored nor proposed", () => {
  let w = setScope(mk(), ["hci", "dr-backup"], D);
  w = fill(w, "dr-backup", ["gap", "gap", "gap"]);
  const res = assess(CAT, w);
  assert.deepEqual(res.lines.map((l) => l.profile), ["hci", "dr-backup"]);
  assert.ok(!res.expand.some((e) => e.profile === "object-storage"));
  assert.throws(() => setScope(w, [], D));
});

test("the meeting summary says what was heard, where to start and what is open", () => {
  let w = fill(mk(), "dr-backup", ["gap", "gap", "gap", "partly", "gap", "unknown"]);
  w = setAnswer(w, "dr-backup", 0, "gap", "A day down is about 2M in lost orders", D);
  const md = summaryMarkdown(CAT, w, assess(CAT, w));
  assert.match(md, /^# Discovery: Halden/);
  assert.match(md, /## What we heard/);
  assert.match(md, /A day down is about 2M/);
  assert.match(md, /## The journey/);
  assert.match(md, /Yes, this is possible/);
  assert.match(md, /- \[ \] .+ First step: .+ Today: a real gap/);
  assert.match(md, /## To find out before the next meeting/);
  const empty = summaryMarkdown(CAT, mk(), assess(CAT, mk()));
  assert.match(empty, /## Where to start/);
  assert.match(empty, /Answer at least 3 questions/);
});

test("the journey turns every gap into a condition with a first step, and keeps what is already true", () => {
  let w = mk();
  assert.equal(journey(CAT, w, assess(CAT, w)), null);
  w = fill(w, "hci", ["partly", "solved", "solved", "partly", "solved", "gap", "solved", "partly"]);
  w = fill(w, "dr-backup", ["gap", "solved", "gap", "partly", "gap", "unknown", "gap", "unknown"]);
  w = setAnswer(w, "dr-backup", 0, "gap", "A day down is about 2M in lost orders", D);
  const j = journey(CAT, w, assess(CAT, w));
  assert.match(j.headline, /^Yes, this is possible\. For Halden, \d+ things need to be true; \d+ already/);
  assert.deepEqual(j.steps.map((s) => s.kind).slice(0, 2), ["agree", "prove"]);
  const [agree, prove] = j.steps;
  assert.ok(agree.conditions.every((c) => c.stage === "value") && agree.already.length === 1);
  assert.ok(prove.conditions.every((c) => c.stage !== "value"));
  // stages in order, and within a stage the real gaps before what nobody knows before what is partly there
  const order = prove.conditions.map((c) => c.stage);
  assert.deepEqual(order, [...order].sort());
  for (const c of [...agree.conditions, ...prove.conditions]) {
    assert.ok(c.need && !c.need.endsWith("?"), c.need);
    assert.ok(c.how, c.need);
  }
  assert.ok(prove.validate.length >= 3, "the proof's own criteria validate the step");
  assert.deepEqual(j.impact, ["A day down is about 2M in lost orders"]);
  assert.equal(j.unknown, 2);
  const then = j.steps.filter((s) => s.kind === "then");
  assert.ok(then.length >= 1 && then[0].why, "the next steps say why they follow");
  assert.equal(j.need, j.steps.reduce((n, s) => n + s.conditions.length, 0));
  assert.equal(j.done, j.steps.reduce((n, s) => n + s.already.length, 0));
});
