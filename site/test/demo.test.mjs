import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REACTIONS, ORDER, DEMO, demoCards, demoSuggest, demoSummary, demoRecapText, demoFollowUps, cardsFor, proofFromDemo, customerNote, demoPace } from "../demo.js";
import { demoPlan, forward, demoTime } from "../forward.js";
import { exampleWorkshop, makeWorkshop, setDemo, setDemoSeen, validWorkshop, assess, mergeWorkshops } from "../workshop.js";
import { nextMeeting, agendaText } from "../nextmeeting.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";

test("four reactions on the four directions, in the order of their keys", () => {
  assert.deepEqual(ORDER, ["landed", "questions", "missed", "skipped"]);
  assert.equal(DEMO.fromKey("ArrowRight"), "landed");
  assert.equal(DEMO.fromKey("ArrowUp"), "questions");
  assert.equal(DEMO.fromKey("ArrowLeft"), "missed");
  assert.equal(DEMO.fromKey("4"), "skipped");
  assert.equal(DEMO.released(120, 10), "landed");
  assert.equal(DEMO.released(20, 10), null);
  for (const k of ORDER) assert.ok(REACTIONS[k].label && REACTIONS[k].tone, k);
});

test("one card per gap the demo closes, then one per concern they raised, each with a key of its own", () => {
  const w = exampleWorkshop(D);
  const plan = demoPlan(CAT, w);
  const cards = demoCards(plan);
  assert.equal(cards.length, plan.segments.length + plan.concerns.length);
  assert.equal(new Set(cards.map((c) => c.key)).size, cards.length, "a gap and a concern of the same line and number stay apart");
  assert.match(cards[0].q.q, /^Show that [a-z]/);
  assert.ok(cards.some((c) => /^For the security team$/.test(c.tag)));
  const said = cards.find((c) => /domain admin/.test(c.q.why));
  assert.ok(said, "what they said in discovery is on the back of the card");
  const concern = cards.find((c) => c.key.startsWith("c:"));
  assert.match(concern.q.q, /^Answer their concern: “/);
  assert.match(concern.q.why, /^The proof that settles it: /);
  assert.deepEqual(demoCards({ ready: false, segments: [], concerns: [] }), []);
  assert.deepEqual(cardsFor(CAT, w, assess(CAT, w)).map((c) => c.key), cards.map((c) => c.key));
  assert.doesNotMatch(JSON.stringify(cards), /nutanix|vmware|broadcom/i);
});

test("the words suggest a reaction, doubt before a question before a yes; nothing when nothing fits", () => {
  for (const [said, want] of [
    ["How long does a restore take?", "questions"],
    ["what about the branches", "questions"],
    ["Send us the details in writing", "questions"],
    ["That's exactly what we need", "landed"],
    ["Makes sense, love the runbook part", "landed"],
    ["We already have that with our current tool", "missed"],
    ["Too complex for our team", "missed"],
    ["Not convinced, to be honest", "missed"],
    ["", null],
    ["ok", null],
  ]) assert.equal(demoSuggest(said), want, said);
});

test("where the demo stands: landed out of what was shown, and the lists that matter after it", () => {
  const cards = demoCards(demoPlan(CAT, exampleWorkshop(D)));
  const seen = { [cards[0].key]: { a: "landed", note: "That's the one" }, [cards[1].key]: { a: "questions", note: "How long does a restore take?" },
    [cards[2].key]: { a: "missed", note: "" }, [cards[3].key]: { a: "skipped", note: "" } };
  const of = (c) => seen[c.key] || null;
  const s = demoSummary(cards, of);
  assert.equal(s.counts.landed, 1);
  assert.equal(s.open, cards.length - 4);
  assert.match(s.head, /^1 of 3 parts shown landed, 1 with questions, 1 did not land; \d not noted yet\.$/);
  assert.deepEqual(s.lists.map(([h, rows]) => [h, rows.length]), [["Questions to answer, in writing", 1], ["Did not land: ask what they expected", 1],
    ["Landed: what the proof should confirm", 1], ["Not shown: for the next meeting", 1]]);
  assert.equal(demoSummary(cards, () => null).head, "Nothing noted yet.");
  const t = demoRecapText("Kestrel (mock)", cards, of);
  assert.match(t, /^Demo recap: Kestrel \(mock\)/);
  assert.match(t, /Questions to answer, in writing\n- Show that .*"How long does a restore take\?"/);
  assert.match(t, /Next\n- Ask what they expected where it did not land/);
});

test("the reactions are kept on the workshop, beside the day it was given, and survive a merge", () => {
  let w = exampleWorkshop(D);
  const cards = demoCards(demoPlan(CAT, w));
  w = setDemoSeen(w, cards[0].key, "landed", "  That's   the one ", D);
  w = setDemoSeen(w, cards[4].key, "questions", "Which arrays?", D);
  assert.ok(validWorkshop(w));
  assert.deepEqual(w.demo, { seen: { [cards[0].key]: { a: "landed", note: "That's the one" }, [cards[4].key]: { a: "questions", note: "Which arrays?" } } });
  w = setDemo(w, D, D);
  assert.equal(w.demo.on, D);
  assert.equal(Object.keys(w.demo.seen).length, 2, "giving the demo keeps how it landed");
  w = setDemo(w, "", D);
  assert.equal(w.demo.on, undefined);
  assert.equal(Object.keys(w.demo.seen).length, 2, "and taking it back too");
  w = setDemoSeen(w, cards[0].key, "", "", D);
  w = setDemoSeen(w, cards[4].key, "", "", D);
  assert.equal(w.demo, undefined, "nothing left, nothing kept");
  assert.throws(() => setDemoSeen(w, "not a key", "landed", "", D));
  assert.throws(() => setDemoSeen(w, cards[0].key, "loved", "", D));
  for (const bad of [{}, { seen: {} }, { on: D, x: 1 }, { seen: { "dr-backup#2": { a: "wow", note: "" } } }, { seen: { "dr-backup#2": { a: "landed", note: "", y: 1 } } },
    { seen: { "c:dr-backup#2": { a: "landed", note: "x".repeat(301) } } }, { on: "2020-01-01" }]) assert.equal(validWorkshop({ ...w, demo: bad }), false, JSON.stringify(bad).slice(0, 60));
  const a = setDemoSeen(exampleWorkshop(D), cards[0].key, "landed", "", "2026-11-20");
  assert.deepEqual(mergeWorkshops([exampleWorkshop(D)], [a])[0].demo, a.demo);
});

test("what landed goes to the proof, the questions and what did not land to the next meeting", () => {
  let w = exampleWorkshop(D);
  const cards = demoCards(demoPlan(CAT, w));
  w = setDemoSeen(w, cards[0].key, "landed", "That's the one", D);
  w = setDemoSeen(w, cards[1].key, "questions", "How long does a restore take?", D);
  w = setDemoSeen(w, cards[2].key, "missed", "We have runbooks", D);
  w = setDemoSeen(w, cards[4].key, "landed", "", D);
  const fu = demoFollowUps(cards, w.demo);
  assert.equal(fu.noted, 4);
  assert.deepEqual(fu.answer.map((x) => x.part), [cards[1].part]);
  const proof = proofFromDemo(cards, w.demo);
  assert.equal(proof.length, 1, "a concern that landed is already a criterion of its own");
  assert.equal(proof[0].text, cards[0].part);
  assert.match(proof[0].target, /^Landed in the demo: "That's the one"\. Now on their own systems$/);
  const m = nextMeeting(CAT, w, D);
  assert.equal(m.demo.answer.length, 1);
  assert.equal(m.demo.again.length, 1);
  const t = agendaText(m);
  assert.match(t, /\d\. Back from the demo\n {3}- Your questions on: .*\("How long does a restore take\?"\)\n {3}- To show again, closer to your case: /);
  assert.doesNotMatch(t, /We have runbooks/, "what they said where it did not land stays with the account team");
  // the way forward asks for it, once the demo is given
  const f = forward(CAT, setDemo(w, D, D), null, D);
  assert.equal(f.phases[1].checks.find((c) => /landed/.test(c.text)).ok, true);
  assert.equal(forward(CAT, setDemo(exampleWorkshop(D), D, D), null, D).phases[1].checks.find((c) => /landed/.test(c.text)).ok, false);
  // with nothing noted, the agenda has no demo section
  assert.doesNotMatch(agendaText(nextMeeting(CAT, makeWorkshop({ customer: "A (mock)", scope: ["hci"], createdOn: D, nonce: "abcdef" }), D)), /Back from the demo/);
});

test("the note for the customer: what we showed against what they said, their questions to answer, the proof; no reaction named", () => {
  const cards = demoCards(demoPlan(CAT, exampleWorkshop(D)));
  const concern = cards.find((c) => c.key.startsWith("c:"));
  const seen = { [cards[0].key]: { a: "landed", note: "That's the one" }, [cards[1].key]: { a: "questions", note: "How long does a restore take?" },
    [cards[2].key]: { a: "missed", note: "We have runbooks already" }, [cards[3].key]: { a: "skipped", note: "" }, [concern.key]: { a: "questions", note: "" } };
  const t = customerNote("Kestrel Logistics (mock)", cards, (c) => seen[c.key] || null);
  assert.match(t, /^Thank you for your time today, Kestrel Logistics \(mock\)\./);
  assert.match(t, /What we showed, against what you told us\n- Every site/);
  assert.ok(t.includes(`- ${cards[1].part}. You told us: "${cards[1].heard}"`), "what they said in discovery, beside what was shown");
  assert.ok(!t.includes(cards[3].part), "what was not shown is not in it");
  assert.match(t, /The concerns you raised\n- ".*" We propose to prove it: /);
  assert.match(t, /Your questions, and our answers\n- "How long does a restore take\?"\n {2}Answer: \n- Your question on: /);
  assert.match(t, /What we propose next\n- A proof of value on your own systems, to confirm:\n {2}- Every site/);
  for (const internal of ["did not land", "Did not land", "We have runbooks already", "That's the one", "Landed", "landed"]) assert.ok(!t.includes(internal), internal);
  const none = customerNote("A (mock)", cards, () => null);
  assert.match(none, /A short call to agree what a proof of value/);
});

test("dealt for the length of the meeting, the cards say how long each part has and leave out what waits", () => {
  const plan = demoPlan(CAT, exampleWorkshop(D));
  const cards = demoCards(plan, demoTime(plan, 45));
  assert.equal(cards.length, 6);
  assert.match(cards[0].tag, /^For the architect, about 7 minutes$/);
  assert.match(cards[4].tag, /^Their concern, about 3 minutes$/);
  const short = demoCards(plan, demoTime(plan, 20));
  assert.deepEqual(short.map((c) => c.key), [plan.segments[0].key, ...plan.concerns.map((c) => c.key)]);
});

test("against the meeting clock, each card says whether the demo is on time, behind or ahead", () => {
  const plan = demoPlan(CAT, exampleWorkshop(D));
  const time = demoTime(plan, 45);                      // 5 minutes to open, 7 a gap, 3 a concern, 5 to close
  const cards = demoCards(plan, time);
  assert.deepEqual(demoPace(time, cards, 0, 6 * 60), { state: "on", minutes: 0, line: "On time: about 7 minutes for this part." });
  const late = demoPace(time, cards, 0, 14 * 60);
  assert.equal(late.state, "behind");
  assert.equal(late.minutes, 2);
  assert.match(late.line, /^2 minutes behind: keep this part to its point/);
  const early = demoPace(time, cards, 2, 10 * 60);    // the third gap starts at 19 minutes
  assert.equal(early.state, "ahead");
  assert.equal(early.minutes, 9);
  assert.equal(demoPace(time, cards, 4, 34 * 60).line, "On time: about 3 minutes for this part.", "a concern has three minutes");
  assert.equal(demoPace(time, cards, cards.length, 41 * 60).state, "close");
  assert.match(demoPace(time, cards, cards.length, 41 * 60).line, /^Time to close/);
  assert.equal(demoPace(time, cards, cards.length, 20 * 60).line, "");
});
