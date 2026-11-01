// Beyond 90 in the browser. The Python engine runs in a worker (WebAssembly, Pyodide) from this same origin.
// Files are read with the File API and handed to the worker as text. User data is never sent anywhere.
import { Engine } from "./engine.js";
import * as W from "./workspace-core.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const state = { files: {}, result: null, tab: "report", saved: [], yields: new Map(), engine: null, running: false };
const ALLOWED = /\.(csv|toml)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const say = (text) => { $("status").textContent = text; };

// ---------- engine
async function boot() {
  state.engine = new Engine(say);
  try {
    await state.engine.start();
    $("version").textContent = "engine " + state.engine.version;
    say("");
    $("demo").disabled = false;
    refreshRun();
  } catch (e) {
    $("version").textContent = "engine failed";
    say("The engine could not start: " + e.message);
  }
  registerOffline();
  await refreshHistory();
}

function refreshRun() {
  $("run").disabled = state.running || !(state.engine && state.engine.version && Object.keys(state.files).length);
}

async function registerOffline() {
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    $("offline").hidden = !keys.some((k) => k.startsWith("beyond90-"));
  } catch { /* offline support is a convenience; the app works without it */ }
}

// ---------- input
async function addFiles(list) {
  const files = [...list].filter((f) => ALLOWED.test(f.name));
  const skipped = list.length - files.length;
  if (files.length) state.files = {};          // a new selection replaces the old one, it never mixes two customers
  for (const f of files) {
    if (f.size > MAX_BYTES) { say(f.name + " is larger than 20 MB and was skipped."); continue; }
    state.files[W.baseName(f.name)] = await f.text();
  }
  if (skipped) say(skipped + " file(s) skipped: only .csv and .toml are read.");
  renderLoaded();
}

function renderLoaded() {
  const ul = $("loaded");
  ul.replaceChildren();
  for (const name of Object.keys(state.files).sort()) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = name;
    ul.append(li);
  }
  state.result = null;
  $("results").hidden = true;
  refreshRun();
}

async function dropped(ev) {
  ev.preventDefault();
  $("drop").classList.remove("over");
  const items = [...(ev.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  async function walk(entry, depth) {
    if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory && depth < 2) {
      const r = entry.createReader();
      let batch;
      do { batch = await new Promise((res, rej) => r.readEntries(res, rej)); for (const e of batch) await walk(e, depth + 1); } while (batch.length);
    }
  }
  if (items.length) for (const e of items) await walk(e, 0);
  else out.push(...ev.dataTransfer.files);
  await addFiles(out);
}

async function loadDemo() {
  say("Loading the demo…");
  state.files = await (await fetch("./demo.json")).json();
  renderLoaded();
  say("Demo loaded: a made-up customer, Northwind. Press Run analysis.");
}

// ---------- run
function options() {
  return {
    hours: Number($("hours").value) || 8,
    weeks: Math.round(Number($("weeks").value)) || 26,
    realization: Math.min(1, Math.max(0.1, Number($("real").value) || 0.9)),
    quarter: $("quarter").value.trim(),
  };
}

async function run(compareId) {
  $("errors").hidden = true;
  state.running = true;
  $("cancel").hidden = false;
  refreshRun();
  say("Analyzing…");
  try {
    const opts = options();
    const id = compareId === undefined ? await defaultCompare() : compareId;
    const base = id && state.saved.find((s) => s.id === id);
    if (base) opts.since_files = base.files;
    const res = await state.engine.json("analyze", { files: state.files, options: opts });
    if (!res.ok) return showErrors(res.errors);
    state.result = res;
    state.compareId = base ? base.id : "";
    say(res.warnings.length ? res.warnings.length + " warning(s): " + res.warnings.join("; ") : "");
    showResults();
  } catch (e) {
    if (e.cancelled) say("Cancelled. The engine was restarted.");
    else showErrors(["Unexpected error: " + e.message]);
  } finally {
    state.running = false;
    $("cancel").hidden = true;
    refreshRun();
  }
}

/** With no choice made, compare with the most recent earlier snapshot of the same customer, if there is one. */
async function defaultCompare() {
  const { customer, asOf } = W.peekCustomer(state.files);
  const here = await W.fingerprint(state.files);
  const prev = W.previousOf(state.saved, customer, asOf, here)[0];
  return prev ? prev.id : "";
}

async function cancel() {
  say("Cancelling…");
  await state.engine.cancel()
    .then(() => { $("version").textContent = "engine " + state.engine.version; say("Cancelled. The engine was restarted."); })
    .catch((e) => say("The engine could not restart: " + e.message));
}

function showErrors(list) {
  $("results").hidden = true;
  $("errors").hidden = false;
  $("errlist").replaceChildren(...list.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  say("");
  $("errors").scrollIntoView({ behavior: "smooth" });
}

function kpi(value, label) {
  const d = document.createElement("div");
  d.className = "kpi";
  d.innerHTML = "<b>" + esc(value) + "</b><span>" + esc(label) + "</span>";
  return d;
}

function showResults() {
  const r = state.result;
  $("kpis").replaceChildren(kpi(pct(r.yield), "Yield"), kpi(pct(r.reach), "Reach"), kpi(String(r.actions), "Open actions"), kpi(r.customer, "Customer as of " + r.as_of));
  renderCompare();
  $("results").hidden = false;
  selectTab(state.tab);
  $("results").scrollIntoView({ behavior: "smooth" });
}

function renderCompare() {
  const sel = $("compare"), r = state.result;
  const options = W.previousOf(state.saved, r.customer, r.as_of, r.input_hash);
  sel.replaceChildren(new Option("nothing (no comparison)", ""), ...options.map((s) => new Option(`${s.as_of} (${s.id.slice(0, 8)})`, s.id)));
  sel.value = options.some((s) => s.id === state.compareId) ? state.compareId : "";
}

// ---------- tabs
const TABS = {
  report: { key: "report_html", file: "beyond90-report.html", type: "text/html" },
  qbr: { key: "qbr_markdown", file: "beyond90-qbr.md", type: "text/markdown" },
  roadmap: { key: "roadmap_markdown", file: "beyond90-roadmap.md", type: "text/markdown" },
  summary: { key: "report_markdown", file: "beyond90-summary.md", type: "text/markdown" },
  json: { key: "score_json", file: "beyond90-score.json", type: "application/json" },
};

function selectTab(name) {
  state.tab = name;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  const t = TABS[name], text = state.result[t.key];
  $("report").hidden = name !== "report";
  $("doc").hidden = !["qbr", "roadmap", "summary"].includes(name);
  $("raw").hidden = name !== "json";
  if (name === "report") $("report").srcdoc = text;
  else if (name === "json") $("raw").textContent = text;
  else $("doc").replaceChildren(...markdown(text));
}

// A deliberately small Markdown renderer: headings, paragraphs, lists, tables, bold, italic, code.
// Everything is escaped first, so nothing in a CSV can inject markup.
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:]|$)/g, "$1<em>$2</em>");
}
function markdown(src) {
  const out = [], lines = src.split("\n");
  const el = (tag, html) => { const e = document.createElement(tag); e.innerHTML = html; return e; };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if (/^---+$/.test(l.trim())) { out.push(document.createElement("hr")); i++; continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(el("h" + Math.min(m[1].length, 4), inline(m[2]))); i++; continue; }
    if (l.startsWith("|") && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || "")) {
      const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l); i += 2;
      let h = "<thead><tr>" + head.map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
      while (i < lines.length && lines[i].startsWith("|")) { h += "<tr>" + cells(lines[i]).map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; i++; }
      out.push(el("table", h + "</tbody>")); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l), list = document.createElement(ordered ? "ol" : "ul");
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const li = el("li", inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")));
        i++;
        while (i < lines.length && /^\s{2,}[-*]\s+/.test(lines[i])) { li.append(el("div", "– " + inline(lines[i].replace(/^\s*[-*]\s+/, "")))); i++; }
        list.append(li);
      }
      out.push(list); continue;
    }
    let p = l; i++;
    while (i < lines.length && lines[i].trim() && !/^(#|\||---|\s*([-*]|\d+\.)\s)/.test(lines[i])) p += " " + lines[i++];
    out.push(el("p", inline(p)));
  }
  return out;
}

// ---------- download / copy
function download() {
  const t = TABS[state.tab], blob = new Blob([state.result[t.key]], { type: t.type + ";charset=utf-8" });
  save(blob, t.file);
}
function save(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy() {
  try { await navigator.clipboard.writeText(state.result[TABS[state.tab].key]); say("Copied."); }
  catch { say("Copy is not available here; use Download."); }
}

// ---------- workspace (local-first)
const wsSay = (t) => { $("ws-status").textContent = t; };

async function saveSnapshot() {
  const r = state.result;
  try {
    const snap = await W.makeSnapshot(state.files, { customer: r.customer, asOf: r.as_of, includePersonal: $("personal").checked, savedOn: new Date().toISOString().slice(0, 10) });
    const added = await store.put([snap]);
    $("saved-note").textContent = added ? `Saved ${snap.as_of} (${snap.id.slice(0, 8)})${snap.personal_excluded ? ", without contacts and commitments" : ""}.` : "This exact snapshot is already saved; nothing changed.";
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await refreshHistory();
    renderCompare();
  } catch (e) {
    $("saved-note").textContent = "Could not save: " + e.message + " (private windows often block storage).";
  }
}

async function refreshHistory() {
  try { state.saved = await store.all(); }
  catch (e) { state.saved = []; wsSay("Saving is not available here: " + e.message); }
  const has = state.saved.length > 0;
  $("history-empty").hidden = has;
  $("history-body").hidden = !has;
  const tbody = $("hist-table").tBodies[0];
  tbody.replaceChildren();
  for (const s of state.saved) {
    const tr = document.createElement("tr");
    const cell = (t, cls) => { const td = document.createElement("td"); td.textContent = t; if (cls) td.className = cls; return td; };
    const y = state.yields.get(s.id);
    tr.append(cell(s.customer), cell(s.as_of), cell(y == null ? "…" : pct(y), "n"));
    const idc = document.createElement("td");
    idc.innerHTML = `<code>${esc(s.id.slice(0, 8))}</code>${s.personal_excluded ? ' <span class="chip">no contacts</span>' : ""}`;
    tr.append(idc);
    const act = document.createElement("td");
    const load = Object.assign(document.createElement("button"), { className: "btn small", type: "button", textContent: "Load" });
    load.onclick = () => { state.files = { ...s.files }; renderLoaded(); say(`Loaded ${s.customer}, ${s.as_of}. Press Run analysis.`); window.scrollTo({ top: 0, behavior: "smooth" }); };
    const del = Object.assign(document.createElement("button"), { className: "btn small danger", type: "button", textContent: "Delete" });
    del.onclick = async () => { await store.remove(s.id); await refreshHistory(); };
    act.append(load, " ", del);
    tr.append(act);
    tbody.append(tr);
  }
  computeYields();
}

// Derived data is computed on demand and kept only in memory, keyed by the snapshot and the engine that read it.
let yieldRun = 0;
async function computeYields() {
  const mine = ++yieldRun;
  if (!state.engine || !state.engine.version) return;
  let changed = false;
  for (const s of state.saved) {
    if (mine !== yieldRun) return;
    if (state.yields.has(s.id)) continue;
    try {
      const r = await state.engine.json("summarize", { files: s.files });
      state.yields.set(s.id, r.ok ? r.yield : null);
      changed = true;
    } catch (e) { if (e.cancelled) return; }
  }
  if (changed && mine === yieldRun) { fillYields(); drawTrend(); }
}
function fillYields() {
  const rows = $("hist-table").tBodies[0].rows;
  state.saved.forEach((s, i) => { if (rows[i]) rows[i].cells[2].textContent = state.yields.get(s.id) == null ? "n/a" : pct(state.yields.get(s.id)); });
}

function drawTrend() {
  const box = $("trend");
  box.replaceChildren();
  const byCustomer = new Map();
  for (const s of state.saved) if (state.yields.get(s.id) != null) (byCustomer.get(s.customer) || byCustomer.set(s.customer, []).get(s.customer)).push(s);
  const series = [...byCustomer.entries()].filter(([, a]) => a.length > 1);
  if (!series.length) return;
  const [name, snaps] = series[0];                       // one customer at a time keeps the chart readable
  const W_ = 640, H = 200, ml = 40, mr = 16, mt = 12, mb = 28;
  const t = (d) => Date.parse(d);
  const t0 = t(snaps[0].as_of), t1 = t(snaps[snaps.length - 1].as_of) || t0 + 1;
  const x = (d) => ml + ((t(d) - t0) / Math.max(t1 - t0, 1)) * (W_ - ml - mr);
  const y = (v) => mt + (1 - v) * (H - mt - mb);
  let g = "";
  for (const v of [0, 0.25, 0.5, 0.75, 1]) g += `<line x1="${ml}" x2="${W_ - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${ml - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`;
  const pts = snaps.map((s) => `${x(s.as_of).toFixed(1)},${y(state.yields.get(s.id)).toFixed(1)}`);
  g += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
  snaps.forEach((s, i) => {
    const anchor = i === 0 ? "start" : i === snaps.length - 1 ? "end" : "middle";       // keep the end labels inside the frame
    g += `<circle cx="${x(s.as_of)}" cy="${y(state.yields.get(s.id))}" r="4" fill="var(--accent)"/><text x="${x(s.as_of)}" y="${H - 8}" text-anchor="${anchor}">${esc(s.as_of)}</text>`;
  });
  box.innerHTML = `<svg viewBox="0 0 ${W_} ${H}" role="img" aria-label="Yield over time for ${esc(name)}">${g}</svg>`;
}

async function exportWorkspace() {
  const text = W.serializeWorkspace(state.saved, { engine: state.engine ? state.engine.version : "" });
  save(new Blob([text], { type: "application/json" }), "beyond90-workspace.json");
  wsSay(`Exported ${state.saved.length} snapshot(s). The file contains customer data: keep it private.`);
}

async function importWorkspace(file) {
  try {
    const { snapshots } = W.parseWorkspace(await file.text());
    const { ok, rejected } = await W.acceptSnapshots(snapshots);
    const added = await store.put(ok);
    await refreshHistory();
    wsSay(`Imported: ${added} new, ${ok.length - added} already here` + (rejected ? `, ${rejected} rejected because their content did not match their name.` : "."));
  } catch (e) {
    wsSay(e.message);
  }
}

async function forgetAll() {
  if (!confirm("Delete every snapshot saved in this browser? Export first if you want to keep them.")) return;
  await store.clear();
  state.yields.clear();
  await refreshHistory();
  wsSay("Everything saved in this browser was deleted.");
}

async function addDemoPrevious() {
  const files = await (await fetch("./demo-previous.json")).json();
  const { customer, asOf } = W.peekCustomer(files);
  await store.put([await W.makeSnapshot(files, { customer, asOf, includePersonal: true, savedOn: "" })]);
  await refreshHistory();
  wsSay("Added the demo's earlier snapshot. Run the demo again to see what changed.");
}

// ---------- transparency
async function selfCheck() {
  $("selfcheck-out").textContent = "Checking…";
  const lines = [];
  try {
    await fetch("https://example.com/beyond90-probe", { mode: "no-cors" });
    lines.push("the page could reach another site (unexpected)");
  } catch { lines.push("the page cannot reach other sites"); }
  try {
    const p = JSON.parse(await state.engine.call("probe"));
    lines.push(p.reached ? "the engine could reach another site (unexpected)" : "the engine cannot reach other sites" + (p.violations.length ? " (the browser blocked and logged the attempt)" : ""));
  } catch (e) { lines.push("the engine check failed: " + e.message); }
  $("selfcheck-out").textContent = lines.join("; ") + ".";
}

// ---------- wiring
$("folder").addEventListener("change", (e) => addFiles(e.target.files));
$("files").addEventListener("change", (e) => addFiles(e.target.files));
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", dropped);
$("demo").addEventListener("click", loadDemo);
$("run").addEventListener("click", () => run());
$("cancel").addEventListener("click", cancel);
$("copy").addEventListener("click", copy);
$("download").addEventListener("click", download);
$("save").addEventListener("click", saveSnapshot);
$("compare").addEventListener("change", (e) => run(e.target.value));
$("export").addEventListener("click", exportWorkspace);
$("import").addEventListener("change", (e) => e.target.files[0] && importWorkspace(e.target.files[0]).then(() => { e.target.value = ""; }));
$("forget").addEventListener("click", forgetAll);
$("demo-prev").addEventListener("click", addDemoPrevious);
$("selfcheck").addEventListener("click", selfCheck);
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => state.result && selectTab(b.dataset.tab));
boot();
