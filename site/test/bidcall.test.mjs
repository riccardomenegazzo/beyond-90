import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUESTIONS, GROUPS, validDecision, emptyDecision, withAnswer, withCall, readAnswers, review, reviewMarkdown, declineLetter } from "../bidcall.js";
import { parseRequirements, rfpState, nextSteps, rfpMarkdown, tendersOverview, validRfp, EXAMPLE_TENDER } from "../rfp.js";
import { makeWorkshop, addRequirements, setRequirement, setRfpMeta, setAward, setBidAnswer, setBidCall, setChannel, validWorkshop } from "../workshop.js";
import { pipeline, agenda } from "../desk.js";
import { forward } from "../forward.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";
const ws = () => makeWorkshop({ customer: "Comune di Esempio (mock)", scope: ["hci", "dr-backup"], createdOn: D, nonce: "abcdef" });
const tender = () => setRfpMeta(addRequirements(ws(), parseRequirements(EXAMPLE_TENDER), CAT, D), { title: "Lot 1 (mock)", questions_due: "2026-11-24", due: "2026-12-05" }, D);
const answerAll = (w, a = "yes") => ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15", "r16"].reduce((x, id) => setRequirement(x, id, { a, note: "How" }, D), w);
const byHand = (w, answers) => Object.entries(answers).reduce((x, [id, a]) => setBidAnswer(x, id, a, D), w);

test("eleven questions in four groups; four are read from the tender, three can exclude the bid", () => {
  assert.equal(QUESTIONS.length, 11);
  assert.deepEqual(Object.keys(GROUPS), ["take", "win", "worth", "deliver"]);
  assert.ok(QUESTIONS.every((q) => GROUPS[q.group] && q.text && q.hint));
  assert.deepEqual(QUESTIONS.filter((q) => q.read).map((q) => q.id), ["musts", "time", "award", "partner"]);
  assert.deepEqual(QUESTIONS.filter((q) => q.stop).map((q) => q.id), ["standing", "musts", "terms"]);
});

test("what the tender already says: the mandatory requirements, the time left, price and quality, the partner", () => {
  let w = tender();
  let read = readAnswers(w, rfpState(CAT, w, D));
  assert.deepEqual(read.musts, { a: "", why: "11 mandatory still to answer" });
  assert.deepEqual(read.time, { a: "yes", why: "16 days left, 16 requirements open" });
  assert.equal(read.award, undefined, "no comparison yet");
  assert.equal(read.partner, undefined, "no partner: not known, not no");
  w = setRequirement(answerAll(w), "r9", { a: "no" }, D);
  read = readAnswers(w, rfpState(CAT, w, "2026-12-03"));
  assert.deepEqual([read.musts.a, read.time.a], ["no", "yes"]);
  assert.deepEqual(readAnswers(tender(), rfpState(CAT, tender(), "2026-12-01")).time, { a: "partly", why: "4 days left, 16 requirements open" });
  assert.deepEqual(readAnswers(tender(), rfpState(CAT, tender(), "2026-12-03")).time.a, "no");
  assert.deepEqual(readAnswers(tender(), rfpState(CAT, tender(), "2026-12-06")).time, { a: "no", why: "the bid's date has passed" });
  w = setAward(w, { ours: { quality: 50, price: 900000 }, rivals: [{ name: "R", quality: 60, price: 1000000 }] }, D);
  assert.deepEqual(readAnswers(w, rfpState(CAT, w, D)).award, { a: "partly", why: "second at the price planned, first at a lower one" });
  w = setChannel(w, { partners: [{ name: "Verdi Sistemi (mock)", kind: "integrator", lead: true }], route: "reseller" }, D);
  assert.deepEqual(readAnswers(w, rfpState(CAT, w, D)).partner, { a: "yes", why: "Verdi Sistemi (mock) leads" });
});

test("the recommendation: a no that can exclude the bid stops it; unknowns are what to find out; much against is a doubt", () => {
  let w = answerAll(tender());
  let rv = rfpState(CAT, w, D).review;
  assert.equal(rv.level, "check");
  assert.match(rv.text, /^Answer the review first: 9 of 11 questions are not known yet\.$/);
  w = byHand(w, { standing: "yes", known: "partly", fair: "yes", proof: "yes", value: "yes", terms: "yes", people: "partly", partner: "yes" });
  rv = rfpState(CAT, w, D).review;
  assert.deepEqual([rv.level, rv.unknown.map((q) => q.id)], ["check", ["award"]]);
  assert.match(rv.text, /^Likely worth bidding; find out first: we can come first on price and quality\.$/);
  w = byHand(w, { award: "partly" });
  rv = rfpState(CAT, w, D).review;
  assert.deepEqual([rv.level, rv.text], ["bid", "Bid: nothing in the review excludes it, and little is against it."]);
  assert.equal(rv.questions.find((q) => q.id === "musts").from, "read");
  // the terms cannot be signed: do not bid, whatever else
  const stop = byHand(w, { terms: "no" });
  rv = rfpState(CAT, stop, D).review;
  assert.equal(rv.level, "no_bid");
  assert.equal(rv.text, "Do not bid as it stands. Answered no on a question that can exclude the bid: the contract terms are acceptable.");
  assert.equal(nextSteps(CAT, stop, D)[0].id, "review", "a stop other than the requirements leads what to do next");
  // much against, nothing that excludes it
  rv = rfpState(CAT, byHand(w, { known: "no", fair: "no", proof: "no" }), D).review;
  assert.deepEqual([rv.level, rv.text], ["doubt", "Think twice: 3 answered no. Bid only with a reason the review does not show."]);
  // an answer by hand wins over what the tender says; taking it back reads the tender again
  const typed = byHand(w, { musts: "partly" });
  assert.deepEqual(["a", "from", "why"].map((k) => rfpState(CAT, typed, D).review.questions.find((q) => q.id === "musts")[k]), ["partly", "typed", "all 11 mandatory met or partly"]);
  assert.equal(rfpState(CAT, byHand(typed, { musts: "" }), D).review.questions.find((q) => q.id === "musts").from, "read");
});

test("the team's call: dated, with why; not bidding takes the tender off the desk's risks, agenda and way forward", () => {
  let w = setRequirement(answerAll(tender()), "r9", { a: "no" }, D);
  assert.ok(pipeline([w], [], CAT, D)[0].risks.some((r) => /tender is not met/.test(r.text)));
  assert.ok(agenda([w], [], CAT, D).some((i) => i.kind === "tender"));
  w = setBidCall(w, "no_bid", "The terms ask for unlimited liability", D);
  assert.equal(validWorkshop(w), true);
  assert.deepEqual(w.rfp.decision, { a: {}, call: "no_bid", on: D, why: "The terms ask for unlimited liability" });
  const st = rfpState(CAT, w, D);
  assert.deepEqual(st.verdict, { level: "nobid", text: "We decided not to bid, on 2026-11-19. The terms ask for unlimited liability" });
  assert.deepEqual(nextSteps(CAT, w, D).map((x) => [x.id, x.act]), [["nobid", "copy-letter"]]);
  assert.equal(pipeline([w], [], CAT, D)[0].risks.some((r) => /tender/.test(r.text)), false);
  assert.equal(agenda([w], [], CAT, D).some((i) => i.kind === "tender"), false);
  assert.equal(JSON.stringify(forward(CAT, w, null, D)).includes("mandatory requirement of the tender"), false);
  const o = tendersOverview([w], CAT, D)[0];
  assert.deepEqual([o.call, o.next, o.verdict.level], ["no_bid", null, "nobid"]);
  assert.match(rfpMarkdown(CAT, w, D), /## Bid or no bid: Lot 1 \(mock\)\n\n\*\*Do not bid as it stands\.[\s\S]*Decided on 2026-11-19: we do not bid\. The terms ask/);
  // taken back, the tender is live again
  const back = setBidCall(w, "", "", D);
  assert.equal(back.rfp.decision, undefined);
  assert.ok(agenda([back], [], CAT, D).some((i) => i.kind === "tender"));
  // a call to bid keeps everything on the desk
  assert.ok(agenda([setBidCall(w, "bid", "", D)], [], CAT, D).some((i) => i.kind === "tender"));
});

test("the review for the bid meeting, and a polite letter declining", () => {
  const w = byHand(tender(), { standing: "yes", terms: "no" });
  const md = reviewMarkdown(w, rfpState(CAT, w, D).review);
  assert.match(md, /^## Bid or no bid: Lot 1 \(mock\)\n\n\*\*Do not bid as it stands/);
  assert.match(md, /### Can we take part\n\n- Yes \(can exclude the bid\): We, or the partner who bids/);
  assert.match(md, /- Not known \(can exclude the bid\): Every mandatory requirement can be met\./);
  assert.match(md, /- Yes: There is time to write a good response before it is due\. _Read from the tender: 16 days left, 16 requirements open\._/);
  const letter = declineLetter(w);
  assert.match(letter, /^Subject: "Lot 1 \(mock\)": our decision not to bid\n\nDear \[name\],/);
  assert.match(letter, /We value the relationship with Comune di Esempio \(mock\)/);
  assert.doesNotMatch(letter, /terms|liability/, "the letter gives no reason unless one is written in");
});

test("stored reviews are checked field by field, and nothing else gets in", () => {
  const good = withCall(withAnswer(emptyDecision(), "terms", "no"), "no_bid", D, " Too\u0007 risky ");
  assert.deepEqual(good, { a: { terms: "no" }, call: "no_bid", on: D, why: "Too risky" });
  assert.equal(validDecision(good), true);
  assert.equal(validDecision(emptyDecision()), true);
  for (const bad of [null, [], { ...good, extra: 1 }, { ...good, a: { lottery: "yes" } }, { ...good, a: { terms: "maybe" } }, { ...good, call: "later" },
    { ...good, on: "" }, { ...good, on: "19/11/2026" }, { ...good, why: "x".repeat(301) }, { ...good, why: "a\u0000b" }]) {
    assert.equal(validDecision(bad), false, JSON.stringify(bad));
  }
  assert.throws(() => withAnswer(null, "lottery", "yes"), /not part of the review/);
  assert.throws(() => withAnswer(null, "terms", "maybe"), /yes, partly or no/);
  assert.throws(() => withCall(null, "no_bid", "", ""), /date of the call/);
  const w = tender();
  assert.equal(validRfp({ ...w.rfp, decision: { ...good, call: "secret" } }), false);
  assert.equal(validRfp({ ...w.rfp, decision: good }), true);
  // a review alone keeps a tender; emptied, it goes
  const only = setBidAnswer(ws(), "terms", "yes", D);
  assert.ok(only.rfp.decision);
  assert.equal(setBidAnswer(only, "terms", "", D).rfp, undefined);
});
