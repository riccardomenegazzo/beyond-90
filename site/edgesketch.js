/**
 * A first design for edge and branch sites: a few standard kinds of site, the servers each needs for its load and for
 * the failure it must ride through, the witness the two-server sites need, whether the nightly copy to the core fits
 * over each link, how long a restore would take over that link instead of from a local copy, and how many waves an
 * upgrade takes. Arithmetic with the assumptions open; the product's own sizing tool has the last word.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);

export const MAX_KINDS = 4;
export const NAME_MAX = 40;

/** What a kind of site must ride through, by the fewest servers it has. */
export const TOLERANCE = {
  1: "can wait for a replacement",
  2: "keeps running through a server failure, with a witness",
  3: "keeps running through a server failure, no witness needed",
};

export const EDGE_DEFAULTS = {
  vms_per_server: 20,       // machines one server carries at this kind of site
  link_use_pct: 70,         // share of each link the copies may use
  window_h: 8,              // hours a night when the copies may run
  wave_size: 20,            // sites upgraded together after the pilot
  waves_per_week: 2,
  visits_year: 0,           // trips to sites a year today (0: not counted)
  visit_cost: 0,            // cost of one trip
  kinds: [
    { name: "Small sites", sites: 120, vms: 4, data_tib: 1, change_pct: 2, link_mbps: 50, servers_min: 1 },
    { name: "Large sites", sites: 30, vms: 12, data_tib: 4, change_pct: 3, link_mbps: 200, servers_min: 2 },
    { name: "Plants", sites: 6, vms: 30, data_tib: 12, change_pct: 4, link_mbps: 500, servers_min: 3 },
    { name: "Other sites", sites: 0, vms: 2, data_tib: 0.5, change_pct: 2, link_mbps: 20, servers_min: 1 },
  ],
};
const LIMITS = { vms_per_server: [1, 500], link_use_pct: [5, 100], window_h: [1, 24], wave_size: [1, 1000], waves_per_week: [1, 14], visits_year: [0, 100000], visit_cost: [0, 1e7] };
const KIND_LIMITS = { sites: [0, 10000], vms: [1, 1000], data_tib: [0, 1000], change_pct: [0, 100], link_mbps: [0.5, 100000], servers_min: [1, 3] };
const CONTROL = /[\u0000-\u001f\u007f]/;

const okName = (s) => typeof s === "string" && s.trim() === s && s.length >= 1 && s.length <= NAME_MAX && !CONTROL.test(s);

/** Only what was typed, brought into range; anything else falls back to the defaults. Never throws. */
export function cleanEdge(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...EDGE_DEFAULTS, kinds: EDGE_DEFAULTS.kinds.map((k) => ({ ...k })) };
  const num = (v) => (v !== undefined && v !== "" && v !== null && Number.isFinite(Number(v)) ? Number(v) : null);
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = num(a[k]);
    if (v !== null) out[k] = Math.min(hi, Math.max(lo, v));
  }
  if (Array.isArray(a.kinds)) {
    out.kinds = out.kinds.map((d, i) => {
      const g = a.kinds[i] && typeof a.kinds[i] === "object" ? a.kinds[i] : {};
      const c = { ...d };
      for (const [k, [lo, hi]] of Object.entries(KIND_LIMITS)) {
        const v = num(g[k]);
        if (v !== null) c[k] = Math.min(hi, Math.max(lo, v));
      }
      c.sites = Math.round(c.sites); c.vms = Math.round(c.vms); c.servers_min = Math.round(c.servers_min);
      if (typeof g.name === "string") {
        const name = g.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, NAME_MAX).trim();
        if (name) c.name = name;
      }
      return c;
    });
  }
  out.wave_size = Math.round(out.wave_size); out.waves_per_week = Math.round(out.waves_per_week); out.vms_per_server = Math.round(out.vms_per_server);
  return out;
}

/** Stored with a workshop: own keys only, numbers in range, whole numbers where they count things. */
export function validEdge(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const whole = new Set(["vms_per_server", "wave_size", "waves_per_week", "sites", "vms", "servers_min"]);
  const inRange = (k, v, [lo, hi]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi && (!whole.has(k) || Number.isInteger(v));
  for (const [k, v] of Object.entries(a)) {
    if (k === "kinds") {
      if (!Array.isArray(v) || v.length !== MAX_KINDS) return false;
      for (const t of v) {
        if (!t || typeof t !== "object" || Array.isArray(t)) return false;
        for (const [tk, tv] of Object.entries(t)) {
          if (tk === "name") { if (!okName(tv)) return false; continue; }
          if (!Object.hasOwn(KIND_LIMITS, tk) || !inRange(tk, tv, KIND_LIMITS[tk])) return false;
        }
      }
      continue;
    }
    if (!Object.hasOwn(LIMITS, k) || !inRange(k, v, LIMITS[k])) return false;
  }
  return true;
}

const hours = (h) => (h < 1 ? `${n(Math.max(1, Math.round(h * 60)))} minutes` : h < 48 ? `${n(h)} hours` : `${n(h / 24)} days`);

/** Servers at one site: enough for the load, plus one when the site must keep running through a failure. */
function serversFor(kind, perServer) {
  const load = Math.max(1, Math.ceil(kind.vms / perServer));
  return kind.servers_min === 1 ? load : Math.max(kind.servers_min, load + 1);
}

/** The design, kind by kind, then the estate. */
export function edgeSketch(given) {
  const a = cleanEdge(given);
  const used = a.kinds.map((k, i) => ({ ...k, n: i + 1 })).filter((k) => k.sites > 0);
  if (!used.length) return { ok: false, assumptions: a, error: "Give the number of sites of at least one kind: the design is worked out kind by kind." };
  const usable = (mbps) => (mbps * a.link_use_pct) / 100;                       // Mbit/s the copies may use
  const transferH = (gib, mbps) => (gib * 1024 ** 3 * 8) / 1e6 / usable(mbps) / 3600;
  const kinds = used.map((k) => {
    const each = serversFor(k, a.vms_per_server);
    const changeGib = (k.data_tib * 1024 * k.change_pct) / 100;
    const copyH = transferH(changeGib, k.link_mbps);
    const restoreH = transferH(k.data_tib * 1024, k.link_mbps);
    return {
      ...k, servers_each: each, servers: each * k.sites, witness: each === 2,
      tolerance: TOLERANCE[k.servers_min], change_gib: Math.round(changeGib * 10) / 10,
      copy_h: Math.round(copyH * 100) / 100, copy_fits: copyH <= a.window_h, restore_h: Math.round(restoreH * 10) / 10,
    };
  });
  const sites = kinds.reduce((s, k) => s + k.sites, 0);
  const servers = kinds.reduce((s, k) => s + k.servers, 0);
  const witnessSites = kinds.filter((k) => k.witness).reduce((s, k) => s + k.sites, 0);
  // upgrades: one site of each kind first, then the rest in waves of the agreed size
  const pilot = kinds.length;
  const waves = Math.ceil(Math.max(0, sites - pilot) / a.wave_size);
  const weeks = Math.ceil((waves + 1) / a.waves_per_week);
  const visits = a.visits_year > 0 && a.visit_cost > 0 ? { year: a.visits_year * a.visit_cost, per_site: (a.visits_year * a.visit_cost) / sites } : null;
  const steps = [
    `${n(sites)} sites in ${kinds.length} standard design${kinds.length === 1 ? "" : "s"}; one server carries about ${n(a.vms_per_server)} machines.`,
    ...kinds.map((k) => `${k.name}: ${n(k.vms)} machine${k.vms === 1 ? "" : "s"} each, ${k.servers_min === 1 ? "enough servers for the load" : `the load plus one spare server, ${k.servers_min} at least`}: ${k.servers_each} server${k.servers_each === 1 ? "" : "s"} a site, ${n(k.servers)} in all.`),
    ...kinds.map((k) => `${k.name}: ${n(k.change_gib)} GiB written a day crosses ${n(usable(k.link_mbps))} Mbit/s (${n(a.link_use_pct)}% of ${n(k.link_mbps)}) in ${hours(k.copy_h)}${k.copy_fits ? `, inside the ${n(a.window_h)}-hour night` : `, more than the ${n(a.window_h)}-hour night`}.`),
    `Upgrades: one site of each kind first, then ${n(waves)} wave${waves === 1 ? "" : "s"} of up to ${n(a.wave_size)} sites, ${n(a.waves_per_week)} a week: about ${n(weeks)} week${weeks === 1 ? "" : "s"} for every site.`,
    ...(visits ? [`Trips to sites today: ${n(a.visits_year)} a year at ${n(a.visit_cost)} each, ${n(visits.year)} a year, ${n(Math.round(visits.per_site))} a site.`] : []),
  ];
  return { ok: true, assumptions: a, kinds, sites, servers, witness_sites: witnessSites, pilot, waves, weeks, visits, steps };
}

/** What the design needs besides the numbers, whatever the product. */
export function edgeNotes(sk) {
  const out = [
    "Keep three or four standard site designs, so hundreds of sites are run as a handful.",
    "Ship servers ready to join the central plane on their own, so someone outside IT can plug them in.",
    "Encrypt the disks at every site: servers in a back office can be carried away.",
  ];
  if (!sk.ok) return out;
  if (sk.witness_sites) out.push(`The ${n(sk.witness_sites)} two-server sites need a small witness in a third place they can all reach, usually the core site; one witness service often serves many sites: check the product's limit.`);
  if (sk.kinds.some((k) => k.servers_min === 1)) out.push("Single-server sites stop when their server fails: keep a spare on hand and a local copy, and agree how long the business can wait.");
  for (const k of sk.kinds.filter((x) => !x.copy_fits)) out.push(`${k.name}: the daily copy does not fit the night over its link; copy less often, keep less at the site, or raise the link.`);
  if (sk.kinds.some((k) => k.restore_h > 24)) out.push("Bringing a whole site back over its link takes more than a day: keep a local copy at each site and restore from it, with the core copy for disasters.");
  return out;
}

export function edgeMarkdown(sk) {
  if (!sk.ok) return `### A first edge design\n\n${sk.error}`;
  return ["### A first edge design", "", "| Kind | Sites | Servers a site | Servers in all | If a server fails | Daily copy to the core | Whole site over the link |", "|---|---|---|---|---|---|---|",
    ...sk.kinds.map((k) => `| ${k.name.replace(/\|/g, "/")} | ${n(k.sites)} | ${k.servers_each} | ${n(k.servers)} | ${k.tolerance} | ${hours(k.copy_h)}${k.copy_fits ? "" : " (does not fit the night)"} | ${hours(k.restore_h)} |`),
    "", `${n(sk.sites)} sites, ${n(sk.servers)} servers${sk.witness_sites ? `, a witness for ${n(sk.witness_sites)} two-server sites` : ""}. Upgrades: a pilot of ${sk.pilot} site${sk.pilot === 1 ? "" : "s"}, then ${n(sk.waves)} waves, about ${n(sk.weeks)} weeks.`,
    ...(sk.visits ? ["", `Trips to sites cost ${n(sk.visits.year)} a year today.`] : []),
    "", ...edgeNotes(sk).map((x) => `- ${x}`)].join("\n");
}

export { hours as edgeHours };
