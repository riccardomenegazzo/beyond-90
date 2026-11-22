import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { k8sSketch, cleanK8s, validK8s, k8sNotes, k8sMarkdown, K8S_DEFAULTS } from "../k8ssketch.js";

test("workers are counted by processor, memory and pods per node, the largest wins, and a node is kept to drain", () => {
  const sk = k8sSketch({});
  assert.equal(sk.ok, true);
  const [prod, nonprod] = sk.clusters;
  // 120 pods x 0.5 cores = 60 cores over 16 x 0.9 x 0.7 = 10.08 a node = 6; 120 GiB over 40.32 = 3; 120 pods over 110 = 2
  assert.deepEqual([prod.pods, prod.by_cpu, prod.by_ram, prod.by_pods, prod.binding, prod.workers, prod.control], [120, 6, 3, 2, "processor", 7, 3]);
  assert.deepEqual([nonprod.pods, nonprod.workers], [60, 4]);
  assert.equal(sk.nodes, 7 + 3 + 4 + 3);
  assert.equal(sk.workers, 11);
  assert.equal(sk.vcpu, 7 * 16 + 3 * 4 + 4 * 16 + 3 * 4);
  assert.equal(sk.ram, 7 * 64 + 3 * 16 + 4 * 64 + 3 * 16);
  assert.equal(sk.pv_tib, 2.9, "20 applications x 1.5 environments x 50 GiB x 2 copies");
});

test("memory or the pods-per-node limit can decide instead, and test and development can be left out", () => {
  assert.equal(k8sSketch({ mem_mib: 8192 }).clusters[0].binding, "memory");
  const small = k8sSketch({ cpu_m: 50, mem_mib: 64, pods_per_app: 60, max_pods: 30 });
  assert.equal(small.clusters[0].binding, "pods per node");
  assert.match(k8sNotes(small).join(" "), /pods-per-node limit decides/);
  const prodOnly = k8sSketch({ nonprod_pct: 0 });
  assert.equal(prodOnly.clusters.length, 1);
  assert.doesNotMatch(k8sMarkdown(prodOnly), /Test and development/);
  assert.equal(k8sSketch({ apps: 0 }).ok, false);
});

test("settings are kept within their limits, and only known ones in range are valid", () => {
  assert.equal(cleanK8s({ apps: -3 }).apps, 0);
  assert.equal(cleanK8s({ control_nodes: 12 }).control_nodes, 7);
  assert.equal(cleanK8s({ fill_pct: "x" }).fill_pct, K8S_DEFAULTS.fill_pct);
  assert.equal(validK8s(cleanK8s({ apps: 40 })), true);
  assert.equal(validK8s({ apps: 40, clusters: 2 }), false);
  assert.equal(validK8s({ apps: "40" }), false);
  assert.equal(validK8s(null), false);
});

test("the notes follow the design, and the markdown carries the count, each step and the notes", () => {
  assert.equal(k8sNotes(k8sSketch({})).length, 2);
  const risky = k8sNotes(k8sSketch({ spare_nodes: 0, control_nodes: 2, fill_pct: 90 })).join(" ");
  assert.match(risky, /no node to spare/);
  assert.match(risky, /An even number of control nodes/);
  assert.match(risky, /Fewer than three control nodes/);
  assert.match(risky, /above 85% of a node/);
  const md = k8sMarkdown(k8sSketch({}));
  assert.ok(md.startsWith("### A first container platform sizing sketch\n\n**11 workers** in 2 clusters, 17 nodes with the control plane: 200 virtual processors, 800 GiB of memory, and 2.9 TiB of persistent volumes."));
  assert.match(md, /\n3\. Production: 120 pods asking 60 cores and 120 GiB: 6 workers by processor, 3 by memory, 2 by pods per node; the processor decides, plus 1 to drain = 7 workers and 3 control nodes\./);
});

test("the workshop keeps it, and the journey and the handover carry it when the container platform is in scope", async () => {
  const { makeWorkshop, setK8s, validWorkshop, summaryMarkdown, assess } = await import("../workshop.js");
  const { handoverMarkdown } = await import("../delivery.js");
  let w = makeWorkshop({ customer: "Orbit Retail (mock)", scope: ["kubernetes-platform", "hci"], createdOn: "2026-11-01", nonce: "abcdef" });
  w = setK8s(w, { apps: 40 }, "2026-11-02");
  assert.equal(w.k8s.apps, 40);
  assert.equal(validWorkshop(w), true);
  assert.equal(validWorkshop({ ...w, k8s: { apps: -1 } }), false);
  assert.throws(() => setK8s(w, { apps: "many" }, "2026-11-02"), /container platform/);
  assert.equal(setK8s(w, null, "2026-11-02").k8s, undefined);
  const cat = JSON.parse(readFileSync(new URL("./workshop-catalog.json", import.meta.url), "utf-8"));
  const withK8s = { ...cat, lines: { ...cat.lines, "kubernetes-platform": { ...cat.lines.hci, label: "Kubernetes platform", questions: [] } } };
  const sk = k8sSketch({ apps: 40 });
  assert.match(handoverMarkdown(withK8s, w, null, "2026-11-20"), new RegExp(`Container platform sizing: ${sk.workers} workers in 2 clusters`));
  assert.match(summaryMarkdown(withK8s, w, assess(withK8s, w)), /### A first container platform sizing sketch/);
  assert.doesNotMatch(handoverMarkdown(withK8s, { ...w, scope: ["hci"] }, null, "2026-11-20"), /Container platform sizing/);
});
