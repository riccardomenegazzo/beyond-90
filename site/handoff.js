// The note that lets someone else pick a customer up on Monday. Built from what the page already holds: the reading, the
// renewal, the contacts, the promises and what happened at earlier renewals. No DOM, so Node can test it.
//
// It never includes the TAM's private call notes (they are not stored), and it says what it is built from and when.
import { ledger } from "./commitments.js";

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const pc = (x) => (typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "n/a");
const STAGES = { L1: "accounts connected", L2: "inventory complete", L3: "capabilities on", L4: "findings owned and decided" };
const cell = (t) => clean(t).replace(/\|/g, "/");

/**
 * @param {{score:object, dash:object, result:{customer:string, as_of:string, input_hash?:string}, commitments?:object[], outcomes?:object[],
 *   history?:{as_of:string, yield:number}[], today:string, from?:string, to?:string}} p
 * @returns {string} Markdown
 */
export function buildHandoff({ score, dash, result, commitments = [], outcomes = [], history = [], today, from = "", to = "" }) {
  const L = [];
  const name = clean(result.customer);
  L.push(`# Handoff: ${name}`, "");
  L.push(`Data as of ${result.as_of}. Prepared on ${today}${from || to ? ` (${[from && `from ${clean(from)}`, to && `to ${clean(to)}`].filter(Boolean).join(" ")})` : ""}.`, "");

  // In short
  const health = dash.health, ren = dash.renewal, touch = dash.rhythm && dash.rhythm.touch;
  const short = [`Yield ${pc(score.yield)}${score.level ? `, level ${clean(score.level)}` : ""}.`];
  if (health && health.score != null) short.push(`Health indicator ${health.score}/100 (${clean(health.band)}), a hypothesis built from ${health.measured} of ${health.of} measured parts, not a measurement.`);
  if (ren && ren.date) short.push(`Renewal ${ren.date} (${ren.days} days)${ren.arr ? `, ARR ${Math.round(ren.arr).toLocaleString("en")}` : ""}${ren.status ? `, status ${clean(ren.status).replace("_", " ")}` : ""}.`);
  if (touch && touch.last_touch) short.push(`Last touch ${touch.last_touch}${touch.days_since != null ? ` (${touch.days_since} days ago)` : ""}; cadence every ${touch.cadence_days} days.`);
  L.push("## In short", "", ...short.map((s) => `- ${s}`), "");

  // Adoption
  const stages = score.stages || {};
  const weakest = Object.entries(stages).filter(([, s]) => s && typeof s.value === "number").sort((a, b) => a[1].value - b[1].value)[0];
  L.push("## Where adoption stands", "");
  for (const k of ["L1", "L2", "L3", "L4"]) if (stages[k] && typeof stages[k].value === "number") L.push(`- ${k} ${STAGES[k]}: ${pc(stages[k].value)}`);
  if (weakest) L.push("", `The weakest stage is ${weakest[0]} (${STAGES[weakest[0]]}).`);
  const acts = (dash.actions || []).slice(0, 3);
  if (acts.length) {
    L.push("", "Next best actions:", "");
    acts.forEach((a, i) => L.push(`${i + 1}. ${clean(a.title)} (about +${Number(a.effect).toFixed(1)} pts, ${a.hours} h, owner ${clean(a.owner) || "unassigned"})`));
  }
  L.push("");

  // Promises
  const book = ledger(commitments, today, { customer: result.customer });
  L.push("## What has been promised", "");
  if (!commitments.some((c) => c.customer === result.customer)) L.push("Nothing is recorded in the ledger for this customer. If promises were made, they are in someone's head or inbox: ask.", "");
  else {
    const row = (c, extra = "") => `- ${clean(c.what)} (${c.who ? clean(c.who) : "owner not said"}${c.due ? `, due ${c.due}` : ", no date"}${extra})`;
    if (book.late.length) L.push("Overdue:", "", ...book.late.map((c) => row(c, `, ${c.days_overdue} days late`)), "");
    if (book.soon.length) L.push("Due in the next 7 days:", "", ...book.soon.map((c) => row(c)), "");
    if (book.later.length || book.undated.length) L.push("Open:", "", ...[...book.later, ...book.undated].map((c) => row(c)), "");
    if (book.recent.length) L.push("Closed in the last 30 days:", "", ...book.recent.map((c) => `- ${clean(c.what)} (${c.status} on ${c.closed_on})`), "");
    if (!book.late.length && !book.soon.length && !book.later.length && !book.undated.length) L.push("Nothing open.", "");
  }

  // Renewal and people
  L.push("## Renewal and people", "");
  const watch = ((ren && ren.signals) || []).filter((s) => s.status && s.status !== "ok");
  if (watch.length) L.push("Renewal signals to watch:", "", ...watch.map((s) => `- ${clean(s.label)}: ${clean(s.detail)}`), "");
  const contacts = (score.relationship && score.relationship.contacts) || [];
  if (contacts.length) {
    L.push("| Contact | Role | Trust | Last contact |", "|---|---|---|---|");
    contacts.forEach((c) => L.push(`| ${cell(c.name)} | ${cell(c.role) || "-"} | ${c.rated ? cell(c.band) : "not rated"} | ${c.days_since_contact != null ? `${c.days_since_contact} days ago${c.stale ? " (stale)" : ""}` : "unknown"} |`));
    L.push("");
  } else L.push("No contacts are recorded.", "");

  // Movement
  const pts = (history || []).filter((h) => h && typeof h.yield === "number").sort((a, b) => a.as_of.localeCompare(b.as_of)).slice(-6);
  if (pts.length >= 2) {
    const d = (pts[pts.length - 1].yield - pts[0].yield) * 100;
    L.push("## How it has moved", "", pts.map((p) => `${p.as_of} ${pc(p.yield)}`).join(" → "), "", `${d >= 0 ? "Up" : "Down"} ${Math.abs(d).toFixed(1)} points over ${pts.length} saved readings.`, "");
  }

  // Risks
  const risks = [];
  const out = dash.outlook;
  if (out && out.loss_points < -0.5) risks.push(`If nothing is done, Yield drops about ${Math.abs(out.loss_points).toFixed(1)} points in ${out.horizon_days} days.`);
  const ob = dash.onboarding;
  if (ob && ob.listed_but_broken && ob.listed_but_broken.length) risks.push(`${ob.listed_but_broken.length} connector(s) are counted as connected but are not working.`);
  if (ob && ob.stalled && ob.stalled.length) risks.push(`${ob.stalled.length} onboarding(s) have stalled.`);
  if (ob && ob.secrets) for (const s of ob.secrets.filter((x) => x.days_left <= 14)) risks.push(`The secret of ${clean(s.connector)} expires on ${s.expires_on}.`);
  if (score.outcomes && score.outcomes.critical_open) risks.push(`${score.outcomes.critical_open} critical finding(s) are open.`);
  if (risks.length) L.push("## Risks to watch", "", ...risks.map((r) => `- ${r}`), "");

  // History at renewal
  const mine = outcomes.filter((o) => o.customer === result.customer).sort((a, b) => b.decided_on.localeCompare(a.decided_on));
  if (mine.length) L.push("## Earlier renewals", "", ...mine.map((o) => `- ${o.decided_on}: ${o.outcome}${o.note ? ` (${clean(o.note)})` : ""}; health before the decision ${o.reading.score != null ? o.reading.score : "n/a"}`), "");

  L.push("## Before you rely on this", "",
    `- Built from the data loaded in this browser${result.input_hash ? ` (input fingerprint ${String(result.input_hash).slice(0, 12)})` : ""} and the ledger and renewal log kept here. Check it with the customer before acting on it.`,
    "- The health indicator is a hypothesis. Yield is computed from the files.",
    "- Private notes from calls are not included: they are never stored with the data.", "");
  return L.join("\n");
}
