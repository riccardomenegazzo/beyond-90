// Beyond 90 in the browser. The Python engine runs in a worker (WebAssembly, Pyodide) from this same origin.
// Files are read with the File API and handed to the worker as text. User data is never sent anywhere.
import { qrSvg } from "./qr.js";
import { PROVIDERS, problems as starterProblems, starterFiles } from "./starter.js";
import { Engine } from "./engine.js";
import * as W from "./workspace-core.js";
import * as O from "./outcomes.js";
import * as K from "./commitments.js";
import * as ASK from "./asks.js";
import * as POV from "./pov.js";
import { ROLES, ROLE_IDS, isRole, shape } from "./roles.js";
import * as store from "./store.js";
import * as Vault from "./vault.js";
import * as V from "./views.js";
import { createPrivacy } from "./privacy.js";
import { h as el_, s as svg_, saveBlob, copyText, setExitGate, csvCell, icon, initTips, info } from "./ui.js";
import { CUSTOMER_NAV, BOOK_NAV, FAQ, GLOSSARY, TOUR } from "./guide.js";

// Another site could frame this page and steer clicks on it; the app only runs as the top-level page.
if (window.top !== window.self) throw new Error("Beyond 90 runs only as a top-level page, never inside another site's frame.");

const $ = (id) => document.getElementById(id);
// The page enforces Trusted Types for scripts (see the CSP): the only string-to-HTML sink left is the sandboxed report frame,
// which has no scripts and no access to this page. Its content is produced by the engine from the customer's files, escaped there.
const swPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-sw", { createScriptURL: (u) => { if (u !== "./sw.js") throw new TypeError("only the page's own service worker may be registered"); return u; } }) : null;
const reportPolicy = window.trustedTypes ? window.trustedTypes.createPolicy("b90-report", { createHTML: (t) => t }) : null;
const state = { commitments: [], outcomes: [], povs: [], asks: [], calibration: null, healthWeights: null, advisories: null, files: {}, groups: {}, mode: "single", result: null, book: null, tab: "overview", saved: [], yields: new Map(), engine: null, running: false };
const ALLOWED = /\.(csv|toml|xlsx)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");

const say = (text) => { $("status").textContent = text; };

// What leaves the page (copy, download) passes through one gate: pseudonyms, a preview, and a log of what left.
const privacy = createPrivacy({ state, store, $, say, unlockVaultUi: () => unlockVaultUi(), today: () => todayIso(), saveBlob, copyText });
setExitGate(privacy.gate);
privacy.onRefresh(() => refreshHistory());

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
  if (!kept.length) { if (skipped) say(skipped + " file(s) skipped: only .csv, .toml and .xlsx are read."); return; }
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
    state.mode = "book";
    for (const [dir, f] of customers) state.groups[uniqueKey(lastSegment(dir), state.groups)] = f;
  } else {
    state.mode = "single";
    state.files = customers.length === 1 ? customers[0][1] : Object.assign({}, ...byDir.values());
  }
  if (skipped) notes.push(skipped + " file(s) skipped: only .csv, .toml and .xlsx are read.");
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
  const what = state.mode === "book" ? `${Object.keys(state.groups).length} customers` : W.peekCustomer(state.files).customer || "these files";
  $("run").textContent = labels.length ? `Analyse ${what}` : "Analyse";
  if (state.mode === "book") say(`${Object.keys(state.groups).length} customers found: analyse them together to plan your week across the book.`);
  state.result = null; state.book = null;
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

async function loadDemoEndpoint() {
  say("Loading the example…");
  state.mode = "single"; state.groups = {};
  state.files = await (await fetch("./demo-endpoint.json")).json();
  renderLoaded();
  say("Example loaded: a made-up endpoint-protection customer.");
}

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
    state.result = res; state.book = null; privacy.learn(res);
    state.compareId = base ? base.id : "";
    say(res.warnings.length ? res.warnings.length + " warning(s): " + res.warnings.join("; ") : "");
    showResults();
    if ($("autosave").checked) await saveSnapshot({ quiet: true });   // the history a review is built from
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
    state.book = res; state.result = null; privacy.learn(res);
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
  if (!VIEWS[state.tab] || !CUSTOMER_NAV.some((g) => g.views.some((v) => v.id === state.tab))) state.tab = "overview";
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
  overview: { kind: "view", view: "overview" }, connections: { kind: "view", view: "connectionsView" }, accounts: { kind: "view", view: "accountsView" }, findings: { kind: "view", view: "findingsView" },
  onboarding: { kind: "view", view: "onboardingView" }, maturity: { kind: "view", view: "maturityView" }, actions: { kind: "view", view: "actionsView" },
  planview: { kind: "view", view: "planView" }, whatif: { kind: "view", view: "whatifView" }, commitments: { kind: "view", view: "commitmentsView" }, handoff: { kind: "view", view: "handoffView" }, outlook: { kind: "view", view: "outlookView" }, teams: { kind: "view", view: "teamsView" }, burndown: { kind: "view", view: "burndownView" }, asks: { kind: "view", view: "asksView" }, pov: { kind: "view", view: "povView" },
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
  booknews: { kind: "view", view: "bookNewsView" }, bookconnections: { kind: "view", view: "bookConnectionsView" },
  calibration: { kind: "view", view: "calibrationView" },
  portfolio: { kind: "md", key: "portfolio_markdown", file: "beyond90-portfolio.md", type: "text/markdown" },
  book: { kind: "md", key: "book_markdown", file: "beyond90-book.md", type: "text/markdown" },
  bookreport: { kind: "html", key: "book_html", file: "beyond90-book.html", type: "text/html" },
};
let tabDefs = [];

const PLACES = { start: "place-start", work: "results", saved: "history-panel", help: "place-help", errors: "errors" };
function showPlace(name) {
  for (const [k, id] of Object.entries(PLACES)) $(id).hidden = k !== name;
  state.place = name;
  for (const b of document.querySelectorAll(".rail [data-place]")) b.toggleAttribute("aria-current", b.dataset.place === name);
  if (name !== "work") for (const b of document.querySelectorAll("#tabs button")) b.removeAttribute("aria-current");
  if (name === "saved") renderDeviceQr();
  window.scrollTo({ top: 0 });
}

function setStep(n) {
  [...document.querySelectorAll(".steps li")].forEach((li, i) => { li.className = i + 1 < n ? "is-done" : i + 1 === n ? "is-now" : ""; });
}

let navGroups = [], navTitle = "";
function savedRole() { try { const r = localStorage.getItem("beyond90.role"); return isRole(r) ? r : "all"; } catch { return "all"; } }
function renderNav(groups, title) {
  navGroups = groups; navTitle = title;
  tabDefs = groups.flatMap((g) => g.views.map((v) => ({ ...v, ...VIEWS[v.id], group: g.question })));   // every view stays reachable, whatever the role
  $("workspace").hidden = false;
  $("ws-title").textContent = title;
  paintRoles();
  const { main, more } = shape(groups, savedRole());
  const btn = (v) => el_("button", { type: "button", dataset: { tab: v.id }, "data-tip": v.tip, onclick: () => selectTab(v.id) }, icon(v.icon), el_("span", { text: v.label }));
  const grp = (g, i, p) => el_("div", { class: "navgroup", role: "group", "aria-labelledby": `grp-${p}${i}` }, el_("p", { class: "grp", id: `grp-${p}${i}`, text: g.question }), g.views.map(btn));
  const kids = main.map((g, i) => grp(g, i, "m"));
  if (more.length) kids.push(el_("details", { class: "navmore", open: more.some((g) => g.views.some((v) => v.id === state.tab)) }, el_("summary", { text: "More views" }), more.map((g, i) => grp(g, i, "x"))));
  $("tabs").replaceChildren(...kids);
}
function setRole(id) {
  try { localStorage.setItem("beyond90.role", id); } catch { /* the choice just does not persist */ }
  paintRoles();
  if (!$("workspace").hidden && navGroups.length) { renderNav(navGroups, navTitle); markTab(); }
}
function paintRoles() {
  const now = savedRole();
  for (const [id, host] of [["role-pick", $("role-pick")], ["hero-roles", $("hero-roles")]]) {
    if (!host) continue;
    host.replaceChildren(...(id === "hero-roles" ? [el_("span", { class: "fine", text: "I work as" })] : []), ...ROLE_IDS.map((r) => el_("button", { type: "button", class: "chip-btn", dataset: { role: r }, "aria-pressed": String(r === now), title: ROLES[r].hint, text: id === "hero-roles" ? (r === "all" ? "Not sure yet" : ROLES[r].label) : ROLES[r].short, onclick: () => setRole(r) })));
  }
}
function markTab() { for (const b of document.querySelectorAll("#tabs button")) b.toggleAttribute("aria-current", b.dataset.tab === state.tab); }

const current = () => tabDefs.find((t) => t.id === state.tab) || tabDefs[0];
const payload = () => (state.mode === "book" || state.book ? state.book : state.result);

function selectTab(name, extra) {
  state.tab = name;
  state.focus = extra && extra.open;
  const t = current();
  showPlace("work");
  for (const b of document.querySelectorAll("#tabs button")) b.toggleAttribute("aria-current", b.dataset.tab === t.id);
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
  if (state.book) return { book: state.book, povs: state.povs, savePov, removePov, today: todayIso(), advisories: state.advisories, openCustomer: (key, tab = "prep") => { state.mode = "single"; state.files = { ...state.groups[key] }; state.book = null; state.tab = tab; renderLoaded(); run(); } };
  const r = state.result;
  if (r && state.parsedFor !== r) { state.parsed = JSON.parse(r.score_json); state.parsedFor = r; }
  return { result: r, dash: r.dashboard, score: state.parsed, engine: state.engine, files: state.files, options: options(), advisories: state.advisories, logTouch, go: (tab, extra) => selectTab(tab, extra),
    povs: state.povs, savePov, removePov, asks: state.asks, addAsk, setAskStatus, removeAsk,
    commitments: state.commitments, addCommitment, setCommitmentStatus, removeCommitment, keepFromCall, today: todayIso(),
    history: state.saved.filter((x) => x.customer === r.customer).map((x) => ({ as_of: x.as_of, yield: state.yields.get(x.id) })).filter((x) => typeof x.yield === "number"),
    outcomes: state.outcomes, calibration: state.calibration, healthWeights: state.healthWeights, recordOutcome, removeOutcome, applyWeights, resetWeights,
    saved: state.saved, frameHtml: (frame, html) => { frame.srcdoc = reportPolicy ? reportPolicy.createHTML(html) : html; } };
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
  saveBlob(payload()[t.key], t.file, t.type + ";charset=utf-8");
}
function save(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy() {
  say((await copyText(payload()[current().key])) ? "Copied." : "Nothing was copied. If copying is not available here, use Download.");
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
  await store.commitmentPut([K.withStatus(c, status, todayIso() < c.created_on ? c.created_on : todayIso())]);
  await refreshCommitments();
  selectTab(state.tab);
}
async function removeCommitment(id) { await store.commitmentRemove(id); await refreshCommitments(); selectTab(state.tab); }
async function keepFromCall({ agreed, ours, date }) {
  const made = K.fromCall({ customer: state.result.customer, agreed, ours, date, existing: state.commitments });
  if (made.length) { await store.commitmentPut(made); await refreshCommitments(); }
  return made.length;
}

async function refreshPovs() { try { state.povs = await store.povsAll(); } catch { state.povs = []; } }
async function refreshAsks() { try { state.asks = await store.asksAll(); } catch { state.asks = []; } }
async function savePov(p) { await store.povPut([p]); await refreshPovs(); selectTab(state.tab); }
async function removePov(id) { await store.povRemove(id); await refreshPovs(); selectTab(state.tab); }
async function addAsk(p) {
  await store.askPut([ASK.makeAsk({ customer: state.result.customer, kind: p.kind, title: p.title, detail: p.detail, atStake: p.atStake, ref: p.ref, createdOn: todayIso() })]);
  await refreshAsks(); selectTab(state.tab);
}
async function setAskStatus(id, status) {
  const a = state.asks.find((x) => x.id === id);
  if (!a) return;
  await store.askPut([ASK.withAskStatus(a, status, todayIso() < a.created_on ? a.created_on : todayIso())]);
  await refreshAsks(); selectTab(state.tab);
}
async function removeAsk(id) { await store.askRemove(id); await refreshAsks(); selectTab(state.tab); }

async function refreshHistory() {
  await refreshCommitments();
  await refreshPovs();
  await refreshAsks();
  await refreshOutcomes();
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
  const text = W.serializeWorkspace(state.saved, { engine: state.engine ? state.engine.version : "", extra: { outcomes: state.outcomes, commitments: state.commitments, povs: state.povs, asks: state.asks } });
  const sealed = await store.sealExport(text);
  save(new Blob([sealed || text], { type: "application/json" }), sealed ? "beyond90-workspace.sealed.json" : "beyond90-workspace.json");
  wsSay(sealed ? `Exported ${state.saved.length} snapshot(s), sealed with your passphrase.`
    : `Exported ${state.saved.length} snapshot(s). The file is not encrypted and contains customer data: protect saved data with a passphrase and exports are sealed too.`);
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
  $("map-count").textContent = `${s.rows} row(s) and ${s.headers.length} column(s) found.` + (s.target ? "" : " The file does not clearly look like accounts or findings; choose what to build.");
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
  $("map-notes").replaceChildren(el_("li", { text: `${r.rows} row(s) ready${r.skipped ? `, ${r.skipped} left out` : ""}.` }), ...r.notes.map((t) => el_("li", { text: t })));
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
  say(`Added ${r.file} from your export (${r.rows} row(s)).` + ("accounts.csv" in files ? "" : " Add the accounts file too: findings refer to accounts."));
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
  const sealed = await store.sealExport(W.serializeWorkspace(state.saved, { engine: state.engine ? state.engine.version : "", extra: { outcomes: state.outcomes, commitments: state.commitments, povs: state.povs, asks: state.asks } }));
  const file = new File([sealed], "beyond90-workspace.sealed.json", { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Beyond 90 workspace" });
      return wsSay(`Sent ${state.saved.length} snapshot(s), encrypted. Import the file on the other device with your passphrase.`);
    } catch (e) { if (e.name === "AbortError") return; }
  }
  save(file, file.name);
  wsSay(`Saved ${state.saved.length} snapshot(s) as one encrypted file. Move it to the other device and import it there with your passphrase.`);
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
    await refreshHistory();
    wsSay(`Imported: ${added} new, ${ok.length - added} already here` + (rejected ? `, ${rejected} rejected because their content did not match their name` : "")
      + (outs.ok.length || outs.rejected ? `; ${addedOut} renewal outcome(s) added` + (outs.rejected ? `, ${outs.rejected} refused` : "") : "")
      + (cms.ok.length || cms.rejected ? `; ${addedCm} commitment(s) added` + (cms.rejected ? `, ${cms.rejected} refused` : "") : "")
      + (pvs.ok.length || pvs.rejected ? `; ${addedPv} proof(s) of value added` + (pvs.rejected ? `, ${pvs.rejected} refused` : "") : "")
      + (aks.ok.length || aks.rejected ? `; ${addedAk} ask(s) added` + (aks.rejected ? `, ${aks.rejected} refused` : "") : "") + ".");
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
$("demo-endpoint").addEventListener("click", loadDemoEndpoint);
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
    { label: "Open the example customer", hint: "example", when: () => !$("demo").disabled, run: () => loadDemo().then(() => run()) },
    { label: "Open the example book (3 customers)", hint: "example", when: () => !$("demo-book").disabled, run: () => loadDemoBook().then(() => run()) },
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
  if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && (hasResult() || state.book)) {
    const t = tabDefs[Number(e.key) - 1]; if (t) selectTab(t.id);
  }
});

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
  if (!state.result && !state.book) { await loadDemo(); await run(); }
  if (!state.result && !state.book) return;
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
showPlace("start");
boot();
