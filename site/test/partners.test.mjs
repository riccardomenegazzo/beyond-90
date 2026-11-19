import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KINDS, ROUTES, ACTIVITIES, validChannel, cleanChannel, channelState, whoLabel, partnerBrief, enablementKit } from "../partners.js";
import { makeWorkshop, setChannel, setAnswer, setRaised, exampleWorkshop, validWorkshop, assess, summaryMarkdown, readoutHtml } from "../workshop.js";

const CAT = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
const D = "2026-11-19";
const base = () => makeWorkshop({ customer: "Acme (mock)", scope: ["hci", "dr-backup"], createdOn: D, nonce: "abcdef" });

test("the kinds of partner, routes to purchase and steps of a deal are plain and vendor-neutral", () => {
  assert.deepEqual(Object.keys(KINDS), ["reseller", "integrator", "service_provider", "distributor", "consulting"]);
  assert.ok(Object.keys(ROUTES).includes("framework"));
  assert.deepEqual(ACTIVITIES.map((a) => a.id), ["discovery", "demo", "sizing", "proof", "proposal", "delivery", "support"]);
  assert.doesNotMatch(JSON.stringify([KINDS, ROUTES, ACTIVITIES]), /nutanix|vmware|broadcom/i);
});

test("what the page gives is cleaned before it is kept, and who-does-what follows the partners that remain", () => {
  const c = cleanChannel({
    partners: [{ name: "  ", kind: "reseller" }, { name: " Verdi\nSistemi (mock) ", kind: "integrator", lead: true, reg: { on: "2026-11-01", until: "2027-02-01" }, skills: ["hci", "hci", "NOT OK"] },
      { name: "Nord (mock)", kind: "bogus", lead: true, reg: { on: "2026-12-01", until: "2026-11-01" } }],
    route: "distribution", split: { discovery: "both", delivery: "p1", proof: "p0", support: "p2", nonsense: "us" },
  });
  assert.equal(c.partners.length, 2);
  assert.equal(c.partners[0].name, "Verdi Sistemi (mock)");
  assert.deepEqual(c.partners[0].skills, ["hci"]);
  assert.equal(c.partners[1].kind, "reseller", "an unknown kind falls back to reseller");
  assert.equal(c.partners[1].lead, undefined, "one lead at most");
  assert.equal(c.partners[1].reg, undefined, "dates out of order are dropped");
  assert.deepEqual(c.split, { discovery: "both", delivery: "p0", support: "p1" }, "references follow the partners kept; the removed one's step is unassigned");
  assert.ok(validChannel(c));
  assert.equal(cleanChannel({ partners: [{ name: "" }] }), null);
  for (const bad of [{}, { partners: [] }, { partners: [{ name: "A", kind: "reseller" }], extra: 1 }, { partners: [{ name: "A", kind: "reseller", lead: true }, { name: "B", kind: "reseller", lead: true }] },
    { partners: [{ name: "A", kind: "reseller" }], split: { proof: "p1" } }, { partners: [{ name: "A\u0007", kind: "reseller" }] }, { partners: [{ name: "A", kind: "reseller", reg: { on: D } }] },
    { partners: [{ name: "A", kind: "reseller" }], route: "smuggling" }, { partners: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}`, kind: "reseller" })) }]) assert.equal(validChannel(bad), false, JSON.stringify(bad));
  let w = setChannel(base(), c, D);
  assert.ok(validWorkshop(w));
  assert.equal(validWorkshop({ ...w, channel: { ...w.channel, partners: [{ name: "X", kind: "reseller", note: "secret" }] } }), false);
  w = setChannel(w, null, D);
  assert.equal("channel" in w, false);
  assert.equal(whoLabel(c, "us"), "Us");
  assert.equal(whoLabel(c, "both"), "Together");
  assert.equal(whoLabel(c, "p1"), "Nord (mock)");
  assert.equal(whoLabel(c, ""), "Not agreed");
});

test("the registration, the steps nobody owns and the skills a partner lacks are what to settle", () => {
  let w = setChannel(base(), { partners: [{ name: "Verdi (mock)", kind: "integrator", lead: true, reg: { on: "2026-09-01", until: "2026-11-26" }, skills: ["hci"] }],
    split: { discovery: "both", delivery: "p0" } }, D);
  let st = channelState(CAT, w, D);
  assert.equal(st.reg.status, "expiring");
  assert.equal(st.reg.days, 7);
  const text = st.warnings.map((x) => x.text).join("\n");
  assert.match(text, /runs out in 7 days/);
  assert.match(text, /Nobody owns proof of value yet/);
  assert.match(text, /without skills on Disaster recovery/);
  assert.match(text, /route to purchase is not set/);
  assert.deepEqual(st.gaps[0].activities, ["deployment and migration"]);
  w = setChannel(w, { ...w.channel, partners: [{ ...w.channel.partners[0], reg: { on: "2026-09-01", until: "2026-11-01" } }] }, D);
  st = channelState(CAT, w, D);
  assert.equal(st.reg.status, "expired");
  assert.equal(st.warnings[0].level, "high");
  w = setChannel(w, { partners: [{ name: "Nord (mock)", kind: "distributor" }], route: "distribution", split: { discovery: "us", proof: "us", delivery: "us" } }, D);
  st = channelState(CAT, w, D);
  assert.equal(st.warnings.length, 0, "a distributor alone needs no registration, and everything is owned");
  assert.equal(channelState(CAT, base(), D), null);
});

test("the brief for the partner carries who does what and where the customer stands; their words only when asked", () => {
  let w = setChannel(base(), { partners: [{ name: "Verdi (mock)", kind: "integrator", lead: true, skills: ["hci"] }], route: "reseller", split: { proof: "both", delivery: "p0" } }, D);
  ["gap", "gap", "gap", "partly"].forEach((a, i) => { w = setAnswer(w, "dr-backup", i, a, i === 0 ? "A day down costs 2M" : i === 2 ? "Branches have no copy" : "", D); });
  w = setRaised(w, "dr-backup", 0, true, D);
  const res = assess(CAT, w);
  const plain = partnerBrief(CAT, w, res, { today: D });
  assert.match(plain, /^# Brief for Verdi \(mock\): Acme \(mock\)/);
  assert.match(plain, /\| Deployment and migration \| Verdi \(mock\) \|/);
  assert.match(plain, /\| Proof of value \| Together \|/);
  assert.match(plain, /Route to purchase: through a reseller\./);
  assert.match(plain, /## Concerns they raised/);
  assert.match(plain, /## Skills to line up/);
  assert.doesNotMatch(plain, /2M|Branches have no copy/, "no customer's words unless asked");
  const words = partnerBrief(CAT, w, res, { today: D, words: true });
  assert.match(words, /A day down costs 2M/);
  assert.match(words, /keep it to the people on the deal/);
});

test("the enablement kit holds the essential questions, the objections, the proof and the first day, and no customer", () => {
  const kit = enablementKit(CAT, ["hci", "dr-backup", "nope"]);
  assert.match(kit, /^# Discovery kit for partners/);
  for (const p of ["hci", "dr-backup"]) {
    const line = CAT.lines[p];
    assert.ok(kit.includes(`## ${line.label}`));
    for (const q of line.questions.filter((x) => x.core)) assert.ok(kit.includes(q.q), q.q);
    assert.ok(kit.includes(line.proof[0].text));
    assert.ok(kit.includes(`- [ ] ${line.readiness[0]}`));
    assert.ok(kit.includes(line.story.objections[0].says));
  }
  assert.match(kit, /## Qualify the deal, the same way on every line/);
  assert.equal((kit.match(/^\d+\. (Pain|Event|Metrics|Economic buyer|Decision criteria|Decision process|Paper process|Technical validation|Champion|Competition): /gm) || []).length, 10);
  assert.doesNotMatch(kit, /\(mock\)/);
});

test("the example sells through an integrator and a distributor, in the summary but never in the customer readout", () => {
  const w = exampleWorkshop(D);
  assert.ok(validWorkshop(w));
  const st = channelState(CAT, w, D);
  assert.equal(st.lead.name, "Verdi Sistemi (mock)");
  assert.equal(st.reg.status, "active");
  assert.ok(st.gaps.length >= 1, "the integrator is asked to deliver lines it has no skills on");
  const res = assess(CAT, w);
  assert.match(summaryMarkdown(CAT, w, res), /## Partners[\s\S]*Verdi Sistemi \(mock\): systems integrator, leads the deal, registered/);
  assert.doesNotMatch(readoutHtml(CAT, w, res, { today: D }), /Verdi Sistemi|Nord Distribuzione|registration/);
});
