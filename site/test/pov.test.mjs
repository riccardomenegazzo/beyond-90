import test from "node:test";
import assert from "node:assert/strict";
import { makePov, validPov, acceptPovs, mergePovs, edit, setCriterion, addCriterion, addSession, setReady, progress, planMarkdown, valueReport, CRITERIA_TEMPLATES, MAX_POVS } from "../pov.js";

const mk = (o = {}) => makePov({ customer: "Acme", sponsor: "Dana", champion: "Lee", start: "2026-11-10", end: "2026-11-24", createdOn: "2026-11-01", nonce: "abc123", ...o });

test("a plan starts valid with criteria and a readiness checklist", () => {
  const p = mk();
  assert.ok(validPov(p));
  assert.equal(p.id, "Acme|2026-11-01|abc123");
  assert.equal(p.criteria.length, 4);
  assert.ok(p.readiness.length >= 5 && p.readiness.every((r) => !r.done));
  assert.throws(() => mk({ customer: "" }));
  assert.throws(() => mk({ end: "2026-11-01" }));
  assert.throws(() => mk({ start: "tomorrow" }));
  assert.equal(mk({ criteria: CRITERIA_TEMPLATES }).criteria.length, CRITERIA_TEMPLATES.length);
});

test("validation refuses what this page would not write", () => {
  const p = mk();
  for (const bad of [null, [], { ...p, stage: "won" }, { ...p, criteria: [{ ...p.criteria[0], status: "yes" }] }, { ...p, criteria: [p.criteria[0], p.criteria[0]] },
    { ...p, summary: "x".repeat(1001) }, { ...p, id: "Other|2026-11-01|abc123" }, { ...p, sessions: [{ on: "x", topic: "t", who: "" }] }, { ...p, updated_on: "2026-10-01" }, { ...p, readiness: [{ id: "r1", text: "t", done: "yes" }] }]) assert.ok(!validPov(bad));
  assert.equal(acceptPovs([p, { junk: 1 }]).rejected, 1);
  assert.equal(acceptPovs(Array.from({ length: MAX_POVS + 2 }, (_, i) => mk({ nonce: String(100000 + i) }))).ok.length, MAX_POVS);
});

test("edits keep the plan valid and move the update date; bad ones are refused", () => {
  let p = mk();
  p = setCriterion(p, "c1", { status: "met", evidence: "all 12 accounts visible on day one" }, "2026-11-12");
  assert.equal(p.criteria[0].status, "met"); assert.equal(p.updated_on, "2026-11-12");
  assert.throws(() => setCriterion(p, "c9", { status: "met" }, "2026-11-12"));
  assert.throws(() => setCriterion(p, "c1", { status: "great" }, "2026-11-12"));
  p = addCriterion(p, { text: "Extra", target: "t" }, "2026-11-12"); assert.equal(p.criteria.at(-1).id, "c5");
  p = addSession(p, { on: "2026-11-14", topic: "Workshop", who: "Lee" }, "2026-11-12"); p = addSession(p, { on: "2026-11-11", topic: "Kickoff" }, "2026-11-12");
  assert.equal(p.sessions[0].topic, "Kickoff");
  p = setReady(p, "r1", true, "2026-11-12"); assert.ok(p.readiness[0].done);
  assert.throws(() => edit(p, { end: "2026-01-01" }, "2026-11-12"));
  assert.throws(() => edit(p, {}, "2026-10-01"));
});

test("the verdict does not flatter", () => {
  let p = mk({ criteria: [{ text: "a", target: "" }, { text: "b", target: "" }, { text: "c", target: "" }, { text: "d", target: "" }] });
  assert.equal(progress(p).verdict, "in progress");
  for (const id of ["c1", "c2", "c3", "c4"]) p = setCriterion(p, id, { status: "met" }, "2026-11-20");
  assert.equal(progress(p).verdict, "all criteria met");
  p = setCriterion(p, "c4", { status: "partly" }, "2026-11-20"); assert.equal(progress(p).verdict, "mostly met");
  p = setCriterion(p, "c3", { status: "not_met" }, "2026-11-20"); assert.equal(progress(p).verdict, "not met");
  p = setCriterion(p, "c3", { status: "dropped" }, "2026-11-20"); assert.equal(progress(p).total, 3); assert.equal(progress(p).dropped, 1);
  assert.equal(progress({ ...mk(), criteria: [] }).verdict, "no criteria");
});

test("merge converges in any order", () => {
  const a = mk(), b = setCriterion(a, "c1", { status: "met" }, "2026-11-05"), c = edit(a, { stage: "running" }, "2026-11-06");
  assert.deepEqual(mergePovs([a, b], [c]), mergePovs([c], [b, a]));
  assert.equal(mergePovs([a, b], [c])[0].stage, "running");
});

test("the texts say what they are and what they do not show", () => {
  let p = mk();
  p = setCriterion(p, "c1", { status: "met", evidence: "12 of 12 | visible" }, "2026-11-12");
  p = setCriterion(p, "c2", { status: "partly", evidence: "took two days" }, "2026-11-12");
  const plan = planMarkdown(p);
  assert.match(plan, /Proof of value: Acme/); assert.match(plan, /- \[ \] Read-only access/); assert.match(plan, /Sponsor: Dana/);
  const rep = valueReport({ ...p, summary: "Good start." }, "2026-11-25");
  assert.match(rep, /Result: in progress/); assert.match(rep, /12 of 12 \/ visible/); assert.match(rep, /only partly shown/);
  assert.match(rep, /does not show/); assert.match(rep, /not an independent measurement/); assert.match(rep, /Good start\./);
  assert.match(valueReport(mk({ criteria: [] }), "2026-11-25"), /Nothing was shown yet/);
});
