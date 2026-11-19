import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorkshop, setAnswer, setPlan, setRaised, setWorth, assess, exampleWorkshop } from "../workshop.js";
import { makePov, setCriterion } from "../pov.js";
import { povFor, promisesFrom, handoverMarkdown } from "../delivery.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-02";

function prospect() {
  let w = makeWorkshop({ customer: "Acme (mock)", scope: ["dr-backup", "hci"], createdOn: D, nonce: "abcdef" });
  ["gap", "gap", "gap", "partly", "gap", "unknown"].forEach((a, i) => { w = setAnswer(w, "dr-backup", i, a, "", D); });
  w = setWorth(w, "dr-backup", 0, 2000000, "day", D);
  w = setPlan(w, "dr-backup", 2, "together", "2026-12-15", D);
  w = setPlan(w, "dr-backup", 4, "customer", "2026-12-20", D);
  w = setRaised(w, "dr-backup", 3, true, D);
  return w;
}

test("the handover carries what was proven, what was agreed, and what the customer asked us to prove", () => {
  const w = prospect();
  const res = assess(CAT, w);
  let pov = makePov({ customer: "Acme (mock)", createdOn: D, criteria: [...res.proof.slice(0, 2).map((c) => ({ text: c.text, target: c.how })), { text: res.raised[0].prove, target: "" }] });
  pov = setCriterion(pov, "c1", { status: "met", evidence: "Restored in 14 minutes" }, D);
  const promises = promisesFrom(CAT, w, pov);
  assert.ok(promises.some((p) => p.from === "proven" && p.what.startsWith("Keep true in production: ")));
  const agreed = promises.filter((p) => p.from === "agreed");
  assert.equal(agreed.length, 1, "only what we, or we and the customer together, agreed to make true");
  assert.equal(agreed[0].who, "Together");
  assert.equal(agreed[0].due, "2026-12-15");
  assert.ok(promises.some((p) => p.from === "asked" && p.what.startsWith("Prove: ")), "a concern not yet proven stays a promise");
  const md = handoverMarkdown(CAT, w, pov, "2026-11-20");
  assert.match(md, /^# Handover to delivery: Acme \(mock\)/);
  assert.match(md, /Proof of value: in progress \(1 of 3 criteria met/);
  assert.match(md, /\| .* \| Met \| Restored in 14 minutes \|/);
  assert.match(md, /## What the customer asked us to prove/);
  assert.match(md, /\*\*Not yet tried\.\*\*/);
  assert.match(md, /2,000,000 per day/);
  assert.match(md, /## Promises to keep after go-live/);
  assert.match(md, /## Who to keep involved/);
  // once the concern is proven, it is no longer an open promise
  const proven = setCriterion(pov, "c3", { status: "met", evidence: "Delete refused" }, D);
  assert.ok(!promisesFrom(CAT, w, proven).some((p) => p.from === "asked"));
});

test("without a proof of value the handover says so, and promises are never repeated", () => {
  const w = prospect();
  const md = handoverMarkdown(CAT, w, null, "2026-11-20");
  assert.match(md, /No proof of value is kept for this prospect yet\./);
  const p = promisesFrom(CAT, w, null);
  assert.equal(new Set(p.map((x) => x.what.toLowerCase())).size, p.length);
  assert.ok(p.every((x) => x.what.length <= 300));
});

test("the proof of value is found by the prospect's name, the latest first", () => {
  const a = { customer: "Acme (mock)", created_on: "2026-11-01", updated_on: "2026-11-05", id: "a" };
  const b = { customer: "acme (mock) ", created_on: "2026-11-02", updated_on: "2026-11-09", id: "b" };
  const c = { customer: "Other", created_on: "2026-11-03", updated_on: "2026-11-10", id: "c" };
  assert.equal(povFor([a, b, c], "Acme (mock)").id, "b");
  assert.equal(povFor([c], "Acme (mock)"), null);
  assert.equal(povFor(null, "x"), null);
});

test("the handover says who delivers, with the skills still to line up before go-live", () => {
  const w = exampleWorkshop("2026-11-19");
  const md = handoverMarkdown(CAT, w, null, "2026-11-19");
  assert.match(md, /## Who delivers\n\n- Deployment and migration: Verdi Sistemi \(mock\)\.\n- Support after go-live: Verdi Sistemi \(mock\)\./);
  assert.match(md, /- Nord Distribuzione \(mock\): distributor\./);
  assert.match(md, /To line up before go-live: Verdi Sistemi \(mock\) has no skills yet on /);
  const bare = handoverMarkdown(CAT, { ...w, channel: undefined }, null, "2026-11-19");
  assert.doesNotMatch(bare, /## Who delivers/);
});

test("the handover carries the edge design and the cost per machine when their lines are in scope", async () => {
  const { setEdge, setUnit } = await import("../workshop.js");
  let w = makeWorkshop({ customer: "Faro Stores (mock)", scope: ["edge-sites", "cloud-operations"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setEdge(w, { window_h: 8 }, "2026-11-02");
  w = setUnit(w, { machines: 300, licences_year: 180000, tenant_vms: 10 }, "2026-11-02");
  const md = handoverMarkdown(CAT, w, null, "2026-11-20");
  assert.match(md, /Edge design: 198 servers at 156 sites in 3 standard designs \(small sites: 1 a site; large sites: 2 a site; plants: 3 a site\), a witness for 30 two-server sites; upgrades in about/);
  assert.match(md, /Cost per machine: 50 a month all in, across 300 machines; a standard tenant costs 500 a month/);
});
