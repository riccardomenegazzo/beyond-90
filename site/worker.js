// The engine, off the main thread. This file is loaded as text and started from a blob: URL, because a
// worker created from a blob inherits the page's Content Security Policy (connect-src 'self'), whereas a
// worker loaded from a plain URL on a static host has no policy at all. __BASE__ is replaced with the
// page's own origin and path before the worker starts.
const BASE = "__BASE__";
let py = null;
const violations = [];
self.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective}: ${e.blockedURI}`));

const say = (text) => self.postMessage({ type: "status", text });

async function init() {
  say("Loading the engine (about 15 MB, cached afterwards)…");
  const { loadPyodide } = await import(BASE + "pyodide/pyodide.mjs");
  py = await loadPyodide({ indexURL: BASE + "pyodide/" });
  const buf = await (await fetch(BASE + "beyond90.zip")).arrayBuffer();
  py.unpackArchive(buf, "zip", { extractDir: "/lib/engine" });
  py.runPython("import sys; sys.path.insert(0, '/lib/engine')\nimport beyond90.web as w, beyond90 as b");
  return py.runPython("b.__version__");
}

// Everything crosses the boundary as JSON text: no shared objects, nothing to keep in step.
const ops = {
  analyze: (a) => call("w.analyze_json(_a, _b)", JSON.stringify(a.files), JSON.stringify(a.options || {})),
  book: (a) => call("w.analyze_book_json(_a, _b)", JSON.stringify(a.groups), JSON.stringify(a.options || {})),
  triage: (a) => call("w.triage_json(_a, _b)", String(a.text || "").slice(0, 4000), JSON.stringify(a.options || {})),
  preflight: (a) => call("w.preflight_json(_a)", JSON.stringify(a.options || {})),
  plan: (a) => call("w.plan_json(_a, _b)", JSON.stringify(a.files), JSON.stringify(a.options || {})),
  summarize: (a) => call("w.summarize_json(_a)", JSON.stringify(a.files)),
  fingerprint: (a) => call("w.fingerprint_json(_a)", JSON.stringify(a.files)),
  execqbr: (a) => call("w.exec_qbr_json(_a)", JSON.stringify({ snapshots: a.snapshots || [], from: a.from || "", to: a.to || "", advisories: a.advisories || null })),
  probe: async () => {
    // Try to send something to another origin. A working policy blocks it, and says so.
    const before = violations.length;
    let reached = false;
    try { await fetch("https://example.com/beyond90-probe", { mode: "no-cors" }); reached = true; } catch { /* expected */ }
    await new Promise((r) => setTimeout(r, 50));
    return JSON.stringify({ reached, violations: violations.slice(before) });
  },
};

function call(expr, a, b) {
  py.globals.set("_a", a);
  py.globals.set("_b", b === undefined ? "{}" : b);
  return py.runPython(expr);
}

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    if (op === "init") return self.postMessage({ id, ok: true, result: await init() });
    if (!py) throw new Error("The engine is not ready yet.");
    self.postMessage({ id, ok: true, result: await ops[op](args || {}) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message ? e.message : e) });
  }
};
