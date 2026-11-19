import test from "node:test";
import assert from "node:assert/strict";
import { DEAL, GATES, STATES, validDeal, withDealAnswer, dealState, dealMarkdown } from "../qualify.js";
import { makeWorkshop, setDeal, validWorkshop, exampleWorkshop, summaryMarkdown, readoutHtml, assess } from "../workshop.js";
import { readFileSync } from "node:fs";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";

test("ten questions, the same on every line, each with what to listen for and the follow-up", () => {
  assert.equal(DEAL.length, 10);
  assert.equal(new Set(DEAL.map((d) => d.id)).size, 10);
  for (const d of DEAL) {
    assert.ok(d.q.endsWith("?") && d.probe.endsWith("?") && d.listen && d.why && d.tag, d.id);
    assert.doesNotMatch(JSON.stringify(d), /nutanix|vmware|broadcom/i);
  }
  // every gate asks only for questions that exist, and each asks for at least what the one before it did
  for (let i = 0; i < GATES.length; i++) {
    for (const id of Object.keys(GATES[i].needs)) assert.ok(DEAL.some((d) => d.id === id), id);
    if (i) for (const id of Object.keys(GATES[i - 1].needs)) assert.ok(id in GATES[i].needs, `${GATES[i].id} keeps ${id}`);
  }
  assert.deepEqual(Object.keys(STATES), ["known", "partly", "unknown"]);
});

test("the deal moves through the gates only when what each needs is known", () => {
  assert.equal(dealState(null).verdict, "Not qualified yet");
  let d = null;
  d = withDealAnswer(d, "why_change", "partly", "Renewal triples the cost", D);
  let s = dealState(d);
  assert.equal(s.verdict, "Keep discovering");
  assert.equal(s.next.id, "demo");
  assert.deepEqual(s.missing.map((m) => m.id), ["outcome", "proof"]);
  for (const id of ["outcome", "proof"]) d = withDealAnswer(d, id, "partly", "", D);
  s = dealState(d);
  assert.equal(s.passed, "demo");
  assert.equal(s.verdict, "Ready for a demo built for them");
  assert.ok(s.missing.some((m) => m.id === "why_change" && m.a === "partly" && m.min === "known"), "partly is not enough for a proof");
  for (const id of ["why_change", "why_now", "outcome", "criteria", "proof"]) d = withDealAnswer(d, id, "known", "", D);
  for (const id of ["decider", "champion"]) d = withDealAnswer(d, id, "partly", "", D);
  s = dealState(d);
  assert.equal(s.passed, "proof");
  assert.equal(s.score, 60);
  for (const id of ["decider", "champion", "process", "paper"]) d = withDealAnswer(d, id, "known", "", D);
  d = withDealAnswer(d, "alternatives", "partly", "", D);
  s = dealState(d);
  assert.equal(s.passed, "commit");
  assert.equal(s.next, null);
  assert.equal(s.missing.length, 0);
  // an answer the gate before needed and that went back to "not yet" closes the later gates too
  d = withDealAnswer(d, "outcome", "unknown", "", D);
  assert.equal(dealState(d).passed, "");
});

test("only a well-formed deal is kept, and clearing the last answer removes it", () => {
  const d = withDealAnswer(null, "decider", "known", " The CIO,\nmet on Monday ", D);
  assert.equal(d.decider.note, "The CIO, met on Monday");
  assert.ok(validDeal(d));
  assert.equal(withDealAnswer(d, "decider", "", "", D), null);
  assert.throws(() => withDealAnswer(d, "budget", "known", "", D));
  assert.throws(() => withDealAnswer(d, "decider", "yes", "", D));
  for (const bad of [{}, [], { x: { a: "known", note: "", on: D } }, { decider: { a: "known", note: "", on: D, extra: 1 } }, { decider: { a: "known", note: "x".repeat(301), on: D } }, { decider: { a: "known", note: "", on: "soon" } }]) assert.equal(validDeal(bad), false);
  let w = makeWorkshop({ customer: "Acme (mock)", scope: ["hci"], createdOn: D, nonce: "abcdef" });
  w = setDeal(w, "why_now", "known", "End of support in June", D);
  assert.ok(validWorkshop(w) && w.deal.why_now.a === "known");
  w = setDeal(w, "why_now", "", "", D);
  assert.equal("deal" in w, false);
  assert.equal(validWorkshop({ ...w, deal: { why_now: { a: "maybe", note: "", on: D } } }), false);
});

test("the example is ready for a demo built for it, and the deal stays out of the customer readout", () => {
  const w = exampleWorkshop(D);
  const s = dealState(w.deal);
  assert.equal(s.passed, "demo");
  assert.equal(s.next.id, "proof");
  const res = assess(CAT, w);
  const md = summaryMarkdown(CAT, w, res);
  assert.match(md, /## The deal/);
  assert.match(md, /To be ready to propose a proof of value, find out:/);
  assert.match(dealMarkdown(w.deal), /\| Decision criteria: .+ \| Not yet \|/);
  const html = readoutHtml(CAT, w, res, { today: D });
  assert.doesNotMatch(html, /Economic buyer|Champion|The deal|have not met her/);
});
