// The first sketches of a workshop's lines, drawn as cards: each from the customer's figures, every assumption open,
// every step of the arithmetic shown, with the notes that hold whatever the product. A figure heard in the meeting can
// be put in one (see heardPanel in views.js): the card then shows it at once. Nothing leaves the browser.
import { h, cap, copyText, card, put } from "./ui.js";
import * as INV from "./inventory.js";
import * as GPU from "./gpu.js";
import * as DRS from "./drsketch.js";
import * as OBJ from "./objsketch.js";
import * as EDGE from "./edgesketch.js";
import * as UNIT from "./unitcost.js";
import * as VDI from "./vdisketch.js";
import * as K8S from "./k8ssketch.js";
import * as DBS from "./dbsketch.js";
import * as FILES from "./filesketch.js";
import * as VC from "./valuecase.js";
import { cleanWaves } from "./waves.js";

// the sketches a figure heard can go in: how each is cleaned, and what it is called
export const SKETCH_CLEAN = { vdi: (x) => VDI.cleanVdi(x), db: (x) => DBS.cleanDb(x), k8s: (x) => K8S.cleanK8s(x), files: (x) => FILES.cleanFiles(x),
  obj: (x) => OBJ.cleanObj(x), dr: (x) => DRS.cleanDr(x), gpu: (x) => GPU.cleanGpu(x), case: (x) => VC.cleanCase(x),
  unit: (x) => UNIT.cleanUnit(x), edge: (x) => EDGE.cleanEdge(x), waves: (x) => cleanWaves(x) };
export const SKETCH_NAME = { vdi: "desktop sizing sketch", db: "database licence sketch", k8s: "container platform sizing sketch", files: "file storage sketch",
  obj: "backup capacity sketch", dr: "recovery design", gpu: "GPU sketch", case: "case for change", unit: "cost per machine", edge: "edge design", waves: "plan in waves" };
/** A sketch's card on the page, if it is there, shows the settings just changed. */
export const refreshSketch = (name, settings, saved = true) => { const el = document.querySelector(`[data-sketch="${name}"]`); if (el) el.dispatchEvent(new CustomEvent("sketch-settings", { detail: { settings, saved } })); };

/** A first capacity sketch for backups on object storage: retention, reduction, protection, growth, the nightly window. */
export function objCard(w, obj) {
  const a = OBJ.cleanObj(w.obj || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [
    ["data_tib", "Protected data (TiB, 0: from the inventory)"], ["change_pct", "Data changed each day (%)"], ["daily_days", "Daily restore points kept"],
    ["weekly_weeks", "Weekly fulls kept"], ["monthly_months", "Monthly fulls kept"], ["reduction", "Data reduction counted (ratio)"],
    ["protection", "Raw over usable for protection (x)"], ["growth_pct", "Growth over the system's life (%)"], ["fill_pct", "Keep the store below (%)"], ["window_h", "Nightly backup window (hours)"],
  ];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return OBJ.cleanObj(v); };
  const draw = (settings) => {
    const sk = OBJ.objSketch(settings, w.inventory);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.usable) }), h("span", {}, h("strong", { text: "TiB usable" }), h("small", { text: `${INV.fmt(sk.raw)} TiB raw; about ${INV.fmt(sk.gbps)} Gbit/s in the nightly window` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, OBJ.objNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await obj(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" }, fields.map(([k, label]) => {
    inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
  }));
  draw(a);
  return sketchCard("obj", inputs, draw, !!w.obj, card("A first backup capacity sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The retention and the assumptions, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(OBJ.OBJ_DEFAULTS[k]);
      draw(OBJ.OBJ_DEFAULTS);
      try { await obj(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For backups kept on object storage: what the retention holds after reduction, with protection and room to grow, and what the nightly window needs. The backup product's own calculator, on the customer's data, has the last word." }));
}

/** A sketch's card, named so a figure heard in the meeting can be shown in it: its fields and its result follow. */
function sketchCard(name, inputs, draw, saved, el, more = () => {}) {
  el.dataset.sketch = name;
  // whether it was worked out with their figures, or still shows the defaults: only the first goes in the readout
  const state = h("span", { class: "chip2 szstate", role: "status" });
  const mark = (on) => { state.className = `chip2 szstate${on ? " good" : ""}`; state.textContent = on ? "With their figures" : "At the defaults"; };
  mark(saved);
  const head = el.querySelector(".cardhead");
  if (head) head.append(state);
  el.addEventListener("change", () => mark(true));
  el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.textContent === "Back to the defaults") mark(false); });
  el.addEventListener("sketch-settings", (e) => {
    const { settings, saved: now } = e.detail;
    for (const [k, input] of Object.entries(inputs)) input.value = settings[k] === undefined ? "" : String(settings[k]);     // a figure taken back leaves its field blank
    more(settings);
    draw(settings);
    mark(now);
  });
  return el;
}

/** A first file storage sketch: growth, the cold share to a cheaper tier, snapshots, reduction, protection. */
export function filesCard(w, files) {
  const a = FILES.cleanFiles(w.files || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [["data_tib", "File data today (TiB)"], ["growth_pct", "Growth a year (%)"], ["years", "Years the storage is sized for"],
    ["cold_pct", "Not opened in a year, to a cheaper tier (%)"], ["change_pct", "Changed each day (%)"], ["daily_days", "Daily snapshots kept"],
    ["weekly_weeks", "Weekly snapshots kept"], ["reduction", "Data reduction counted (ratio)"], ["protection", "Raw over usable for protection (x)"],
    ["fill_pct", "Keep the storage below (%)"], ["servers_today", "File servers today (0: not known)"]];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return FILES.cleanFiles(v); };
  const draw = (settings) => {
    const sk = FILES.fileSketch(settings);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.usable) }), h("span", {}, h("strong", { text: "TiB usable" }),
        h("small", { text: `${INV.fmt(sk.raw)} TiB raw; ${INV.fmt(sk.cold_tib)} TiB on a cheaper tier` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, FILES.fileNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await files(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" }, fields.map(([k, label]) => {
    inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
  }));
  draw(a);
  return sketchCard("files", inputs, draw, !!w.files, card("A first file storage sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The data, its growth, the snapshots and the assumptions, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(FILES.FILE_DEFAULTS[k]);
      draw(FILES.FILE_DEFAULTS);
      try { await files(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For file shares: the data after growth, the share nobody opens moved to a cheaper tier, the snapshots kept on the rest, with reduction, protection and room to fill. A scan of last-access times and the product's own sizing have the last word." }));
}

/** A first database licence sketch: the busy cores at the planned peak, on whole hosts kept for the databases. */
export function dbCard(w, db) {
  const a = DBS.cleanDb(w.db || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [["databases", "Databases licensed per core"], ["vcpu_per_db", "Processors each is given today"], ["busy_pct", "Busy at the busiest hour (%)"],
    ["target_pct", "Hosts may run at the busiest hour (%)"], ["cores_today", "Cores licensed today"], ["host_cores", "Cores per host kept for them"],
    ["spare_hosts", "Hosts kept free for a failure"], ["core_year", "A licensed core a year, support included (0: not known)"]];
  const inputs = {};
  const spare = h("input", { type: "checkbox", checked: a.spare_licensed ? "" : null });
  const current = () => { const v = { spare_licensed: spare.checked ? 1 : 0 }; for (const [k] of fields) v[k] = Number(inputs[k].value); return DBS.cleanDb(v); };
  const draw = (settings) => {
    const sk = DBS.dbSketch(settings);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    const vs = sk.freed == null ? "" : sk.freed >= 0 ? `, ${INV.fmt(sk.freed)} fewer than today${sk.money != null && sk.freed > 0 ? ` (about ${INV.fmt(sk.money)} a year)` : ""}` : `, ${INV.fmt(-sk.freed)} more than today`;
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.licensed) }), h("span", {}, h("strong", { text: "cores to license" }),
        h("small", { text: `on ${sk.hosts} host${sk.hosts === 1 ? "" : "s"} kept for the databases${vs}` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the engine" }), h("ul", {}, DBS.dbNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await db(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  spare.addEventListener("change", save);
  const grid = h("div", { class: "szgrid" }, fields.map(([k, label]) => {
    inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
  }));
  draw(a);
  return sketchCard("db", inputs, draw, !!w.db, card("A first database licence sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The databases, their busiest hour and the hosts, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("label", { class: "vcopt" }, spare, h("span", { text: "The agreement asks for the spare host to be licensed too" }))),
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(DBS.DB_DEFAULTS[k]);
      spare.checked = !!DBS.DB_DEFAULTS.spare_licensed;
      draw(DBS.DB_DEFAULTS);
      try { await db(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For databases licensed per processor core: the cores their busiest hour needs, planned on whole hosts kept for them, against the cores licensed today. The licence agreement and the customer's licensing specialist have the last word." }), (v) => { spare.checked = !!v.spare_licensed; });
}

/** A first container platform sizing sketch: workers per cluster by processor, memory and pods, the control plane, the volumes. */
export function k8sCard(w, k8s) {
  const a = K8S.cleanK8s(w.k8s || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const load = [["apps", "Applications in production"], ["pods_per_app", "Pods per application"], ["cpu_m", "Processor requested per pod (millicores)"],
    ["mem_mib", "Memory requested per pod (MiB)"], ["nonprod_pct", "Test and development (% of production)"], ["pv_gib", "Persistent volume per application (GiB)"], ["pv_copies", "Copies the storage keeps"]];
  const nodes = [["node_vcpu", "Virtual processors per worker"], ["node_ram_gib", "Memory per worker (GiB)"], ["system_pct", "Taken by the platform's own pods (%)"],
    ["fill_pct", "Requests kept below (%)"], ["max_pods", "Pods a node may run"], ["spare_nodes", "Workers kept to drain, per cluster"],
    ["control_nodes", "Control nodes per cluster"], ["control_vcpu", "Virtual processors per control node"], ["control_ram_gib", "Memory per control node (GiB)"]];
  const fields = [...load, ...nodes];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return K8S.cleanK8s(v); };
  const draw = (settings) => {
    const sk = K8S.k8sSketch(settings);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: String(sk.workers) }), h("span", {}, h("strong", { text: "workers" }),
        h("small", { text: `in ${sk.clusters.length} cluster${sk.clusters.length === 1 ? "" : "s"}, ${sk.nodes} nodes with the control plane: ${INV.fmt(sk.vcpu)} virtual processors, ${INV.fmt(sk.ram)} GiB, ${INV.fmt(sk.pv_tib)} TiB of volumes` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the platform" }), h("ul", {}, K8S.k8sNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await k8s(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = (list) => h("div", { class: "szgrid" }, list.map(([k, label]) => {
    inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
  }));
  draw(a);
  return sketchCard("k8s", inputs, draw, !!w.k8s, card("A first container platform sizing sketch", h("div", { class: "sz" }, out,
    h("details", { class: "szassume" }, h("summary", { text: "The applications and what they ask for, to agree with the teams" }), grid(load)),
    h("details", { class: "szassume" }, h("summary", { text: "The nodes and the room kept on them" }), grid(nodes),
      h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
        for (const [k] of fields) inputs[k].value = String(K8S.K8S_DEFAULTS[k]);
        draw(K8S.K8S_DEFAULTS);
        try { await k8s(null); } catch (e) { say.textContent = e.message; }
      } }))), say),
  { sub: "For a container platform: the workers each cluster needs, counted by processor, by memory and by pods per node, with room for bursts and rolling updates and a node to drain; the control plane; the persistent volumes. The requests read from a running cluster have the last word." }));
}

/** A first desktop sizing sketch: hosts by processor and by memory, a host kept free, and the storage. */
export function vdiCard(w, vdi) {
  const a = VDI.cleanVdi(w.vdi || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const people = [["users", "Users who will have a desktop"], ["concurrency_pct", "Connected at the busiest hour (%)"],
    ...VDI.KINDS.map((k) => [`${k.id}_pct`, `${k.label} (% of users)`]), ["persistent_pct", "Desktops that keep their changes (%)"],
    ["host_cores", "Physical cores per host"], ["host_ram", "Memory per host (GiB)"], ["overhead_ram", "Memory the platform keeps per host (GiB)"], ["spare_hosts", "Hosts kept free for a failure"]];
  const given = [...VDI.KINDS.flatMap((k) => [[`${k.id}_vcpu`, `${k.label}: virtual processors`], [`${k.id}_ram`, `${k.label}: memory (GiB)`], [`${k.id}_ratio`, `${k.label}: virtual processors per core`]]),
    ["disk_gib", "Disk of a desktop that keeps its changes (GiB)"], ["delta_gib", "Written by a fresh desktop while it runs (GiB)"], ["images", "Golden images"], ["image_gib", "Size of an image (GiB)"],
    ["profile_gib", "Profile and data per user (GiB)"], ["fill_pct", "Keep the storage below (%)"]];
  const fields = [...people, ...given];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return VDI.cleanVdi(v); };
  const draw = (settings) => {
    const sk = VDI.vdiSketch(settings);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: String(sk.hosts) }), h("span", {}, h("strong", { text: "hosts" }),
        h("small", { text: `for ${INV.fmt(sk.concurrent)} desktops at once, the ${sk.binding} decides; ${INV.fmt(sk.usable_tib)} TiB of usable storage` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, VDI.vdiNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await vdi(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = (list) => h("div", { class: "szgrid" }, list.map(([k, label]) => {
    inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
  }));
  draw(a);
  return sketchCard("vdi", inputs, draw, !!w.vdi, card("A first desktop sizing sketch", h("div", { class: "sz" }, out,
    h("details", { class: "szassume" }, h("summary", { text: "The users, the mix and the hosts, to agree with the customer" }), grid(people)),
    h("details", { class: "szassume" }, h("summary", { text: "What each kind of desktop is given, and the storage" }), grid(given),
      h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
        for (const [k] of fields) inputs[k].value = String(VDI.VDI_DEFAULTS[k]);
        draw(VDI.VDI_DEFAULTS);
        try { await vdi(null); } catch (e) { say.textContent = e.message; }
      } }))), say),
  { sub: "For virtual desktops: the hosts the busiest hour needs, counted by processor and by memory, with a host kept free for a failure, and the storage the desktops, their images and the profiles take. A week of real use on a pilot group has the last word." }));
}

/** A first recovery design: per tier, the replication its recovery point calls for, the bandwidth, a retention. */
export function drCard(w, dr) {
  const a = DRS.cleanDr(w.dr || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const top = [["data_tib", "Protected data (TiB, 0: from the inventory)"], ["change_pct", "Data written each day (%)"], ["peak", "Busiest hour against the day's average (x)"], ["latency_ms", "Round trip between the sites (ms)"]];
  const inputs = {}, tierIn = [];
  const current = () => {
    const v = { tiers: tierIn.map((t) => Object.fromEntries(Object.entries(t).map(([k, el]) => [k, Number(el.value)]))) };
    for (const [k] of top) v[k] = Number(inputs[k].value);
    return DRS.cleanDr(v);
  };
  const draw = (settings) => {
    const sk = DRS.drSketch(settings, w.inventory);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.mbps) }), h("span", {}, h("strong", { text: "Mbit/s between the sites" }), h("small", { text: `to keep ${INV.fmt(sk.data)} TiB protected in three tiers, before compression` }))),
      h("div", { class: "tablewrap" }, h("table", { class: "drtable", stack: true },
        h("thead", {}, h("tr", {}, ["Tier", "Data", "Recovery point", "Recovery time", "Replication", "Bandwidth", "Retention to agree"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, sk.tiers.map((t) => h("tr", {}, h("td", { text: String(t.n) }), h("td", { text: `${INV.fmt(t.tib)} TiB` }), h("td", { text: DRS.duration(t.rpo_min) }), h("td", { text: DRS.duration(t.rto_min) }),
          h("td", {}, h("span", { text: t.mode }), t.ok ? null : h("small", { class: "neg drwhy", text: `Not at this distance: ${t.why}.` })),
          h("td", { text: `~${INV.fmt(t.mbps)} Mbit/s` }), h("td", { text: t.retention })))))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, DRS.drNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await dr(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const field = (el, label) => { el.addEventListener("change", save); return h("label", { class: "szf" }, h("span", { text: label }), el); };
  const grid = h("div", { class: "szgrid" }, top.map(([k, label]) => field(inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label }), label)));
  const tiers = h("div", { class: "szgrid drtiers" }, a.tiers.flatMap((t, i) => {
    const row = {
      share_pct: h("input", { type: "number", step: "any", min: "0", value: String(t.share_pct), "aria-label": `Tier ${i + 1}: share of the data (%)` }),
      rpo_min: h("input", { type: "number", step: "any", min: "0", value: String(t.rpo_min), "aria-label": `Tier ${i + 1}: recovery point (minutes)` }),
      rto_min: h("input", { type: "number", step: "any", min: "0", value: String(t.rto_min), "aria-label": `Tier ${i + 1}: recovery time (minutes)` }),
    };
    tierIn.push(row);
    return [field(row.share_pct, `Tier ${i + 1}: share of the data (%)`), field(row.rpo_min, `Tier ${i + 1}: recovery point (minutes)`), field(row.rto_min, `Tier ${i + 1}: recovery time (minutes)`)];
  }));
  draw(a);
  return sketchCard("dr", inputs, draw, !!w.dr, card("A first recovery design", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The data, the distance and the tiers, to agree with the customer" }), grid, tiers,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of top) inputs[k].value = String(DRS.DR_DEFAULTS[k]);
      tierIn.forEach((row, i) => { for (const k of Object.keys(row)) row[k].value = String(DRS.DR_DEFAULTS.tiers[i][k]); });
      draw(DRS.DR_DEFAULTS);
      try { await dr(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For each tier of applications: the replication its recovery point calls for, whether the distance allows it, the bandwidth its data needs, and a retention to agree. The replication product's own calculator has the last word." }));
}

/** A first design for edge and branch sites: servers per kind of site, the witness, copies over each link, upgrade waves. */
export function edgeCard(w, edge) {
  const a = EDGE.cleanEdge(w.edge || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const top = [["vms_per_server", "Machines one server carries"], ["link_use_pct", "Share of each link the copies may use (%)"], ["window_h", "Hours a night for the copies"],
    ["wave_size", "Sites upgraded together after the pilot"], ["waves_per_week", "Upgrade waves a week"], ["visits_year", "Trips to sites a year today (0: not counted)"], ["visit_cost", "Cost of one trip"]];
  const cols = [["sites", "sites"], ["vms", "machines a site"], ["data_tib", "data a site (TiB)"], ["change_pct", "written a day (%)"], ["link_mbps", "link (Mbit/s)"]];
  const inputs = {}, kindIn = [];
  const current = () => {
    const v = { kinds: kindIn.map((r) => ({ name: r.name.value, servers_min: Number(r.servers_min.value), ...Object.fromEntries(cols.map(([k]) => [k, Number(r[k].value)])) })) };
    for (const [k] of top) v[k] = Number(inputs[k].value);
    return EDGE.cleanEdge(v);
  };
  const draw = (settings) => {
    const sk = EDGE.edgeSketch(settings);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.servers) }), h("span", {}, h("strong", { text: "servers" }),
        h("small", { text: `at ${INV.fmt(sk.sites)} sites in ${sk.kinds.length} standard design${sk.kinds.length === 1 ? "" : "s"}${sk.witness_sites ? `, a witness for ${INV.fmt(sk.witness_sites)} two-server sites` : ""}; every site upgraded in about ${INV.fmt(sk.weeks)} week${sk.weeks === 1 ? "" : "s"}` }))),
      h("div", { class: "tablewrap" }, h("table", { class: "drtable edgetable", stack: true },
        h("thead", {}, h("tr", {}, ["Kind", "Sites", "Servers a site", "Servers in all", "If a server fails", "Daily copy to the core", "Whole site over the link"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, sk.kinds.map((k) => h("tr", {}, h("td", { text: k.name }), h("td", { text: INV.fmt(k.sites) }), h("td", { text: String(k.servers_each) }), h("td", { text: INV.fmt(k.servers) }),
          h("td", { text: k.tolerance }), h("td", {}, h("span", { text: EDGE.edgeHours(k.copy_h) }), k.copy_fits ? null : h("small", { class: "neg drwhy", text: "Does not fit the night." })),
          h("td", { text: EDGE.edgeHours(k.restore_h) })))))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, EDGE.edgeNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await edge(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const field = (el, label) => { el.addEventListener("change", save); return h("label", { class: "szf" }, h("span", { text: label }), el); };
  const grid = h("div", { class: "szgrid" }, top.map(([k, label]) => field(inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label }), label)));
  const kinds = a.kinds.map((t, i) => {
    const row = { name: h("input", { type: "text", maxlength: EDGE.NAME_MAX, value: t.name, "aria-label": `Kind ${i + 1}: name` }),
      servers_min: h("select", { "aria-label": `Kind ${i + 1}: if a server fails` }, Object.entries(EDGE.TOLERANCE).map(([v, label]) => h("option", { value: v, text: `${v === "1" ? "One server" : `${v} servers`} at least: ${label}` }))) };
    row.servers_min.value = String(t.servers_min);
    for (const [k, label] of cols) row[k] = h("input", { type: "number", step: "any", min: "0", value: String(t[k]), "aria-label": `Kind ${i + 1}: ${label}` });
    kindIn.push(row);
    return h("fieldset", { class: "vcgroup edgekind" }, h("legend", { text: `Kind ${i + 1}` }),
      h("div", { class: "szgrid" }, field(row.name, "Name"), ...cols.map(([k, label]) => field(row[k], cap(label))), field(row.servers_min, "If a server fails")));
  });
  draw(a);
  // a figure heard in the meeting reaches the kinds of site too
  const kindsFollow = (v) => kindIn.forEach((row, i) => {
    const k = (v.kinds || [])[i];
    if (!k) return;
    row.name.value = k.name;
    row.servers_min.value = String(k.servers_min);
    for (const [c] of cols) row[c].value = String(k[c]);
  });
  return sketchCard("edge", inputs, draw, !!w.edge, card("A first edge design", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The kinds of site, the links and the upgrade pace, to agree with the customer" }), h("div", { class: "vcgroups" }, kinds), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of top) inputs[k].value = String(EDGE.EDGE_DEFAULTS[k]);
      kindIn.forEach((row, i) => { const d = EDGE.EDGE_DEFAULTS.kinds[i]; row.name.value = d.name; row.servers_min.value = String(d.servers_min); for (const [k] of cols) row[k].value = String(d[k]); });
      draw(EDGE.EDGE_DEFAULTS);
      try { await edge(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "Three or four standard kinds of site: the servers each needs for its load and the failure it must ride through, the witness, whether the nightly copy fits over each link, a restore over the link against a local one, and the upgrade waves. The product's own sizing tool has the last word." }), kindsFollow);
}

/** What one machine costs a month, all in, in the customer's figures; idle machines, a public cloud and a tenant beside it. */
export function unitCard(w, unit) {
  const a = UNIT.cleanUnit(w.unit || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const inputs = {};
  const current = () => { const v = {}; for (const [k, el] of Object.entries(inputs)) if (el.value !== "") v[k] = Number(el.value); return UNIT.cleanUnit(v); };
  const draw = (figures) => {
    const sk = UNIT.unitSketch(figures, w.inventory);
    if (!sk.ok) { put(out, h("p", { class: "note first", text: `${sk.error} Every figure stays in this browser.` })); copy.hidden = true; return; }
    copy.hidden = false;
    put(out,
      h("div", { class: "szhead" }, h("b", { text: UNIT.money(sk.month) }), h("span", {}, h("strong", { text: "a machine a month, all in" }),
        h("small", { text: `across ${UNIT.money(sk.machines)} machines${sk.used_month ? `; ${UNIT.money(sk.used_month)} for each one that really works` : ""}` }))),
      h("div", { class: "tablewrap" }, h("table", { class: "wvtable vctable" },
        h("thead", {}, h("tr", {}, ["Part", "A year", "A machine a month", "Share"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, sk.parts.map((p) => h("tr", {}, h("th", { scope: "row", text: p.label }), h("td", { class: "n", text: UNIT.money(p.year) }), h("td", { class: "n", text: UNIT.money(p.month) }), h("td", { class: "n", text: `${Math.round(p.share)}%` }))),
          h("tr", { class: "vctotal" }, h("th", { scope: "row", text: "Total" }), h("td", { class: "n", text: UNIT.money(sk.total) }), h("td", { class: "n", text: UNIT.money(sk.month) }), h("td", { class: "n", text: "100%" }))))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Before showing it" }), h("ul", {}, UNIT.unitNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); const any = Object.keys(v).some((k) => k !== "hardware_years" || v[k] !== UNIT.UNIT_DEFAULTS.hardware_years); try { await unit(any ? v : null); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  // outside what is redrawn, so a change made by leaving a field never takes it away mid-click
  const copy = h("button", { class: "btn small", type: "button", text: "Copy for finance", hidden: true,
    onclick: (ev) => copyText(UNIT.unitMarkdown(UNIT.unitSketch(current(), w.inventory))).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) });
  const groups = UNIT.FIELDS.map((g) => h("fieldset", { class: "vcgroup" }, h("legend", { text: g.group }),
    g.fields.map(([k, label, u]) => {
      inputs[k] = h("input", { type: "number", step: "any", min: "0", value: a[k] == null ? "" : String(a[k]), "aria-label": label, placeholder: "—" });
      inputs[k].addEventListener("change", save);
      return h("label", { class: "szf" }, h("span", { text: `${label} (${u})` }), inputs[k]);
    })));
  draw(a);
  return sketchCard("unit", inputs, draw, !!w.unit, card("What one machine costs", h("div", { class: "sz" }, out, h("div", { class: "btnrow" }, copy),
    h("details", { class: "szassume" }, h("summary", { text: "The figures, as the customer and finance gave them" }), h("div", { class: "vcgroups" }, groups)), say),
  { sub: "Hardware written off, licences, support, power, space and people, divided among the machines they run: the number behind \"the cloud is cheaper\", showback per team and a provider's price per tenant. In the customer's own figures; not a quote." }));
}

/** A first GPU sketch for serving a model: memory for the weights and the conversations, copies, servers. */
export function gpuCard(w, gpu) {
  const a = GPU.cleanGpu(w.gpu || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [
    ["params_b", "Model size", "billion parameters"], ["bits", "Bits per weight as served", "16, 8 or 4"], ["context_k", "Tokens kept per request", "thousands"],
    ["concurrent", "Requests in flight at the busiest time", ""], ["kv_kib_per_token", "Cache per token, from the model card", "KiB"], ["overhead_pct", "Runtime overhead", "%"],
    ["gpu_mem_gib", "Memory per GPU", "GiB"], ["fill_pct", "Use each GPU's memory up to", "%"], ["gpus_per_server", "GPUs per server", ""], ["min_replicas", "Copies of the model at least", ""],
    ["tps_per_user", "Tokens per second each user should see (0: not counted)", ""], ["tps_per_gpu", "Tokens per second one GPU was measured to give (0: unknown)", ""],
  ];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return GPU.cleanGpu(v); };
  const draw = (assumptions) => {
    const sk = GPU.gpuSketch(assumptions);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: String(sk.gpus) }), h("span", {}, h("strong", { text: "GPUs" }),
        h("small", { text: `in ${sk.servers} server${sk.servers === 1 ? "" : "s"}: ${sk.copies} copies of the model on ${sk.shape} GPU${sk.shape === 1 ? "" : "s"} each, decided by ${sk.decided}` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Check before relying on it" }), h("ul", {}, GPU.gpuNotes(assumptions).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await gpu(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" }, fields.map(([k, label, unit]) => {
    inputs[k] = h("input", { type: "number", step: "any", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label + (unit ? ` (${unit})` : "") }), inputs[k]);
  }));
  draw(a);
  return sketchCard("gpu", inputs, draw, !!w.gpu, card("A first GPU sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The assumptions, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(GPU.GPU_DEFAULTS[k]);
      draw(GPU.GPU_DEFAULTS);
      try { await gpu(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For serving a model on the customer's own GPUs: memory for the weights and for the conversations in flight, the GPUs one copy takes, the copies the load and availability need. A starting point for a benchmark on their prompts, not a sizing." }));
}
