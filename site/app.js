// Beyond 90 in the browser. The Python engine runs in a worker (WebAssembly, Pyodide) from this same origin.
// Files are read with the File API and handed to the worker as text. User data is never sent anywhere.
import { internalWarning } from "./internal.js";
import { rank } from "./fuzzy.js";
import { qrSvg } from "./qr.js";
import { PROVIDERS, problems as starterProblems, starterFiles } from "./starter.js";
import { Engine } from "./engine.js";
import * as W from "./workspace-core.js";
import * as O from "./outcomes.js";
import * as K from "./commitments.js";
import * as ASK from "./asks.js";
import * as DONE from "./done.js";
import * as POV from "./pov.js";
import * as WSHOP from "./workshop.js";
import * as INV from "./inventory.js";
import * as DESKX from "./desk.js";
import * as SLA from "./sla.js";
import { ROLES, ROLE_IDS, isRole, shape } from "./roles.js";
import * as store from "./store.js";
import * as Vault from "./vault.js";
import * as V from "./views.js";
import { createPrivacy } from "./privacy.js";
import { h as el_, s as svg_, saveBlob, copyText, setExitGate, csvCell, icon, initTips, info } from "./ui.js";
import { CUSTOMER_NAV, BOOK_NAV, ESTATE_NAV, WORKSHOP_NAV, FAQ, GLOSSARY, TOUR } from "./guide.js";
import { navBadges, stageBars, togglePin, pinnedViews } from "./nav.js";
import * as KEYS from "./keys.js";
import { nextStep, answers } from "./next.js";
import { nOf, verb } from "./words.js";

// Another site could frame this page and steer clicks on it; the app only runs as the top-level page.
if (window.top !== window.self) throw new Error("Beyond 90 runs only as a top-level page, never inside another site's frame.");

const $ = (id) => document.getElementById(id);
// The page enforces Trusted Types for scripts (see the CSP): the only string-to-HTML sink left is the sandboxed report frame,
// which has no scripts and no access to this page. Its content is produced by the engine from the customer's files, escaped there.
const swPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-sw", { createScriptURL: (u) => { if (u !== "./sw.js") throw new TypeError("only the page's own service worker may be registered"); return u; } }) : null;
const reportPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-report", { createHTML: (t) => t }) : null;
const state = { commitments: [], outcomes: [], povs: [], asks: [], marks: [], workshops: [], workshop: null, wcat: null, calibration: null, healthWeights: null, advisories: null, files: {}, groups: {}, mode: "single", result: null, book: null, tab: "today", saved: [], yields: new Map(), engine: null, running: false };
const ALLOWED = /\.(csv|toml|xlsx)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");

const say = (text) => { $("status").textContent = text; };

// What leaves the page (copy, download) passes through one gate: pseudonyms, a preview, and a log of what left.
const privacy = createPrivacy({ state, store, $, say, unlockVaultUi: () => unlockVaultUi(), today: () => todayIso(), saveBlob, copyText });
setExitGate(privacy.gate);
privacy.onRefresh(() => refreshHistory());

// ---------- how the app was opened: a shortcut on its icon, or files shared to it from another app
async function openedWith() {
  const q = new URLSearchParams(location.search);
  const start = q.get("start"), shared = q.has("shared");
  if (start || shared) history.replaceState(null, "", location.pathname);   // a reload must not repeat it
  if (shared) {
    let entries = [];
    try {
      const inbox = await caches.open("share-inbox");
      for (const req of await inbox.keys()) {
        const res = await inbox.match(req);
        const name = decodeURIComponent(res.headers.get("x-name") || "").split(/[\\/]/).pop();
        if (ALLOWED.test(name)) entries.push({ file: new File([await res.blob()], name), path: name });
      }
    } catch { entries = []; }
    finally { try { await caches.delete("share-inbox"); } catch { /* nothing to empty */ } }   // emptied at once, read or not
    if (entries.length) { showPlace("start"); await addFiles(entries); say(`${nOf(entries.length, "shared file")} loaded. Check the list, then Analyse.`); }
    else say("Nothing usable was shared: only .csv, .toml and .xlsx files are read.");
    return;
  }
  if (start === "demo") { showPlace("start"); await loadDemo(); await run(); }
  else if (start === "saved") showPlace("saved");

}

/** One link to the presales desk at work, opened at once (the desk needs no engine): a first visit gets the invented
 *  examples; a browser with real work only opens the desk, adding nothing to it. */
async function openPresales() {
  history.replaceState(null, "", location.pathname);   // a reload must not repeat it
  setRole("se");
  await refreshWorkshops(); await refreshPovs();
  if (!state.workshops.length && !state.povs.length) await fillDeskExamples();
  showPlace("desk");
}

/** The invented prospects of the presales desk, the first with its invented inventory. */
async function fillDeskExamples() {
  const ex = DESKX.exampleDesk(todayIso());
  const read = INV.readInventory(await (await fetch("./demo-inventory.csv")).text());
  if (read.ok) ex.workshops[0] = WSHOP.setInventory(ex.workshops[0], { ...INV.summarise(read), imported_on: ex.workshops[0].created_on }, ex.workshops[0].created_on);
  await store.workshopPut(ex.workshops, true); await store.povPut(ex.povs, true);
}

// ---------- engine
async function boot() {
  state.engine = new Engine(say);
  try {
    await state.engine.start();
    $("version").textContent = "engine " + state.engine.version;
    say("");
    $("demo").disabled = false;
    $("try-now").disabled = false; $("try-now").textContent = "See it on an example";
    refreshRun();
    await openedWith();
  } catch (e) {
    $("version").textContent = "engine failed";
    say("The engine could not start: " + e.message);
  }
  registerOffline();
  await refreshHistory();
}

const multiMode = () => state.mode === "book" || state.mode === "estate";
const multi = () => state.book || state.estate || state.workshop;

function refreshRun() {
  const have = multiMode() ? Object.keys(state.groups).length : Object.keys(state.files).length;
  $("run").disabled = state.running || !(state.engine && state.engine.version && have);
  $("demo-book").disabled = $("demo-endpoint").disabled = $("demo-estate").disabled = !(state.engine && state.engine.version);
  for (const b of document.querySelectorAll("[data-demo]")) b.disabled = !(state.engine && state.engine.version);
}

// A new build is installed in the background and offered, never forced: "Update now" switches every tab to it at once.
function offerUpdate(reg) {
  const offer = (w) => {
    if (!w || !navigator.serviceWorker.controller) return;           // the first install is not an update
    $("update-bar").hidden = false;
    $("update-now").onclick = () => { $("update-now").disabled = true; w.postMessage("activate-now"); };
  };
  offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    w?.addEventListener("statechange", () => { if (w.state === "installed") offer(w); });
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloading) { reloading = true; location.reload(); } });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
}

async function registerOffline() {
  if (/^(chrome|moz)-extension:$/.test(location.protocol)) {       // the extension carries every file: offline by nature
    $("offline").hidden = false;
    $("get-extension").hidden = true;
    $("install-app").hidden = true;                                 // the extension is already an app of its own
    return;
  }
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) return;
  try {
    const reg = await navigator.serviceWorker.register(swPolicy ? swPolicy.createScriptURL("./sw.js") : "./sw.js", { updateViaCache: "none" });
    offerUpdate(reg);
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
  if (!kept.length) { if (skipped) say(`${nOf(skipped, "file")} skipped: only .csv, .toml and .xlsx are read.`); return; }
  const notes = [];
  const byDir = new Map();
  for (const { file, path } of kept) {
    if (file.size > MAX_BYTES) { say(file.name + " is larger than 20 MB and was skipped."); continue; }
    const dir = dirOf(path);
    if (!byDir.has(dir)) byDir.set(dir, {});
    if (/\.xlsx$/i.test(file.name)) {                 // a workbook: the engine turns its sheets into the customer's files
      await state.engine.ready;
      const r = JSON.parse(await state.engine.call("workbook", { name: file.name, data: toBase64(new Uint8Array(await file.arrayBuffer())) }));
      Object.assign(byDir.get(dir), r.files);
      notes.push(...r.notes);
    } else {
      byDir.get(dir)[W.baseName(file.name)] = await file.text();
    }
  }
  const customers = [...byDir.entries()].filter(([, f]) => "customer.toml" in f);
  state.files = {}; state.groups = {};                 // a new selection replaces the old one, it never mixes customers
  if (customers.length >= 2) {
    // Folders on different profiles are one customer's product lines, not a book of like customers
    state.mode = new Set(customers.map(([, f]) => profileOf(f))).size > 1 ? "estate" : "book";
    for (const [dir, f] of customers) state.groups[uniqueKey(lastSegment(dir), state.groups)] = f;
  } else {
    state.mode = "single";
    state.files = customers.length === 1 ? customers[0][1] : Object.assign({}, ...byDir.values());
  }
  if (skipped) notes.push(`${nOf(skipped, "file")} skipped: only .csv, .toml and .xlsx are read.`);
  if (notes.length) say(notes.join(" "));
  renderLoaded();
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function uniqueKey(key, taken) {
  let k = key || "customer", i = 2;
  while (k in taken) k = `${key}-${i++}`;
  return k;
}

const fromInput = (list) => [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

function renderLoaded() {
  document.body.classList.toggle("has-files", multiMode() ? Object.keys(state.groups || {}).length > 0 : Object.keys(state.files || {}).length > 0);
  const ul = $("loaded");
  ul.replaceChildren();
  const labels = multiMode()
    ? Object.entries(state.groups).map(([k, f]) => `${k} (${Object.keys(f).length} files)`)
    : Object.keys(state.files).sort();
  for (const t of labels) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = t;
    ul.append(li);
  }
  const what = state.mode === "estate" ? estateName() : state.mode === "book" ? `${Object.keys(state.groups).length} customers` : W.peekCustomer(state.files).customer || "these files";
  $("run").textContent = labels.length ? `Analyse ${what}` : "Analyse";
  if (state.mode === "book") say(`${Object.keys(state.groups).length} customers found: analyse them together to plan your week across the book.`);
  if (state.mode === "estate") say(`${estateName()} on ${nOf(Object.keys(state.groups).length, "product line")}: analyse them together to see the whole customer.`);
  state.result = null; state.book = null; state.estate = null; state.workshop = null;
  setStep(labels.length ? 2 : 1);
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
  say("Loading the example…");
  state.mode = "single"; state.groups = {};
  state.files = await (await fetch("./demo.json")).json();
  renderLoaded();
  say("Example loaded: Northwind, a made-up customer.");
}

async function loadDemoProfile(key, label) {
  say("Loading the example…");
  state.mode = "single"; state.groups = {};
  if (!/^[a-z-]+$/.test(key)) return;
  state.files = await (await fetch(`./demo-${key}.json`)).json();
  renderLoaded();
  say(`Example loaded: ${label}.`);
}

async function loadDemoEndpoint() {
  say("Loading the example…");
  state.mode = "single"; state.groups = {};
  state.files = await (await fetch("./demo-endpoint.json")).json();
  renderLoaded();
  say("Example loaded: a made-up endpoint-protection customer.");
}

async function loadDemoEstate() {
  say("Loading the example estate…");
  state.mode = "estate"; state.files = {};
  state.groups = await (await fetch("./demo-estate.json")).json();
  renderLoaded();
}

const profileOf = (files) => (/^\s*profile\s*=\s*"([^"\n]*)"/m.exec(files["customer.toml"] || "") || [])[1] || "cnapp";
const estateName = () => W.peekCustomer(Object.values(state.groups)[0] || {}).customer || "this customer";

async function loadDemoBook() {
  say("Loading the example book…");
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
    ...(state.healthWeights ? { health_weights: state.healthWeights } : {}),
  };
}

async function run(compareId) {
  if (state.mode === "book") return runBook();
  if (state.mode === "estate") return runEstate();
  state.running = true;
  $("cancel").hidden = false;
  refreshRun();
  say("Analysing…");
  try {
    const opts = options();
    const id = compareId === undefined ? await defaultCompare() : compareId;
    const base = id && state.saved.find((s) => s.id === id);
    if (base) opts.since_files = base.files;
    const res = await state.engine.json("analyze", { files: state.files, options: opts });
    if (!res.ok) return showErrors(res.errors);
    state.result = res; state.book = null; state.estate = null; state.workshop = null; privacy.learn(res);
    state.compareId = base ? base.id : "";
    say(res.warnings.length ? `${nOf(res.warnings.length, "warning")}: ` + res.warnings.join("; ") : "");
    showResults();
    if ($("autosave").checked && !holdSave) await saveSnapshot({ quiet: true });   // the history a review is built from
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
  state.running = true;
  $("cancel").hidden = false;
  refreshRun();
  say("Analysing every customer and planning your hours…");
  try {
    const o = options();
    const res = await state.engine.json("book", { groups: state.groups, options: {
      hours: Number($("bookhours").value) || 30, week_hours: Number($("bookhours").value) || 30, weeks: o.weeks, realization: o.realization, weighting: $("weighting").value,
      ...(state.advisories ? { advisories: state.advisories } : {}) } });
    if (!res.ok) return showErrors(res.errors);
    state.book = res; state.result = null; state.estate = null; state.workshop = null; privacy.learn(res);
    const skipped = Object.keys(res.errors || {});
    say(skipped.length ? `${nOf(skipped.length, "customer")} skipped because their data is invalid: ${skipped.join(", ")}.` : "");
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

async function runEstate() {
  state.running = true;
  $("cancel").hidden = false;
  refreshRun();
  say("Scoring each product line on its own profile…");
  try {
    const res = await state.engine.json("estate", { groups: state.groups });
    if (!res.ok) return showErrors(res.errors);
    state.estate = res; state.result = null; state.book = null; state.workshop = null;
    const skipped = Object.keys(res.errors || {});
    say(skipped.length ? `${nOf(skipped.length, "line")} skipped because their data is invalid: ${skipped.join(", ")}.` : "");
    showEstate();
  } catch (e) {
    if (e.cancelled) say("Cancelled. The engine was restarted.");
    else showErrors(["Unexpected error: " + e.message]);
  } finally {
    state.running = false;
    $("cancel").hidden = true;
    refreshRun();
  }
}

function showEstate() {
  const e = state.estate;
  fillHead(e.customer, `${nOf(e.lines.length, "product line")}, data as of ${e.as_of}`, e.yield);
  $("kpis").replaceChildren(kpi(pct(e.yield), "Estate Yield", "yield"), kpi(String(e.lines.length), "Lines in place"), kpi(String(e.whitespace.length), "Lines to open"));
  $("worktools").hidden = true;
  $("saved-note").textContent = "";
  $("book-table").hidden = true;
  state.tab = "estate";
  renderNav(ESTATE_NAV, e.customer);
  selectTab(state.tab);
}

function showBook() {
  const b = state.book;
  fillHead("Your book", `${b.customers.length} customers, ${b.profile} catalogue`, b.arr_weighted_yield);
  $("kpis").replaceChildren(kpi(pct(b.arr_weighted_yield), "Revenue-weighted Yield", "yield"), kpi(pct(b.weighted_end), "After the plan", null, "Where the book would be if the plan for your hours is followed."),
    kpi(String(b.customers.length), "Customers", "book"), kpi(String(b.patterns), "Gaps shared across customers", null, "Problems that appear at more than one customer: fix once, reuse everywhere."));
  $("worktools").hidden = true;
  $("saved-note").textContent = "";
  $("book-table").hidden = true;
  state.tab = "week";
  renderNav(BOOK_NAV, "Your book");
  selectTab(state.tab);
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
  $("errlist").replaceChildren(...list.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  say("");
  showPlace("errors");
}

const GLOSS = Object.fromEntries(GLOSSARY.map((g) => [g.id, g]));
/** A number with its name; a term from the glossary gets a question mark that explains it. */
function kpi(value, label, term, tip) {
  const g = term && GLOSS[term];
  const help = g ? info(g.text, g.term, () => openTerm(term)) : tip ? info(tip, label) : null;
  return el_("div", { class: "kpi" }, el_("b", { text: value }), el_("span", {}, label, help));
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const longDate = (iso) => (iso ? LONG_DATE.format(new Date(iso + "T00:00:00Z")) : "");

/** The ring: the brand's mark, drawn with the open customer's own Yield. */
function ring(value, size = 34) {
  const r = 13, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return svg_("svg", { viewBox: "0 0 32 32", width: size, height: size, class: "ring", role: "img", "aria-label": `Yield ${pct(value)}` },
    svg_("circle", { cx: 16, cy: 16, r, fill: "none", stroke: "var(--line)", "stroke-width": 4 }),
    svg_("circle", { cx: 16, cy: 16, r, fill: "none", stroke: "var(--accent)", "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": `${(v * c).toFixed(2)} ${c.toFixed(2)}`, transform: "rotate(-90 16 16)" }));
}

function fillHead(title, sub, value, badge) {
  $("reshead").replaceChildren(...[ring(value, 56), el_("div", {}, el_("h1", { class: "who-name", text: title }), el_("p", { class: "who-sub", text: sub })), badge].filter(Boolean));
  $("context").replaceChildren(ring(value), el_("span", { class: "context-name", text: title }), el_("span", { class: "context-sub", text: sub }));
  setStep(3);
}

const levelName = (r) => r.level.charAt(0).toUpperCase() + r.level.slice(1) + (r.level_provisional ? " (provisional)" : "");

function showResults() {
  const r = state.result;
  fillHead(r.customer, `Data as of ${longDate(r.as_of)}`, r.yield, el_("span", { class: "levelbadge lv-" + r.level, "data-tip": GLOSS.level.text, text: levelName(r) }));
  $("kpis").replaceChildren(kpi(pct(r.yield), "Yield", "yield"), kpi(pct(r.reach), "Reach", "reach"), kpi(String(r.actions), "Open actions"),
    kpi(levelName(r), "Maturity level", "level"), kpi(r.confidence, "Input confidence", "confidence"));
  renderCompare();
  $("worktools").hidden = false;
  $("book-table").hidden = true;
  if (!VIEWS[state.tab] || !CUSTOMER_NAV.some((g) => g.views.some((v) => v.id === state.tab))) state.tab = "today";
  renderNav(CUSTOMER_NAV, r.customer);
  selectTab(state.tab);
  offerTour();
}

function renderCompare() {
  const sel = $("compare"), r = state.result;
  const options = W.previousOf(state.saved, r.customer, r.as_of, r.input_hash);
  sel.replaceChildren(new Option("nothing", ""), ...options.map((s) => new Option(`${longDate(s.as_of)} (${s.id.slice(0, 8)})`, s.id)));
  sel.value = options.some((s) => s.id === state.compareId) ? state.compareId : "";
}

// ---------- places and views
const VIEWS = {
  today: { kind: "view", view: "todayView" }, overview: { kind: "view", view: "overview" }, connections: { kind: "view", view: "connectionsView" }, accounts: { kind: "view", view: "accountsView" }, findings: { kind: "view", view: "findingsView" },
  onboarding: { kind: "view", view: "onboardingView" }, maturity: { kind: "view", view: "maturityView" }, actions: { kind: "view", view: "actionsView" },
  planview: { kind: "view", view: "planView" }, whatif: { kind: "view", view: "whatifView" }, commitments: { kind: "view", view: "commitmentsView" }, handoff: { kind: "view", view: "handoffView" }, outlook: { kind: "view", view: "outlookView" }, teams: { kind: "view", view: "teamsView" }, burndown: { kind: "view", view: "burndownView" }, asks: { kind: "view", view: "asksView" }, scorecard: { kind: "view", view: "scorecardView" }, pov: { kind: "view", view: "povView" },
  prep: { kind: "view", view: "prepView" }, call: { kind: "view", view: "callView" }, news: { kind: "view", view: "newsView" }, value: { kind: "view", view: "valueView" },
  execqbr: { kind: "view", view: "execQbrView" }, renewal: { kind: "view", view: "renewalView" }, changes: { kind: "view", view: "changesView" },
  report: { kind: "html", key: "report_html", file: "beyond90-report.html", type: "text/html" },
  qbr: { kind: "md", key: "qbr_markdown", file: "beyond90-qbr.md", type: "text/markdown" },
  plan: { kind: "md", key: "success_plan_markdown", file: "beyond90-success-plan.md", type: "text/markdown" },
  onepager: { kind: "html", key: "onepager_html", file: "beyond90-one-page.html", type: "text/html" },
  actionscsv: { kind: "csv", key: "actions_csv", file: "beyond90-actions.csv", type: "text/csv" },
  roadmap: { kind: "md", key: "roadmap_markdown", file: "beyond90-roadmap.md", type: "text/markdown" },
  summary: { kind: "md", key: "report_markdown", file: "beyond90-summary.md", type: "text/markdown" },
  json: { kind: "json", key: "score_json", file: "beyond90-score.json", type: "application/json" },
  week: { kind: "view", view: "weekView" }, bookmap: { kind: "view", view: "bookView" }, bookonboard: { kind: "view", view: "bookOnboardView" },
  booknews: { kind: "view", view: "bookNewsView" }, bookburndown: { kind: "view", view: "bookBurndownView" }, bookconnections: { kind: "view", view: "bookConnectionsView" },
  calibration: { kind: "view", view: "calibrationView" },
  portfolio: { kind: "md", key: "portfolio_markdown", file: "beyond90-portfolio.md", type: "text/markdown" },
  book: { kind: "md", key: "book_markdown", file: "beyond90-book.md", type: "text/markdown" },
  bookreport: { kind: "html", key: "book_html", file: "beyond90-book.html", type: "text/html" },
  wsprep: { kind: "view", view: "wsPrepView" }, wsqualify: { kind: "view", view: "qualifyView" }, wsforward: { kind: "view", view: "forwardView" }, wscase: { kind: "view", view: "caseView" }, wsdelivery: { kind: "view", view: "deliveryView" }, workshop: { kind: "view", view: "workshopView" }, journey: { kind: "view", view: "journeyView" }, hurt: { kind: "view", view: "hurtView" }, wspov: { kind: "view", view: "povView" },
  wsummary: { kind: "md", key: "summary_markdown", file: "beyond90-discovery.md", type: "text/markdown" },
  readout: { kind: "html", key: "readout_html", file: "discovery-readout.html", type: "text/html" },
  estate: { kind: "view", view: "estateView" }, estategrow: { kind: "view", view: "growView" },
  estateplan: { kind: "md", key: "plan_markdown", file: "beyond90-account-plan.md", type: "text/markdown" },
};
let tabDefs = [];

const PLACES = { start: "place-start", desk: "place-desk", work: "results", saved: "history-panel", help: "place-help", errors: "errors" };
function showPlace(name) {
  for (const [k, id] of Object.entries(PLACES)) $(id).hidden = k !== name;
  state.place = name;
  for (const b of document.querySelectorAll(".rail [data-place]")) b.toggleAttribute("aria-current", b.dataset.place === name);
  if (name !== "work") for (const b of document.querySelectorAll("#tabs button")) b.removeAttribute("aria-current");
  if (name === "saved") renderDeviceQr();
  if (name === "desk") renderDesk().catch((e) => say(e.message));
  window.scrollTo({ top: 0 });
}

function setStep(n) {
  [...document.querySelectorAll(".steps li")].forEach((li, i) => { li.className = i + 1 < n ? "is-done" : i + 1 === n ? "is-now" : ""; });
}

let navGroups = [], navTitle = "";
function savedRole() { try { const r = localStorage.getItem("beyond90.role"); return isRole(r) ? r : "core"; } catch { return "core"; } }
const readList = (key) => { try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* the choice just does not persist */ } };
// Actions marked done are customer facts like promises: kept in this browser's store, sealed with the passphrase when one is
// set, erased with the customer. Each mark remembers the date of the data it was made on, so newer data can check it.
async function refreshMarks() { try { state.marks = await store.marksAll(); } catch { state.marks = []; } }
function marksFor(r) {
  if (!r || !r.dashboard) return { done: new Set(), stillOpen: [], confirmed: [] };
  return DONE.readMarks(state.marks, r.customer, r.dashboard.actions, r.as_of);
}
function doneFor(r) { return marksFor(r).done; }
async function markDone(id, on) {
  const r = state.result, today = todayIso();
  const have = state.marks.find((m) => m.customer === r.customer && m.action === id);
  try {
    if (on) {
      const a = r.dashboard.actions.find((x) => x.id === id);
      if (!a) return;
      await store.markPut([DONE.makeDone({ customer: r.customer, action: id, title: a.title, points: a.effect, dataAsOf: r.as_of, today })], true);
    } else if (have) {
      await store.markPut([DONE.withDone(have, false, today)], true);
    }
  } catch (e) { say(e.message); return; }
  await refreshMarks();
  renderNav(navGroups, navTitle); markTab();
  renderView(current());
}
function navSignals() {
  if (multi() || !state.result) return { badges: {}, bars: [] };
  const r = state.result;
  if (state.parsedFor !== r) { state.parsed = JSON.parse(r.score_json); state.parsedFor = r; }
  const left = r.dashboard.actions.filter((a) => !doneFor(r).has(a.id));
  return { badges: navBadges({ score: state.parsed, dash: { ...r.dashboard, actions: left } }), bars: stageBars(state.parsed) };
}
function pulseCard(bars) {
  const r = state.result;
  if (!r || multi()) return null;
  return el_("button", { type: "button", class: "pulse", "aria-label": `Yield ${pct(r.yield)}. Open Today`, onclick: () => selectTab("today") },
    el_("span", { class: "pulse-top" }, ring(r.yield, 40), el_("span", {}, el_("b", { class: "pulse-v", text: pct(r.yield) }), el_("small", { text: "Yield, the four stages multiplied" }))),
    el_("span", { class: "pulse-bars" }, bars.map((b) => el_("span", { class: "pbar" + (b.weakest ? " weak" : ""), title: `${b.id} ${b.label}: ${pct(b.value)}` },
      el_("i", { style: `width:${Math.max(4, Math.round(b.value * 100))}%` }), el_("em", { text: b.id })))));
}
function renderNav(groups, title) {
  navGroups = groups; navTitle = title;
  // "Accounts" reads "Clusters" or "Tenants" when that is what the customer's profile counts
  // A profile may give a shorter "menu" word when its units are long ("Databases" for "database environments")
  const terms = !multi() && state.result ? JSON.parse(state.result.score_json).terms || {} : {};
  const units = terms.menu || terms.units || "";
  const named = (v) => (v.id === "accounts" && units && units !== "accounts" ? { ...v, label: units[0].toUpperCase() + units.slice(1) } : v);
  if (units && units !== "accounts") groups = groups.map((g) => ({ ...g, views: g.views.map(named) }));
  tabDefs = groups.flatMap((g) => g.views.map((v) => ({ ...v, ...VIEWS[v.id], group: g.question })));   // every view stays reachable, whatever the role
  // the phone bar offers only the views this mode has (a book or an estate has no Today, Actions or Call of its own)
  for (const b of document.querySelectorAll("#mobilebar [data-go]")) b.hidden = !tabDefs.some((t) => t.id === b.dataset.go) && b.dataset.go !== "menu";
  $("workspace").hidden = false;
  document.body.classList.add("has-work");
  $("ws-title").textContent = title;
  paintRoles();
  const { badges, bars } = navSignals();
  const closed = new Set(readList("beyond90.navclosed"));
  const { main, more } = groups === BOOK_NAV || groups === ESTATE_NAV || groups === WORKSHOP_NAV ? { main: groups, more: [] } : shape(groups, savedRole());
  const badge = (id) => badges[id] ? el_("span", { class: "nbadge t-" + badges[id].tone, title: badges[id].label }, el_("span", { "aria-hidden": "true", text: badges[id].n > 99 ? "99+" : String(badges[id].n) }), el_("span", { class: "sr", text: `, ${badges[id].n} waiting` })) : null;
  const label = (v) => [icon(v.icon), el_("span", { class: "nlabel", text: v.label }), badge(v.id)];
  const btn = (v) => el_("button", { type: "button", dataset: { tab: v.id }, "data-tip": v.tip, onclick: () => selectTab(v.id) }, ...label(v));
  const grp = (g, i, p) => {
    const key = g.question, holdsCurrent = g.views.some((v) => v.id === state.tab), isOpen = holdsCurrent || !closed.has(key);
    const sum = g.views.reduce((n, v) => n + (badges[v.id] && badges[v.id].tone !== "info" ? badges[v.id].n : 0), 0);
    const head = el_("button", { type: "button", class: "grp", id: `grp-${p}${i}`, "aria-expanded": String(isOpen), onclick: (e) => {
      const now = new Set(readList("beyond90.navclosed")), open = e.currentTarget.getAttribute("aria-expanded") === "true";
      if (open) now.add(key); else now.delete(key);
      writeList("beyond90.navclosed", [...now]);
      e.currentTarget.setAttribute("aria-expanded", String(!open));
      e.currentTarget.parentElement.classList.toggle("shut", open);
    } }, el_("span", { text: g.question }), !isOpen && sum ? el_("span", { class: "nbadge t-warn", text: String(sum) }) : null, el_("span", { class: "chev", "aria-hidden": "true" }));
    return el_("div", { class: "navgroup" + (isOpen ? "" : " shut"), role: "group", "aria-labelledby": `grp-${p}${i}` }, head, el_("div", { class: "navitems" }, g.views.map(btn)));
  };
  const pins = pinnedViews(readList("beyond90.pins"), groups);
  const kids = [];
  if (pins.length) kids.push(el_("div", { class: "navgroup pins", role: "group", "aria-label": "Pinned" }, el_("p", { class: "grp-static", text: "Pinned" }),
    el_("div", { class: "navitems" }, pins.map((v) => el_("button", { type: "button", dataset: { pin: v.id }, onclick: () => selectTab(v.id) }, ...label(v))))));
  kids.push(...main.map((g, i) => grp(g, i, "m")));
  if (more.length) kids.push(el_("details", { class: "navmore", open: more.some((g) => g.views.some((v) => v.id === state.tab)) }, el_("summary", { text: "More views" }), more.map((g, i) => grp(g, i, "x"))));
  $("tabs").replaceChildren(...kids);
  $("pulse-host").replaceChildren(...[pulseCard(bars)].filter(Boolean));
  paintPin();
}
function paintPin() {
  const b = $("pin-view");
  if (!b) return;
  const on = readList("beyond90.pins").includes(state.tab);
  b.setAttribute("aria-pressed", String(on));
  b.textContent = on ? "Pinned" : "Pin to menu";
}
function setRole(id) {
  try { localStorage.setItem("beyond90.role", id); } catch { /* the choice just does not persist */ }
  paintRoles();
  if (!$("workspace").hidden && navGroups.length) { renderNav(navGroups, navTitle); markTab(); }
}
function paintRoles() {
  const now = savedRole();
  $("desk-btn").hidden = !(now === "se" || now === "all");     // a pre-sales engineer gets a desk of their own
  for (const [id, host] of [["role-pick", $("role-pick")], ["hero-roles", $("hero-roles")]]) {
    if (!host) continue;
    host.replaceChildren(...(id === "hero-roles" ? [el_("span", { class: "fine", text: "I work as" })] : []), ...ROLE_IDS.map((r) => el_("button", { type: "button", class: "chip-btn", dataset: { role: r }, "aria-pressed": String(r === now), title: ROLES[r].hint, text: id === "hero-roles" ? (r === "core" ? "Not sure yet" : r === "all" ? "Show everything" : ROLES[r].label) : ROLES[r].short, onclick: () => setRole(r) })));
  }
}
function markTab() { for (const b of document.querySelectorAll("#tabs [data-tab], #tabs [data-pin], #mobilebar [data-go]")) b.toggleAttribute("aria-current", (b.dataset.tab || b.dataset.pin || b.dataset.go) === state.tab); }

const current = () => tabDefs.find((t) => t.id === state.tab) || tabDefs[0];
const payload = () => (state.workshop && !state.result && !state.book && !state.estate && currentWorkshop() ? workshopDocs() : state.estate ? state.estate : state.mode === "book" || state.book ? state.book : state.result);

function selectTab(name, extra) {
  state.tab = name;
  document.body.dataset.view = name;
  state.focus = extra && extra.open;
  const t = current();
  showPlace("work");
  markTab();
  paintPin();
  document.body.classList.remove("menu-open");
  $("res-title").textContent = t.label;
  $("view-tip").textContent = t.tip;
  $("view").hidden = t.kind !== "view";
  $("docactions").hidden = t.kind === "view";
  if (t.kind === "view") {
    $("report").hidden = $("doc").hidden = $("raw").hidden = true;
    return renderView(t);
  }
  const text = payload()[t.key];
  $("report").hidden = t.kind !== "html";
  $("doc").hidden = t.kind !== "md";
  $("raw").hidden = t.kind !== "json" && t.kind !== "csv";
  if (t.kind === "html") $("report").srcdoc = reportPolicy ? reportPolicy.createHTML(text) : text;
  else if (t.kind === "json" || t.kind === "csv") $("raw").textContent = text;
  else $("doc").replaceChildren(...markdown(text));
}

function context() {
  if (state.workshop && !state.result && !state.book && !state.estate) return workshopContext();
  if (state.estate) return { estate: state.estate, present, startWorkshop: (c, scope) => startWorkshopFor(c, scope).catch((e) => say(e.message)), go: (tab, extra) => selectTab(tab, extra), openLine: (key, tab = "today") => { state.mode = "single"; state.files = { ...state.groups[key] }; state.estate = null; state.tab = tab; renderLoaded(); run(); } };
  if (state.book) return { book: state.book, povs: state.povs, savePov, removePov, today: todayIso(), advisories: state.advisories, openCustomer: (key, tab = "prep") => { state.mode = "single"; state.files = { ...state.groups[key] }; state.book = null; state.tab = tab; renderLoaded(); run(); } };
  const r = state.result;
  if (r && state.parsedFor !== r) { state.parsed = JSON.parse(r.score_json); state.parsedFor = r; }
  return { result: r, dash: r.dashboard, score: state.parsed, done: doneFor(r), markDone, engine: state.engine, files: state.files, options: options(), advisories: state.advisories, logTouch, go: (tab, extra) => selectTab(tab, extra),
    povs: state.povs, savePov, removePov, setSla, asks: state.asks, addAsk, setAskStatus, removeAsk, marks: marksFor(r),
    commitments: state.commitments, addCommitment, setCommitmentStatus, removeCommitment, keepFromCall, today: todayIso(),
    history: state.saved.filter((x) => x.customer === r.customer).map((x) => ({ as_of: x.as_of, yield: state.yields.get(x.id) })).filter((x) => typeof x.yield === "number"),
    outcomes: state.outcomes, calibration: state.calibration, healthWeights: state.healthWeights, recordOutcome, removeOutcome, applyWeights, resetWeights,
    saved: state.saved, frameHtml: (frame, html) => { frame.srcdoc = reportPolicy ? reportPolicy.createHTML(html) : html; } };
}

function renderView(t) {
  const host = $("view");
  try {
    const ctx = { ...context(), focus: state.focus };
    host.replaceChildren(V[t.view](ctx));
    const ns = multi() ? null : nextStep(t.id, ctx);
    if (ns) host.append(el_("aside", { class: "nextstep", "aria-label": "Next step" }, el_("p", {}, el_("b", { text: "Next: " }), el_("span", { text: ns.text })),
      el_("button", { class: "btn", type: "button", text: ns.cta, onclick: () => selectTab(ns.go, ns.open ? { open: ns.open } : undefined) })));
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
  saveBlob(payload()[t.key], t.file, t.type + ";charset=utf-8");
}
function save(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy() {
  const text = payload()[current().key], warn = internalWarning(text);
  say((await copyText(text)) ? "Copied." + (warn ? " " + warn : "") : "Nothing was copied. If copying is not available here, use Download.");
}

// ---------- workspace (local-first)
const wsSay = (t) => { $("ws-status").textContent = t; };

async function saveSnapshot({ quiet = false } = {}) {
  const r = state.result;
  if ((await store.getVault()) && !store.unlocked()) {
    if (quiet) { $("saved-note").textContent = "Not added to the history: saved data is locked."; return; }
    if (!(await unlockVaultUi())) { $("saved-note").textContent = "Saved data is protected; unlock it to save."; return; }
  }
  try {
    const snap = await W.makeSnapshot(state.files, { customer: r.customer, asOf: r.as_of, includePersonal: $("personal").checked, savedOn: new Date().toISOString().slice(0, 10) });
    const added = await store.put([snap]);
    $("saved-note").textContent = added ? (quiet ? `Added to ${snap.customer}'s history.` : `Saved: ${snap.customer}, ${snap.as_of}${snap.personal_excluded ? ", without contacts and logged calls" : ""}.`)
      : quiet ? $("saved-note").textContent : "This exact snapshot is already saved; nothing changed.";
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    await refreshHistory();
    renderCompare();
  } catch (e) {
    $("saved-note").textContent = "Could not save: " + e.message + " (private windows often block storage).";
  }
}

/** What happened at each renewal, the comparison with the health readings, and the weights in use. Read again whenever the saved data changes. */
async function refreshOutcomes() {
  try { state.outcomes = await store.outcomesAll(); state.healthWeights = await store.getWeights(); } catch { state.outcomes = []; state.healthWeights = null; }
  state.calibration = null;
  if (state.engine && state.outcomes.length) {
    try { await state.engine.ready; state.calibration = JSON.parse(await state.engine.call("calibrate", { outcomes: state.outcomes })); } catch { /* the view then shows the outcomes without the comparison */ }
  }
}
async function recordOutcome(p) {
  const r = state.result;
  const o = O.makeOutcome({ customer: r.customer, decidedOn: p.decidedOn, outcome: p.outcome, note: p.note, health: r.dashboard.health, asOf: r.as_of, recordedOn: new Date().toISOString().slice(0, 10) });
  await store.outcomePut([o]);
  await refreshOutcomes();
  say(`Recorded: ${o.customer} ${o.outcome} on ${o.decided_on}.`);
}
async function removeOutcome(id) { await store.outcomeRemove(id); await refreshOutcomes(); }
async function applyWeights(w) { await store.setWeights(w); state.healthWeights = w; say("New health weights applied."); run(); }
async function resetWeights() { await store.setWeights(null); state.healthWeights = null; say("Health weights are back to the defaults."); run(); }

/** What has been promised, across customers. Read again whenever the saved data changes. */
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function refreshCommitments() {
  try { state.commitments = await store.commitmentsAll(); } catch { state.commitments = []; }
}
async function addCommitment(p) {
  const c = K.makeCommitment({ customer: state.result.customer, what: p.what, who: p.who, due: p.due, source: "manual", createdOn: todayIso() });
  await store.commitmentPut([c]);
  await refreshCommitments();
  selectTab(state.tab);
}
async function setCommitmentStatus(id, status) {
  const c = state.commitments.find((x) => x.id === id);
  if (!c) return;
  await store.commitmentPut([K.withStatus(c, status, todayIso() < c.created_on ? c.created_on : todayIso())], true);
  await refreshCommitments();
  selectTab(state.tab);
}
async function removeCommitment(id) { await store.commitmentRemove(id); await refreshCommitments(); selectTab(state.tab); }
async function keepFromCall({ agreed, ours, date }) {
  const made = K.fromCall({ customer: state.result.customer, agreed, ours, date, existing: state.commitments });
  if (made.length) { await store.commitmentPut(made); await refreshCommitments(); }
  return made.length;
}

async function setSla(days) {
  state.files["customer.toml"] = SLA.applySla(state.files["customer.toml"], days);
  holdSave = true;                    // a changed target is not a new reading: it is kept only when you save
  try { await run(); } finally { holdSave = false; }
}
let holdSave = false;
async function refreshPovs() { try { state.povs = await store.povsAll(); } catch { state.povs = []; } }
async function refreshWorkshops() { try { state.workshops = await store.workshopsAll(); } catch { state.workshops = []; } }

// ---------- the discovery workshop: no files, the profiles' questions and what the customer says
const currentWorkshop = () => state.workshops.find((x) => x.id === state.workshop) || null;
async function workshopCatalog() {
  if (!state.wcat) state.wcat = await (await fetch("./workshop.json")).json();
  return state.wcat;
}
async function keepWorkshop(w) {
  await store.workshopPut([w], true);
  await refreshWorkshops();
  state.workshop = w.id;
  return w;
}
// ---------- the presales desk: every prospect in one place, from what this browser keeps
async function renderDesk() {
  const cat = await workshopCatalog();
  await refreshWorkshops();
  await refreshPovs();
  const ctx = {
    workshops: state.workshops, povs: state.povs, catalog: cat, today: todayIso(),
    openOpp: (o) => openWorkshop(o.workshop, o.stage === "proof" || o.stage === "decision" ? "wspov" : o.stage === "journey" ? "journey" : "workshop"),
    newWorkshop: () => newWorkshop().catch((e) => say(e.message)), example: () => openExampleWorkshop().catch((e) => say(e.message)),
    fillExamples: async () => { await fillDeskExamples(); renderDesk().catch((e) => say(e.message)); },
    removeExamples: async () => {
      for (const w of state.workshops.filter((x) => DESKX.isExampleId(x.id))) await store.workshopRemove(w.id);
      for (const p of state.povs.filter((x) => DESKX.isExampleId(x.id))) await store.povRemove(p.id);
      renderDesk().catch((e) => say(e.message));
    },
  };
  $("desk-body").replaceChildren(V.deskView(ctx));
}

async function openWorkshop(id, tab = "workshop") {
  const cat = await workshopCatalog();   // the questions ship with the page: no engine needed
  await refreshWorkshops();
  let w = id ? state.workshops.find((x) => x.id === id) : state.workshops[0];
  if (!w) w = await keepWorkshop(WSHOP.makeWorkshop({ customer: "New prospect", scope: cat.families.infrastructure.slice(0, 4), createdOn: todayIso() }));
  state.workshop = w.id; state.result = null; state.book = null; state.estate = null;
  showWorkshop(tab);
}
async function openExampleWorkshop() {
  await workshopCatalog();
  await refreshWorkshops();
  const have = state.workshops.find(WSHOP.isExample);
  let w = have;
  if (!w) {
    // the example comes with an invented inventory export, read the same way a real one is
    const read = INV.readInventory(await (await fetch("./demo-inventory.csv")).text());
    w = WSHOP.exampleWorkshop(todayIso());
    if (read.ok) w = WSHOP.setInventory(w, { ...INV.summarise(read), imported_on: todayIso() }, todayIso());
    w = await keepWorkshop(w);
  }
  state.workshop = w.id; state.result = null; state.book = null; state.estate = null;
  showWorkshop("journey");
}
/** From the estate: a workshop with this customer on the lines it does not run yet. */
async function startWorkshopFor(customer, scope) {
  await workshopCatalog();
  const w = await keepWorkshop(WSHOP.makeWorkshop({ customer, scope, createdOn: todayIso() }));
  state.workshop = w.id; state.result = null; state.book = null; state.estate = null;
  showWorkshop("workshop");
}
async function removeWorkshop(id) {
  await store.workshopRemove(id);
  await refreshWorkshops();
  if (state.workshops.length) { state.workshop = state.workshops[0].id; showWorkshop("workshop"); }
  else { state.workshop = null; showPlace("start"); }
}
async function newWorkshop() {
  const cat = await workshopCatalog();
  const was = currentWorkshop();
  const w = await keepWorkshop(WSHOP.makeWorkshop({ customer: "New prospect", scope: was ? was.scope : cat.families.infrastructure.slice(0, 4), createdOn: todayIso() }));
  state.workshop = w.id;
  showWorkshop("workshop");
}
function showWorkshop(tab) {
  const w = currentWorkshop();
  if (!w) return;
  const res = WSHOP.assess(state.wcat, w);
  fillHead(w.customer, `Discovery workshop, started ${longDate(w.created_on)}`, res.coverage);
  $("kpis").replaceChildren(kpi(`${res.answered} of ${res.total}`, "Questions answered"), kpi(res.land ? res.land.label : "Not yet", "Start here"), kpi(String(res.unknowns.length), "To find out"));
  $("worktools").hidden = true;
  $("saved-note").textContent = "";
  $("book-table").hidden = true;
  state.tab = tab || "workshop";
  renderNav(WORKSHOP_NAV, w.customer);
  selectTab(state.tab);
}
// ---------- presenting: the view alone, larger, for a shared screen; Esc or the button brings the app back
function present() {
  document.body.classList.add("presenting");
  $("present-exit").hidden = false;
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => { /* a window is fine too */ });
  $("main").focus();
}
function stopPresenting() {
  document.body.classList.remove("presenting");
  $("present-exit").hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
$("present-exit").addEventListener("click", stopPresenting);
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("presenting")) stopPresenting(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("presenting")) stopPresenting(); });

function workshopDocs() {
  const w = currentWorkshop(), res = WSHOP.assess(state.wcat, w);
  return { summary_markdown: WSHOP.summaryMarkdown(state.wcat, w, res), readout_html: WSHOP.readoutHtml(state.wcat, w, res, { today: longDate(todayIso()) }) };
}
function workshopContext() {
  const w = currentWorkshop(), cat = state.wcat, today = todayIso();
  const res = WSHOP.assess(cat, w);
  // edits are applied one after another, each on the result of the last: a note and a figure typed in quick succession both land
  const edit = (fn) => {
    const run = (state.wsQueue || Promise.resolve()).catch(() => {}).then(() => keepWorkshop(fn(currentWorkshop())));
    state.wsQueue = run;
    return run;
  };
  return {
    workshop: w, catalog: cat, list: state.workshops, go: (tab, extra) => selectTab(tab, extra), today, present,
    answer: async (profile, i, a, note) => { const next = await edit((x) => WSHOP.setAnswer(x, profile, i, a, note, today)); const r = WSHOP.assess(cat, next); fillHead(next.customer, `Discovery workshop, started ${longDate(next.created_on)}`, r.coverage); return next; },
    worth: async (profile, i, amount, per) => edit((x) => WSHOP.setWorth(x, profile, i, amount, per, today)),
    plan: async (profile, i, who, by) => edit((x) => WSHOP.setPlan(x, profile, i, who, by, today)),
    preparedBy: async (name) => edit((x) => WSHOP.setPreparedBy(x, name, today)),
    inventory: async (summary) => { await edit((x) => WSHOP.setInventory(x, summary, today)); showWorkshop("workshop"); },
    sizing: async (assumptions) => edit((x) => WSHOP.setSizing(x, assumptions, today)),
    raise: async (profile, i, on) => edit((x) => WSHOP.setRaised(x, profile, i, on, today)),
    setDeal: async (id, a, note) => edit((x) => WSHOP.setDeal(x, id, a, note, today)),
    setDemo: async (on) => { await edit((x) => WSHOP.setDemo(x, on, today)); selectTab("wsforward"); },
    waves: async (settings) => edit((x) => WSHOP.setWaves(x, settings, today)),
    setCase: async (figures) => edit((x) => WSHOP.setCase(x, figures, today)),
    gpu: async (assumptions) => edit((x) => WSHOP.setGpu(x, assumptions, today)),
    dr: async (settings) => edit((x) => WSHOP.setDr(x, settings, today)),
    obj: async (settings) => edit((x) => WSHOP.setObj(x, settings, today)),
    commitments: state.commitments,
    // the promises of the handover become the customer's commitments, kept with the rest after the sale; none twice
    keepPromises: async (list) => {
      const have = new Set(state.commitments.filter((c) => c.customer.toLowerCase() === w.customer.toLowerCase()).map((c) => c.what.toLowerCase()));
      const made = list.filter((p) => !have.has(p.what.toLowerCase())).map((p) => K.makeCommitment({ customer: w.customer, what: p.what, who: p.who, due: p.due, source: "manual", createdOn: today }));
      if (made.length) { await store.commitmentPut(made); await refreshCommitments(); }
      return made.length;
    },
    rename: async (name) => { await edit((x) => WSHOP.rename(x, name, today)); showWorkshop("workshop"); },
    setScope: async (scope) => { await edit((x) => WSHOP.setScope(x, scope, today)); showWorkshop("workshop"); },
    newWorkshop, openWorkshop, removeWorkshop, presets: WSHOP.PRESETS.map((p) => ({ ...p, scope: p.scope.filter((x) => cat.lines[x]) })).filter((p) => p.scope.length),
    startPov: async (r) => {
      const p = POV.makePov({ customer: w.customer, createdOn: today, problem: `Heard in discovery on ${r.land.label.toLowerCase()}: ${r.land.gaps.map((q) => q.q).join(" ")}`.slice(0, 300),
        // the line's own tests, then what the customer asked us to prove
        criteria: [...r.proof.slice(0, 4).map((c) => ({ text: c.text, target: c.how })), ...(r.raised || []).slice(0, 4).map((o) => ({ text: o.prove, target: `Raised by the customer: "${o.says}"` }))], readiness: r.readiness });
      await store.povPut([p], true); await refreshPovs(); selectTab("wspov");
    },
    // the proof-of-value view, for this prospect, with the first line's own criteria as suggestions
    result: { customer: w.customer }, dash: { pov_criteria: res.proof }, povs: state.povs, savePov, removePov,
  };
}
async function refreshAsks() { try { state.asks = await store.asksAll(); } catch { state.asks = []; } }
async function savePov(p) { await store.povPut([p], true); await refreshPovs(); selectTab(state.tab); }
async function removePov(id) { await store.povRemove(id); await refreshPovs(); selectTab(state.tab); }
async function addAsk(p) {
  await store.askPut([ASK.makeAsk({ customer: state.result.customer, kind: p.kind, title: p.title, detail: p.detail, atStake: p.atStake, ref: p.ref, createdOn: todayIso() })]);
  await refreshAsks(); selectTab(state.tab);
}
async function setAskStatus(id, status) {
  const a = state.asks.find((x) => x.id === id);
  if (!a) return;
  await store.askPut([ASK.withAskStatus(a, status, todayIso() < a.created_on ? a.created_on : todayIso())], true);
  await refreshAsks(); selectTab(state.tab);
}
async function removeAsk(id) { await store.askRemove(id); await refreshAsks(); selectTab(state.tab); }

async function refreshHistory() {
  await refreshCommitments();
  await refreshPovs();
  await refreshWorkshops();
  await refreshAsks();
  await refreshMarks();
  await refreshOutcomes();
  if (state.place === "desk") renderDesk().catch(() => {});     // the desk opened before the store had answered
  try { state.saved = await store.all(); }
  catch (e) { state.saved = []; wsSay("Saving is not available here: " + e.message); }
  const has = state.saved.length > 0;
  $("history-empty").hidden = has;
  $("history-body").hidden = !has;
  $("demo-prev").parentElement.hidden = state.saved.some((s) => s.customer === "Northwind (mock)" && s.as_of === "2026-09-30");
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
    act.append(
      el_("button", { class: "btn small", type: "button", text: "Open", "aria-label": `Open ${s.customer}, ${s.as_of}`, onclick: () => { state.mode = "single"; state.groups = {}; state.files = { ...s.files }; renderLoaded(); run(); } }), " ",
      el_("button", { class: "btn small danger", type: "button", text: "Delete", "aria-label": `Delete ${s.customer}, ${s.as_of}`, onclick: async () => { await store.remove(s.id); await refreshHistory(); } }));
    tr.append(act);
    tbody.append(tr);
  }
  computeYields();
  renderRecent();
  await refreshVault();
  await privacy.render();
}

// Derived data is computed on demand and kept only in memory, keyed by the snapshot and the engine that read it.
let yieldRun = 0;
async function computeYields() {
  const mine = ++yieldRun;
  if (!state.engine || !state.engine.version) return;
  for (const s of state.saved) {
    if (mine !== yieldRun) return;
    if (state.yields.has(s.id)) continue;
    try {
      const r = await state.engine.json("summarize", { files: s.files });
      state.yields.set(s.id, r.ok ? r.yield : null);
    } catch (e) { if (e.cancelled) return; }
  }
  if (mine === yieldRun) { fillYields(); drawTrend(); }        // also when an interrupted run already filled the cache
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
  const text = W.serializeWorkspace(state.saved, { engine: state.engine ? state.engine.version : "", extra: { outcomes: state.outcomes, commitments: state.commitments, povs: state.povs, asks: state.asks, done: state.marks, workshops: state.workshops } });
  const sealed = await store.sealExport(text);
  save(new Blob([sealed || text], { type: "application/json" }), sealed ? "beyond90-workspace.sealed.json" : "beyond90-workspace.json");
  wsSay(sealed ? `Exported ${nOf(state.saved.length, "snapshot")}, sealed with your passphrase.`
    : `Exported ${nOf(state.saved.length, "snapshot")}. The file is not encrypted and contains customer data: protect saved data with a passphrase and exports are sealed too.`);
}

// ---------- start from a form: the two files every analysis needs, made from what the user knows
function starterRow(a = { id: "", provider: "aws", connected: false, owner: "", spend: "" }) {
  const tr = el_("tr", {},
    el_("td", {}, el_("input", { type: "text", "aria-label": "Account", value: a.id, placeholder: "e.g. prod-payments" })),
    el_("td", {}, el_("select", { "aria-label": "Provider" }, PROVIDERS.map((p) => el_("option", { value: p, text: p, selected: p === a.provider })))),
    el_("td", {}, el_("input", { type: "checkbox", "aria-label": "Connected", checked: a.connected })),
    el_("td", {}, el_("input", { type: "text", "aria-label": "Owner", value: a.owner, placeholder: "team" })),
    el_("td", {}, el_("input", { type: "number", min: "0", step: "1", inputmode: "numeric", "aria-label": "Monthly spend", value: a.spend, placeholder: "spend / month" })),
    el_("td", {}, el_("button", { type: "button", class: "icon-btn", "aria-label": "Remove this account", text: "×", onclick: () => tr.remove() })));
  $("st-rows").append(tr);
}
function starterForm() {
  return {
    customer: { name: $("st-name").value, tier: $("st-tier").value, arr: $("st-arr").value, as_of: $("st-asof").value, renewal_date: $("st-renewal").value },
    accounts: [...$("st-rows").children].map((tr) => {
      const [id, provider, connected, owner, spend] = tr.querySelectorAll("input, select");
      return { id: id.value, provider: provider.value, connected: connected.checked, owner: owner.value, spend: spend.value };
    }),
  };
}
function starterCheck() {
  const p = starterProblems(starterForm());
  $("st-problems").replaceChildren(...p.map((t) => el_("li", { text: t })));
  return p.length ? null : starterFiles(starterForm());
}
$("open-starter").addEventListener("click", () => {
  if (!$("st-asof").value) $("st-asof").value = new Date().toISOString().slice(0, 10);
  if (!$("st-rows").children.length) for (let i = 0; i < 3; i++) starterRow();
  $("st-problems").replaceChildren();
  $("starter").showModal();
  $("st-name").focus();
});
$("st-add").addEventListener("click", () => { starterRow(); $("st-rows").lastElementChild.querySelector("input").focus(); });
$("st-cancel").addEventListener("click", () => $("starter").close());
$("st-download").addEventListener("click", () => {
  const f = starterCheck();
  if (f) for (const [name, text] of Object.entries(f)) saveBlob(text, name, name.endsWith(".csv") ? "text/csv" : "application/toml", { raw: true });
});
$("starter-form").addEventListener("submit", (e) => {
  const f = starterCheck();
  if (!f) { e.preventDefault(); return; }
  state.mode = "single"; state.groups = {}; state.files = f;
  renderLoaded();
  say("Made customer.toml and accounts.csv from the form.");
  run();
});

// ---------- map an export: say which column is which, check the result, then add the file
const mapper = { text: "", name: "", s: null, ok: false };
const MAP_LABELS = {
  id: { "accounts.csv": "Account id", "findings.csv": "Finding id" }, provider: "Provider", connected: "Connected to the platform", owner: "Owner", last_spend: "Monthly spend",
  status: "Status", created_at: "Created on", account_id: "Account", severity: "Severity", exposure: "Exposed to the internet", opened_at: "Opened on", closed_at: "Closed on", decision: "Decision",
};
const mapLabel = (field, target) => (typeof MAP_LABELS[field] === "object" ? MAP_LABELS[field][target] : MAP_LABELS[field]) || field;
const hasCustomer = () => "customer.toml" in state.files;

function mapInvalidate() {
  mapper.ok = false;
  $("map-use").disabled = true;
  $("map-preview-wrap").hidden = true;
  $("map-notes").replaceChildren();
}
function mapRead() {
  const m = {};
  for (const sel of $("map-rows").querySelectorAll("select")) m[sel.dataset.field] = sel.value || null;
  return m;
}
function mapRender() {
  const s = mapper.s, target = $("map-target").value;
  $("map-rows").replaceChildren(...(s.fields || []).map((f) => el_("tr", {},
    el_("th", { scope: "row", text: mapLabel(f, target) + ((s.required || []).includes(f) ? " (required)" : "") }),
    el_("td", {}, el_("select", { dataset: { field: f }, "aria-label": mapLabel(f, target), onchange: mapInvalidate },
      el_("option", { value: "", text: "none" }), s.headers.map((h) => el_("option", { value: h, text: h, selected: (s.mapping || {})[f] === h })))))));
  $("map-provider-label").hidden = target !== "accounts.csv";
  $("map-name-label").hidden = $("map-asof-label").hidden = hasCustomer();
  $("map-count").textContent = `${nOf(s.rows, "row")} and ${nOf(s.headers.length, "column")} found.` + (s.target ? "" : " The file does not clearly look like accounts or findings; choose what to build.");
  $("map-check").hidden = false;
  mapInvalidate();
}
async function mapSuggest(target) {
  await state.engine.ready;
  const r = JSON.parse(await state.engine.call("mapsuggest", { text: mapper.text, target, hint: mapper.name }));
  if (!r.ok) { $("map-body").hidden = true; $("map-check").hidden = true; $("map-notes").replaceChildren(el_("li", { text: r.error })); return; }
  mapper.s = r;
  if (!target && r.target) $("map-target").value = r.target;
  if (!r.fields) return mapSuggest($("map-target").value);   // unclear file: map it as the chosen file
  $("map-body").hidden = false;
  mapRender();
}
$("open-mapper").addEventListener("click", () => {
  $("map-file").value = ""; $("map-body").hidden = true; $("map-check").hidden = true; mapInvalidate();
  if (!$("map-asof").value) $("map-asof").value = new Date().toISOString().slice(0, 10);
  $("mapper").showModal();
});
$("map-cancel").addEventListener("click", () => $("mapper").close());
$("map-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_BYTES) { $("map-notes").replaceChildren(el_("li", { text: "The file is larger than 20 MB." })); return; }
  mapper.text = await file.text(); mapper.name = file.name;
  await mapSuggest("");
});
$("map-target").addEventListener("change", () => mapSuggest($("map-target").value));
$("map-provider").addEventListener("change", mapInvalidate);
$("map-check").addEventListener("click", async () => {
  mapInvalidate();
  const r = JSON.parse(await state.engine.call("mapconvert", { text: mapper.text, target: $("map-target").value, mapping: mapRead(), defaults: { provider: $("map-provider").value } }));
  if (!r.ok) { $("map-notes").replaceChildren(el_("li", { text: r.error })); return; }
  mapper.result = r;
  const cols = r.preview.length ? Object.keys(r.preview[0]) : [];
  $("map-head").replaceChildren(el_("tr", {}, cols.map((c) => el_("th", { scope: "col", text: c }))));
  $("map-preview").replaceChildren(...r.preview.map((row) => el_("tr", {}, cols.map((c) => el_("td", { text: row[c] })))));
  $("map-preview-wrap").hidden = !r.preview.length;
  $("map-notes").replaceChildren(el_("li", { text: `${nOf(r.rows, "row")} ready${r.skipped ? `, ${r.skipped} left out` : ""}.` }), ...r.notes.map((t) => el_("li", { text: t })));
  mapper.ok = r.rows > 0;
  $("map-use").disabled = !mapper.ok;
});
$("mapper-form").addEventListener("submit", (e) => {
  if (!mapper.ok) { e.preventDefault(); return; }
  const r = mapper.result, files = { ...state.files, [r.file]: r.csv };
  if (!hasCustomer()) {
    const name = $("map-name").value.trim();
    if (!name || !$("map-asof").value) { e.preventDefault(); $("map-notes").replaceChildren(el_("li", { text: "Give the customer a name and the date of the data." })); return; }
    files["customer.toml"] = starterFiles({ customer: { name, tier: "enterprise", arr: "", as_of: $("map-asof").value, renewal_date: "" }, accounts: [] })["customer.toml"];
  }
  state.mode = "single"; state.groups = {}; state.files = files;
  renderLoaded();
  say(`Added ${r.file} from your export (${nOf(r.rows, "row")}).` + ("accounts.csv" in files ? "" : " Add the accounts file too: findings refer to accounts."));
  if ("accounts.csv" in files) run();
});

// ---------- another device: a code to open the app there, and the work sent as one sealed file
function renderDeviceQr() {
  const box = $("device-qr");
  if (box.childElementCount || !/^https?:$/.test(location.protocol)) { $("devices").hidden = !/^https?:$/.test(location.protocol); return; }
  const url = location.origin + location.pathname.replace(/index\.html$/, "");
  box.append(qrSvg(url, "QR code that opens Beyond 90 at " + url), el_("p", { class: "fine", text: url }));
}
async function sendWork() {
  if (!state.saved.length) return wsSay("Nothing saved yet: analyse a customer first, and it is kept here.");
  if (!(await store.getVault())) {
    wsSay("Protect your saved data with a passphrase first: your work then travels encrypted, and only that passphrase opens it.");
    $("vault-on").focus();
    return;
  }
  if (!store.unlocked() && !(await unlockVaultUi())) return;
  const sealed = await store.sealExport(W.serializeWorkspace(state.saved, { engine: state.engine ? state.engine.version : "", extra: { outcomes: state.outcomes, commitments: state.commitments, povs: state.povs, asks: state.asks, done: state.marks, workshops: state.workshops } }));
  const file = new File([sealed], "beyond90-workspace.sealed.json", { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Beyond 90 workspace" });
      return wsSay(`Sent ${nOf(state.saved.length, "snapshot")}, encrypted. Import the file on the other device with your passphrase.`);
    } catch (e) { if (e.name === "AbortError") return; }
  }
  save(file, file.name);
  wsSay(`Saved ${nOf(state.saved.length, "snapshot")} as one encrypted file. Move it to the other device and import it there with your passphrase.`);
}
$("send-work").addEventListener("click", sendWork);

async function importWorkspace(file) {
  try {
    let text = await file.text();
    let doc = null;
    try { doc = JSON.parse(text); } catch { /* parseWorkspace says what is wrong */ }
    if (Vault.isSealedWorkspace(doc)) {
      const p = await askPassphrase({ title: "Open a sealed workspace", confirm: false, help: "Enter the passphrase that protected it." });
      if (p == null) return;
      text = await Vault.openWorkspace(doc, p);
      if (text == null) { wsSay("That is not the passphrase of this workspace file."); return; }
    }
    const { snapshots, unknown } = W.parseWorkspace(text);
    const { ok, rejected } = await W.acceptSnapshots(snapshots);
    const added = await store.put(ok);
    const outs = O.acceptOutcomes(unknown.outcomes);
    const addedOut = outs.ok.length ? await store.outcomePut(outs.ok) : 0;
    const cms = K.acceptCommitments(unknown.commitments);
    const addedCm = cms.ok.length ? await store.commitmentPut(cms.ok) : 0;
    const pvs = POV.acceptPovs(unknown.povs);
    const addedPv = pvs.ok.length ? await store.povPut(pvs.ok) : 0;
    const aks = ASK.acceptAsks(unknown.asks);
    const addedAk = aks.ok.length ? await store.askPut(aks.ok) : 0;
    const dns = DONE.acceptDone(unknown.done);
    const addedDn = dns.ok.length ? await store.markPut(dns.ok) : 0;
    const wss = WSHOP.acceptWorkshops(unknown.workshops);
    const addedWs = wss.ok.length ? await store.workshopPut(wss.ok) : 0;
    await refreshWorkshops();
    await refreshHistory();
    wsSay(`Imported: ${added} new, ${ok.length - added} already here` + (rejected ? `, ${rejected} rejected because their content did not match their name` : "")
      + (outs.ok.length || outs.rejected ? `; ${nOf(addedOut, "renewal outcome")} added` + (outs.rejected ? `, ${outs.rejected} refused` : "") : "")
      + (cms.ok.length || cms.rejected ? `; ${nOf(addedCm, "commitment")} added` + (cms.rejected ? `, ${cms.rejected} refused` : "") : "")
      + (pvs.ok.length || pvs.rejected ? `; ${nOf(addedPv, "proof")} of value added` + (pvs.rejected ? `, ${pvs.rejected} refused` : "") : "")
      + (aks.ok.length || aks.rejected ? `; ${nOf(addedAk, "ask")} added` + (aks.rejected ? `, ${aks.rejected} refused` : "") : "")
      + (dns.ok.length || dns.rejected ? `; ${nOf(addedDn, "action")} marked done added` + (dns.rejected ? `, ${dns.rejected} refused` : "") : "")
      + (wss.ok.length || wss.rejected ? `; ${nOf(addedWs, "discovery workshop")} added` + (wss.rejected ? `, ${wss.rejected} refused` : "") : "") + ".");
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
paintRoles();
$("try-now").addEventListener("click", async () => { $("try-now").disabled = true; try { await loadDemo(); await run(); } finally { $("try-now").disabled = false; } });
$("demo-book").addEventListener("click", loadDemoBook);
$("demo-estate").addEventListener("click", loadDemoEstate);
$("open-workshop").addEventListener("click", () => openWorkshop().catch((e) => say(e.message)));
$("demo-workshop").addEventListener("click", () => openExampleWorkshop().catch((e) => say(e.message)));
$("demo-endpoint").addEventListener("click", loadDemoEndpoint);
$("keys-open").addEventListener("click", () => showKeys());
// Phone with a customer open: the sharing level and the theme move from the crowded top bar into the menu sheet.
const phone = window.matchMedia("(max-width: 900px)");
function placeTools() {
  const pick = document.querySelector(".share-pick"), theme = $("theme"), inSheet = phone.matches && document.body.classList.contains("has-work");
  const host = inSheet ? $("sheet-tools") : document.querySelector(".top-actions");
  if (pick.parentElement !== host) { host.append(pick, theme); }
}
phone.addEventListener("change", placeTools);
new MutationObserver(placeTools).observe(document.body, { attributes: true, attributeFilter: ["class"] });
placeTools();
$("pin-view").addEventListener("click", () => { writeList("beyond90.pins", togglePin(readList("beyond90.pins"), state.tab)); renderNav(navGroups, navTitle); markTab(); });
for (const b of document.querySelectorAll("#mobilebar [data-go]")) b.addEventListener("click", () => { if (tabDefs.some((t) => t.id === b.dataset.go)) selectTab(b.dataset.go); else { document.body.classList.add("menu-open"); $("m-menu").setAttribute("aria-expanded", "true"); } });
$("m-menu").addEventListener("click", () => { const open = document.body.classList.toggle("menu-open"); $("m-menu").setAttribute("aria-expanded", String(open)); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("menu-open")) { document.body.classList.remove("menu-open"); $("m-menu").setAttribute("aria-expanded", "false"); $("m-menu").focus(); } });
for (const b of document.querySelectorAll(".rail [data-place]")) b.addEventListener("click", () => { document.body.classList.remove("menu-open"); $("m-menu").setAttribute("aria-expanded", "false"); });
for (const b of document.querySelectorAll("[data-demo]")) b.addEventListener("click", () => loadDemoProfile(b.dataset.demo, `a made-up ${b.textContent.trim()} customer`));
$("run").addEventListener("click", () => run());
$("cancel").addEventListener("click", cancel);
$("copy").addEventListener("click", copy);
$("download").addEventListener("click", download);
$("save").addEventListener("click", () => saveSnapshot());
try { $("autosave").checked = localStorage.getItem("b90-autosave") !== "off"; } catch { /* storage blocked: keep the default */ }
$("autosave").addEventListener("change", () => { try { localStorage.setItem("b90-autosave", $("autosave").checked ? "on" : "off"); } catch { /* ignore */ } });
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
  const plainCount = on ? 0 : state.saved.length;
  $("vault-warn").hidden = !plainCount;
  $("vault-warn").textContent = plainCount ? `${plainCount} snapshot${plainCount === 1 ? "" : "s"} of customer data stored unencrypted on this device.` : "";
  clearTimeout(idleTimer);
  if (open) idleTimer = setTimeout(() => lockVault("Locked after 15 minutes without use."), IDLE_LOCK_MS);
  return { meta, open };
}
async function lockVault(why = "Locked.") {
  store.setKey(null);
  state.saved = []; state.yields.clear();
  await refreshHistory();
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
  const p = await askPassphrase({ title: "Protect saved data", confirm: true, help: "Saved snapshots and exported workspaces are sealed with a key made from this passphrase. The key stays in this tab's memory and is dropped after 15 idle minutes. There is no recovery: forget it and the saved copy is gone, so keep an exported workspace as a backup." });
  if (p == null) return;
  wsSay("Sealing…");
  try {
    const { key, meta } = await Vault.createVault(p);
    store.setKey(key);
    await store.convertAll({ toSealed: true, meta });
    wsSay("Saved data is now protected.");
  } catch (e) { store.setKey(null); wsSay("Could not protect saved data: " + e.message); }
  await refreshHistory();
}
async function unlockVaultUi() {
  const meta = await store.getVault();
  if (!meta) return true;
  for (let tries = 0; tries < 5; tries++) {
    const p = await askPassphrase({ title: "Unlock saved data", confirm: false, help: tries ? "That was not the passphrase. Try again." : "Enter the passphrase you chose." });
    if (p == null) return false;
    const key = await Vault.unlockVault(meta, p);
    if (key) { store.setKey(key); await store.reslot(); await refreshHistory(); wsSay("Unlocked."); return true; }
    await new Promise((r) => setTimeout(r, 400 * 2 ** tries));          // slows guessing from inside the page; the key derivation already costs the rest
  }
  wsSay("Too many wrong passphrases. Reload the page to try again.");
  return false;
}
async function disableVault() {
  if (!confirm("Remove the passphrase? Saved snapshots will be stored unprotected again.")) return;
  try { await store.convertAll({ toSealed: false }); store.setKey(null); wsSay("Protection removed."); }
  catch (e) { wsSay("Could not remove protection: " + e.message); }
  await refreshHistory();
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
    return isDaily(d) && Array.isArray(d.threats) && d.threats.length > 0 && d.threats.length <= 2000 ? d : null;
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
  if (state.files["interactions.csv"]) saveBlob(state.files["interactions.csv"], "interactions.csv", "text/csv", { raw: true });
}

// ---------- theme
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = (t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  $("theme").replaceChildren(icon(dark ? "sun" : "moon", 18));
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
  const go = (id, label) => ({ label: "Go to " + label, hint: "view", run: () => selectTab(id) });
  return [
    { label: "Analyse", hint: "action", when: () => !$("run").disabled, run: () => run() },
    ...(hasResult() && !multi() ? answers({ dash: state.result.dashboard, score: state.parsed || JSON.parse(state.result.score_json), done: doneFor(state.result) })
      .map((x) => ({ label: x.label, find: x.find, hint: "this customer", run: () => selectTab(x.go, x.open ? { open: x.open } : undefined) })) : []),
    { label: "Open the example customer", hint: "example", when: () => !$("demo").disabled, run: () => loadDemo().then(() => run()) },
    { label: "Open the example book (3 customers)", hint: "example", when: () => !$("demo-book").disabled, run: () => loadDemoBook().then(() => run()) },
    { label: "Open the example estate (one customer, four product lines)", hint: "example", when: () => !$("demo-estate").disabled, run: () => loadDemoEstate().then(() => run()) },
    ...tabDefs.map((t) => go(t.id, t.label)),
    { label: "Go to Start", hint: "place", run: () => showPlace("start") },
    { label: "Go to Saved", hint: "place", run: () => showPlace("saved") },
    { label: "Take the tour", hint: "help", run: startTour },
    { label: "Save snapshot in this browser", hint: "action", when: hasResult, run: () => saveSnapshot() },
    { label: "Copy a five-line summary for chat", hint: "action", when: hasResult, run: copySummary },
    { label: "Download the current document", hint: "action", when: () => hasResult() && current().kind !== "view", run: download },
    { label: "Download interactions.csv", hint: "action", when: () => !!state.files["interactions.csv"], run: downloadInteractions },
    { label: "Export workspace", hint: "action", run: exportWorkspace },
    { label: "Print this view", hint: "action", run: () => window.print() },
    { label: "Switch colour theme", hint: "action", run: () => $("theme").click() },
    { label: "Check that nothing leaves this page", hint: "privacy", run: () => { showPlace("help"); selfCheck(); } },
    ...FAQ.flatMap((g) => g.items.map((it) => ({ label: it.q, hint: "answer", run: () => openAnswer(it.q) }))),
    ...GLOSSARY.map((g) => ({ label: `What is ${g.term}?`, hint: "term", run: () => openTerm(g.id) })),
  ].filter((c) => !c.when || c.when());
}
function copySummary() {
  const r = state.result, sc = state.parsed || JSON.parse(r.score_json), d = r.dashboard;
  const lines = [`${r.customer} · ${r.as_of}`, `Yield ${pct(r.yield)} (legacy metric ${pct(sc.naive)}), maturity ${r.level}`,
    ...Object.entries(sc.stages).map(([k, v]) => `${k} ${v.name}: ${pct(v.value)} (${v.numerator}/${v.denominator})`),
    d.actions[0] ? `Top action: ${d.actions[0].title} (+${d.actions[0].effect.toFixed(1)} pts, ${d.actions[0].hours.toFixed(1)} h)` : ""].filter(Boolean);
  copyText(lines.join("\n")).then((ok) => say(ok ? "Summary copied." : "Nothing was copied."));
}
const pal = { el: $("palette"), q: $("palette-q"), list: $("palette-list"), items: [], at: 0 };
function paintPalette() {
  const q = pal.q.value.trim().toLowerCase();
  pal.items = rank(q, commands(), (c) => (c.find ? `${c.label} ${c.find}` : c.label));
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
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && (hasResult() || multi())) {
    const t = tabDefs[Number(e.key) - 1]; if (t) selectTab(t.id);
    return;
  }
  if (typing || KEYS.typing(e.target) || document.querySelector("dialog[open]")) { keyPending = false; return; }
  const d = KEYS.decide(e.key, { pending: keyPending, mods: e.ctrlKey || e.metaKey || e.altKey });
  keyPending = d.pending;
  const a = d.action;
  if (!a) return;
  if (a.help) { e.preventDefault(); showKeys(); return; }
  if (a.search) { e.preventDefault(); openPalette(); return; }
  if (!(hasResult() || multi())) return;
  const ids = [...document.querySelectorAll("#tabs [data-tab]")].map((b) => b.dataset.tab);
  const to = a.go ? (tabDefs.some((t) => t.id === a.go) ? a.go : null) : KEYS.stepView(ids, state.tab, a.step);
  if (to) { e.preventDefault(); selectTab(to); }
});
let keyPending = false;
function showKeys() {
  let dlg = $("keys-help");
  if (!dlg) {
    dlg = el_("dialog", { id: "keys-help", class: "keysdlg", "aria-labelledby": "keys-title" },
      el_("h2", { id: "keys-title", text: "Keyboard shortcuts" }),
      el_("dl", { class: "keylist" }, KEYS.LIST.flatMap(([k, what]) => [el_("dt", {}, ...k.split(" ").map((w) => ["then", "and", "or"].includes(w) ? el_("span", { text: ` ${w} ` }) : el_("kbd", { text: w }))), el_("dd", { text: what })])),
      el_("button", { class: "btn", type: "button", text: "Close", onclick: () => dlg.close() }));
    document.body.append(dlg);
  }
  dlg.showModal();
}

// ---------- recent customers: one click back to where you were
function renderRecent() {
  const latest = new Map();
  for (const snap of state.saved) if (!latest.has(snap.customer) || latest.get(snap.customer).as_of < snap.as_of) latest.set(snap.customer, snap);
  const list = [...latest.values()].sort((a, b) => b.as_of.localeCompare(a.as_of)).slice(0, 5);
  $("recent-card").hidden = !list.length;
  $("recent").replaceChildren(...list.map((snap) => el_("li", {},
    el_("button", { type: "button", class: "recent-btn", "data-tip": `Open ${snap.customer} with the data saved for ${longDate(snap.as_of)}.`,
      onclick: () => { state.mode = "single"; state.groups = {}; state.files = { ...snap.files }; renderLoaded(); run(); } },
    el_("b", { text: snap.customer }), el_("small", { text: `data as of ${longDate(snap.as_of)}` })))));
}

// ---------- help: answers, terms and the tour
// ---------- install as an app: offered when the browser allows it, explained when it does not
let installPrompt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function refreshInstall() {
  $("installed").hidden = !standalone();
  $("install-now").hidden = standalone() || !installPrompt;
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; refreshInstall(); });
window.addEventListener("appinstalled", () => { installPrompt = null; refreshInstall(); });
$("install-now").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  refreshInstall();
});
refreshInstall();

// ---------- this build: what it is made of, and a check that the files running are the ones published
async function renderBuild() {
  let b = null;
  try { b = await (await fetch("./build.json")).json(); } catch { /* a local build without a manifest */ }
  const row = (k, v) => [el_("dt", { text: k }), el_("dd", {}, v)];
  if (!b) { $("build-info").replaceChildren(...row("Manifest", "not found in this copy")); $("verify-build").disabled = true; return; }
  const commit = /^[0-9a-f]{40}$/.test(b.commit) ? el_("a", { href: `https://github.com/riccardomenegazzo/beyond-90/commit/${b.commit}`, rel: "noopener noreferrer", target: "_blank", text: b.commit.slice(0, 12) }) : "local build";
  $("build-info").replaceChildren(...row("Version", b.version), ...row("Source commit", commit), ...row("Files", String(b.files)), ...row("Manifest digest", el_("code", { text: b.digest.slice(0, 32) + "…" })));
}
async function verifyBuild() {
  const out = $("verify-out");
  $("verify-build").disabled = true;
  out.textContent = "Checking…";
  try {
    const lines = (await (await fetch("./SHA256SUMS")).text()).trim().split("\n").map((l) => l.match(/^([0-9a-f]{64}) {2}(.+)$/)).filter(Boolean);
    const bad = [];
    for (const [, want, name] of lines) {
      const got = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await (await fetch("./" + name)).arrayBuffer())), (x) => x.toString(16).padStart(2, "0")).join("");
      if (got !== want) bad.push(name);
    }
    out.textContent = bad.length ? `${bad.length} of ${lines.length} files do not match the manifest: ${bad.slice(0, 5).join(", ")}. Reload the page; if it persists, do not use this copy.` : `All ${lines.length} files match the manifest.`;
  } catch (e) { out.textContent = "The check could not run: " + e.message; }
  $("verify-build").disabled = false;
}
$("verify-build").addEventListener("click", verifyBuild);

function renderHelp() {
  renderBuild();
  $("faq").replaceChildren(...FAQ.map((g, gi) => el_("section", { class: "block faqgroup", "aria-labelledby": `faq-${gi}` }, el_("h2", { id: `faq-${gi}`, text: g.group }),
    g.items.map((it) => el_("details", { class: "qa", dataset: { q: it.q } }, el_("summary", { text: it.q }), el_("p", { text: it.a }),
      it.link ? el_("p", {}, el_("button", { type: "button", class: "link", text: it.link.text, onclick: () => { showPlace(it.link.place); if (it.link.anchor) $(it.link.anchor).scrollIntoView(); } })) : null)))));
  $("glossary").replaceChildren(...GLOSSARY.flatMap((g) => [el_("dt", { id: "term-" + g.id, text: g.term }), el_("dd", { text: g.text })]));
}
function filterHelp() {
  const q = $("faq-q").value.trim().toLowerCase();
  for (const d of document.querySelectorAll("#faq details")) {
    const hit = !q || d.textContent.toLowerCase().includes(q);
    d.hidden = !hit;
    d.open = !!q && hit;
  }
  for (const g of document.querySelectorAll("#faq .faqgroup")) g.hidden = ![...g.querySelectorAll("details")].some((d) => !d.hidden);
}
function openAnswer(q) {
  showPlace("help");
  const d = [...document.querySelectorAll("#faq details")].find((x) => x.dataset.q === q);
  if (d) { d.open = true; d.scrollIntoView({ block: "center" }); d.querySelector("summary").focus(); }
}
function openTerm(id) {
  showPlace("help");
  const dt = $("term-" + id);
  if (dt) { dt.scrollIntoView({ block: "center" }); dt.classList.add("flash"); setTimeout(() => dt.classList.remove("flash"), 1600); }
}

const tour = { at: 0, steps: [] };
function placeTour() {
  const step = tour.steps[tour.at], target = document.querySelector(step.target), card = $("tour");
  for (const e of document.querySelectorAll(".tour-on")) e.classList.remove("tour-on");
  target.classList.add("tour-on");
  target.scrollIntoView({ block: "nearest" });
  $("tour-step").textContent = `${tour.at + 1} of ${tour.steps.length}`;
  $("tour-title").textContent = step.title;
  $("tour-text").textContent = step.text;
  $("tour-next").textContent = tour.at === tour.steps.length - 1 ? "Done" : "Next";
  card.hidden = false;
  const r = target.getBoundingClientRect(), c = card.getBoundingClientRect();
  const tall = r.height > window.innerHeight / 2 && r.right + 16 + c.width < window.innerWidth;     // beside a tall target, not over it
  const top = tall ? Math.max(12, r.top + 24) : r.bottom + 12 + c.height < window.innerHeight ? r.bottom + 12 : Math.max(12, r.top - c.height - 12);
  const left = tall ? r.right + 16 : Math.min(Math.max(12, r.left), window.innerWidth - c.width - 12);
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  $("tour-next").focus();
}
function endTour() {
  $("tour").hidden = true;
  for (const e of document.querySelectorAll(".tour-on")) e.classList.remove("tour-on");
  try { localStorage.setItem("b90-toured", "1"); } catch { /* the offer comes back next time */ }
  const offer = $("tour-offer"); if (offer) offer.remove();
}
async function startTour() {
  if (!state.result && !multi()) { await loadDemo(); await run(); }
  if (!state.result && !multi()) return;
  if (state.place !== "work") selectTab(state.tab);
  tour.steps = TOUR.filter((t) => { const e = document.querySelector(t.target); return e && e.getClientRects().length; });
  tour.at = 0;
  if (tour.steps.length) placeTour();
}
function offerTour() {
  let seen = false;
  try { seen = !!localStorage.getItem("b90-toured"); } catch { seen = true; }
  if (seen || $("tour-offer")) return;
  $("worktools").prepend(el_("button", { type: "button", class: "btn tour-offer", id: "tour-offer", text: "New here? Take the one-minute tour", onclick: startTour }));
}

// ---------- wiring of the shell
document.addEventListener("click", (e) => {
  const p = e.target instanceof Element && e.target.closest("[data-place]");
  if (p) showPlace(p.dataset.place);
});
$("faq-q").addEventListener("input", filterHelp);
$("tour-start").addEventListener("click", startTour);
$("tour-next").addEventListener("click", () => { if (++tour.at >= tour.steps.length) endTour(); else placeTour(); });
$("tour-end").addEventListener("click", endTour);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("tour").hidden) endTour(); });

initTips();
renderHelp();
// a pre-sales engineer lands on their desk; a shared link or a demo link still lands where it points
if (savedRole() === "se" && !["start", "shared"].some((k) => new URLSearchParams(location.search).has(k))) showPlace("desk");
else if (new URLSearchParams(location.search).get("start") === "presales") openPresales().catch((e) => say(e.message));
else showPlace("start");
boot();
