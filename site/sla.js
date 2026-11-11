// Target ages for findings, kept where the engine already reads them: customer.toml, [settings.sla_days].
// Pure text functions, no DOM, so Node can test them. Nothing here talks to storage: the edited text is simply the
// customer's file, saved in a snapshot like any other input.

export const SEVERITIES = ["critical", "high", "medium", "low"];
export const PRESETS = [
  { id: "default", label: "Default: 7, 30, 90, 180 days", days: { critical: 7, high: 30, medium: 90, low: 180 } },
  { id: "strict", label: "Strict: 3, 14, 30, 90 days", days: { critical: 3, high: 14, medium: 30, low: 90 } },
  { id: "relaxed", label: "Slower: 30, 90, 90, 365 days", days: { critical: 30, high: 90, medium: 90, low: 365 } },
];

/** Whole days between 1 and 730 for each severity, and never shorter for a lower severity than a higher one. */
export function validSla(days) {
  if (!days || typeof days !== "object") return false;
  let prev = 0;
  for (const s of SEVERITIES) {
    const v = days[s];
    if (!Number.isInteger(v) || v < 1 || v > 730 || v < prev) return false;
    prev = v;
  }
  return true;
}

export function preset(days) {
  const hit = PRESETS.find((p) => SEVERITIES.every((s) => p.days[s] === days[s]));
  return hit ? hit.id : "custom";
}

/** The customer.toml text with its own target ages set. Any earlier [settings.sla_days] table or sla_days line is replaced. */
export function applySla(toml, days) {
  if (!validSla(days)) throw new Error("Give whole days from 1 to 730, and no shorter for a lower severity than for a higher one.");
  const lines = String(toml || "").split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const header = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (header) skipping = header[1].replace(/\s+/g, "") === "settings.sla_days";
    if (skipping) continue;
    if (/^\s*sla_days\s*=/.test(line)) continue;              // an inline table under [settings]
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return [...out, "", "[settings.sla_days]", ...SEVERITIES.map((s) => `${s} = ${days[s]}`), ""].join("\n");
}
