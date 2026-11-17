// The next step at the foot of a view: one suggestion, worked out from the data, never a generic tip.
// Pure: given the view's id and the customer's data, it returns {text, go, open?, cta} or null.

const first = (actions, leak) => (actions || []).find((a) => !leak || a.leak === leak);

export function nextStep(view, { dash, score, done = new Set() }) {
  if (!dash || !score) return null;
  const acts = (dash.actions || []).filter((a) => !done.has(a.id));
  const units = (score.terms && score.terms.units) || "accounts";
  const S = (dash.findings && dash.findings.states) || {};
  const late = (score.relationship && score.relationship.reliability && score.relationship.reliability.overdue_open) || [];
  const e2e = score.end_to_end || {};
  const worstStop = Object.entries(e2e.first_break || {}).sort((a, b) => b[1] - a[1])[0];
  const act = (a, why) => a && { text: `${why} ${a.title} (+${a.effect.toFixed(1)} pts${a.unlocks ? `, finishes ${a.unlocks}` : ""}).`, go: "actions", open: a.id, cta: "Open the action" };
  switch (view) {
    case "overview":
      return worstStop && worstStop[1] ? { text: `Most ${units} stop first at ${worstStop[0]} (${worstStop[1]} of ${e2e.total}). See which ones.`, go: "accounts", open: `stop:${worstStop[0]}`, cta: `Open those ${units}` } : null;
    case "accounts":
      return act(first(acts, "L1") || first(acts, "L3"), "The action that moves these the most:");
    case "findings":
      return (S.unowned || 0) + (S.no_decision || 0) ? act(first(acts, "L4"), "Findings waiting on a person become one action:") : null;
    case "burndown":
      return (S.unowned || 0) ? { text: "Some findings past triage have no owner yet. Give them one first: nothing gets fixed without it.", go: "findings", cta: "Open findings" } : null;
    case "onboarding":
      return (e2e.first_break || {}).L1 ? { text: `${e2e.first_break.L1} of ${e2e.total} ${units} are not connected. See them with the reason for each.`, go: "accounts", open: "stop:L1", cta: `Open those ${units}` } : null;
    case "actions":
      return late.length ? { text: "Before the next call, look at what you owe: some promises are past their date.", go: "commitments", cta: "Open promises" }
        : { text: "Take the first actions into the next call: what to say, what to ask.", go: "prep", cta: "Prepare the call" };
    case "prep":
      return late.length ? { text: `Start from what you owe: ${late.length === 1 ? "1 promise is" : `${late.length} promises are`} past the date.`, go: "commitments", cta: "Open promises" }
        : { text: "When the call starts, keep the agenda and what was agreed in one place.", go: "call", cta: "On the call" };
    case "outlook":
      return act(first(acts), "What waiting costs is avoided by acting first on:");
    case "commitments":
      return { text: "With what you owe in view, prepare the next call.", go: "prep", cta: "Prepare the call" };
    case "pov":
      return { text: "Bring the proof of value into the next call: criteria, dates and the decision.", go: "prep", cta: "Prepare the call" };
    default:
      return null;
  }
}

/**
 * Answers for the search box: what the data says, each a sentence that leads where it is. A few hidden words per answer
 * ("late", "unowned", "risk") let a short query find it. Pure.
 */
export function answers({ dash, score, done = new Set() }) {
  if (!dash || !score) return [];
  const out = [];
  const units = (score.terms && score.terms.units) || "accounts";
  const NAME = { L1: "connected", L2: "seen", L3: "switched on", L4: "decided" };
  const e2e = score.end_to_end || {};
  for (const [k, n] of Object.entries(e2e.first_break || {})) if (n) out.push({ label: `${n} ${units} stop at ${k} ${NAME[k]}`, find: "stuck stage gap", go: "accounts", open: `stop:${k}` });
  if (e2e.total) out.push({ label: `${e2e.through} of ${e2e.total} ${units} pass every stage`, find: "end to end done finished complete", go: "today" });
  const late = (score.relationship && score.relationship.reliability && score.relationship.reliability.overdue_open) || [];
  if (late.length) out.push({ label: `${late.length} ${late.length === 1 ? "promise is" : "promises are"} overdue`, find: "late owe commitment", go: "commitments" });
  const S = (dash.findings && dash.findings.states) || {};
  const waiting = (S.unowned || 0) + (S.no_decision || 0);
  if (waiting) out.push({ label: `${waiting} findings past triage need an owner or a decision`, find: "unowned undecided triage", go: "findings" });
  const crit = dash.burndown && dash.burndown.open ? dash.burndown.open.critical || 0 : 0;
  if (crit) out.push({ label: `${crit} critical ${crit === 1 ? "finding is" : "findings are"} open`, find: "risk severe exposure", go: "burndown" });
  for (const a of (dash.actions || []).filter((x) => !done.has(x.id)).slice(0, 8)) {
    out.push({ label: `Action: ${a.title} (+${a.effect.toFixed(1)} pts)`, find: `${a.leak} todo next fix`, go: "actions", open: a.id });
  }
  return out;
}
