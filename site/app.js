// Beyond 90 in the browser. The Python engine runs in WebAssembly (Pyodide) from this same origin.
// Files are read with the File API and handed to Python as text. There is no fetch of user data anywhere.
import { loadPyodide } from "./pyodide/pyodide.mjs";

const $ = (id) => document.getElementById(id);
const state = { files: {}, result: null, tab: "report", py: null };
const ALLOWED = /\.(csv|toml)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- engine
async function boot() {
  try {
    $("status").textContent = "Loading the engine (about 15 MB, cached afterwards)…";
    const py = await loadPyodide({ indexURL: new URL("./pyodide/", import.meta.url).href });
    const buf = await (await fetch("./beyond90.zip")).arrayBuffer();
    py.unpackArchive(buf, "zip", { extractDir: "/lib/engine" });
    py.runPython("import sys; sys.path.insert(0, '/lib/engine')");
    py.runPython("import beyond90.web as w, beyond90 as b");
    state.py = py;
    $("version").textContent = "engine " + py.runPython("b.__version__");
    $("status").textContent = "";
    $("demo").disabled = false;
    refreshRun();
  } catch (e) {
    $("version").textContent = "engine failed";
    $("status").textContent = "The engine could not start: " + e.message;
  }
}

function refreshRun() {
  $("run").disabled = !(state.py && Object.keys(state.files).length);
}

// ---------- input
async function addFiles(list) {
  const files = [...list].filter((f) => ALLOWED.test(f.name));
  const skipped = list.length - files.length;
  if (files.length) state.files = {};          // a new selection replaces the old one, it never mixes two customers
  for (const f of files) {
    if (f.size > MAX_BYTES) { $("status").textContent = f.name + " is larger than 20 MB and was skipped."; continue; }
    state.files[f.name] = await f.text();
  }
  if (skipped) $("status").textContent = skipped + " file(s) skipped: only .csv and .toml are read.";
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
  $("status").textContent = "Loading the demo…";
  state.files = await (await fetch("./demo.json")).json();
  renderLoaded();
  $("status").textContent = "Demo loaded: a made-up customer, Northwind. Press Run analysis.";
}

// ---------- run
function run() {
  $("errors").hidden = true;
  $("status").textContent = "Analyzing…";
  // Let the browser paint the message before the (synchronous) engine call.
  setTimeout(() => {
    try {
      const opts = {
        hours: Number($("hours").value) || 8,
        weeks: Math.round(Number($("weeks").value)) || 26,
        realization: Math.min(1, Math.max(0.1, Number($("real").value) || 0.9)),
        quarter: $("quarter").value.trim(),
      };
      state.py.globals.set("_files", JSON.stringify(state.files));
      state.py.globals.set("_opts", JSON.stringify(opts));
      const res = JSON.parse(state.py.runPython("w.analyze_json(_files, _opts)"));
      if (!res.ok) return showErrors(res.errors);
      state.result = res;
      $("status").textContent = res.warnings.length ? res.warnings.length + " warning(s): " + res.warnings.join("; ") : "";
      showResults();
    } catch (e) {
      showErrors(["Unexpected error: " + e.message]);
    }
  }, 30);
}

function showErrors(list) {
  $("results").hidden = true;
  $("errors").hidden = false;
  $("errlist").replaceChildren(...list.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  $("status").textContent = "";
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
  const pct = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");
  $("kpis").replaceChildren(kpi(pct(r.yield), "Yield"), kpi(pct(r.reach), "Reach"), kpi(String(r.actions), "Open actions"), kpi(r.customer, "Customer as of " + r.as_of));
  $("results").hidden = false;
  selectTab(state.tab);
  $("results").scrollIntoView({ behavior: "smooth" });
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
    while (i < lines.length && lines[i].trim() && !/^(#|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) p += " " + lines[i++];
    out.push(el("p", inline(p)));
  }
  return out;
}

// ---------- actions
function download() {
  const t = TABS[state.tab], blob = new Blob([state.result[t.key]], { type: t.type + ";charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: t.file });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy() {
  try { await navigator.clipboard.writeText(state.result[TABS[state.tab].key]); $("status").textContent = "Copied."; }
  catch { $("status").textContent = "Copy is not available here; use Download."; }
}

// ---------- wiring
$("folder").addEventListener("change", (e) => addFiles(e.target.files));
$("files").addEventListener("change", (e) => addFiles(e.target.files));
$("drop").addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("over"));
$("drop").addEventListener("drop", dropped);
$("demo").addEventListener("click", loadDemo);
$("run").addEventListener("click", run);
$("copy").addEventListener("click", copy);
$("download").addEventListener("click", download);
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => state.result && selectTab(b.dataset.tab));
boot();
