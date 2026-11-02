// Beyond 90 in the browser. The Python engine runs in a worker (WebAssembly, Pyodide) from this same origin.
// Files are read with the File API and handed to the worker as text. User data is never sent anywhere.
import { Engine } from "./engine.js";
import * as W from "./workspace-core.js";
import * as store from "./store.js";
import * as V from "./views.js";
import { h as el_, saveBlob, copyText } from "./ui.js";

const $ = (id) => document.getElementById(id);
const state = { files: {}, groups: {}, mode: "single", result: null, book: null, tab: "overview", saved: [], yields: new Map(), engine: null, running: false };
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
  const have = state.mode === "book" ? Object.keys(state.groups).length : Object.keys(state.files).length;
  $("run").disabled = state.running || !(state.engine && state.engine.version && have);
  $("demo-book").disabled = $("demo-endpoint").disabled = !(state.engine && state.engine.version);
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
const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const lastSegment = (dir) => dir.split("/").pop() || dir;

/** Accept files with their folder paths. One customer folder, a folder of customer folders, or loose files. */
async function addFiles(entries) {
  const kept = entries.filter(({ file }) => ALLOWED.test(file.name));
  const skipped = entries.length - kept.length;
  if (!kept.length) { if (skipped) say(skipped + " file(s) skipped: only .csv and .toml are read."); return; }
  const byDir = new Map();
  for (const { file, path } of kept) {
    if (file.size > MAX_BYTES) { say(file.name + " is larger than 20 MB and was skipped."); continue; }
    const dir = dirOf(path);
    if (!byDir.has(dir)) byDir.set(dir, {});
    byDir.get(dir)[W.baseName(file.name)] = await file.text();
  }
  const customers = [...byDir.entries()].filter(([, f]) => "customer.toml" in f);
  state.files = {}; state.groups = {};                 // a new selection replaces the old one, it never mixes customers
  if (customers.length >= 2) {
    state.mode = "book";
    for (const [dir, f] of customers) state.groups[uniqueKey(lastSegment(dir), state.groups)] = f;
  } else {
    state.mode = "single";
    state.files = customers.length === 1 ? customers[0][1] : Object.assign({}, ...byDir.values());
  }
  if (skipped) say(skipped + " file(s) skipped: only .csv and .toml are read.");
  renderLoaded();
}

function uniqueKey(key, taken) {
  let k = key || "customer", i = 2;
  while (k in taken) k = `${key}-${i++}`;
  return k;
}

const fromInput = (list) => [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

function renderLoaded() {
  const ul = $("loaded");
  ul.replaceChildren();
  const labels = state.mode === "book"
    ? Object.entries(state.groups).map(([k, f]) => `${k} (${Object.keys(f).length} files)`)
    : Object.keys(state.files).sort();
  for (const t of labels) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = t;
    ul.append(li);
  }
  if (state.mode === "book") say(`${Object.keys(state.groups).length} customers found. Press Run analysis to see the portfolio and a plan for your hours.`);
  state.result = null; state.book = null;
  $("results").hidden = true;
  refreshRun();
}

async function dropped(ev) {
  ev.preventDefault();
  $("drop").classList.remove("over");
  const items = [...(ev.dataTransfer.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  async function walk(entry, depth) {
    if (entry.isFile) out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path: entry.fullPath.replace(/^\//, "") });
    else if (entry.isDirectory && depth < 3) {
      const r = entry.createReader();
      let batch;
      do { batch = await new Promise((res, rej) => r.readEntries(res, rej)); for (const e of batch) await walk(e, depth + 1); } while (batch.length);
    }
  }
  if (items.length) for (const e of items) await walk(e, 0);
  else out.push(...fromInput(ev.dataTransfer.files));
  await addFiles(out);
}

async function loadDemo() {
  say("Loading the demo…");
  state.mode = "single"; state.groups = {};
  state.files = await (await fetch("./demo.json")).json();
  renderLoaded();
  say("Demo loaded: a made-up customer, Northwind. Press Run analysis.");
}

async function loadDemoEndpoint() {
  say("Loading the demo…");
  state.mode = "single"; state.groups = {};
  state.files = await (await fetch("./demo-endpoint.json")).json();
  renderLoaded();
  say("Demo loaded: a made-up endpoint-protection customer (profile: endpoint). Press Run analysis.");
}

async function loadDemoBook() {
  say("Loading the book demo…");
  state.mode = "book"; state.files = {};
  state.groups = await (await fetch("./demo-book.json")).json();
  renderLoaded();
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
  if (state.mode === "book") return runBook();
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
    state.result = res; state.book = null;
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

async function runBook() {
  $("errors").hidden = true;
  state.running = true;
  $("cancel").hidden = false;
  refreshRun();
  say("Analyzing every customer and planning your hours…");
  try {
    const o = options();
    const res = await state.engine.json("book", { groups: state.groups, options: {
      hours: Number($("bookhours").value) || 30, weeks: o.weeks, realization: o.realization, weighting: $("weighting").value } });
    if (!res.ok) return showErrors(res.errors);
    state.book = res; state.result = null;
    const skipped = Object.keys(res.errors || {});
    say(skipped.length ? `${skipped.length} customer(s) skipped because their data is invalid: ${skipped.join(", ")}.` : "");
    showBook();
  } catch (e) {
    if (e.cancelled) say("Cancelled. The engine was restarted.");
    else showErrors(["Unexpected error: " + e.message]);
  } finally {
    state.running = false;
    $("cancel").hidden = true;
    refreshRun();
  }
}

function showBook() {
  const b = state.book;
  $("kpis").replaceChildren(kpi(pct(b.arr_weighted_yield), "ARR-weighted Yield now"), kpi(pct(b.weighted_end), "After the plan"), kpi(String(b.customers.length), "Customers"), kpi(String(b.patterns), "Patterns shared across customers"));
  document.querySelector(".bar").hidden = true;
  $("saved-note").textContent = "";
  const tbody = $("book-table").tBodies[0];
  tbody.replaceChildren();
  for (const c of b.customers) {
    const tr = document.createElement("tr");
    const cell = (t, cls) => { const td = document.createElement("td"); td.textContent = t; if (cls) td.className = cls; return td; };
    tr.append(cell(c.name), cell(Math.round(c.arr).toLocaleString("en"), "n"), cell(pct(c.yield), "n"), cell(pct(c.planned_yield), "n"), cell(c.hours.toFixed(0), "n"), cell(c.confidence));
    const td = document.createElement("td");
    const open = Object.assign(document.createElement("button"), { className: "btn small", type: "button", textContent: "Open" });
    open.onclick = () => { state.mode = "single"; state.files = { ...state.groups[c.key] }; state.book = null; renderLoaded(); run(); };
    td.append(open); tr.append(td); tbody.append(tr);
  }
  $("book-table").hidden = true;                 // the portfolio map in the tabs replaces this table
  state.tab = "bookmap";
  $("results").hidden = false;
  renderTabs(BOOK_TABS);
  selectTab(state.tab);
  $("results").scrollIntoView({ behavior: "smooth" });
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
  $("kpis").replaceChildren(kpi(pct(r.yield), "Yield"), kpi(pct(r.reach), "Reach"), kpi(String(r.actions), "Open actions"), kpi(r.level.charAt(0).toUpperCase() + r.level.slice(1) + (r.level_provisional ? " (provisional)" : ""), "Maturity level"), kpi(r.confidence, "Confidence in the inputs"), kpi(r.profile, "Catalogue profile"), kpi(r.customer, "Customer as of " + r.as_of));
  renderCompare();
  document.querySelector(".bar").hidden = false;
  $("book-table").hidden = true;
  if (!SINGLE_TABS.some((t) => t.id === state.tab)) state.tab = "overview";
  $("results").hidden = false;
  renderTabs(SINGLE_TABS);
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
const SINGLE_TABS = [
  { id: "overview", label: "Overview", kind: "view", view: "overview" },
  { id: "actions", label: "Actions", kind: "view", view: "actionsView" },
  { id: "accounts", label: "Accounts", kind: "view", view: "accountsView" },
  { id: "findings", label: "Findings", kind: "view", view: "findingsView" },
  { id: "planview", label: "Plan & what-if", kind: "view", view: "planView" },
  { id: "maturity", label: "Maturity", kind: "view", view: "maturityView" },
  { id: "renewal", label: "Renewal & trust", kind: "view", view: "renewalView" },
  { id: "changes", label: "Changes", kind: "view", view: "changesView" },
  { id: "report", sep: true, label: "Report", key: "report_html", file: "beyond90-report.html", type: "text/html", kind: "html" },
  { id: "qbr", label: "QBR draft", key: "qbr_markdown", file: "beyond90-qbr.md", type: "text/markdown", kind: "md" },
  { id: "plan", label: "Success plan", key: "success_plan_markdown", file: "beyond90-success-plan.md", type: "text/markdown", kind: "md" },
  { id: "roadmap", label: "Roadmap", key: "roadmap_markdown", file: "beyond90-roadmap.md", type: "text/markdown", kind: "md" },
  { id: "summary", label: "Summary", key: "report_markdown", file: "beyond90-summary.md", type: "text/markdown", kind: "md" },
  { id: "json", label: "JSON", key: "score_json", file: "beyond90-score.json", type: "application/json", kind: "json" },
];
const BOOK_TABS = [
  { id: "bookmap", label: "Portfolio map", kind: "view", view: "bookView" },
  { id: "portfolio", label: "Portfolio", key: "portfolio_markdown", file: "beyond90-portfolio.md", type: "text/markdown", kind: "md" },
  { id: "book", label: "Where your hours go", key: "book_markdown", file: "beyond90-book.md", type: "text/markdown", kind: "md" },
  { id: "bookreport", label: "Book report", key: "book_html", file: "beyond90-book.html", type: "text/html", kind: "html" },
];
let tabDefs = SINGLE_TABS;

function renderTabs(defs) {
  tabDefs = defs;
  $("tabs").replaceChildren(...defs.flatMap((t) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: t.label });
    b.setAttribute("role", "tab");
    b.dataset.tab = t.id;
    b.addEventListener("click", () => selectTab(t.id));
    return t.sep ? [Object.assign(document.createElement("span"), { className: "sep", ariaHidden: "true" }), b] : [b];
  }));
}

const current = () => tabDefs.find((t) => t.id === state.tab) || tabDefs[0];
const payload = () => (state.mode === "book" || state.book ? state.book : state.result);

function selectTab(name, extra) {
  state.tab = name;
  state.focus = extra && extra.open;
  const t = current();
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === t.id));
  $("view").hidden = t.kind !== "view";
  $("docactions").hidden = t.kind === "view";
  if (t.kind === "view") {
    $("report").hidden = $("doc").hidden = $("raw").hidden = true;
    return renderView(t);
  }
  const text = payload()[t.key];
  $("report").hidden = t.kind !== "html";
  $("doc").hidden = t.kind !== "md";
  $("raw").hidden = t.kind !== "json";
  if (t.kind === "html") $("report").srcdoc = text;
  else if (t.kind === "json") $("raw").textContent = text;
  else $("doc").replaceChildren(...markdown(text));
}

function context() {
  if (state.book) return { book: state.book, openCustomer: (key) => { state.mode = "single"; state.files = { ...state.groups[key] }; state.book = null; state.tab = "overview"; renderLoaded(); run(); } };
  const r = state.result;
  if (r && state.parsedFor !== r) { state.parsed = JSON.parse(r.score_json); state.parsedFor = r; }
  return { result: r, dash: r.dashboard, score: state.parsed, engine: state.engine, files: state.files, options: options(), go: (tab, extra) => selectTab(tab, extra) };
}

function renderView(t) {
  const host = $("view");
  try {
    host.replaceChildren(V[t.view]({ ...context(), focus: state.focus }));
  } catch (e) {
    host.replaceChildren(el_("p", { class: "note", text: "This view could not be drawn: " + e.message }));
  }
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
  const t = current();
  save(new Blob([payload()[t.key]], { type: t.type + ";charset=utf-8" }), t.file);
}
function save(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy() {
  try { await navigator.clipboard.writeText(payload()[current().key]); say("Copied."); }
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
$("folder").addEventListener("change", (e) => addFiles(fromInput(e.target.files)));
$("files").addEventListener("change", (e) => addFiles(fromInput(e.target.files)));
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", dropped);
$("demo").addEventListener("click", loadDemo);
$("demo-book").addEventListener("click", loadDemoBook);
$("demo-endpoint").addEventListener("click", loadDemoEndpoint);
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

// ---------- theme
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem("b90-theme")); } catch { /* storage may be blocked; the theme then follows the system */ }
$("theme").addEventListener("click", () => {
  const now = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = now === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem("b90-theme", next); } catch { /* ignore */ }
});

// ---------- command palette and keys
const hasResult = () => !!state.result;
function commands() {
  const go = (id, label) => ({ label: "Go to " + label, hint: "view", when: () => hasResult(), run: () => { selectTab(id); $("results").scrollIntoView({ behavior: "smooth" }); } });
  return [
    { label: "Run analysis", hint: "action", when: () => !$("run").disabled, run: () => run() },
    { label: "Load the demo (one customer)", hint: "demo", when: () => !$("demo").disabled, run: loadDemo },
    { label: "Load the book demo (3 customers)", hint: "demo", when: () => !$("demo-book").disabled, run: loadDemoBook },
    { label: "Load the endpoint demo", hint: "demo", when: () => !$("demo-endpoint").disabled, run: loadDemoEndpoint },
    ...SINGLE_TABS.map((t) => go(t.id, t.label)),
    { label: "Save snapshot in this browser", hint: "action", when: hasResult, run: saveSnapshot },
    { label: "Copy a five-line summary for chat", hint: "action", when: hasResult, run: copySummary },
    { label: "Download the current document", hint: "action", when: () => hasResult() && current().kind !== "view", run: download },
    { label: "Export workspace", hint: "action", run: exportWorkspace },
    { label: "Print this view", hint: "action", run: () => window.print() },
    { label: "Switch colour theme", hint: "action", run: () => $("theme").click() },
    { label: "Check that nothing leaves this page", hint: "privacy", run: selfCheck },
  ].filter((c) => !c.when || c.when());
}
function copySummary() {
  const r = state.result, sc = state.parsed || JSON.parse(r.score_json), d = r.dashboard;
  const lines = [`${r.customer} · ${r.as_of}`, `Yield ${pct(r.yield)} (legacy metric ${pct(sc.naive)}), maturity ${r.level}`,
    ...Object.entries(sc.stages).map(([k, v]) => `${k} ${v.name}: ${pct(v.value)} (${v.numerator}/${v.denominator})`),
    d.actions[0] ? `Top action: ${d.actions[0].title} (+${d.actions[0].effect.toFixed(1)} pts, ${d.actions[0].hours.toFixed(1)} h)` : ""].filter(Boolean);
  copyText(lines.join("\n")).then((ok) => say(ok ? "Summary copied." : "Copy is not available here."));
}
const pal = { el: $("palette"), q: $("palette-q"), list: $("palette-list"), items: [], at: 0 };
function paintPalette() {
  const q = pal.q.value.trim().toLowerCase();
  pal.items = commands().filter((c) => !q || c.label.toLowerCase().includes(q));
  pal.at = Math.min(pal.at, Math.max(0, pal.items.length - 1));
  pal.list.replaceChildren(...pal.items.map((c, i) => {
    const li = el_("li", { role: "option", "aria-selected": String(i === pal.at) }, el_("span", { text: c.label }), el_("small", { text: c.hint }));
    li.addEventListener("click", () => runPalette(i));
    return li;
  }));
}
function runPalette(i) { const c = pal.items[i]; if (!c) return; pal.el.close(); c.run(); }
function openPalette() { pal.q.value = ""; pal.at = 0; paintPalette(); if (!pal.el.open) pal.el.showModal(); pal.q.focus(); }
pal.q.addEventListener("input", () => { pal.at = 0; paintPalette(); });
pal.q.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { pal.at = Math.min(pal.items.length - 1, pal.at + 1); paintPalette(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { pal.at = Math.max(0, pal.at - 1); paintPalette(); e.preventDefault(); }
  else if (e.key === "Enter") { runPalette(pal.at); e.preventDefault(); }
});
$("open-palette").addEventListener("click", openPalette);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal.el.open ? pal.el.close() : openPalette(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || pal.el.open;
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && hasResult() && tabDefs === SINGLE_TABS) {
    const t = SINGLE_TABS[Number(e.key) - 1]; if (t) selectTab(t.id);
  }
});
renderTabs(SINGLE_TABS);
boot();
