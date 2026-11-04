// Beyond 90 in the browser. The Python engine runs in a worker (WebAssembly, Pyodide) from this same origin.
// Files are read with the File API and handed to the worker as text. User data is never sent anywhere.
import { Engine } from "./engine.js";
import * as W from "./workspace-core.js";
import * as store from "./store.js";
import * as Vault from "./vault.js";
import * as V from "./views.js";
import { h as el_, s as svg_, saveBlob, copyText, csvCell, icon } from "./ui.js";
import { gauge, STAGE } from "./charts.js";

const $ = (id) => document.getElementById(id);
// The page enforces Trusted Types for scripts (see the CSP): the only string-to-HTML sink left is the sandboxed report frame,
// which has no scripts and no access to this page. Its content is produced by the engine from the customer's files, escaped there.
const swPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-sw", { createScriptURL: (u) => { if (u !== "./sw.js") throw new TypeError("only the page's own service worker may be registered"); return u; } }) : null;
const reportPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-report", { createHTML: (t) => t }) : null;
const state = { advisories: null, files: {}, groups: {}, mode: "single", result: null, book: null, tab: "overview", saved: [], yields: new Map(), engine: null, running: false };
const ALLOWED = /\.(csv|toml)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");

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
  await refreshVault();
}

function refreshRun() {
  const have = state.mode === "book" ? Object.keys(state.groups).length : Object.keys(state.files).length;
  $("run").disabled = state.running || !(state.engine && state.engine.version && have);
  $("demo-book").disabled = $("demo-endpoint").disabled = !(state.engine && state.engine.version);
}

async function registerOffline() {
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) return;
  try {
    await navigator.serviceWorker.register(swPolicy ? swPolicy.createScriptURL("./sw.js") : "./sw.js");
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
    ...(state.advisories ? { advisories: state.advisories } : {}),
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
      hours: Number($("bookhours").value) || 30, week_hours: Number($("bookhours").value) || 30, weeks: o.weeks, realization: o.realization, weighting: $("weighting").value,
      ...(state.advisories ? { advisories: state.advisories } : {}) } });
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
  fillHead("Your book", `${b.customers.length} customers · ${b.profile} catalogue · engine ${b.version}`, [el_("span", { class: "chip", text: "ARR-weighted Yield " + pct(b.arr_weighted_yield) }), el_("span", { class: "chip", text: "after the plan " + pct(b.weighted_end) })]);
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
  state.tab = "week";
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
  return el_("div", { class: "kpi" }, el_("b", { text: value }), el_("span", { text: label }));
}

function fillHead(title, sub, chips) {
  $("reshead").replaceChildren(el_("div", {}, el_("h1", { text: title }), el_("div", { class: "sub", text: sub })), el_("div", { class: "chips2" }, chips));
  document.body.classList.add("has-results");
}

function showResults() {
  const r = state.result;
  fillHead(r.customer, `As of ${r.as_of} · ${r.profile} catalogue · engine ${r.version}`, [el_("span", { class: "levelbadge lv-" + r.level, text: r.level.charAt(0).toUpperCase() + r.level.slice(1) + (r.level_provisional ? " (provisional)" : "") }), el_("span", { class: "chip", text: "inputs: " + r.confidence + " confidence" })]);
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
  { id: "overview", label: "Overview", kind: "view", view: "overview", icon: "overview", group: "Customer" },
  { id: "prep", label: "Prep a call", kind: "view", view: "prepView", icon: "prep" },
  { id: "onboarding", label: "Onboarding", kind: "view", view: "onboardingView", icon: "onboarding" },
  { id: "outlook", label: "If nothing is done", kind: "view", view: "outlookView", icon: "outlook" },
  { id: "value", label: "Value receipt", kind: "view", view: "valueView", icon: "renewal" },
  { id: "teams", label: "Teams", kind: "view", view: "teamsView", icon: "accounts" },
  { id: "actions", label: "Actions", kind: "view", view: "actionsView", icon: "actions" },
  { id: "accounts", label: "Accounts", kind: "view", view: "accountsView", icon: "accounts" },
  { id: "findings", label: "Findings", kind: "view", view: "findingsView", icon: "findings" },
  { id: "news", label: "News", kind: "view", view: "newsView", icon: "news" },
  { id: "planview", label: "Plan & what-if", kind: "view", view: "planView", icon: "planview", group: "Plan and review" },
  { id: "maturity", label: "Maturity", kind: "view", view: "maturityView", icon: "maturity" },
  { id: "renewal", label: "Renewal & trust", kind: "view", view: "renewalView", icon: "renewal" },
  { id: "changes", label: "Changes", kind: "view", view: "changesView", icon: "changes" },
  { id: "report", sep: true, icon: "doc", group: "Documents", label: "Report", key: "report_html", file: "beyond90-report.html", type: "text/html", kind: "html" },
  { id: "qbr", label: "QBR draft", key: "qbr_markdown", file: "beyond90-qbr.md", type: "text/markdown", kind: "md" },
  { id: "plan", label: "Success plan", key: "success_plan_markdown", file: "beyond90-success-plan.md", type: "text/markdown", kind: "md" },
  { id: "roadmap", label: "Roadmap", key: "roadmap_markdown", file: "beyond90-roadmap.md", type: "text/markdown", kind: "md" },
  { id: "summary", label: "Summary", key: "report_markdown", file: "beyond90-summary.md", type: "text/markdown", kind: "md" },
  { id: "json", label: "JSON", key: "score_json", file: "beyond90-score.json", type: "application/json", kind: "json" },
];
const BOOK_TABS = [
  { id: "week", label: "This week", kind: "view", view: "weekView", icon: "week", group: "Your book" },
  { id: "bookmap", label: "Portfolio map", kind: "view", view: "bookView", icon: "bookmap" },
  { id: "bookonboard", label: "Onboarding", kind: "view", view: "bookOnboardView", icon: "onboarding" },
  { id: "booknews", label: "Cloud news", kind: "view", view: "bookNewsView", icon: "news" },
  { id: "portfolio", label: "Portfolio", icon: "doc", group: "Documents", key: "portfolio_markdown", file: "beyond90-portfolio.md", type: "text/markdown", kind: "md" },
  { id: "book", label: "Where your hours go", key: "book_markdown", file: "beyond90-book.md", type: "text/markdown", kind: "md" },
  { id: "bookreport", label: "Book report", key: "book_html", file: "beyond90-book.html", type: "text/html", kind: "html" },
];
let tabDefs = SINGLE_TABS;

function renderTabs(defs) {
  tabDefs = defs;
  $("tabs").replaceChildren(...defs.flatMap((t) => {
    const b = el_("button", { type: "button" }, icon(t.icon || "doc"), el_("span", { text: t.label }));
    b.setAttribute("role", "tab");
    b.dataset.tab = t.id;
    b.addEventListener("click", () => selectTab(t.id));
    const out = [];
    if (t.group) out.push(el_("span", { class: "grp", "aria-hidden": "true", text: t.group }));
    if (t.sep) out.push(el_("span", { class: "sep", "aria-hidden": "true" }));
    return [...out, b];
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
  if (t.kind === "html") $("report").srcdoc = reportPolicy ? reportPolicy.createHTML(text) : text;
  else if (t.kind === "json") $("raw").textContent = text;
  else $("doc").replaceChildren(...markdown(text));
}

function context() {
  if (state.book) return { book: state.book, advisories: state.advisories, openCustomer: (key, tab = "prep") => { state.mode = "single"; state.files = { ...state.groups[key] }; state.book = null; state.tab = tab; renderLoaded(); run(); } };
  const r = state.result;
  if (r && state.parsedFor !== r) { state.parsed = JSON.parse(r.score_json); state.parsedFor = r; }
  return { result: r, dash: r.dashboard, score: state.parsed, engine: state.engine, files: state.files, options: options(), advisories: state.advisories, logTouch, go: (tab, extra) => selectTab(tab, extra) };
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
function inlineNodes(src) {
  const out = [], re = /`([^`]+)`|\*\*([^*]+)\*\*|(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:]|$)/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    if (m[1] != null) out.push(el_("code", { text: m[1] }));
    else if (m[2] != null) out.push(el_("strong", { text: m[2] }));
    else { out.push(m[3]); out.push(el_("em", { text: m[4] })); }
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}
function markdown(src) {
  const out = [], lines = src.split("\n");
  const el = (tag, ...kids) => el_(tag, {}, ...kids);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if (/^---+$/.test(l.trim())) { out.push(document.createElement("hr")); i++; continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(el("h" + Math.min(m[1].length, 4), inlineNodes(m[2]))); i++; continue; }
    if (l.startsWith("|") && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || "")) {
      const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(el("tr", cells(lines[i]).map((c) => el("td", inlineNodes(c))))); i++; }
      out.push(el("table", el("thead", el("tr", head.map((c) => el("th", inlineNodes(c))))), el("tbody", rows))); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l), list = document.createElement(ordered ? "ol" : "ul");
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const li = el("li", inlineNodes(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")));
        i++;
        while (i < lines.length && /^\s{2,}[-*]\s+/.test(lines[i])) { li.append(el("div", "– ", inlineNodes(lines[i].replace(/^\s*[-*]\s+/, "")))); i++; }
        list.append(li);
      }
      out.push(list); continue;
    }
    let p = l; i++;
    while (i < lines.length && lines[i].trim() && !/^(#|\||---|\s*([-*]|\d+\.)\s)/.test(lines[i])) p += " " + lines[i++];
    out.push(el("p", inlineNodes(p)));
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
  if ((await store.getVault()) && !store.unlocked() && !(await unlockVaultUi())) { $("saved-note").textContent = "Saved data is protected; unlock it to save."; return; }
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
    idc.append(el_("code", { text: s.id.slice(0, 8) }), ...(s.personal_excluded ? [" ", el_("span", { class: "chip", text: "no contacts" })] : []));
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
  const g = [];
  for (const v of [0, 0.25, 0.5, 0.75, 1]) g.push(svg_("line", { x1: ml, x2: W_ - mr, y1: y(v), y2: y(v), stroke: "var(--grid)" }), svg_("text", { x: ml - 6, y: y(v) + 4, "text-anchor": "end" }, `${v * 100}%`));
  g.push(svg_("polyline", { points: snaps.map((q) => `${x(q.as_of).toFixed(1)},${y(state.yields.get(q.id)).toFixed(1)}`).join(" "), fill: "none", stroke: "var(--accent)", "stroke-width": 2.5 }));
  snaps.forEach((q, i) => {
    const anchor = i === 0 ? "start" : i === snaps.length - 1 ? "end" : "middle";       // keep the end labels inside the frame
    g.push(svg_("circle", { cx: x(q.as_of), cy: y(state.yields.get(q.id)), r: 4, fill: "var(--accent)" }), svg_("text", { x: x(q.as_of), y: H - 8, "text-anchor": anchor }, q.as_of));
  });
  box.append(svg_("svg", { viewBox: `0 0 ${W_} ${H}`, role: "img", "aria-label": `Yield over time for ${name}` }, g));
}

async function exportWorkspace() {
  if (await store.getVault() && !store.unlocked() && !(await unlockVaultUi())) return;
  const text = W.serializeWorkspace(state.saved, { engine: state.engine ? state.engine.version : "" });
  save(new Blob([text], { type: "application/json" }), "beyond90-workspace.json");
  wsSay(`Exported ${state.saved.length} snapshot(s). The file is not encrypted and contains customer data: keep it private.`);
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
  store.setKey(null);
  state.yields.clear();
  await refreshHistory();
  await refreshVault();
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

// ---------- protection of saved data
const IDLE_LOCK_MS = 15 * 60 * 1000;
let idleTimer = null;
async function refreshVault() {
  let meta = null, locked = 0;
  try { meta = await store.getVault(); locked = meta ? await store.lockedCount() : 0; } catch { /* storage unavailable: nothing to protect */ }
  const on = !!meta, open = on && store.unlocked();
  $("vault-state").textContent = !on ? "saved data is not protected" : open ? "protected, unlocked" : `protected, locked${locked ? ` (${locked} snapshot${locked === 1 ? "" : "s"})` : ""}`;
  $("vault-state").className = "chip" + (!on ? "" : open ? " on" : " locked");
  $("vault-on").hidden = on;
  $("vault-unlock").hidden = !on || open;
  $("vault-lock").hidden = !open;
  $("vault-off").hidden = !open;
  clearTimeout(idleTimer);
  if (open) idleTimer = setTimeout(() => lockVault("Locked after 15 minutes without use."), IDLE_LOCK_MS);
  return { meta, open };
}
async function lockVault(why = "Locked.") {
  store.setKey(null);
  state.saved = []; state.yields.clear();
  await refreshHistory();
  await refreshVault();
  wsSay(why);
}
function askPassphrase({ title, help, confirm }) {
  const d = $("vault-dialog");
  $("vault-title").textContent = title; $("vault-help").textContent = help;
  $("vault-pass").value = $("vault-pass2").value = ""; $("vault-msg").textContent = "";
  $("vault-again-label").hidden = !confirm; 
  d.showModal(); $("vault-pass").focus();
  return new Promise((resolve) => {
    const form = $("vault-form"), cancel = $("vault-cancel");
    const finish = (v) => { form.removeEventListener("submit", onSubmit); cancel.removeEventListener("click", onCancel); d.removeEventListener("close", onCancel); if (d.open) d.close(); resolve(v); };
    const onSubmit = (e) => {
      e.preventDefault();
      const p = $("vault-pass").value;
      if (confirm) {
        const bad = Vault.checkPassphrase(p);
        if (bad) { $("vault-msg").textContent = bad; return; }
        if (p !== $("vault-pass2").value) { $("vault-msg").textContent = "The two passphrases differ."; return; }
      }
      finish(p);
    };
    const onCancel = () => finish(null);
    form.addEventListener("submit", onSubmit); cancel.addEventListener("click", onCancel); d.addEventListener("close", onCancel);
  });
}
async function enableVault() {
  const p = await askPassphrase({ title: "Protect saved data", confirm: true, help: "Saved snapshots are sealed with a key made from this passphrase. The key stays in this tab's memory and is dropped after 15 idle minutes. There is no recovery: forget it and the saved copy is gone, so export a workspace first if you need a backup (an export is not sealed)." });
  if (p == null) return;
  wsSay("Sealing…");
  try {
    const { key, meta } = await Vault.createVault(p);
    store.setKey(key);
    await store.convertAll({ toSealed: true, meta });
    wsSay("Saved data is now protected.");
  } catch (e) { store.setKey(null); wsSay("Could not protect saved data: " + e.message); }
  await refreshHistory(); await refreshVault();
}
async function unlockVaultUi() {
  const meta = await store.getVault();
  if (!meta) return true;
  for (let tries = 0; tries < 5; tries++) {
    const p = await askPassphrase({ title: "Unlock saved data", confirm: false, help: tries ? "That was not the passphrase. Try again." : "Enter the passphrase you chose." });
    if (p == null) return false;
    const key = await Vault.unlockVault(meta, p);
    if (key) { store.setKey(key); await refreshHistory(); await refreshVault(); wsSay("Unlocked."); return true; }
    await new Promise((r) => setTimeout(r, 400 * 2 ** tries));          // slows guessing from inside the page; the key derivation already costs the rest
  }
  wsSay("Too many wrong passphrases. Reload the page to try again.");
  return false;
}
async function disableVault() {
  if (!confirm("Remove the passphrase? Saved snapshots will be stored unprotected again.")) return;
  try { await store.convertAll({ toSealed: false }); store.setKey(null); wsSay("Protection removed."); }
  catch (e) { wsSay("Could not remove protection: " + e.message); }
  await refreshHistory(); await refreshVault();
}
$("vault-on").addEventListener("click", enableVault);
$("vault-unlock").addEventListener("click", unlockVaultUi);
$("vault-lock").addEventListener("click", () => lockVault());
$("vault-off").addEventListener("click", disableVault);
for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => { if (store.unlocked()) { clearTimeout(idleTimer); idleTimer = setTimeout(() => lockVault("Locked after 15 minutes without use."), IDLE_LOCK_MS); } }, { passive: true });

// ---------- news and advisories
const ADV_KEY = "b90-advisories";
function showAdvisories() {
  const n = state.advisories ? (Array.isArray(state.advisories) ? state.advisories : state.advisories.threats || []).length : 0;
  $("adv-status").textContent = n ? `${n} advisories loaded.` : "";
  $("clear-adv").hidden = !n;
}
function setAdvisories(doc) {
  state.advisories = doc;
  try { doc ? localStorage.setItem(ADV_KEY, JSON.stringify(doc)) : localStorage.removeItem(ADV_KEY); } catch { /* storage may be blocked; the feed then lasts for this tab */ }
  showAdvisories();
}
async function loadAdvisoryFile(file) {
  if (file.size > 1024 * 1024) { $("adv-status").textContent = "That file is larger than 1 MB; an advisory feed should not be."; return; }
  try {
    const doc = JSON.parse(await file.text());
    const list = Array.isArray(doc) ? doc : doc && doc.threats;
    if (!Array.isArray(list) || list.length > 2000) throw new Error("expected a list of advisories (up to 2000), or an object with a 'threats' list");
    setAdvisories(doc);
    $("adv-status").textContent += " Run the analysis again to match them.";
  } catch (e) { $("adv-status").textContent = "Not a usable feed: " + e.message; }
}
try { const saved = localStorage.getItem(ADV_KEY); if (saved) state.advisories = JSON.parse(saved); } catch { /* ignore */ }
showAdvisories();
$("advfile").addEventListener("change", (e) => e.target.files[0] && loadAdvisoryFile(e.target.files[0]).then(() => { e.target.value = ""; }));
$("demo-adv").addEventListener("click", async () => { setAdvisories(await (await fetch("./demo-advisories.json")).json()); $("adv-status").textContent += " Run the analysis again to match them."; });
$("clear-adv").addEventListener("click", () => setAdvisories(null));

// The daily feed, published next to the page. Same origin, so the page's policy (connect-src 'self') is unchanged.
const isDaily = (d) => d && !Array.isArray(d) && d.schema === "beyond90-feed/1";
function describeFeed(d) {
  const ok = (d.sources || []).filter((x) => x.ok && x.id !== "epss").length, all = (d.sources || []).filter((x) => x.id !== "epss").length;
  const kev = (d.threats || []).filter((t) => t.kev).length;
  return `${(d.threats || []).length} cloud stories as of ${d.as_of}${kev ? `, ${kev} known exploited` : ""} (${ok} of ${all} sources read).`;
}
async function latestFeed() {
  try {
    const r = await fetch("./feed/advisories.json");
    if (!r.ok) return null;
    const d = await r.json();
    return isDaily(d) && Array.isArray(d.threats) && d.threats.length <= 2000 ? d : null;
  } catch { return null; }
}
latestFeed().then((d) => {
  if (!d) return;
  state.latestFeed = d;
  const b = $("latest-adv");
  b.hidden = false;
  b.title = describeFeed(d);
  if (isDaily(state.advisories) && state.advisories.generated !== d.generated) {
    setAdvisories(d);                                       // the user chose the daily news before: keep it current
    $("adv-status").textContent = "Updated to today's news: " + describeFeed(d);
  }
});
$("latest-adv").addEventListener("click", () => {
  if (!state.latestFeed) return;
  setAdvisories(state.latestFeed);
  $("adv-status").textContent = describeFeed(state.latestFeed) + " Run the analysis again to match them.";
});

// ---------- the interaction log
function logTouch(e) {
  const asOf = state.result.as_of;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Pick a date.";
  if (e.date > asOf) return `The date cannot be after the customer's as_of (${asOf}). Update as_of in customer.toml first.`;
  if (e.next_due && !/^\d{4}-\d{2}-\d{2}$/.test(e.next_due)) return "The due date is not a date.";
  const header = "date,kind,contact_id,summary,next_step,next_due";
  const line = [e.date, e.kind, e.contact_id, e.summary.trim(), e.next_step.trim(), e.next_due || ""].map(csvCell).join(",");
  const old = state.files["interactions.csv"];
  state.files["interactions.csv"] = (old && old.trim() ? old.replace(/\s*$/, "\n") : header + "\n") + line + "\n";
  renderLoaded();
  run();
  say("Added to interactions.csv in this tab. Download it from the command palette to keep it.");
  return "Added.";
}
function downloadInteractions() {
  if (state.files["interactions.csv"]) saveBlob(state.files["interactions.csv"], "interactions.csv", "text/csv");
}

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
    { label: "Download interactions.csv", hint: "action", when: () => !!state.files["interactions.csv"], run: downloadInteractions },
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

// ---------- first impression
for (const e of document.querySelectorAll("[data-i]")) e.prepend(icon(e.dataset.i, e.classList.contains("fi") ? 20 : 16));
function drawHero() {
  const stage = (v, n, d) => ({ value: v, numerator: n, denominator: d });
  const rows = [["L1", "Connected", 0.901, "var(--s1)"], ["L2", "Inventoried", 0.973, "var(--s2)"], ["L3", "Controls on", 0.927, "var(--s3)"], ["L4", "Decided", 0.894, "var(--s4)"]];
  void stage; void STAGE;
  $("hero-art").replaceChildren(el_("div", { class: "preview" },
    el_("div", { class: "pv-head" }, el_("span", { text: "Northwind (mock) · sample data" }), el_("span", { class: "levelbadge small lv-bronze", text: "Bronze" })),
    el_("div", { class: "pv-grid" }, gauge({ value: 0.726, marker: 0.92, size: 200, ticks: [] }),
      el_("div", { class: "pv-bars" }, rows.map(([k, name, v, c]) => el_("div", { class: "pv-bar" }, el_("span", { text: `${k} ${name}` }), el_("span", {}, el_("i", { style: `width:${v * 100}%;background:${c}` })), el_("b", { text: (v * 100).toFixed(0) + "%" }))))),
    el_("div", { class: "pv-opp" }, [["L4", "Give unowned findings an owner", "+4.0"], ["L3", "Adopt workflow automation on 31 accounts", "+2.1"], ["L1", "Connect 3 accounts owned by retail", "+2.0"]].map(([k, t, e]) => el_("div", { class: "pv-o" }, el_("span", { class: "stagepip", style: `border-color:var(--s${k.slice(1)})`, text: k }), el_("b", { text: t }), el_("span", { text: e + " pts" }))))),
    el_("div", { class: "pv-badge" }, icon("news", 16), el_("span", { text: "2 advisories touch uncovered accounts" })));
}
drawHero();
renderTabs(SINGLE_TABS);
boot();
