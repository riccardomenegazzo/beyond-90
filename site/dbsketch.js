/**
 * A first database licence sketch: databases licensed per processor core run on hosts sized for their peak, at a
 * share of their processors that is rarely busy. Placed on fewer hosts kept for them, at a planned peak, they need
 * fewer licensed cores. Arithmetic with every assumption open: the licence agreement and the customer's licensing
 * specialist have the last word on what must be licensed.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

export const DB_DEFAULTS = {
  databases: 120,           // database servers or instances licensed per core
  vcpu_per_db: 4,           // processors each is given today, on average
  busy_pct: 25,             // of those, busy at the busiest hour, on average
  target_pct: 60,           // how busy the hosts kept for them may run at the busiest hour
  cores_today: 512,         // processor cores licensed today for these databases
  host_cores: 32,           // cores per host kept for the databases
  spare_hosts: 1,           // hosts kept free for a failure
  spare_licensed: 1,        // 1 when the agreement asks for the spare host to be licensed too, 0 when not
  core_year: 0,             // what a licensed core costs a year, support included; 0 when not known
};
const LIMITS = {
  databases: [0, 100000], vcpu_per_db: [1, 256], busy_pct: [1, 100], target_pct: [20, 95], cores_today: [0, 1e6],
  host_cores: [2, 512], spare_hosts: [0, 10], spare_licensed: [0, 1], core_year: [0, 1e6],
};

export function cleanDb(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...DB_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  out.spare_licensed = out.spare_licensed >= 0.5 ? 1 : 0;
  return out;
}

export function validDb(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  return a.spare_licensed === undefined || a.spare_licensed === 0 || a.spare_licensed === 1;
}

/**
 * The busy processors at the busiest hour, over the planned peak, are the cores the hosts must give; whole hosts are
 * licensed, as most per-core agreements count every core of a host the databases may run on.
 */
export function dbSketch(given) {
  const a = cleanDb(given);
  if (!a.databases) return { ok: false, assumptions: a, error: "Give the number of databases licensed per core: the sketch is worked out from them." };
  const given_ = a.databases * a.vcpu_per_db;
  const busy = (given_ * a.busy_pct) / 100;
  const needed = busy / (a.target_pct / 100);
  const hosts = Math.max(1, Math.ceil(needed / a.host_cores));
  const licensed = (hosts + (a.spare_licensed ? a.spare_hosts : 0)) * a.host_cores;
  const freed = a.cores_today ? a.cores_today - licensed : null;
  const money = a.core_year && freed != null ? freed * a.core_year : null;
  const steps = [
    `${n(a.databases)} databases with ${n(a.vcpu_per_db)} processors each = ${n(given_)} processors given; ${n(a.busy_pct)}% busy at the busiest hour = ${n(r1(busy))} busy.`,
    `Planned to run at ${n(a.target_pct)}% at the busiest hour = ${n(r1(needed))} cores; on hosts of ${n(a.host_cores)} cores = ${hosts} host${hosts === 1 ? "" : "s"} for the databases.`,
    a.spare_hosts ? `Plus ${a.spare_hosts} host${a.spare_hosts === 1 ? "" : "s"} kept free for a failure, ${a.spare_licensed ? "licensed too" : "not licensed, as the agreement allows"}: ${n(licensed)} cores to license.` : `No host kept free: ${n(licensed)} cores to license.`,
    freed == null ? "The cores licensed today are not given: the difference is not counted." : freed >= 0
      ? `Against ${n(a.cores_today)} cores licensed today: ${n(freed)} fewer${money != null ? `, about ${n(Math.round(money))} a year at ${n(a.core_year)} a core` : ""}.`
      : `Against ${n(a.cores_today)} cores licensed today: ${n(-freed)} more. Today's hosts may be too busy, or the peak planned too low.`,
  ];
  return { ok: true, assumptions: a, busy: r1(busy), needed: r1(needed), hosts, licensed, freed, money: money == null ? null : Math.round(money), steps };
}

/** What to agree besides the count, whatever the database engine. */
export function dbNotes(sk) {
  const a = sk.assumptions || DB_DEFAULTS;
  const out = [
    "The licence agreement decides: check with the customer's licensing specialist which cores must be licensed, whether a host kept free counts, and how databases are kept on the licensed hosts.",
    "Take the busy share from a week of data at the busiest hour, database by database, not from a monthly average.",
    "Each engine and edition is its own pool of hosts: sketch them one at a time.",
  ];
  if (a.target_pct > 75) out.push("Hosts planned to run above 75% at the busiest hour leave little room for a month-end or a failure.");
  if (sk.ok && sk.freed != null && sk.freed > 0 && sk.freed / a.cores_today > 0.5) out.push("More than half the licensed cores freed: check the busy share before it is shown to finance.");
  return out;
}

export function dbMarkdown(sk) {
  if (!sk.ok) return `### A first database licence sketch\n\n${sk.error}`;
  const head = sk.freed == null ? `**${n(sk.licensed)} cores to license** on ${sk.hosts} host${sk.hosts === 1 ? "" : "s"} kept for the databases.`
    : `**${n(sk.licensed)} cores to license** on ${sk.hosts} host${sk.hosts === 1 ? "" : "s"} kept for the databases, ${sk.freed >= 0 ? `${n(sk.freed)} fewer` : `${n(-sk.freed)} more`} than today${sk.money != null && sk.freed > 0 ? ` (about ${n(sk.money)} a year)` : ""}.`;
  return ["### A first database licence sketch", "", head, "", ...sk.steps.map((x, i) => `${i + 1}. ${x}`), "", ...dbNotes(sk).map((x) => `- ${x}`)].join("\n");
}
