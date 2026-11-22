/**
 * A first file storage sketch: the file data after growth, the share nobody opens moved to a cheaper tier, the
 * snapshots kept on what stays, after data reduction, with protection and room to fill. Arithmetic with every
 * assumption open: a scan of the shares' last access times, and the product's own sizing, have the last word.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

export const FILE_DEFAULTS = {
  data_tib: 100,          // file data today
  growth_pct: 20,         // a year
  years: 3,               // the life the storage is sized for
  cold_pct: 40,           // not opened in a year: moved to a cheaper tier
  change_pct: 0.5,        // of the data that stays, changed each day
  daily_days: 30,         // daily snapshots kept
  weekly_weeks: 4,        // weekly snapshots kept
  reduction: 1.5,         // compression and deduplication, as a ratio
  protection: 2,          // raw over usable: two copies 2x, erasure coding about 1.3x to 1.5x
  fill_pct: 80,           // keep the storage below this
  servers_today: 0,       // file servers today, brought together; 0 when not known
};
const LIMITS = {
  data_tib: [0, 1e6], growth_pct: [0, 300], years: [1, 10], cold_pct: [0, 95], change_pct: [0, 100], daily_days: [0, 400], weekly_weeks: [0, 520],
  reduction: [1, 20], protection: [1, 5], fill_pct: [50, 95], servers_today: [0, 100000],
};

export function cleanFiles(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...FILE_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function validFiles(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  return true;
}

/**
 * Snapshots keep what changed: the daily ones a day of changes each, the weekly ones a week of changes each, capped at
 * the data itself. Growth compounds over the years the storage is sized for.
 */
export function fileSketch(given) {
  const a = cleanFiles(given);
  if (!a.data_tib) return { ok: false, assumptions: a, error: "Give the file data in TiB: the storage is worked out from it." };
  const grown = a.data_tib * (1 + a.growth_pct / 100) ** a.years;
  const cold = (grown * a.cold_pct) / 100;
  const hot = grown - cold;
  const day = (hot * a.change_pct) / 100;
  const snaps = a.daily_days * day + a.weekly_weeks * Math.min(hot, day * 7);
  const stored = (hot + snaps) / a.reduction;
  const usable = stored / (a.fill_pct / 100);
  const raw = usable * a.protection;
  const coldStored = cold / a.reduction;
  const steps = [
    `${n(a.data_tib)} TiB of file data growing ${n(a.growth_pct)}% a year for ${n(a.years)} year${a.years === 1 ? "" : "s"} = ${n(r1(grown))} TiB.`,
    `${n(a.cold_pct)}% not opened in a year moves to a cheaper tier (${n(r1(cold))} TiB); ${n(r1(hot))} TiB stays.`,
    `${n(a.change_pct)}% of it changes each day = ${n(r1(day))} TiB; ${n(a.daily_days)} daily and ${n(a.weekly_weeks)} weekly snapshots keep ${n(r1(snaps))} TiB of changes.`,
    `Reduced ${n(a.reduction)}:1 = ${n(r1(stored))} TiB; kept below ${n(a.fill_pct)}% full = ${n(r1(usable))} TiB usable; at ${n(a.protection)}x for protection = ${n(r1(raw))} TiB raw.`,
    `The cheaper tier holds ${n(r1(coldStored))} TiB after reduction, with its own protection.`,
  ];
  return { ok: true, assumptions: a, grown: r1(grown), hot: r1(hot), cold: r1(cold), snaps: r1(snaps), usable: r1(usable), raw: r1(raw), cold_tib: r1(coldStored), steps };
}

/** What to agree besides capacity, whatever the product. */
export function fileNotes(sk) {
  const a = sk.assumptions || FILE_DEFAULTS;
  const out = [
    "Measure the share nobody opens with a scan of last-access times before counting it: shares used once a year, at closing or audit time, look cold until that month.",
    "Snapshots are not a backup: keep a copy elsewhere, locked so that not even an administrator can delete it early.",
    "Changes are counted as if no file changed twice: the space today's snapshots take, read from the current system, is the better figure.",
    "Ransomware on a file share shows as mass renames and rewrites: ask who would see it, and how fast a share can be rolled back.",
  ];
  if (a.reduction > 2) out.push(`A ${a.reduction}:1 reduction is optimistic for files that are already compressed (office documents, images, video): measure it on a sample.`);
  if (a.protection < 1.3) out.push("Below 1.3x there is little room to lose a disk or a server and keep every file.");
  if (a.servers_today > 0) out.push(`${n(a.servers_today)} file servers today become one place to look after: map each share, its permissions and who uses it before the move.`);
  return out;
}

export function fileMarkdown(sk) {
  if (!sk.ok) return `### A first file storage sketch\n\n${sk.error}`;
  return ["### A first file storage sketch", "", `**${n(sk.usable)} TiB usable, ${n(sk.raw)} TiB raw**, and ${n(sk.cold_tib)} TiB on a cheaper tier.`, "",
    ...sk.steps.map((x, i) => `${i + 1}. ${x}`), "", ...fileNotes(sk).map((x) => `- ${x}`)].join("\n");
}
