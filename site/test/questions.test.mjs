import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aheadText, AHEAD_MAX } from "../questions.js";

const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const aheadOf = (p) => cat.lines[p].questions.map((q, i) => ({ q, i })).filter((x) => x.q.ahead);

test("the questions to send ahead: the factual ones on the lines in scope, grouped by who would answer them", () => {
  const w = { scope: ["hci", "dr-backup"], answers: {} };
  const { text, count } = aheadText(cat, w, "2 December");
  assert.equal(count, aheadOf("hci").length + aheadOf("dr-backup").length);
  assert.ok(text.startsWith("Before our meeting on 2 December: a few facts your team could send us in advance"));
  for (const p of ["hci", "dr-backup"]) for (const { q } of aheadOf(p)) assert.ok(text.includes(`- ${q.q}`), q.q);
  // grouped by who answers, in the usual order of roles, each group once
  const heads = text.split("\n").filter((l) => l.startsWith("For "));
  assert.deepEqual(heads, [...new Set(heads)]);
  assert.ok(heads.indexOf("For the architects:") < heads.indexOf("For operations:"));
  // nothing of what was said or noted goes in it, and nothing from lines out of scope
  assert.ok(!aheadOf("dbaas").some(({ q }) => text.includes(q.q)));
});

test("an answered question is not sent again, nothing is sent when all are answered, and the note stays short", () => {
  const [first] = aheadOf("hci");
  const w = { scope: ["hci"], answers: { [`hci#${first.i}`]: { a: "gap", note: "Eleven plants, two of them on old servers" } } };
  const { text, count } = aheadText(cat, w);
  assert.equal(count, aheadOf("hci").length - 1);
  assert.ok(!text.includes(first.q.q) && !text.includes("Eleven plants") && text.startsWith("Before our meeting: "));
  const all = Object.fromEntries(aheadOf("hci").map(({ i }) => [`hci#${i}`, { a: "solved" }]));
  assert.deepEqual(aheadText(cat, { scope: ["hci"], answers: all }), { text: "", count: 0 });
  assert.deepEqual(aheadText(cat, { scope: [], answers: {} }), { text: "", count: 0 });
  const every = Object.keys(cat.lines);
  assert.ok(aheadText(cat, { scope: every, answers: {} }).count <= AHEAD_MAX);
});
