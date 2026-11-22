// A first sizing sketch from an inventory: how many servers the estate needs, which resource decides it, and every
// assumption on the table so the customer can argue with each one.
//
// It is not a sizing. A vendor's sizing tool knows its hardware, its overheads and its measured performance; this only
// does the arithmetic a presales engineer does on a whiteboard before opening that tool, so the first conversation about
// size happens with the customer's own numbers. Pure functions, no DOM.

/**
 * How data is protected, what it costs in raw capacity, and the fewest servers it needs. Erasure coding applies to data
 * that is no longer written to (cold); the rest keeps its copies, so its cost depends on how much of the data is cold.
 * A parity strip needs at least one server more than its width, so it can be rebuilt after a failure.
 */
export const PROTECTION = {
  copies2: { label: "Two copies: survives one failure", hot: 2, cold: 2, min: 3 },
  copies3: { label: "Three copies: survives two failures", hot: 3, cold: 3, min: 5 },
  ec1: { label: "Erasure coding, single parity (4 data + 1 parity, 1.25x) on cold data; two copies on the rest", hot: 2, cold: 1.25, min: 6 },
  ec2: { label: "Erasure coding, double parity (4 data + 2 parity, 1.5x) on cold data; three copies on the rest", hot: 3, cold: 1.5, min: 8 },
};
export const factorOf = (protection, coldPct) => {
  const p = Object.hasOwn(PROTECTION, protection) ? PROTECTION[protection] : PROTECTION.copies2;
  return p.hot + (p.cold - p.hot) * (coldPct / 100);
};

export const DEFAULTS = {
  growth_pct: 20,          // growth over the life of the platform
  vcpu_per_core: 4,        // vCPU per physical core: a common starting ratio for general server workloads
  mem_overcommit: 1,       // memory is usually not overcommitted
  protection: "copies2",
  reduction: 1,            // data reduction from compression and deduplication: 1 means none is counted
  cold_pct: 50,            // share of data no longer written to, where erasure coding applies
  fill_pct: 75,            // of the capacity left after a failure: warn here, well before writes would stop
  spare_nodes: 1,          // whole servers kept free to absorb a failure (N+1)
  node_cores: 64, node_mem_gib: 1024, node_raw_tib: 30,
  overhead_cores: 8, overhead_mem_gib: 48,     // per server, for the platform's own storage and control services
};

const LIMITS = {
  growth_pct: [0, 500], vcpu_per_core: [1, 16], mem_overcommit: [1, 2], reduction: [1, 5], cold_pct: [0, 100], fill_pct: [50, 95], spare_nodes: [0, 4],
  node_cores: [4, 512], node_mem_gib: [32, 16384], node_raw_tib: [1, 2000], overhead_cores: [0, 64], overhead_mem_gib: [0, 512],
};

/** Assumptions as given, each kept inside a sensible range; unknown keys are dropped. */
export function clean(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  if (typeof a.protection === "string" && Object.hasOwn(PROTECTION, a.protection)) out.protection = a.protection;
  return out;
}

export function validAssumptions(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) {
    if (k === "protection") { if (typeof v !== "string" || !Object.hasOwn(PROTECTION, v)) return false; continue; }
    if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  }
  return true;
}

const up = (v) => Math.max(1, Math.ceil(v - 1e-9));
const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Servers needed for compute, memory and storage, the one that decides, plus the spare servers for failures; with each
 * step written out. `inv` is an inventory summary (inventory.js); `a` the assumptions.
 */
export function sketch(inv, a) {
  const s = clean(a);
  const g = 1 + s.growth_pct / 100;
  const storageNow = inv.used_tib != null ? inv.used_tib : inv.prov_tib;
  const need = { vcpu: inv.vcpu_on * g, mem: (inv.mem_on_gib * g) / s.mem_overcommit, tib: storageNow * g };
  const per = { cores: s.node_cores - s.overhead_cores, mem: s.node_mem_gib - s.overhead_mem_gib, tib: s.node_raw_tib };
  if (per.cores <= 0 || per.mem <= 0) return { ok: false, error: "The platform's overhead per server is larger than the server itself." };
  const prot = Math.round(factorOf(s.protection, s.cold_pct) * 100) / 100;
  const rawTib = (need.tib / s.reduction) * prot / (s.fill_pct / 100);
  const by = {
    compute: up(need.vcpu / (per.cores * s.vcpu_per_core)),
    memory: up(need.mem / per.mem),
    storage: up(rawTib / per.tib),
  };
  // copies and parity must sit on different servers, with one more to rebuild on: the protection sets a floor
  const minimum = PROTECTION[s.protection].min;
  const decided = Object.entries(by).sort((x, y) => y[1] - x[1])[0][0];
  const base = Math.max(by.compute, by.memory, by.storage, minimum - s.spare_nodes);
  const nodes = Math.max(base + s.spare_nodes, minimum);
  // what the chosen size runs at once a server is down: the number a customer should look at
  const live = nodes - s.spare_nodes;
  const use = { cpu: need.vcpu / (live * per.cores * s.vcpu_per_core), mem: need.mem / (live * per.mem), storage: rawTib * (s.fill_pct / 100) / (live * per.tib) };
  // what a subscription priced per core counts: every physical core of every server, the spare ones included
  const cores = nodes * s.node_cores;
  return {
    ok: true, assumptions: s, nodes, cores, decided: base > Math.max(by.compute, by.memory, by.storage) ? "minimum" : decided, by, minimum,
    need: { vcpu: Math.round(need.vcpu), mem_gib: Math.round(need.mem), tib: r1(need.tib), raw_tib: r1(rawTib) },
    use: { cpu: r1(use.cpu * 100), mem: r1(use.mem * 100), storage: r1(use.storage * 100) },
    steps: [
      `Today: ${n(Math.round(inv.vcpu_on))} vCPU and ${n(Math.round(inv.mem_on_gib))} GiB in use on running machines, ${n(r1(storageNow))} TiB ${inv.used_tib != null ? "used" : "provisioned"}.`,
      `With ${s.growth_pct}% growth: ${n(Math.round(need.vcpu))} vCPU, ${n(Math.round(need.mem))} GiB, ${n(r1(need.tib))} TiB.`,
      `Compute: ${n(Math.round(need.vcpu))} vCPU at ${s.vcpu_per_core} per core over ${per.cores} usable cores per server = ${by.compute} servers.`,
      `Memory: ${n(Math.round(need.mem))} GiB over ${n(per.mem)} usable GiB per server = ${by.memory} servers.`,
      `Storage: ${n(r1(need.tib))} TiB${s.reduction > 1 ? ` reduced ${s.reduction}:1` : ""}, x${prot} for ${s.protection.startsWith("ec") ? `${s.cold_pct}% cold data erasure coded, the rest in copies` : PROTECTION[s.protection].label.split(":")[0].toLowerCase()}, kept below ${s.fill_pct}% = ${n(r1(rawTib))} TiB raw over ${n(per.tib)} TiB per server = ${by.storage} servers.`,
      `Plus ${s.spare_nodes} spare server${s.spare_nodes === 1 ? "" : "s"} to absorb a failure and rebuild, and at least ${minimum} for this protection: ${nodes} servers.`,
      `Counted per core, for a subscription priced that way: ${nodes} servers x ${s.node_cores} cores = ${n(cores)} physical cores, the spare servers included. Some count a minimum per processor; check the product's own rules.`,
    ],
  };
}

/** What a design built on this sketch should respect: rules of thumb of distributed storage, each tied to the assumptions. */
export function designNotes(a) {
  const s = clean(a);
  const notes = [
    "Keep the servers alike: after a failure, the capacity left is set by the largest server that can be lost.",
    "Spreading copies across racks or rooms needs at least three of them, evenly filled; otherwise copies are only spread across servers.",
    `Warn at ${s.fill_pct}% of the capacity left after a failure; if storage goes past it, the platform can no longer rebuild a lost server's data.`,
  ];
  if (s.protection.startsWith("ec")) notes.push("Erasure coding pays off on data that is no longer written to; databases and other write-heavy data keep their copies.");
  if (s.reduction > 1) notes.push(`A ${s.reduction}:1 data reduction is counted: measure it on the customer's own data before relying on it. Deduplication pays off for desktops and clones, rarely for databases.`);
  else notes.push("No data reduction is counted. Compression usually saves something; measure it on the customer's data before counting it.");
  if (s.vcpu_per_core > 6) notes.push(`${s.vcpu_per_core} vCPU per core is a high ratio: check it against the CPU ready time the current platform shows.`);
  return notes;
}

/** The sketch in a few lines of Markdown, for the meeting summary. */
export function sketchMarkdown(sk) {
  if (!sk || !sk.ok) return "";
  const name = { compute: "compute", memory: "memory", storage: "storage", minimum: "the minimum for the copies" }[sk.decided];
  return [`**A first sizing sketch: ${sk.nodes} servers, decided by ${name}.** Not a sizing: every assumption below is to be checked with the customer and the sizing tool.`, "",
    ...sk.steps.map((x) => `- ${x}`), "",
    `With the spare servers out: CPU at ${sk.use.cpu}%, memory at ${sk.use.mem}%, storage at ${sk.use.storage}%.`, "",
    "Design notes:", "", ...designNotes(sk.assumptions).map((x) => `- ${x}`)].join("\n");
}
