/**
 * A first capacity sketch for backups kept on object storage: what a retention scheme holds, after data reduction,
 * with the protection overhead and room to grow, and the bandwidth the nightly window needs. Arithmetic with every
 * assumption open; the backup product's own calculator, run on the customer's data, has the last word.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

export const OBJ_DEFAULTS = {
  data_tib: 0,            // protected data; 0 means "take it from the inventory"
  change_pct: 3,          // of the data changed each day
  daily_days: 30,         // daily restore points kept
  weekly_weeks: 12,       // weekly fulls kept
  monthly_months: 12,     // monthly fulls kept
  reduction: 2,           // compression and deduplication, as a ratio
  protection: 1.5,        // raw over usable: erasure coding about 1.3x to 1.5x, three copies 3x
  growth_pct: 20,         // over the life of the system
  fill_pct: 80,           // keep the store below this
  window_h: 8,            // hours of the nightly backup window
};
const LIMITS = { data_tib: [0, 1e6], change_pct: [0, 100], daily_days: [0, 400], weekly_weeks: [0, 520], monthly_months: [0, 240], reduction: [1, 20],
  protection: [1, 5], growth_pct: [0, 500], fill_pct: [50, 95], window_h: [1, 24] };

export function cleanObj(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...OBJ_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function validObj(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  return true;
}

/**
 * Fulls are kept as synthetic fulls that share unchanged blocks, as most backup products do on object storage: each kept
 * full adds only what changed since the previous one (a week or a month of changes, capped at the whole data).
 */
export function objSketch(given, inventory) {
  const a = cleanObj(given);
  const data = a.data_tib || (inventory ? inventory.used_tib || inventory.prov_tib || 0 : 0);
  if (!data) return { ok: false, assumptions: a, error: "Give the protected data in TiB, or read an inventory: the capacity is worked out from it." };
  const day = (data * a.change_pct) / 100;
  const base = data;                                                     // the first full
  const dailies = a.daily_days * day;
  const weeklies = a.weekly_weeks * Math.min(data, day * 7);
  const monthlies = a.monthly_months * Math.min(data, day * 30);
  const logical = base + dailies + weeklies + monthlies;
  const stored = logical / a.reduction;
  const grown = stored * (1 + a.growth_pct / 100);
  const usable = grown / (a.fill_pct / 100);
  const raw = usable * a.protection;
  const nightly = day / a.reduction;                                     // what crosses the network each night, reduced at the source
  const gbps = (nightly * 1024 ** 4 * 8) / (a.window_h * 3600) / 1e9;
  const steps = [
    `Protected data: ${n(data)} TiB${a.data_tib ? "" : " from the inventory"}; ${n(a.change_pct)}% changes each day = ${n(day)} TiB.`,
    `Kept: one full (${n(base)} TiB), ${n(a.daily_days)} daily points (${n(dailies)} TiB), ${n(a.weekly_weeks)} weekly (${n(weeklies)} TiB) and ${n(a.monthly_months)} monthly (${n(monthlies)} TiB) = ${n(logical)} TiB before reduction.`,
    `Reduced ${n(a.reduction)}:1 = ${n(stored)} TiB; with ${n(a.growth_pct)}% growth = ${n(grown)} TiB.`,
    `Kept below ${n(a.fill_pct)}% full = ${n(usable)} TiB usable; at ${n(a.protection)}x for protection = ${n(raw)} TiB raw.`,
    `Each night: ${n(nightly)} TiB after reduction in ${n(a.window_h)} hours = about ${n(gbps)} Gbit/s.`,
  ];
  return { ok: true, assumptions: a, data, logical: r1(logical), stored: r1(stored), usable: r1(usable), raw: r1(raw), nightly: r1(nightly), gbps: Math.round(gbps * 100) / 100, steps };
}

/** What to agree besides capacity, whatever the product. */
export function objNotes(sk) {
  const a = sk.assumptions || OBJ_DEFAULTS;
  const out = [
    "Lock the backups for at least as long as an attack could go unnoticed, so not even an administrator can delete them early.",
    "Restores are the test: time a full restore of the largest system from the store, not only the backup.",
  ];
  if (a.reduction > 3) out.push(`A ${a.reduction}:1 reduction is optimistic for databases and media: measure it on a week of the customer's own backups.`);
  if (a.protection < 1.3) out.push("Below 1.3x there is little room to lose a disk or a server and keep every object.");
  if (a.monthly_months >= 60) out.push("Years of monthly copies may be cheaper in a colder tier or a second region: ask what the rule behind them actually requires.");
  return out;
}

export function objMarkdown(sk) {
  if (!sk.ok) return `### A first backup capacity sketch\n\n${sk.error}`;
  return ["### A first backup capacity sketch", "", `**${n(sk.usable)} TiB usable, ${n(sk.raw)} TiB raw**, and about ${n(sk.gbps)} Gbit/s in the nightly window.`, "",
    ...sk.steps.map((x, i) => `${i + 1}. ${x}`), "", ...objNotes(sk).map((x) => `- ${x}`)].join("\n");
}
