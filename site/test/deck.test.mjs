import test from "node:test";
import assert from "node:assert/strict";
import { heading, released, hintStrength, forKey, deckFrom, firstOpen, nextOpen, suggest, deckSummary, ORDER, THRESHOLD, REHEARSE, rehearseCards, rehearseSummary } from "../deck.js";

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

test("the next card still open goes on from where the deck is, round to the top, and says when none is left", () => {
  const cards = deckFrom(catalog, ["dr", "hci"]);
  assert.equal(nextOpen(cards, { "dr#2": { a: "gap" } }, 0), 2);
  assert.equal(nextOpen(cards, { "hci#0": { a: "gap" } }, 2), 0);
  const all = Object.fromEntries(cards.map((c) => [c.key, { a: "solved" }]));
  assert.equal(nextOpen(cards, all, 1), -1);
});

test("an answer set lays any few answers on the directions, with the keys in their order", async () => {
  const { answerSet, QUALIFY, DISCOVERY, direction, tally } = await import("../deck.js");
  assert.equal(direction(-50, 10), "left");
  assert.equal(direction(0, 0), null);
  assert.deepEqual(QUALIFY.order, ["known", "partly", "unknown"]);
  assert.equal(QUALIFY.toward(80, 0), "known");
  assert.equal(QUALIFY.toward(0, 80), null);                // down holds nothing in qualification
  assert.equal(QUALIFY.released(-100, 0), "unknown");
  assert.equal(QUALIFY.released(-40, 0), null);
  assert.equal(QUALIFY.fromKey("2"), "partly");
  assert.equal(QUALIFY.fromKey("4"), null);
  assert.equal(QUALIFY.fromKey("ArrowLeft"), "unknown");
  assert.deepEqual(QUALIFY.dir("partly"), { dx: 0, dy: -1, key: "ArrowUp", arrow: "up" });
  assert.equal(DISCOVERY.fromKey("ArrowDown"), "unknown");
  assert.equal(answerSet({ yes: "right", no: "left" }).released(200, 5), "yes");
  const cards = [{ key: "a", label: "A", q: { q: "Qa" } }, { key: "b", label: "B", q: { q: "Qb" } }, { key: "c", label: "C", q: { q: "Qc" } }];
  const t = tally(cards, (c) => ({ a: { a: "known", note: "yes" }, b: { a: "unknown", note: "" } })[c.key], ["known", "partly", "unknown"]);
  assert.deepEqual(t.counts, { known: 1, partly: 0, unknown: 1, open: 1 });
  assert.deepEqual(t.under.known, [{ key: "a", label: "A", q: "Qa", note: "yes" }]);
});

test("most useful first: open before answered, essential first, the least known lines and the untouched ones ahead", async () => {
  const { bestFirst } = await import("../deck.js");
  const cards = [
    { key: "a#0", line: "a", q: { q: "a0" } }, { key: "a#1", line: "a", q: { q: "a1", core: true } }, { key: "a#2", line: "a", q: { q: "a2" } },
    { key: "b#0", line: "b", q: { q: "b0" } }, { key: "b#1", line: "b", q: { q: "b1", core: true } },
  ];
  const answers = { "a#0": { a: "solved" }, "a#2": { a: "gap" } };
  const { cards: order, why } = bestFirst(cards, answers);
  assert.deepEqual(order.map((c) => c.key), ["b#1", "a#1", "b#0", "a#0", "a#2"]);
  assert.deepEqual(why["b#1"], ["Nothing asked on this line yet"]);
  assert.deepEqual(why["a#1"], []);
  const some = bestFirst(cards, { "a#0": { a: "solved" }, "b#0": { a: "unknown" } });
  assert.equal(some.cards[0].key, "b#1");
  assert.deepEqual(some.why["b#1"], ["Least known line"]);
});

test("the recap says how much was asked, the gaps and the unknowns with what was said, and what would need to be true", async () => {
  const { recapText, recapMailto } = await import("../deck.js");
  const cards = deckFrom({ lines: { dr: { label: "Disaster recovery", questions: [
    { q: "Could an administrator delete your backups?", stage: "L3", need: "No single account can delete the copies" },
    { q: "When was the last recovery test?", stage: "L2", need: "A recovery is tested" },
    { q: "Where is the second site?", stage: "L1" },
  ] } } }, ["dr"]);
  const text = recapText("Kestrel (mock)", cards, { "dr#0": { a: "gap", note: "Any admin can" }, "dr#1": { a: "unknown", note: "" } });
  assert.match(text, /^Discovery recap: Kestrel \(mock\)\n\nAsked 2 of 3 questions: 1 real gap, 1 nobody could answer, 0 partly, 0 solved\./);
  assert.match(text, /Real gaps\n- Could an administrator delete your backups\? "Any admin can"/);
  assert.match(text, /Nobody could answer\n- When was the last recovery test\?/);
  assert.match(text, /What would need to be true\n- A recovery is tested\n- No single account can delete the copies$/);        // in the order the list shows
  const link = recapMailto("Recap", "x".repeat(3000));
  assert.ok(link.startsWith("mailto:?subject=Recap&body=") && decodeURIComponent(link.split("body=")[1]).length === 1800);
});

test("who to invite next: the roles of the essential questions still open, most first", async () => {
  const { whoNext } = await import("../deck.js");
  const cards = [
    { key: "a", q: { q: "A?", core: true, role: "security" } }, { key: "b", q: { q: "B?", core: true, role: "security" } },
    { key: "c", q: { q: "C?", core: true, role: "executive" } }, { key: "d", q: { q: "D?", role: "architect" } },
    { key: "e", q: { q: "E?", core: true, role: "architect" } },
  ];
  assert.deepEqual(whoNext(cards, { e: { a: "solved" }, c: { a: "unknown" } }),
    [{ role: "security", n: 2, first: "A?" }, { role: "executive", n: 1, first: "C?" }]);
  assert.deepEqual(whoNext(cards, { a: { a: "gap" }, b: { a: "partly" }, c: { a: "solved" }, e: { a: "solved" } }), []);
});

test("the invitations read as sentences, and go into the recap", async () => {
  const { inviteLines, recapText } = await import("../deck.js");
  const cards = [{ key: "a", label: "DR", q: { q: "A?", core: true, role: "security" } }, { key: "b", label: "DR", q: { q: "B?", core: true, role: "security" } },
    { key: "c", label: "DR", q: { q: "C?", core: true, role: "application" } }];
  assert.deepEqual(inviteLines(cards, {}).map((x) => x.text), ["Invite the security team: 2 essential questions still open", "Invite the application owner: 1 essential question still open"]);
  assert.match(recapText("K", cards, { c: { a: "unknown" } }), /For the next meeting\n- Invite the security team: 2 essential questions still open\n- Invite the application owner: 1 essential question still open$/);
});

test("rehearsing the objections: the line to start with first, the ones raised first, and what to practise again", () => {
  const told = [
    { label: "Disaster recovery", objections: [
      { says: "We already have backups.", clarify: "When did you last restore?", answer: "Backups are copies.", prove: "Restore one.", key: "dr#0", index: 0, raised: false },
      { says: "Ransomware would encrypt the backups too.", clarify: "Who can delete them?", answer: "Locked copies.", prove: "Try to delete one.", key: "dr#1", index: 1, raised: true }] },
    { label: "Platform", objections: [{ says: "We have just bought new arrays.", clarify: "Until when?", answer: "Keep them.", prove: "Run on them.", key: "hci#0", index: 0, raised: false }] }];
  const cards = rehearseCards(told);
  assert.deepEqual(cards.map((c) => c.key), ["dr#1", "dr#0", "hci#0"]);
  assert.equal(cards[0].q.q, "“Ransomware would encrypt the backups too.”");
  assert.equal(cards[0].tag, "They raised it");
  assert.equal(cards[0].q.why, "Who can delete them?");
  assert.equal(REHEARSE.fromKey("ArrowRight"), "ready");
  assert.equal(REHEARSE.fromKey("2"), "again");
  assert.equal(REHEARSE.released(0, -200), null, "up and down mean nothing here");
  const seen = { "dr#1": { a: "ready", note: "" }, "dr#0": { a: "again", note: "forgot the restore question" } };
  const s = rehearseSummary(cards, (c) => seen[c.key] || null);
  assert.equal(s.head, "1 of 3 objections ready, 1 to practise again; 1 not rehearsed yet.");
  assert.deepEqual(s.lists[0][1].map((r) => r.key), ["dr#0"]);
  assert.equal(rehearseSummary(cards, () => null).head, "Nothing rehearsed yet.");
});
