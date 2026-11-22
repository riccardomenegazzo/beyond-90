/**
 * A first container platform sizing sketch: the worker nodes the applications' requests call for, in production and
 * outside it, counted by processor, by memory and by the number of pods a node may run; with room left for bursts and
 * rolling updates, a node to drain, the control plane, and the persistent volumes. Arithmetic with every assumption
 * open: the requests the teams actually set, read from a running cluster, have the last word.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

export const K8S_DEFAULTS = {
  apps: 20,               // applications to run in production
  pods_per_app: 6,        // pods each application runs in production (replicas of each part)
  cpu_m: 500,             // processor requested per pod, in millicores
  mem_mib: 1024,          // memory requested per pod, in MiB
  nonprod_pct: 50,        // test and development, as a share of production
  node_vcpu: 16,          // virtual processors per worker node
  node_ram_gib: 64,       // memory per worker node
  system_pct: 10,         // of each node taken by the platform's own pods: networking, logging, monitoring
  fill_pct: 70,           // requests kept below this share of what is left, for bursts and rolling updates
  max_pods: 110,          // pods a node may run
  spare_nodes: 1,         // per cluster, to drain a node for an upgrade or lose one
  control_nodes: 3,       // per cluster
  control_vcpu: 4,        // per control node
  control_ram_gib: 16,    // per control node
  pv_gib: 50,             // persistent volume per application in production
  pv_copies: 2,           // copies the storage keeps of each volume
};
const LIMITS = {
  apps: [0, 10000], pods_per_app: [1, 1000], cpu_m: [10, 64000], mem_mib: [16, 524288], nonprod_pct: [0, 300],
  node_vcpu: [2, 512], node_ram_gib: [4, 8192], system_pct: [0, 50], fill_pct: [30, 95], max_pods: [10, 1000],
  spare_nodes: [0, 10], control_nodes: [1, 7], control_vcpu: [1, 64], control_ram_gib: [2, 512], pv_gib: [0, 100000], pv_copies: [1, 5],
};

export function cleanK8s(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...K8S_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function validK8s(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  return true;
}

/** One cluster: the workers its pods call for, the larger of three counts, plus the spare, plus the control plane. */
function cluster(name, pods, a) {
  const usable = (1 - a.system_pct / 100) * (a.fill_pct / 100);
  const cores = (pods * a.cpu_m) / 1000;
  const gib = (pods * a.mem_mib) / 1024;
  const byCpu = Math.ceil(cores / (a.node_vcpu * usable));
  const byRam = Math.ceil(gib / (a.node_ram_gib * usable));
  const byPods = Math.ceil(pods / a.max_pods);
  const load = Math.max(byCpu, byRam, byPods, 1);
  const binding = load === byPods && byPods > Math.max(byCpu, byRam) ? "pods per node" : byRam > byCpu ? "memory" : "processor";
  const workers = load + a.spare_nodes;
  return { name, pods: Math.round(pods), cores: r1(cores), gib: r1(gib), by_cpu: byCpu, by_ram: byRam, by_pods: byPods, binding, workers, control: a.control_nodes,
    vcpu: workers * a.node_vcpu + a.control_nodes * a.control_vcpu, ram: workers * a.node_ram_gib + a.control_nodes * a.control_ram_gib };
}

export function k8sSketch(given) {
  const a = cleanK8s(given);
  if (!a.apps) return { ok: false, assumptions: a, error: "Give the number of applications to run: the sketch is worked out from them." };
  const prodPods = a.apps * a.pods_per_app;
  const clusters = [cluster("Production", prodPods, a)];
  if (a.nonprod_pct > 0) clusters.push(cluster("Test and development", (prodPods * a.nonprod_pct) / 100, a));
  const nodes = clusters.reduce((s, c) => s + c.workers + c.control, 0);
  const vcpu = clusters.reduce((s, c) => s + c.vcpu, 0);
  const ram = clusters.reduce((s, c) => s + c.ram, 0);
  const pvTib = (a.apps * (1 + a.nonprod_pct / 100) * a.pv_gib * a.pv_copies) / 1024;
  const usablePct = Math.round((1 - a.system_pct / 100) * a.fill_pct);
  const steps = [
    `${n(a.apps)} applications of ${n(a.pods_per_app)} pods = ${n(prodPods)} pods in production, each asking ${n(a.cpu_m)} millicores and ${n(a.mem_mib)} MiB${a.nonprod_pct ? `; test and development at ${n(a.nonprod_pct)}% of production` : ""}.`,
    `Of each ${n(a.node_vcpu)}-processor, ${n(a.node_ram_gib)} GiB worker, ${n(a.system_pct)}% goes to the platform's own pods, and requests are kept below ${n(a.fill_pct)}% of the rest: about ${usablePct}% of a node is planned for.`,
    ...clusters.map((c) => `${c.name}: ${n(c.pods)} pods asking ${n(c.cores)} cores and ${n(c.gib)} GiB: ${c.by_cpu} workers by processor, ${c.by_ram} by memory, ${c.by_pods} by pods per node; the ${c.binding} decides, plus ${a.spare_nodes} to drain = ${c.workers} workers and ${c.control} control nodes.`),
    `On the platform: ${nodes} nodes, ${n(vcpu)} virtual processors and ${n(ram)} GiB of memory in all.`,
    `Persistent volumes: ${n(a.pv_gib)} GiB per application${a.nonprod_pct ? ", in every environment" : ""}, kept ${n(a.pv_copies)} times = ${n(r1(pvTib))} TiB.`,
  ];
  return { ok: true, assumptions: a, clusters, nodes, vcpu, ram, pv_tib: r1(pvTib), workers: clusters.reduce((s, c) => s + c.workers, 0), steps };
}

/** What to agree besides the count, whatever the platform. */
export function k8sNotes(sk) {
  const a = sk.assumptions || K8S_DEFAULTS;
  const out = [
    "Read the requests the teams actually set from a running cluster: requests that are too high waste nodes, missing ones make the count meaningless.",
    "Keep production apart from test and development, with its own control plane, so an upgrade is tried where a mistake costs nothing.",
  ];
  if (!a.spare_nodes) out.push("With no node to spare, an upgrade or a failed node leaves pods with nowhere to go.");
  if (a.control_nodes % 2 === 0) out.push("An even number of control nodes adds no tolerance: three or five keep a majority when one is lost.");
  if (a.control_nodes < 3) out.push("Fewer than three control nodes means losing one stops changes to the cluster: acceptable for a lab, not for production.");
  if (a.fill_pct > 85) out.push("Requests planned above 85% of a node leave little room for a rolling update to start new pods before old ones stop.");
  if (sk.ok && sk.clusters.some((c) => c.binding === "pods per node")) out.push("The pods-per-node limit decides: many small pods; check the limit the network plugin allows before buying larger nodes.");
  return out;
}

export function k8sMarkdown(sk) {
  if (!sk.ok) return `### A first container platform sizing sketch\n\n${sk.error}`;
  return ["### A first container platform sizing sketch", "", `**${sk.workers} workers** in ${sk.clusters.length} cluster${sk.clusters.length === 1 ? "" : "s"}, ${sk.nodes} nodes with the control plane: ${n(sk.vcpu)} virtual processors, ${n(sk.ram)} GiB of memory, and ${n(sk.pv_tib)} TiB of persistent volumes.`, "",
    ...sk.steps.map((x, i) => `${i + 1}. ${x}`), "", ...k8sNotes(sk).map((x) => `- ${x}`)].join("\n");
}
