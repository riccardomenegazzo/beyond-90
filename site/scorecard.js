// A one-page posture scorecard a customer can show someone else, tied to the exact inputs it was computed from by their
// fingerprint. It says what it proves (these numbers came from those files) and what it does not (that the files are true).
// Pure functions: no DOM, no storage.

const pct = (v) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "not available");
const STAGES = [["L1", "Connected"], ["L2", "Visible"], ["L3", "Enabled"], ["L4", "Decided"]];

export const FINGERPRINT_SHOWN = 16;
const HEX = /^[0-9a-f]{12,64}$/;

export function shortFingerprint(hash) {
  return /^[0-9a-f]{12,}$/i.test(String(hash || "")) ? String(hash).slice(0, FINGERPRINT_SHOWN).toLowerCase() : "";
}

/** True when the pasted fingerprint (at least 12 hex characters) starts the fingerprint of the data loaded now. */
export function matches(pasted, current) {
  const p = String(pasted || "").trim().toLowerCase().replace(/^fingerprint:?\s*/, "");
  const c = String(current || "").toLowerCase();
  return HEX.test(p) && /^[0-9a-f]{12,}$/.test(c) && c.startsWith(p);
}

export function scorecard({ result, score, burndown, today, engine = "" }) {
  const fp = shortFingerprint(result.input_hash);
  const lines = [`# Posture scorecard: ${result.customer}`, "",
    `Data as of ${result.as_of}. Made on ${today}${engine ? ` with Beyond 90 ${engine}` : ""}.`, "",
    `**Yield ${pct(result.yield)}**, maturity ${result.level}.`, "",
    "| Stage | Share |", "|---|---|",
    ...STAGES.map(([k, name]) => `| ${name} | ${pct(score && score.stages && score.stages[k] ? score.stages[k].value : null)} |`), ""];
  if (burndown) {
    const b = burndown, z = b.zero_critical;
    const state = z.never_had ? "no critical finding on record" : z.now ? `zero critical findings open${z.days != null ? ` for ${z.days} days` : ""}` : `${b.open.critical} critical finding(s) open`;
    lines.push("## Risk", "",
      `- ${state}; ${b.open.high} high open.`,
      `- ${b.past_sla_total} open finding(s) older than their target age (${["critical", "high", "medium", "low"].map((s) => `${s} ${b.sla_days[s]} d`).join(", ")}${b.sla_is_default ? ", the default values" : ", set for this customer"}).`);
    if (b.focus && b.focus.raw) lines.push(`- ${b.focus.raw} finding(s) open, ${b.focus.matter} that need a decision now (${b.focus.rule.toLowerCase()}`.replace(/\.$/, "") + ").");
    const c = b.closure;
    if (c && c.raised) {
      lines.push(`- Critical and high findings raised in the last ${c.window_days} days: ${c.raised}; closed: ${c.closed}`
        + (c.tracks_verification ? `; confirmed fixed by a later scan: ${c.verified}; came back: ${c.reopened}.` : ". The customer does not record whether a later scan confirmed the fixes."));
    }
    lines.push("");
  }
  lines.push("## Where these numbers come from", "",
    fp ? `Input fingerprint: \`${fp}\`. Anyone holding the same input files gets the same fingerprint and the same numbers.` : "No input fingerprint was available for this reading.", "",
    "## What this is, and what it is not", "",
    "- It shows that these numbers were computed from one specific set of files, which can be checked against the fingerprint above.",
    "- It does not show that the files are complete or true: they are what the customer or the account team supplied.",
    "- It is not an audit, a certification or an independent measurement. Quote the date with it.", "");
  return lines.join("\n");
}
