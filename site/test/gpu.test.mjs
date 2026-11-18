import test from "node:test";
import assert from "node:assert/strict";
import { gpuSketch, cleanGpu, validGpu, gpuNotes, gpuMarkdown, GPU_DEFAULTS } from "../gpu.js";

test("weights, conversations, copies and servers, each step in words", () => {
  const sk = gpuSketch({});
  assert.equal(sk.ok, true);
  assert.equal(sk.weights, 130.4, "70 billion parameters at 16 bits");
  assert.equal(sk.shape, 4, "a copy needs room for its weights and a fifth more");
  assert.equal(sk.copies, 2, "two copies at least, for availability");
  assert.equal(sk.decided, "availability");
  assert.equal(sk.gpus, 8);
  assert.equal(sk.servers, 1);
  assert.equal(sk.steps.length, 6);
  assert.match(sk.steps[0], /130\.4 GiB/);
});

test("fewer bits, more users, a speed target: the sketch follows", () => {
  const small = gpuSketch({ bits: 4 });
  assert.ok(small.shape < 4);
  const busy = gpuSketch({ concurrent: 2000 });
  assert.equal(busy.decided, "memory");
  assert.ok(busy.copies > 2 && busy.servers > 1);
  const fast = gpuSketch({ tps_per_user: 30, tps_per_gpu: 200, concurrent: 200 });
  assert.equal(fast.for_speed, Math.ceil((30 * 200) / (200 * fast.shape)));
  assert.equal(fast.decided, "speed");
  assert.match(fast.steps[4], /tokens per second/);
});

test("a model too large for one server says so", () => {
  const sk = gpuSketch({ params_b: 1000, gpu_mem_gib: 24 });
  assert.equal(sk.ok, false);
  assert.match(sk.error, /fewer bits, or choose GPUs with more memory/);
  assert.match(gpuMarkdown(sk), /fewer bits/);
});

test("assumptions are cleaned, and only valid ones are stored", () => {
  assert.deepEqual(cleanGpu(null), GPU_DEFAULTS);
  assert.equal(cleanGpu({ fill_pct: 120 }).fill_pct, 98);
  assert.equal(validGpu({ params_b: 8, bits: 4 }), true);
  for (const bad of [{ params_b: 0 }, { bits: "16" }, { toString: 1 }, { gpu_mem_gib: 4 }, [], null]) assert.equal(validGpu(bad), false, JSON.stringify(bad));
});

test("the notes follow the assumptions", () => {
  assert.ok(gpuNotes({ bits: 4 }).some((x) => /a quarter/.test(x)));
  assert.ok(gpuNotes({ context_k: 64 }).some((x) => /retrieval/.test(x)));
  assert.ok(gpuNotes({ min_replicas: 1 }).some((x) => /stops the service/.test(x)));
  assert.match(gpuMarkdown(gpuSketch({})), /\*\*8 GPUs in 1 server\*\*/);
});
