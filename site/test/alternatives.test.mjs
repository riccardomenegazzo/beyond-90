import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorkshop, setAlt, alternativesFor, alternativesMarkdown, validWorkshop, summaryMarkdown, assess, setDeal, exampleWorkshop } from "../workshop.js";
import { forward } from "../forward.js";
import { pipeline, exampleDesk } from "../desk.js";
import { dealFacts, lessons, lessonsMarkdown } from "../lessons.js";
import { snapshotFrom, validSnapshot, teamView, teamMarkdown } from "../team.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";

test("the alternatives come from the families of the lines in scope, and say when the other choice wins", () => {
  const w = makeWorkshop({ customer: "Acme (mock)", scope: ["hci", "dr-backup"], createdOn: D, nonce: "abcdef" });
  const alts = alternativesFor(CAT, w);
  assert.deepEqual(alts.map((a) => a.id), ["renew", "public_cloud", "other_platform", "three_tier", "build_own", "wait"]);
  assert.ok(alts.every((a) => !a.on && a.fits_them && a.ask.length));
  assert.deepEqual(alternativesFor({ ...CAT, alternatives: {} }, w), [], "a family without alternatives has none");
});

test("marking one puts it on the table; it is kept, checked on import, and reaches the summary", () => {
  let w = makeWorkshop({ customer: "Acme (mock)", scope: ["hci"], createdOn: D, nonce: "abcdef" });
  w = setAlt(setAlt(w, "renew", true, D), "wait", true, D);
  assert.deepEqual(w.alts, ["renew", "wait"]);
  assert.equal(validWorkshop(w), true);
  assert.deepEqual(alternativesFor(CAT, w).filter((a) => a.on).map((a) => a.id), ["renew", "wait"]);
  const md = alternativesMarkdown(CAT, w);
  assert.match(md, /^## What else they weigh/);
  assert.match(md, /\*\*Renew the current platform\.\*\*.*It is the better choice when: /);
  assert.match(summaryMarkdown(CAT, w, assess(CAT, w)), /## What else they weigh/);
  w = setAlt(w, "renew", false, D);
  assert.deepEqual(w.alts, ["wait"]);
  assert.equal("alts" in setAlt(w, "wait", false, D), false);
  assert.throws(() => setAlt(w, "Not an id", true, D));
  for (const bad of [[], ["renew", "renew"], ["BAD"], Array.from({ length: 9 }, (_, i) => `alt_${"abcdefghi"[i]}`), "renew"]) assert.equal(validWorkshop({ ...w, alts: bad }), false, JSON.stringify(bad));
  assert.equal(alternativesMarkdown(CAT, makeWorkshop({ customer: "B (mock)", scope: ["hci"], createdOn: D, nonce: "abcdeg" })), "");
});

test("the way forward asks how we compare before the decision, once something else is on the table", () => {
  let w = makeWorkshop({ customer: "Acme (mock)", scope: ["hci"], createdOn: D, nonce: "abcdef" });
  const none = forward(CAT, w, null, D).phases.find((p) => p.id === "decision").checks;
  assert.ok(!none.some((c) => /what else they weigh/.test(c.text)));
  w = setAlt(w, "public_cloud", true, D);
  let check = forward(CAT, w, null, D).phases.find((p) => p.id === "decision").checks.find((c) => /what else they weigh/.test(c.text));
  assert.equal(check.ok, false);
  assert.match(check.text, /move everything to a public cloud/);
  assert.match(check.fix, /What one machine costs here/);
  w = setDeal(w, "alternatives", "known", "Cloud quote seen", D);
  check = forward(CAT, w, null, D).phases.find((p) => p.id === "decision").checks.find((c) => /what else they weigh/.test(c.text));
  assert.equal(check.ok, true);
});

test("weighing doing nothing with no date is a risk on the desk", () => {
  let w = makeWorkshop({ customer: "Acme (mock)", scope: ["hci"], createdOn: D, nonce: "abcdef" });
  w = setAlt(w, "wait", true, D);
  const risks = pipeline([w], [], CAT, D)[0].risks;
  assert.ok(risks.some((r) => r.level === "high" && /weighing doing nothing/.test(r.text)));
  const dated = setDeal(w, "why_now", "known", "Contract ends in June", D);
  assert.ok(!pipeline([dated], [], CAT, D)[0].risks.some((r) => /weighing doing nothing/.test(r.text)));
});

test("the lessons count what else was weighed and how those deals ended, on one desk and across a team", () => {
  const ex = exampleDesk(D);
  const facts = dealFacts(ex.workshops, ex.povs, CAT);
  assert.deepEqual(facts.find((f) => f.customer === "Brina Retail (mock)").alts, ["Renew the current platform", "Separate servers and storage arrays"]);
  const l = lessons(facts, { includeExamples: true });
  const renew = l.alternatives.find((a) => a.label === "Renew the current platform");
  assert.ok(renew.count >= 2 && renew.decided >= 1 && renew.won >= 1);
  const md = lessonsMarkdown(l);
  assert.match(md, /## What else they weighed\n\n- /);
  assert.match(md, /- Renew the current platform: 2 prospects, 1 won of 1 decided\./);
  assert.match(md, /- Move everything to a public cloud: 2 prospects, 0 won of 1 decided\./);
  const snap = snapshotFrom(pipeline(ex.workshops, ex.povs, CAT, D), facts, "Giulia R. (mock)", D);
  assert.ok(validSnapshot(snap));
  assert.deepEqual(snap.deals.find((d) => d.customer === "Ardesia Logistics (mock)").alts, ["Move everything to a public cloud"]);
  for (const bad of [[], ["x".repeat(61)], ["a", "a"], ["bad\u0007"]]) {
    const t = structuredClone(snap);
    t.deals[0].alts = bad;
    assert.equal(validSnapshot(t), false, JSON.stringify(bad));
  }
  const tv = teamView([snap], { includeExamples: true });
  assert.match(teamMarkdown(tv, D), /## What else customers weighed, across the team/);
});

test("the invented example weighs renewing and a public cloud", () => {
  const w = exampleWorkshop(D);
  assert.deepEqual(w.alts, ["renew", "public_cloud"]);
  assert.equal(validWorkshop(w), true);
});
