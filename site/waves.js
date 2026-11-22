/**
 * A migration plan in waves, from an inventory summary: a test wave first, then cluster by cluster, the least risky
 * first, each wave capped in size and spaced in time, with the steps every wave goes through. Only totals and cluster
 * names, never machine names: it is a plan to agree with the customer, not a runbook to execute.
 */
import { fmt } from "./inventory.js";
import { addDays, calendar } from "./ics.js";

export const WAVE_DEFAULTS = { start: "", per_wave: 50, every_days: 7, pilot: 20, include_off: false, link_mbps: 1000 };
const LIMITS = { per_wave: [5, 1000], every_days: [1, 60], pilot: [0, 200], link_mbps: [10, 400000] };
/** The share of the link a copy can count on, beside the traffic already on it. */
export const LINK_USABLE = 0.7;
const MAX_WAVES = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

/** What every wave goes through, in the customer's words: the same steps each time, improved after each wave. */
export const RUNBOOK = [
  { when: "Before", steps: [
    "The application owners in the wave are named, and the change is approved",
    "A performance baseline is taken for each application",
    "Data is copied ahead, so the cutover moves only the last changes",
    "The rollback is written down, with who decides to use it and by when",
    "Backup, monitoring and security tools see the new platform",
  ] },
  { when: "On the day", steps: [
    "Go or no-go: tests passed, people ready, change approved",
    "Cutover inside the agreed window",
    "Each owner tests the application against its baseline",
    "Sign-off, or rollback by the agreed time",
  ] },
  { when: "After", steps: [
    "Labels, protection and security policies checked on every moved machine",
    "What went well and what did not goes into the next wave's runbook",
    "The old machines stay off for an agreed period, then are removed",
  ] },
];

/** The assumptions with defaults filled in and numbers brought into range. Never throws. */
export function cleanWaves(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...WAVE_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && Number.isFinite(v)) out[k] = Math.round(Math.min(hi, Math.max(lo, v)));
  }
  if (isDate(a.start)) out.start = a.start;
  if (typeof a.include_off === "boolean") out.include_off = a.include_off;
  return out;
}

/** Stored with a workshop: checked on save and when a workspace file is imported. */
export function validWaves(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) {
    if (k === "start") { if (v !== "" && !isDate(v)) return false; continue; }
    if (k === "include_off") { if (typeof v !== "boolean") return false; continue; }
    if (!Object.hasOwn(LIMITS, k) || !Number.isInteger(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  }
  return true;
}

/** How many machines go into each of n waves, as even as possible. */
const split = (total, n) => Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));

/**
 * The plan. `today` sets the default start, two weeks out. Clusters move whole before the next starts, so machines that
 * talk to each other inside a cluster stay together; dependencies across clusters still have to be checked.
 */
export function planWaves(inv, given, today) {
  const a = cleanWaves(given);
  if (!inv || !inv.vms) return { ok: false, error: "Read an inventory first: the waves are planned from it." };
  const start = a.start || addDays(today, 14);
  const count = (c) => (a.include_off ? c.vms : c.on);
  const clusters = inv.clusters.map((c) => ({ ...c }));
  // machines beyond the clusters listed (the summary keeps the largest) still have to move
  const listed = clusters.reduce((n, c) => n + c.vms, 0), listedOn = clusters.reduce((n, c) => n + c.on, 0);
  if (inv.vms > listed) {
    clusters.push({ name: "Other clusters", vms: inv.vms - listed, on: Math.max(0, inv.on - listedOn), vcpu: Math.max(0, inv.vcpu_on - clusters.reduce((n, c) => n + c.vcpu, 0)),
      mem_gib: Math.max(0, inv.mem_on_gib - clusters.reduce((n, c) => n + c.mem_gib, 0)), hosts: 0, past: Math.max(0, inv.past_total - clusters.reduce((n, c) => n + c.past, 0)) });
  }
  const biggest = Math.max(1, ...clusters.map((c) => c.vms));
  const risk = (c) => (c.vms ? c.past / c.vms : 0) + 0.5 * (c.vms / biggest);
  const first = inv.first_wave ? clusters.find((c) => c.name === inv.first_wave.name) : null;
  const order = [...(first ? [first] : []), ...clusters.filter((c) => c !== first).sort((x, y) => risk(x) - risk(y) || x.vms - y.vms || (x.name < y.name ? -1 : 1))];
  // a share of a cluster: its resources, its data and its machines past support, in proportion (running machines carry the vCPU and memory)
  const data = (c) => (a.include_off ? c.tib : c.tib_on);
  const part = (c, k) => ({ cluster: c.name, machines: k,
    vcpu: c.on ? Math.round((c.vcpu * Math.min(k, c.on)) / c.on) : 0, mem_gib: c.on ? Math.round((c.mem_gib * Math.min(k, c.on)) / c.on) : 0,
    past: c.vms ? Math.round((c.past * k) / c.vms) : 0,
    tib: Number.isFinite(data(c)) && count(c) ? Math.round((data(c) * k * 10) / count(c)) / 10 : null });
  const waves = [];
  const left = new Map(order.map((c) => [c, count(c)]));
  if (a.pilot && order.length && left.get(order[0]) > 0) {
    const k = Math.min(a.pilot, left.get(order[0]));
    waves.push({ ...part(order[0], k), test: true });
    left.set(order[0], left.get(order[0]) - k);
  }
  for (const c of order) {
    const rest = left.get(c);
    if (rest <= 0) continue;
    for (const k of split(rest, Math.ceil(rest / a.per_wave))) waves.push({ ...part(c, k), test: false });
  }
  if (!waves.length) return { ok: false, error: "No machines to move with these settings: include the powered-off ones, or read another export." };
  if (waves.length > MAX_WAVES) return { ok: false, error: `That makes more than ${MAX_WAVES} waves: allow more machines per wave.` };
  waves.forEach((wv, i) => { wv.n = i + 1; wv.date = addDays(start, i * a.every_days); wv.copy_h = wv.tib == null ? null : copyHours(wv.tib, a.link_mbps); });
  const known = waves.filter((wv) => wv.tib != null);
  const moved = waves.reduce((n, wv) => n + wv.machines, 0);
  const end = waves[waves.length - 1].date;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
  return { ok: true, assumptions: a, start, end, waves, moved, retired: a.include_off ? 0 : inv.off,
    clusters: new Set(waves.map((wv) => wv.cluster)).size, weeks: Math.max(1, Math.ceil((days + 1) / 7)), past: waves.reduce((n, wv) => n + wv.past, 0),
    has_data: known.length > 0, data_tib: Math.round(known.reduce((n, wv) => n + wv.tib, 0) * 10) / 10, unknown_data: waves.length - known.length,
    copy_max_h: known.length ? Math.max(...known.map((wv) => wv.copy_h)) : null,
    slow: known.filter((wv) => wv.copy_h > a.every_days * 24).length };
}

/** Hours to copy so many TiB over a link of so many Mbit/s, with the share of it a copy can count on. */
export const copyHours = (tib, mbps) => (tib * 2 ** 40 * 8) / (mbps * 1e6 * LINK_USABLE) / 3600;

/** A copy time in the words a meeting uses: under an hour, hours up to two days, then days. */
export function copyTime(hours) {
  if (hours == null) return "not known";
  if (hours < 1) return "under an hour";
  if (hours < 48) { const n = Math.round(hours); return `about ${n} hour${n === 1 ? "" : "s"}`; }
  return `about ${fmt(Math.round(hours / 2.4) / 10)} days`;
}

/** What the waves copy ahead of their day, and whether the link keeps up with the pace: "" when the inventory has no data per cluster. */
export function copyLine(p) {
  if (!p.has_data) return "";
  const big = p.waves.filter((wv) => wv.copy_h != null).reduce((x, y) => (y.copy_h > x.copy_h ? y : x));
  const name = big.test ? "the test wave" : `wave ${big.n}`;
  return `Data copied ahead of the cutovers: ${fmt(p.data_tib)} TiB in all${p.unknown_data ? ` (not known for ${p.unknown_data} wave${p.unknown_data === 1 ? "" : "s"})` : ""}. `
    + `The largest, ${name}, copies ${fmt(big.tib)} TiB: ${copyTime(big.copy_h)} at ${fmt(p.assumptions.link_mbps)} Mbit/s, counting on ${Math.round(LINK_USABLE * 100)}% of the link.`
    + (p.slow ? ` The copy for ${p.slow === 1 ? "one wave" : `${fmt(p.slow)} waves`} takes longer than the ${fmt(p.assumptions.every_days)} day${p.assumptions.every_days === 1 ? "" : "s"} between waves: more bandwidth, more days between waves, or smaller waves.` : "");
}

/** The plan in one sentence. */
export const wavesLine = (p) => `${fmt(p.waves.length)} waves from ${p.start} to ${p.end} (${fmt(p.weeks)} week${p.weeks === 1 ? "" : "s"}): `
  + `${fmt(p.moved)} machines from ${fmt(p.clusters)} cluster${p.clusters === 1 ? "" : "s"}${p.retired ? `; ${fmt(p.retired)} powered off, to retire rather than move` : ""}.`;

const waveName = (wv) => (wv.test ? "Test wave" : `Wave ${wv.n}`);

/** The plan in Markdown, for the meeting summary. */
export function wavesMarkdown(p) {
  const d = p.has_data;
  const out = ["### A plan in waves", "", wavesLine(p), ...(d ? ["", copyLine(p)] : []), "",
    `| Date | Wave | Cluster | Machines | vCPU | Memory GiB | Past support |${d ? " Data TiB | Copy ahead |" : ""}`, `|---|---|---|---|---|---|---|${d ? "---|---|" : ""}`];
  for (const wv of p.waves) {
    out.push(`| ${wv.date} | ${waveName(wv)} | ${wv.cluster.replace(/\|/g, "/")} | ${fmt(wv.machines)} | ${fmt(wv.vcpu)} | ${fmt(wv.mem_gib)} | ${fmt(wv.past)} |`
      + (d ? ` ${wv.tib == null ? "—" : fmt(wv.tib)} | ${copyTime(wv.copy_h)} |` : ""));
  }
  out.push("", "Every wave: " + RUNBOOK.map((r) => `${r.when.toLowerCase()}, ${r.steps.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join("; ")}`).join(". ") + ".");
  return out.join("\n");
}

/** One all-day event per wave, for any calendar. */
export function wavesIcs(w, p, stamp) {
  return calendar("Migration waves", p.waves.map((wv) => ({
    uid: `${w.id.replace(/\|/g, "-")}-wave-${wv.n}`, date: wv.date,
    summary: `${w.customer}: ${waveName(wv)}, ${wv.machines} machines from ${wv.cluster}`,
    description: `${wv.tib != null ? `Copy ahead: ${fmt(wv.tib)} TiB, ${copyTime(wv.copy_h)} before the day. ` : ""}${wv.past ? `${wv.past} on operating systems past support: check tools and agents first. ` : ""}${RUNBOOK.map((r) => `${r.when}: ${r.steps.join("; ")}.`).join(" ")}`,
  })), stamp);
}
