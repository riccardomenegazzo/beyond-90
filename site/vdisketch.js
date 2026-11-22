/**
 * A first desktop sizing sketch: how many hosts a pool of virtual desktops needs at the busiest hour, from the users,
 * how many connect at once, the kinds of worker and what each kind uses, with a host kept free for a failure; and the
 * storage the desktops, their images and the users' profiles take. Arithmetic with every assumption open: a week of
 * real use, measured on a pilot group of each kind, has the last word.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

/** The kinds of worker, as desktop teams usually group them, with what a desktop of each kind is given. */
export const KINDS = [
  { id: "task", label: "Task workers", hint: "one or two applications, a form, a till, a call centre" },
  { id: "knowledge", label: "Knowledge workers", hint: "office suite, browser, mail, video calls" },
  { id: "power", label: "Power users", hint: "developers, analysts, heavy spreadsheets" },
  { id: "graphics", label: "Graphics users", hint: "design, engineering, imaging: they need a GPU" },
];

export const VDI_DEFAULTS = {
  users: 1000,              // named users who will have a desktop
  concurrency_pct: 80,      // of them connected at the busiest hour
  task_pct: 30, knowledge_pct: 50, power_pct: 15, graphics_pct: 5,
  task_vcpu: 2, task_ram: 4, task_ratio: 8,                 // virtual processors, GiB of memory, virtual processors per physical core
  knowledge_vcpu: 2, knowledge_ram: 8, knowledge_ratio: 6,
  power_vcpu: 4, power_ram: 16, power_ratio: 4,
  graphics_vcpu: 4, graphics_ram: 16, graphics_ratio: 4,
  persistent_pct: 20,       // desktops that keep their changes, each with a full disk
  disk_gib: 60,             // the disk of a desktop that keeps its changes
  delta_gib: 10,            // what a fresh desktop from a shared image writes while it runs
  images: 3,                // golden images
  image_gib: 60,            // the size of one image
  profile_gib: 10,          // profile and user data per named user
  host_cores: 64,           // physical cores per host
  host_ram: 1024,           // GiB of memory per host
  overhead_ram: 32,         // GiB per host the platform keeps for itself
  spare_hosts: 1,           // hosts kept free for a failure or for maintenance
  fill_pct: 80,             // keep the storage below this
};
const LIMITS = {
  users: [0, 1e6], concurrency_pct: [1, 100], task_pct: [0, 100], knowledge_pct: [0, 100], power_pct: [0, 100], graphics_pct: [0, 100],
  task_vcpu: [1, 64], task_ram: [1, 512], task_ratio: [1, 32], knowledge_vcpu: [1, 64], knowledge_ram: [1, 512], knowledge_ratio: [1, 32],
  power_vcpu: [1, 64], power_ram: [1, 512], power_ratio: [1, 32], graphics_vcpu: [1, 64], graphics_ram: [1, 512], graphics_ratio: [1, 32],
  persistent_pct: [0, 100], disk_gib: [1, 4096], delta_gib: [0, 1024], images: [0, 100], image_gib: [1, 4096], profile_gib: [0, 4096],
  host_cores: [4, 512], host_ram: [16, 16384], overhead_ram: [0, 512], spare_hosts: [0, 10], fill_pct: [50, 95],
};

export function cleanVdi(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...VDI_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function validVdi(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  return true;
}

/**
 * Hosts are counted twice, by processor and by memory, and the larger count wins; the spare hosts come on top. The mix
 * is read as shares of the users, so it need not add up to 100. Desktops that keep their changes keep a full disk each,
 * connected or not; fresh desktops write only while they run; every named user keeps a profile.
 */
export function vdiSketch(given) {
  const a = cleanVdi(given);
  if (!a.users) return { ok: false, assumptions: a, error: "Give the number of users who will have a desktop: the sketch is worked out from it." };
  const total = KINDS.reduce((s, k) => s + a[`${k.id}_pct`], 0);
  if (!total) return { ok: false, assumptions: a, error: "Give the share of at least one kind of worker." };
  const concurrent = (a.users * a.concurrency_pct) / 100;
  const kinds = KINDS.map((k) => {
    const share = a[`${k.id}_pct`] / total;
    const desktops = concurrent * share;
    const vcpu = desktops * a[`${k.id}_vcpu`];
    return { id: k.id, label: k.label, share, desktops: Math.round(desktops), vcpu: Math.round(vcpu), cores: r1(vcpu / a[`${k.id}_ratio`]), ram: Math.round(desktops * a[`${k.id}_ram`]) };
  }).filter((k) => k.share > 0);
  const cores = kinds.reduce((s, k) => s + k.cores, 0);
  const ram = kinds.reduce((s, k) => s + k.ram, 0);
  const byCpu = Math.ceil(cores / a.host_cores);
  const room = Math.max(1, a.host_ram - a.overhead_ram);
  const byRam = Math.ceil(ram / room);
  const load = Math.max(byCpu, byRam, 1);
  const hosts = load + a.spare_hosts;
  const binding = byRam > byCpu ? "memory" : "processor";
  const persistent = (a.users * a.persistent_pct) / 100;
  const fresh = concurrent * (1 - a.persistent_pct / 100);
  const disks = persistent * a.disk_gib, deltas = fresh * a.delta_gib, imgs = a.images * a.image_gib * 2, profiles = a.users * a.profile_gib;
  const usedTib = (disks + deltas + imgs + profiles) / 1024;
  const usableTib = usedTib / (a.fill_pct / 100);
  const graphics = kinds.find((k) => k.id === "graphics");
  const steps = [
    `${n(a.users)} users, ${n(a.concurrency_pct)}% connected at the busiest hour = ${n(Math.round(concurrent))} desktops at once.`,
    ...kinds.map((k) => `${k.label}: ${n(k.desktops)} desktops, ${n(k.vcpu)} virtual processors at ${n(a[`${k.id}_ratio`])} per core = ${n(k.cores)} cores; ${n(k.ram)} GiB of memory.`),
    `Processor: ${n(r1(cores))} cores over ${n(a.host_cores)} a host = ${byCpu} host${byCpu === 1 ? "" : "s"}. Memory: ${n(ram)} GiB over ${n(room)} GiB a host (after ${n(a.overhead_ram)} GiB for the platform) = ${byRam} host${byRam === 1 ? "" : "s"}.`,
    `The ${binding} decides: ${load} host${load === 1 ? "" : "s"} for the load, plus ${a.spare_hosts} kept free for a failure or maintenance = ${hosts} hosts.`,
    `Storage: ${n(Math.round(persistent))} desktops that keep their changes at ${n(a.disk_gib)} GiB (${n(r1(disks / 1024))} TiB), ${n(Math.round(fresh))} fresh desktops writing ${n(a.delta_gib)} GiB each (${n(r1(deltas / 1024))} TiB), ${n(a.images)} images and a copy of each being prepared (${n(r1(imgs / 1024))} TiB), ${n(a.users)} profiles at ${n(a.profile_gib)} GiB (${n(r1(profiles / 1024))} TiB) = ${n(r1(usedTib))} TiB; kept below ${n(a.fill_pct)}% full = ${n(r1(usableTib))} TiB usable.`,
  ];
  return { ok: true, assumptions: a, concurrent: Math.round(concurrent), kinds, cores: r1(cores), ram, by_cpu: byCpu, by_ram: byRam, binding, hosts,
    graphics: graphics ? graphics.desktops : 0, used_tib: r1(usedTib), usable_tib: r1(usableTib), steps };
}

/** What to agree besides the count, whatever the product. */
export function vdiNotes(sk) {
  const a = sk.assumptions || VDI_DEFAULTS;
  const out = [
    "Measure a week of real use (processor, memory, logon time) on a pilot group of each kind before fixing the ratios: the applications decide them more than the job titles.",
    "Plan for the busiest half hour, when most users log on at once: time a logon in the pilot, with the profile and the security agents in place.",
  ];
  if (sk.graphics) out.push(`${n(sk.graphics)} graphics desktops at once need hosts with GPUs: size the cards from the applications they run, not from the user count.`);
  if (a.persistent_pct > 50) out.push("Most desktops keep their changes: each is a machine to patch, protect and back up. Ask which users truly need one.");
  if (!a.spare_hosts) out.push("With no host kept free, one failure or one maintenance window leaves users without a desktop.");
  if (KINDS.some((k) => a[`${k.id}_pct`] > 0 && a[`${k.id}_ratio`] > 10)) out.push("More than ten virtual processors per core is optimistic outside light task work: check it in the pilot.");
  return out;
}

export function vdiMarkdown(sk) {
  if (!sk.ok) return `### A first desktop sizing sketch\n\n${sk.error}`;
  return ["### A first desktop sizing sketch", "", `**${sk.hosts} hosts** for ${n(sk.concurrent)} desktops at once (the ${sk.binding} decides), and **${n(sk.usable_tib)} TiB** of usable storage.`, "",
    ...sk.steps.map((x, i) => `${i + 1}. ${x}`), "", ...vdiNotes(sk).map((x) => `- ${x}`)].join("\n");
}
