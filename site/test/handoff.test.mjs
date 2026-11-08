import test from "node:test";
import assert from "node:assert/strict";
import { buildHandoff } from "../handoff.js";
import { makeCommitment, withStatus } from "../commitments.js";

const result = { customer: "Northwind", as_of: "2026-10-31", input_hash: "abcdef0123456789abcdef" };
const score = { yield: 0.726, level: "bronze", stages: { L1: { value: 0.9 }, L2: { value: 0.97 }, L3: { value: 0.93 }, L4: { value: 0.65 } },
  outcomes: { critical_open: 3 }, relationship: { contacts: [
    { name: "Priya | Raman", role: "champion", rated: true, band: "strong", days_since_contact: 12, stale: false },
    { name: "Dan", role: "", rated: false, band: "", days_since_contact: 140, stale: true }] } };
const dash = { health: { score: 54, band: "at risk", measured: 4, of: 4 },
  renewal: { date: "2027-02-28", days: 120, arr: 480000, status: "at_risk", signals: [{ label: "Licences", status: "watch", detail: "sensors at 54%" }, { label: "Sponsor", status: "ok", detail: "fine" }] },
  rhythm: { touch: { last_touch: "2026-10-19", days_since: 12, cadence_days: 14 } },
  actions: [{ title: "Give owners to findings", effect: 4.2, hours: 6, owner: "platform" }],
  outlook: { loss_points: -3.4, horizon_days: 90 },
  onboarding: { listed_but_broken: ["a"], stalled: [], secrets: [{ connector: "azure-1", days_left: 5, expires_on: "2026-11-05" }] } };
const base = { score, dash, result, today: "2026-11-08" };

test("the handoff says what it is, for whom and from what", () => {
  const md = buildHandoff({ ...base, from: "Riccardo", to: "Marco" });
  assert.match(md, /^# Handoff: Northwind/);
  assert.match(md, /from Riccardo to Marco/);
  assert.match(md, /Yield 72\.6%, level bronze/);
  assert.match(md, /Health indicator 54\/100 \(at risk\), a hypothesis/);
  assert.match(md, /Renewal 2027-02-28 \(120 days\), ARR 480,000, status at risk/);
  assert.match(md, /The weakest stage is L4/);
  assert.match(md, /input fingerprint abcdef012345\b/);
  assert.match(md, /Private notes from calls are not included/);
});

test("without a ledger entry it asks rather than saying nothing is promised", () => {
  assert.match(buildHandoff(base), /Nothing is recorded in the ledger/);
});

test("promises are grouped by how late they are, and only this customer's appear", () => {
  const mk = (o) => makeCommitment({ customer: "Northwind", createdOn: "2026-10-20", source: "call", ...o });
  const commitments = [mk({ what: "Late thing", due: "2026-11-01", who: "me", nonce: "aaaaaa" }), mk({ what: "Soon thing", due: "2026-11-10", nonce: "bbbbbb" }),
    withStatus(mk({ what: "Done thing", nonce: "cccccc" }), "done", "2026-11-05"), makeCommitment({ customer: "Contoso", what: "Not mine", createdOn: "2026-10-20", nonce: "dddddd" })];
  const md = buildHandoff({ ...base, commitments });
  assert.match(md, /Overdue:\n\n- Late thing \(me, due 2026-11-01, 7 days late\)/);
  assert.match(md, /Due in the next 7 days:\n\n- Soon thing \(owner not said, due 2026-11-10\)/);
  assert.match(md, /Done thing \(done on 2026-11-05\)/);
  assert.doesNotMatch(md, /Not mine/);
});

test("people, risks, movement and earlier renewals appear when they exist, and a pipe cannot break the table", () => {
  const md = buildHandoff({ ...base, history: [{ as_of: "2026-08-31", yield: 0.6 }, { as_of: "2026-10-31", yield: 0.726 }],
    outcomes: [{ customer: "Northwind", decided_on: "2025-12-01", outcome: "renewed", note: "after the QBR", reading: { score: 61 } }, { customer: "Contoso", decided_on: "2025-01-01", outcome: "churned", note: "", reading: { score: 20 } }] });
  assert.match(md, /\| Priya \/ Raman \| champion \| strong \| 12 days ago \|/);
  assert.match(md, /\| Dan \| - \| not rated \| 140 days ago \(stale\) \|/);
  assert.match(md, /drops about 3\.4 points in 90 days/);
  assert.match(md, /1 connector\(s\) are counted as connected but are not working/);
  assert.match(md, /secret of azure-1 expires on 2026-11-05/);
  assert.match(md, /3 critical finding\(s\) are open/);
  assert.match(md, /2026-08-31 60\.0% → 2026-10-31 72\.6%/);
  assert.match(md, /2025-12-01: renewed \(after the QBR\); health before the decision 61/);
  assert.doesNotMatch(md, /churned/);
  assert.doesNotMatch(md, /Not rated.*ok/);
});

test("it copes with a customer that has almost nothing", () => {
  const md = buildHandoff({ score: { yield: 0.5, stages: {} }, dash: {}, result: { customer: "Tiny", as_of: "2026-10-31" }, today: "2026-11-08" });
  assert.match(md, /No contacts are recorded/);
  assert.doesNotMatch(md, /undefined|NaN|null/);
});
