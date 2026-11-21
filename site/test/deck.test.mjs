import test from "node:test";
import assert from "node:assert/strict";
import { heading, released, hintStrength, forKey, deckFrom, firstOpen, suggest, deckSummary, ORDER, THRESHOLD } from "../deck.js";

const catalog = {
  lines: {
    dr: { label: "Disaster recovery", questions: [
      { q: "Could an administrator account delete your backups today?", stage: "L3", role: "security", core: true },
      { q: "What would one day without your main site cost?", stage: "value", role: "executive", core: true },
      { q: "Where is the second site, and what is the network round-trip time between them?", stage: "L1", role: "architect" },
    ] },
    hci: { label: "Platform", questions: [{ q: "How far behind on upgrades are you?", stage: "L2", role: "operations" }] },
  },
};

test("a drag heads for the answer of its main axis: right solved, left a real gap, up partly, down nobody knows", () => {
  assert.equal(heading(40, 10), "solved");
  assert.equal(heading(-40, 10), "gap");
  assert.equal(heading(10, -40), "partly");
  assert.equal(heading(10, 40), "unknown");
  assert.equal(heading(0, 0), null);
});

test("letting go answers only past the threshold, and the hint grows from nothing to full on the way", () => {
  assert.equal(released(THRESHOLD - 1, 0), null);
  assert.equal(released(-THRESHOLD, 0), "gap");
  assert.equal(hintStrength(10, 0), 0);
  assert.equal(hintStrength(THRESHOLD, 0), 1);
  assert.ok(hintStrength(60, 0) > 0 && hintStrength(60, 0) < 1);
});

test("the keys: arrows as the gestures, 1 to 4 as in the list", () => {
  assert.deepEqual(ORDER, ["solved", "partly", "gap", "unknown"]);
  assert.equal(forKey("ArrowRight"), "solved");
  assert.equal(forKey("ArrowLeft"), "gap");
  assert.equal(forKey("ArrowUp"), "partly");
  assert.equal(forKey("ArrowDown"), "unknown");
  assert.equal(forKey("3"), "gap");
  assert.equal(forKey("5"), null);
  assert.equal(forKey("a"), null);
});

test("the deck follows the lines in scope and the order the list shows, through the meeting's filter", () => {
  const all = deckFrom(catalog, ["dr", "hci", "missing"]);
  assert.deepEqual(all.map((c) => c.key), ["dr#1", "dr#2", "dr#0", "hci#0"]);
  assert.equal(all[0].label, "Disaster recovery");
  const core = deckFrom(catalog, ["dr", "hci"], (key, q) => !!q.core);
  assert.deepEqual(core.map((c) => c.key), ["dr#1", "dr#0"]);
});

test("it starts at the first question with no answer, or at the top when all are answered", () => {
  const cards = deckFrom(catalog, ["dr"]);
  assert.equal(firstOpen(cards, { "dr#1": { a: "gap", note: "" } }), 1);
  assert.equal(firstOpen(cards, { "dr#1": { a: "gap" }, "dr#2": { a: "solved" }, "dr#0": { a: "partly" } }), 0);
});

test("the customer's words suggest an answer, and settle nothing when they say nothing", () => {
  const q = { q: "When was the last full recovery test?" };
  assert.equal(suggest(q, "We have never done a full test"), "gap");
  assert.equal(suggest(q, "Some systems, once a year"), "partly");
  assert.equal(suggest(q, "Tested every quarter, signed off"), "solved");
  assert.equal(suggest(q, "Not sure, I think the other team did"), "unknown");
  assert.equal(suggest(q, "Lisbon"), null);
  assert.equal(suggest(q, "ok"), null);
  assert.equal(suggest(q, ""), null);
});

test("on a question a yes answers badly, being able to delete is the gap and copies nobody can change are solved", () => {
  const q = catalog.lines.dr.questions[0];
  assert.equal(suggest(q, "Any domain admin can wipe the backup repository"), "gap");
  assert.equal(suggest(q, "Yes, sadly"), "gap");
  assert.equal(suggest(q, "No, the copies are immutable for 30 days"), "solved");
});

test("a round trip under about five milliseconds allows copies with no loss; beyond, it is only partly there", () => {
  const q = catalog.lines.dr.questions[2];
  assert.equal(suggest(q, "Second site 30 km away, around 2 ms"), "solved");
  assert.equal(suggest(q, "90 km, about 7,5 milliseconds"), "partly");
});

test("the summary counts each answer, keeps the gaps and the unknowns with what was said, and reads in one line", () => {
  const cards = deckFrom(catalog, ["dr", "hci"]);
  const s = deckSummary(cards, { "dr#0": { a: "gap", note: "Any admin can" }, "dr#1": { a: "unknown", note: "" }, "hci#0": { a: "gap", note: "" } });
  assert.deepEqual(s.counts, { solved: 0, partly: 0, gap: 2, unknown: 1, open: 1 });
  assert.deepEqual(s.gaps.map((g) => [g.key, g.note]), [["dr#0", "Any admin can"], ["hci#0", ""]]);
  assert.equal(s.unknown[0].label, "Disaster recovery");
  assert.equal(s.head, "2 real gaps, 1 nobody could answer, 1 still to ask.");
  assert.equal(deckSummary(cards.slice(0, 1), { "dr#1": { a: "gap" } }).head, "1 real gap, 0 nobody could answer.");
});
