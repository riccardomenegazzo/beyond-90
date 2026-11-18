/**
 * A first GPU sketch for serving a model on your own infrastructure: how much GPU memory the weights and the
 * conversations in flight need, how many GPUs one copy of the model takes, how many copies the load and availability
 * need, and how many servers that makes. Arithmetic with every assumption open; a starting point for a benchmark on the
 * customer's own prompts, not a sizing.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const n = (v) => F.format(v);
const r1 = (v) => Math.round(v * 10) / 10;

export const GPU_DEFAULTS = {
  params_b: 70,             // parameters of the model, in billions
  bits: 16,                 // bits per weight as served: 16, 8 or 4
  context_k: 8,             // tokens per request kept in memory, in thousands (prompt, documents and answer)
  concurrent: 50,           // requests in flight at the busiest time
  kv_kib_per_token: 320,    // cache per token: 2 x layers x KV heads x head size x bytes, from the model card
  overhead_pct: 10,         // runtime, activations and fragmentation, over weights and cache
  gpu_mem_gib: 80,          // memory per GPU
  fill_pct: 90,             // of each GPU's memory, at most
  gpus_per_server: 8,
  min_replicas: 2,          // so an update or a failure does not stop the service
  tps_per_user: 0,          // tokens per second each user should see; 0 to size on memory only
  tps_per_gpu: 0,           // measured tokens per second one GPU gives for this model, all requests together; 0 if unknown
};
const LIMITS = { params_b: [0.1, 2000], bits: [2, 32], context_k: [0.5, 2000], concurrent: [1, 100000], kv_kib_per_token: [1, 10000], overhead_pct: [0, 100],
  gpu_mem_gib: [8, 1024], fill_pct: [50, 98], gpus_per_server: [1, 16], min_replicas: [1, 16], tps_per_user: [0, 10000], tps_per_gpu: [0, 1e7] };
const SHAPES = [1, 2, 4, 8];       // GPUs one copy of the model is split across: powers of two, inside one server

export function cleanGpu(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...GPU_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const v = Number(a[k]);
    if (a[k] !== undefined && a[k] !== "" && a[k] !== null && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  for (const k of ["concurrent", "gpus_per_server", "min_replicas"]) out[k] = Math.round(out[k]);
  return out;
}

export function validGpu(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) if (!Object.hasOwn(LIMITS, k) || typeof v !== "number" || !Number.isFinite(v) || v < LIMITS[k][0] || v > LIMITS[k][1]) return false;
  return true;
}

const GIB = 1024 ** 3;

/** The sketch: memory, the GPUs one copy takes, the copies, the servers, and each step in words. */
export function gpuSketch(given) {
  const a = cleanGpu(given);
  const usable = a.gpu_mem_gib * (a.fill_pct / 100);
  const weights = (a.params_b * 1e9 * (a.bits / 8)) / GIB;                      // GiB
  const kvPerRequest = (a.context_k * 1000 * a.kv_kib_per_token * 1024) / GIB;   // GiB
  const kv = kvPerRequest * a.concurrent;
  const oh = 1 + a.overhead_pct / 100;
  // one copy of the model must hold its weights and leave at least a fifth of its memory for conversations
  const shape = SHAPES.find((g) => g <= a.gpus_per_server && weights * oh <= 0.8 * g * usable);
  if (!shape) {
    return { ok: false, assumptions: a, weights: r1(weights), error: `The weights alone need ${n(weights * oh)} GiB with overhead: more than ${Math.min(8, a.gpus_per_server)} GPUs of ${n(a.gpu_mem_gib)} GiB in one server can hold. Serve it at fewer bits, or choose GPUs with more memory.` };
  }
  const room = shape * usable - weights * oh;                                     // GiB left for conversations in one copy
  const perCopy = Math.max(1, Math.floor(room / (kvPerRequest * oh)));            // requests in flight one copy can hold
  const forMemory = Math.ceil(a.concurrent / perCopy);
  const need = a.tps_per_user * a.concurrent;
  const forSpeed = a.tps_per_user && a.tps_per_gpu ? Math.ceil(need / (a.tps_per_gpu * shape)) : 0;
  const copies = Math.max(a.min_replicas, forMemory, forSpeed);
  const decided = copies === forSpeed && forSpeed > forMemory && forSpeed >= a.min_replicas ? "speed" : copies === forMemory && forMemory >= a.min_replicas ? "memory" : "availability";
  const gpus = copies * shape;
  const servers = Math.ceil(gpus / a.gpus_per_server);
  const steps = [
    `Weights: ${n(a.params_b)} billion parameters at ${a.bits} bits = ${n(weights)} GiB.`,
    `Conversations: ${n(a.context_k)}k tokens each at ${n(a.kv_kib_per_token)} KiB per token = ${n(kvPerRequest)} GiB per request; ${n(a.concurrent)} in flight = ${n(kv)} GiB.`,
    `One copy of the model: ${shape} GPU${shape === 1 ? "" : "s"} of ${n(a.gpu_mem_gib)} GiB used to ${a.fill_pct}% (${n(shape * usable)} GiB), of which ${n(weights * oh)} GiB for weights with ${a.overhead_pct}% overhead, leaving room for ${n(perCopy)} requests in flight.`,
    `Copies for memory: ${n(a.concurrent)} requests over ${n(perCopy)} per copy = ${forMemory}.`,
    forSpeed ? `Copies for speed: ${n(a.concurrent)} users at ${n(a.tps_per_user)} tokens per second = ${n(need)} tokens per second, over ${n(a.tps_per_gpu * shape)} per copy = ${forSpeed}.` : "Speed is not counted: give the tokens per second a GPU was measured to give for this model, and what each user should see.",
    `At least ${a.min_replicas} cop${a.min_replicas === 1 ? "y" : "ies"} for availability: ${copies} copies x ${shape} GPU${shape === 1 ? "" : "s"} = ${gpus} GPUs, in ${servers} server${servers === 1 ? "" : "s"} of ${a.gpus_per_server}.`,
  ];
  return { ok: true, assumptions: a, weights: r1(weights), kv: r1(kv), kv_per_request: r1(kvPerRequest), shape, per_copy: perCopy, for_memory: forMemory, for_speed: forSpeed,
    copies, gpus, servers, decided, steps };
}

/** What to check before relying on the sketch, tied to the assumptions. */
export function gpuNotes(given) {
  const a = cleanGpu(given);
  const out = [
    "Measure tokens per second with the customer's own prompts and documents: published figures use short prompts.",
    "The GPUs of one copy of the model should sit in the same server, joined by its fast link.",
  ];
  if (a.bits < 16) out.push(`At ${a.bits} bits the weights take ${a.bits === 8 ? "half" : a.bits === 4 ? "a quarter" : "a fraction"} of the memory: check the answers on the customer's own tasks before relying on it.`);
  if (a.context_k >= 32) out.push("Long contexts make the conversation cache, not the weights, the larger part: a retrieval step that sends less text can cut it.");
  if (a.min_replicas < 2) out.push("With one copy, an update or a failure stops the service.");
  out.push("The cache per token comes from the model card: 2 x layers x KV heads x head size x bytes per value.");
  return out;
}

export function gpuMarkdown(sk) {
  if (!sk.ok) return `### A first GPU sketch\n\n${sk.error}`;
  return ["### A first GPU sketch", "", `**${sk.gpus} GPUs in ${sk.servers} server${sk.servers === 1 ? "" : "s"}**, ${sk.copies} copies of the model, decided by ${sk.decided}.`, "",
    ...sk.steps.map((x, i) => `${i + 1}. ${x}`), "", "Check before relying on it:", "", ...gpuNotes(sk.assumptions).map((x) => `- ${x}`)].join("\n");
}
