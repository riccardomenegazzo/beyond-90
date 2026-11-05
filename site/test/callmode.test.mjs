import test from "node:test";
import assert from "node:assert/strict";
import { newCall, callOutput } from "../callmode.js";

const prep = { items: [
  { id: "owed", title: "Start with what we owe", points: ["Introduce the detection specialist (was due 2026-10-15)"] },
  { id: "onboarding", title: "Unblock onboarding", points: ["Admin consent was never granted"] },
  { id: "ask", title: "Questions worth asking", points: ["Who decides?"] },
  { id: "close", title: "End by agreeing next steps", points: [] },
] };

test("a new call starts from the prepared agenda with nothing covered", () => {
  const c = newCall(prep);
  assert.deepEqual(c.items.map((i) => i.id), ["owed", "onboarding", "ask"]);
  assert.ok(c.items.every((i) => !i.covered && i.note === ""));
  assert.deepEqual(c.ours, ["Introduce the detection specialist (was due 2026-10-15)"]);
  assert.deepEqual(c.agreed, []);
});

function finished() {
  const c = newCall(prep);
  c.items[0].covered = true; c.items[1].covered = true;
  c.items[0].note = "PRIVATE: they sounded tired of us";
  c.agreed = [{ what: "Grant admin consent", who: "identity team", when: "2026-11-11" }, { what: "=HYPERLINK(\"x\")", who: "", when: "soon" }, { what: "  ", who: "x", when: "" }];
  return callOutput({ customer: "Northwind", date: "2026-11-05", contact: "Ana Rossi", call: c });
}

test("the recap says what was covered and agreed, and never the private notes", () => {
  const o = finished();
  assert.match(o.recap.subject, /Northwind: recap of our call on 2026-11-05/);
  assert.match(o.recap.body, /Start with what we owe/);
  assert.match(o.recap.body, /Grant admin consent \(identity team, by 2026-11-11\)/);
  assert.ok(!o.recap.body.includes("PRIVATE") && !o.touch.summary.includes("PRIVATE") && !o.csv.includes("PRIVATE"));
  assert.ok(!o.recap.body.includes("Questions worth asking"), "an item that was not covered is not in the recap");
  assert.match(o.recap.body, /^Hi Ana,/);
});

test("empty agreements are dropped and a free-text date is not kept as a date", () => {
  const o = finished();
  assert.equal(o.agreed.length, 2);
  assert.equal(o.agreed[1].when, "");
});

test("the log line is short and its next step is the first thing agreed", () => {
  const o = finished();
  assert.ok(o.touch.summary.length <= 300 && o.touch.summary.startsWith("Covered:"));
  assert.equal(o.touch.next_step, "Grant admin consent");
  assert.equal(o.touch.next_due, "2026-11-11");
});

test("the CSV lists what was agreed and what we owe, and cannot start a formula", () => {
  const o = finished();
  const lines = o.csv.trim().split("\n");
  assert.equal(lines[0], "Action,Owner,Due date,Customer,Call date,Source");
  assert.equal(lines.length, 4);
  assert.ok(lines.some((l) => l.includes("us,") && l.includes("we owe")));
  assert.ok(lines.some((l) => l.startsWith("'=HYPERLINK") || l.startsWith("\"'=HYPERLINK")));
  assert.ok(!lines.slice(1).some((l) => /^[=+\-@]/.test(l)));
});

test("a call with nothing in it still produces a valid, empty result", () => {
  const o = callOutput({ customer: "X", date: "2026-11-05", call: { items: [], agreed: [], ours: [] } });
  assert.equal(o.touch.summary, "");
  assert.equal(o.touch.next_step, "");
  assert.equal(o.csv.trim().split("\n").length, 1);
});
