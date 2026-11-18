/**
 * A first recovery design: for each tier of applications, the replication its recovery point calls for, whether the
 * distance allows it, the bandwidth it needs from the data and its daily change, and a retention to agree. Arithmetic
 * with the assumptions open; the replication product's own calculator has the last word.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);

export const DR_DEFAULTS = {
  data_tib: 0,          // protected data; 0 means "take it from the inventory"
  change_pct: 3,        // of the data written each day
  peak: 3,              // the busiest hour against the day's average
  latency_ms: 2,        // round trip between the sites
  tiers: [
    { share_pct: 15, rpo_min: 0, rto_min: 15 },
    { share_pct: 35, rpo_min: 15, rto_min: 240 },
    { share_pct: 50, rpo_min: 240, rto_min: 1440 },
  ],
};
const LIMITS = { data_tib: [0, 100000], change_pct: [0.1, 100], peak: [1, 24], latency_ms: [0, 500] };
const TIER_LIMITS = { share_pct: [0, 100], rpo_min: [0, 10080], rto_min: [0, 43200] };
const SYNC_MS = 5;      // round trip above which synchronous writes slow applications down

export function cleanDr(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...DR_DEFAULTS, tiers: DR_DEFAULTS.tiers.map((t) => ({ ...t })) };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  if (Array.isArray(a.tiers)) {
    out.tiers = out.tiers.map((t, i) => {
      const g = a.tiers[i] && typeof a.tiers[i] === "object" ? a.tiers[i] : {};
      const c = { ...t };
      for (const [k, [lo, hi]] of Object.entries(TIER_LIMITS)) {
        const v = Number(g[k]);
        if (g[k] !== undefined && g[k] !== "" && g[k] !== null && Number.isFinite(v)) c[k] = Math.min(hi, Math.max(lo, v));
      }
      return c;
    });
  }
  return out;
}

export function validDr(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) {
    if (k === "tiers") {
      if (!Array.isArray(v) || v.length !== 3) return false;
      for (const t of v) {
        if (!t || typeof t !== "object" || Array.isArray(t)) return false;
        for (const [tk, tv] of Object.entries(t)) if (!Object.hasOwn(TIER_LIMITS, tk) || typeof tv !== "number" || !Number.isFinite(tv) || tv < TIER_LIMITS[tk][0] || tv > TIER_LIMITS[tk][1]) return false;
      }
      continue;
    }
    if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  }
  return true;
}

const dur = (min) => (min === 0 ? "zero" : min < 60 ? `${n(min)} minutes` : min < 1440 ? `${n(min / 60)} hour${min === 60 ? "" : "s"}` : `${n(min / 1440)} day${min === 1440 ? "" : "s"}`);

/** The replication a recovery point calls for, in words that fit any product. */
function modeFor(rpo, latency) {
  if (rpo === 0) {
    return latency <= SYNC_MS
      ? { mode: "Synchronous replication, with a witness in a third place", ok: true }
      : { mode: "Synchronous replication", ok: false, why: `a ${n(latency)} ms round trip slows every write; zero data loss needs sites closer than about ${SYNC_MS} ms` };
  }
  if (rpo <= 15) return { mode: "Near-continuous replication (every few minutes)", ok: true };
  return { mode: `Scheduled snapshots replicated every ${dur(rpo)}`, ok: true };
}

/** A retention to start from: recent points close together, older ones further apart. */
function retentionFor(rpo) {
  if (rpo === 0 || rpo <= 15) return "Points every few minutes for a day, hourly for a week, daily for a month";
  if (rpo <= 240) return "Hourly for a day, daily for a week, weekly for a month";
  return "Daily for a week, weekly for a month, monthly for a year";
}

/**
 * The design. Bandwidth: the data a tier writes in its busiest hour must cross between the sites in that hour, so
 * replication keeps up (synchronous needs it as it happens; the rest can catch up within the recovery point).
 */
export function drSketch(given, inventory) {
  const a = cleanDr(given);
  const data = a.data_tib || (inventory ? inventory.used_tib || inventory.prov_tib || 0 : 0);
  if (!data) return { ok: false, assumptions: a, error: "Give the protected data in TiB, or read an inventory: the bandwidth is worked out from it." };
  const shares = a.tiers.reduce((s, t) => s + t.share_pct, 0);
  if (Math.abs(shares - 100) > 0.5) return { ok: false, assumptions: a, data, error: `The tiers add up to ${n(shares)}% of the data: they should add up to 100%.` };
  const tiers = a.tiers.map((t, i) => {
    const tib = (data * t.share_pct) / 100;
    const perDay = (tib * a.change_pct) / 100;                              // TiB written a day
    const peakTiBh = (perDay / 24) * a.peak;                                 // TiB in the busiest hour
    const mbps = (peakTiBh * 1024 ** 4 * 8) / 3600 / 1e6;                    // megabits per second to keep up
    return { n: i + 1, ...t, tib: Math.round(tib * 10) / 10, change_tib_day: Math.round(perDay * 100) / 100, mbps: Math.ceil(mbps), ...modeFor(t.rpo_min, a.latency_ms), retention: retentionFor(t.rpo_min) };
  });
  const mbps = tiers.reduce((s, t) => s + t.mbps, 0);
  const steps = [
    `Protected data: ${n(data)} TiB${a.data_tib ? "" : " from the inventory"}, ${n(a.change_pct)}% written each day = ${n((data * a.change_pct) / 100)} TiB a day.`,
    `The busiest hour writes ${n(a.peak)} times the day's average, and replication has to keep up with it.`,
    ...tiers.map((t) => `Tier ${t.n}: ${n(t.share_pct)}% of the data (${n(t.tib)} TiB), recovery point ${dur(t.rpo_min)}, recovery time ${dur(t.rto_min)}: ${t.mode.toLowerCase()}, about ${n(t.mbps)} Mbit/s.`),
    `Between the sites: about ${n(mbps)} Mbit/s for replication, before compression${tiers.some((t) => !t.ok) ? "; tier 1 needs closer sites, or a recovery point of a few minutes" : ""}.`,
  ];
  return { ok: true, assumptions: a, data, tiers, mbps, steps };
}

/** What the design needs besides bandwidth, whatever the product. */
export function drNotes(sk) {
  const out = [
    "Group applications that depend on each other, and recover them together, in a set order, from the same point in time.",
    "Test failovers on an isolated network, during working hours, without touching production.",
    "Keep at least one copy nobody can change or delete for a set time, administrators included.",
  ];
  if (sk.ok && sk.tiers.some((t) => t.rpo_min === 0)) out.push("Synchronous replication needs a witness in a third place to decide which site carries on if the link between them is cut.");
  if (sk.ok && sk.tiers.some((t) => t.rto_min <= 30)) out.push("A recovery time under half an hour needs the recovery plan to start machines without a person: power-on order and network mapping written in advance.");
  return out;
}

export function drMarkdown(sk) {
  if (!sk.ok) return `### A first recovery design\n\n${sk.error}`;
  return ["### A first recovery design", "", "| Tier | Data | Recovery point | Recovery time | Replication | Bandwidth | Retention |", "|---|---|---|---|---|---|---|",
    ...sk.tiers.map((t) => `| ${t.n} | ${n(t.tib)} TiB | ${dur(t.rpo_min)} | ${dur(t.rto_min)} | ${t.mode}${t.ok ? "" : ` (not at this distance: ${t.why})`} | ~${n(t.mbps)} Mbit/s | ${t.retention} |`),
    "", `About ${n(sk.mbps)} Mbit/s between the sites, before compression.`, "", ...drNotes(sk).map((x) => `- ${x}`)].join("\n");
}

export { dur as duration };
