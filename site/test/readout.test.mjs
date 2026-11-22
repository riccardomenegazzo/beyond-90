import test from "node:test";
import assert from "node:assert/strict";
import { RESULTS, ORDER, READOUT, readoutCards, resultOf, readoutSuggest, readoutSummary, readoutText, readoutAgenda, readoutIcs, readoutDay } from "../readout.js";
import { makePov, setCriterion, progress } from "../pov.js";

const D = "2026-11-22";
const pov = () => makePov({ customer: "Kestrel (mock)", createdOn: D, nonce: "abcdef", criteria: [
  { text: "Restore the order system in under four hours", target: "Timed, from the declaration" },
  { text: "No administrator account can delete the backups", target: "Tried with a domain admin" },
  { text: "Every branch has a copy of its workloads", target: "" },
  { text: "A missed recovery point alerts a named owner", target: "Within minutes" }] });

test("four results on the four directions, as the proof of value names them", () => {
  assert.deepEqual(ORDER, ["met", "partly", "not_met", "dropped"]);
  assert.equal(READOUT.fromKey("ArrowRight"), "met");
  assert.equal(READOUT.fromKey("ArrowLeft"), "not_met");
  assert.equal(READOUT.fromKey("2"), "partly");
  assert.equal(READOUT.released(0, 140), "dropped");
  for (const k of ORDER) assert.ok(RESULTS[k].label && RESULTS[k].tone, k);
});

test("one card per criterion still counted, with how we will know on the back", () => {
  let p = pov();
  p = setCriterion(p, "c4", { status: "dropped", evidence: "Out of scope, agreed with the sponsor" }, D);
  const cards = readoutCards(p);
  assert.deepEqual(cards.map((c) => c.key), ["c1", "c2", "c3"]);
  assert.equal(cards[0].label, "Criterion 1 of 3");
  assert.match(cards[0].q.why, /^How we will know: Timed/);
  assert.equal(cards[2].tag, "No target yet");
  assert.match(cards[2].q.why, /agree with the sponsor what counts/);
  const of = resultOf(p);
  assert.equal(of(cards[0]), null, "not tried yet is no answer");
  p = setCriterion(p, "c1", { status: "met", evidence: "3h40" }, D);
  assert.deepEqual(resultOf(p)(cards[0]), { a: "met", note: "3h40" });
});

test("the evidence suggests a result: a failure before a qualifier before a pass", () => {
  for (const [said, want] of [
    ["Restored in 3h40, under the 4h target", "met"],
    ["Restored within the window, sponsor confirmed", "met"],
    ["Failed: the restore took six hours", "not_met"],
    ["Could not delete it? No: the admin could delete the copy", "not_met"],
    ["Worked on two of three sites, the third next week", "partly"],
    ["Alerts arrive, but only by email", "partly"],
    ["", null],
    ["see the screenshots", null],
  ]) assert.equal(readoutSuggest(said), want, said);
});

test("where the readout stands, and the text for the account team", () => {
  let p = pov();
  p = setCriterion(p, "c1", { status: "met", evidence: "3h40 against 4h" }, D);
  p = setCriterion(p, "c2", { status: "not_met", evidence: "The domain admin could delete the copy" }, D);
  p = setCriterion(p, "c3", { status: "partly", evidence: "Two of three sites" }, D);
  const cards = readoutCards(p);
  const s = readoutSummary(cards, resultOf(p));
  assert.equal(s.head, "1 of 4 criteria met, 1 partly, 1 not met; 1 not tried yet.");
  assert.deepEqual(s.lists.map(([h, rows]) => [h, rows.length]), [["Not met: what it means for the decision", 1], ["Partly met: what is still needed", 1],
    ["Met, with the evidence", 1], ["Dropped, with the sponsor", 0]]);
  assert.equal(progress(p).met, s.counts.met, "the same count as the proof of value's own");
  const t = readoutText(p, cards, resultOf(p));
  assert.match(t, /^Proof of value readout: Kestrel \(mock\)\n\n1 of 4 criteria met/);
  assert.match(t, /Not met: what it means for the decision\n- No administrator account can delete the backups: The domain admin could delete the copy/);
  assert.match(t, /Not yet tried\n- A missed recovery point alerts a named owner/);
  assert.match(t, /Next\n- Agree with the sponsor what the criteria not met mean/);
  assert.equal(readoutSummary(readoutCards(pov()), resultOf(pov())).head, "Nothing tried yet.");
  assert.doesNotMatch(t, /nutanix|vmware|broadcom/i);
});

test("the readout's agenda for the sponsor: each criterion with how we will know, who should be there, no result", () => {
  let p = pov();
  p = { ...p, sponsor: "Head of infrastructure (mock)", problem: "Recovery after an attack is not proven", end: "2026-12-11" };
  p = setCriterion(p, "c2", { status: "not_met", evidence: "The domain admin could delete the copy" }, D);
  p = setCriterion(p, "c4", { status: "dropped", evidence: "" }, D);
  const a = readoutAgenda(p, "Monday 14 December");
  assert.match(a, /^Proof of value readout: Kestrel \(mock\), Monday 14 December\n\n1\. What we set out to prove: Recovery after an attack is not proven \(5 minutes\)/);
  assert.match(a, /2\. Criterion by criterion, with the evidence \(about 8 minutes each\)\n {3}- Restore the order system in under four hours \(how we will know: Timed, from the declaration\)/);
  assert.ok(!a.includes("A missed recovery point"), "a dropped criterion is not on the agenda");
  assert.ok(!a.includes("could delete"), "no result is in it");
  assert.match(a, /Who should be there: the sponsor \(Head of infrastructure \(mock\)\), whoever decides\.$/);
  assert.equal(readoutDay(p, D), "2026-12-14", "three days after the window, as the mutual plan has it");
  assert.equal(readoutDay({ ...p, end: "" }, D), "2026-11-29");
  const ics = readoutIcs(p, "2026-12-14", "20261122T000000Z");
  assert.match(ics, /DTSTART;VALUE=DATE:20261214/);
  assert.match(ics, /SUMMARY:Kestrel \(mock\): proof of value readout/);
});
