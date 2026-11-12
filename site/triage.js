// Plain-language answers for the Accounts and Findings views. Pure functions: no DOM, no storage.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The units to look at first: not connected beats everything, then critical findings, then most gaps.
export function accountsFirst(rows, limit = 3) {
  const score = (r) => (r.connected ? 0 : 1000) + (r.open_critical || 0) * 50 + (r.issues || 0) * 5 + (r.owner ? 0 : 3);
  return rows.map((r) => ({ r, s: score(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || String(a.r.id).localeCompare(String(b.r.id))).slice(0, limit).map((x) => x.r);
}

export function accountsAnswer(rows, terms) {
  const n = rows.length;
  if (!n) return { lead: `No ${terms.units} in scope yet.`, detail: "Add accounts.csv to see where coverage stops." };
  const off = rows.filter((r) => !r.connected).length, gaps = rows.filter((r) => r.issues > 0).length, unowned = rows.filter((r) => !r.owner).length;
  if (!off && !gaps) return { lead: `All ${n} ${n === 1 ? terms.unit : terms.units} are connected with nothing missing.`, detail: unowned ? `${plural(unowned, "has", "have")} no owner.` : "Each one has an owner." };
  const parts = [];
  if (off) parts.push(`${off} not connected`);
  if (gaps) parts.push(`${plural(gaps, "has", "have")} a gap`);
  return { lead: `${off ? off : gaps} of ${n} ${n === 1 ? terms.unit : terms.units} ${off ? "are not connected" : "need work"}.`, detail: `${parts.join(", ")}${unowned ? `, ${unowned} with no owner` : ""}. Start with the ones below.` };
}

export function whyAccount(r) {
  if (!r.connected) return "not connected, so it counts against L1";
  if (r.open_critical) return `${plural(r.open_critical, "critical finding", "critical findings")} open`;
  if (r.issues) return `${plural(r.issues, "gap", "gaps")} to close`;
  return "no owner";
}

// Which findings need a person to act today: no owner or an expired acceptance first.
export function findingsFirst(rows, limit = 3) {
  const rank = { unowned: 0, expired_acceptance: 1, no_decision: 2, accepted_without_expiry: 3 };
  const sev = ["critical", "high", "medium", "low"];
  return rows.filter((r) => r.state in rank)
    .sort((a, b) => sev.indexOf(a.severity) - sev.indexOf(b.severity) || rank[a.state] - rank[b.state] || (b.age_days || 0) - (a.age_days || 0) || String(a.id).localeCompare(String(b.id))).slice(0, limit);
}

export function findingsAnswer(F) {
  const S = F.states || {}, total = Object.entries(S).reduce((a, [k, v]) => a + (k === "in_window" ? 0 : v), 0);
  if (!total) return { lead: "No open finding is past triage.", detail: "Nothing is waiting on an owner or a decision." };
  const bad = (S.unowned || 0) + (S.no_decision || 0) + (S.accepted_without_expiry || 0) + (S.expired_acceptance || 0);
  if (!bad) return { lead: `All ${total} findings past triage have an owner and a decision.`, detail: "L4 is in good shape." };
  const parts = [];
  if (S.unowned) parts.push(`${S.unowned} with no owner`);
  if (S.no_decision) parts.push(`${S.no_decision} with no decision`);
  if (S.expired_acceptance) parts.push(`${S.expired_acceptance} whose acceptance expired`);
  if (S.accepted_without_expiry) parts.push(`${S.accepted_without_expiry} accepted with no expiry`);
  return { lead: `${bad} of ${total} findings past triage need a person.`, detail: parts.join(", ") + "." };
}

export function whyFinding(r) {
  const t = { unowned: "has no owner", no_decision: "has an owner but no decision", expired_acceptance: "was accepted and the acceptance has expired", accepted_without_expiry: "was accepted with no expiry date" }[r.state] || "";
  return `${r.severity}, ${r.age_days ?? "?"} days old: ${t}`;
}
