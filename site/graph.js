// The connections graph: an interactive picture of where a customer's separate signals meet.
// No library: a layered layout with semantic columns (threats, gaps, accounts, owners), drawn in SVG,
// with zoom, pan, drag, neighbourhood highlight, keyboard access, and the insights that light up their own path.
import { h, s } from "./ui.js";

const TYPES = {
  story: { label: "Security stories", column: 0.03, color: "var(--bad)" },
  capability: { label: "Protections off", column: 0.25, color: "var(--s3)" },
  cause: { label: "Onboarding blockers", column: 0.25, color: "var(--warn)" },
  account: { label: "Accounts", column: 0.52, color: "var(--accent)" },
  customer: { label: "Customers", column: 0.6, color: "var(--accent)" },
  finding: { label: "Critical findings", column: 0.72, color: "var(--s2)" },
  team: { label: "Owner teams", column: 0.9, color: "var(--ink2)" },
};
const EDGE = {
  exposes: { color: "var(--bad)", dash: "", width: 2 }, blind: { color: "var(--muted)", dash: "4 4", width: 1 },
  blocks: { color: "var(--warn)", dash: "", width: 1.6 }, missing: { color: "var(--s3)", dash: "3 3", width: 1.2 },
  mitigates: { color: "var(--s3)", dash: "", width: 1.6 }, owns: { color: "var(--line)", dash: "", width: 1.2 },
  on: { color: "var(--s2)", dash: "", width: 1.4 },
};
const W = 1000, PAD = 30;
let H = 640;

/**
 * A layered layout: every kind keeps its column, and each column is ordered so that linked items sit level with
 * each other (a few barycentre sweeps), which keeps the links short and mostly free of crossings.
 * Deterministic: the same customer always draws the same picture.
 */
function layout(nodes, edges) {
  const columns = new Map();
  for (const n of nodes) { const c = n.column; if (!columns.has(c)) columns.set(c, []); columns.get(c).push(n); }
  const near = new Map(nodes.map((n) => [n.id, []]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = byId.get(e.source), b = byId.get(e.target);
    if (a && b && a.column !== b.column) { near.get(a.id).push(b); near.get(b.id).push(a); }
  }
  const gap = (a, b) => Math.max(radius(a), 7) + Math.max(radius(b), 7) + (a.type === "team" || b.type === "team" ? 14 : 8);
  const need = (col) => col.reduce((sum, n, i) => sum + (i ? gap(col[i - 1], n) : 0), 0);
  H = Math.max(480, Math.max(...[...columns.values()].map(need)) + 2 * PAD);
  for (const col of columns.values()) {
    const x = col[0].column * W;
    const step = Math.min(64, (H - 2 * PAD) / Math.max(col.length, 1));
    col.forEach((n, i) => { n.x = x; n.y = H / 2 + (i - (col.length - 1) / 2) * step; });
  }
  const spread = (col) => {
    for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + gap(col[i - 1], col[i]));
    col[col.length - 1].y = Math.min(col[col.length - 1].y, H - PAD);
    for (let i = col.length - 2; i >= 0; i--) col[i].y = Math.min(col[i].y, col[i + 1].y - gap(col[i], col[i + 1]));
    const low = PAD - col[0].y;
    if (low > 0) for (const n of col) n.y += low;
  };
  const order = [...columns.keys()].sort((a, b) => a - b);
  for (let sweep = 0; sweep < 8; sweep++) {
    for (const c of sweep % 2 ? [...order].reverse() : order) {
      const col = columns.get(c);
      for (const n of col) { const ns = near.get(n.id); n.target = ns.length ? ns.reduce((t, m) => t + m.y, 0) / ns.length : n.y; }
      col.sort((a, b) => a.target - b.target || (a.id < b.id ? -1 : 1));
      col.forEach((n) => { n.y = n.target; });
      spread(col);
    }
  }
}

const radius = (n) => (n.type === "team" ? 0 : n.type === "finding" ? 6 : n.type === "account" ? 7 + Math.min(12, Math.sqrt(n.weight) * 2.2) : n.type === "customer" ? 10 + Math.min(12, Math.sqrt(n.weight) * 2.4) : 11);

function shape(n) {
  const c = TYPES[n.type].color, r = radius(n);
  if (n.type === "story") return s("path", { d: `M0 ${-r - 3}L${r + 3} 0L0 ${r + 3}L${-r - 3} 0Z`, fill: n.kev ? c : "var(--surface)", stroke: c, "stroke-width": 2.5 });
  if (n.type === "cause") return s("rect", { x: -r, y: -r, width: 2 * r, height: 2 * r, rx: 3, fill: "var(--surface)", stroke: c, "stroke-width": 2.5 });
  if (n.type === "capability") return s("rect", { x: -r, y: -r, width: 2 * r, height: 2 * r, rx: r / 2, fill: "var(--surface)", stroke: c, "stroke-width": 2.5, "stroke-dasharray": "4 2" });
  if (n.type === "team") {
    const w = Math.max(64, n.label.length * 7.6 + 20);
    return s("rect", { x: -w / 2, y: -14, width: w, height: 28, rx: 14, fill: "var(--surface)", stroke: c, "stroke-width": 1.5 });
  }
  if (n.type === "finding") return s("circle", { r, fill: n.severity === "critical" ? "var(--bad)" : c, stroke: "var(--surface)", "stroke-width": 1.5 });
  const hot = n.convergence >= 2;
  return s("circle", { r, fill: n.connected ? c : "var(--surface)", "fill-opacity": n.connected ? 0.16 + Math.min(0.6, n.weight / 30) : 1,
    stroke: hot ? "var(--bad)" : c, "stroke-width": hot ? 3 : 2, "stroke-dasharray": n.connected ? "" : "3 2" });
}

const showsLabel = (n) => n.type !== "finding";
const short = (text) => (text.length > 30 ? text.slice(0, 28) + "…" : text);
function label(n) {
  if (n.type === "team") return s("text", { class: "g-label", y: 4, "text-anchor": "middle" }, n.label);
  return s("text", { class: "g-label", x: radius(n) + 7, y: 4 }, short(n.label));
}

/**
 * The view. `graph` is {nodes, edges, insights, stats} from the engine; `go(tab)` opens another view.
 */
export function connections(graph, { go, open = null }) {
  const BOOK = graph.stats.scope === "book";
  // across a book there are no accounts, findings or teams: three columns spread over the width, and the capabilities are the ones missing
  const BOOK_COLUMNS = { story: 0.04, capability: 0.36, cause: 0.36, customer: 0.7 };
  const kind = (t) => (BOOK && t === "capability" ? "Missing capabilities" : TYPES[t].label);
  const describeNode = (n) => `${kind(n.type).replace(/s$/, "")} ${n.label}. ${n.detail}${n.signals ? ". " + n.signals.join("; ") : ""}`;
  const nodes = graph.nodes.map((n) => ({ ...n })), edges = graph.edges;
  if (!nodes.length) return h("p", { class: "fine", text: "Nothing to connect yet: no account carries a signal. That is good news." });
  for (const n of nodes) n.column = (BOOK && BOOK_COLUMNS[n.type]) || TYPES[n.type].column;
  layout(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const near = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
  for (const e of edges) { near.get(e.source)?.add(e.target); near.get(e.target)?.add(e.source); }

  const view = { x: 0, y: 0, k: 1 };
  const world = s("g", { class: "g-world" });
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "g-svg", role: "group", "aria-label": `Connections graph: ${nodes.length} items and ${edges.length} links. Use Tab to move between items and Enter to open one.` }, world);
  const apply = () => world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.k})`);

  const lines = edges.map((e) => {
    const st = EDGE[e.kind] || EDGE.owns;
    return { e, el: s("path", { stroke: st.color, "stroke-width": st.width, "stroke-dasharray": st.dash, fill: "none", class: "g-edge" }) };
  });
  const draws = nodes.map((n) => {
    const g = s("g", { class: `g-node g-${n.type}`, tabindex: "0", role: "button", "aria-label": describeNode(n), "data-tip": `${n.label}: ${n.detail}` },
      shape(n), showsLabel(n) ? label(n) : null);
    return { n, g };
  });
  world.append(s("g", {}, lines.map((l) => l.el)), s("g", {}, draws.map((d) => d.g)));
  const place = () => {
    for (const { e, el } of lines) {
      const a = byId.get(e.source), b = byId.get(e.target), bend = (b.x - a.x) * 0.45;
      el.setAttribute("d", `M${a.x.toFixed(1)} ${a.y.toFixed(1)}C${(a.x + bend).toFixed(1)} ${a.y.toFixed(1)} ${(b.x - bend).toFixed(1)} ${b.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
    for (const { n, g } of draws) g.setAttribute("transform", `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`);
  };
  place();

  // highlight: a set of node ids stays bright, the rest dims; edges are bright when both ends are
  let pinned = null;
  const light = (ids) => {
    svg.classList.toggle("g-focus", !!ids);
    for (const { n, g } of draws) g.classList.toggle("on", !!ids && ids.has(n.id));
    for (const { e, el } of lines) el.classList.toggle("on", !!ids && ids.has(e.source) && ids.has(e.target));
  };
  const fit = (ids) => {
    if (!ids) { Object.assign(view, { x: 0, y: 0, k: 1 }); apply(); return; }
    const pts = nodes.filter((n) => !ids || ids.has(n.id));
    const x0 = Math.min(...pts.map((p) => p.x)) - 60, x1 = Math.max(...pts.map((p) => p.x)) + 200;
    const y0 = Math.min(...pts.map((p) => p.y)) - 50, y1 = Math.max(...pts.map((p) => p.y)) + 50;
    view.k = Math.max(0.5, Math.min(2.2, Math.min(W / (x1 - x0), H / (y1 - y0))));
    view.x = W / 2 - ((x0 + x1) / 2) * view.k; view.y = H / 2 - ((y0 + y1) / 2) * view.k;
    apply();
  };

  // the side panel: what a node is, what it touches, and the insights it is part of
  const panel = h("div", { class: "g-panel", "aria-live": "polite" });
  const insightOf = (id) => graph.insights.filter((i) => i.nodes.includes(id));
  const reveal = () => {                                    // keep the details in sight on a short screen
    if (panel.getBoundingClientRect().top > innerHeight - 160)
      panel.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const select = (n) => {
    pinned = near.get(n.id);
    light(pinned);
    for (const { n: m, g } of draws) g.classList.toggle("sel", m.id === n.id);
    const links = edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => ({ e, other: byId.get(e.source === n.id ? e.target : e.source) }));
    panel.replaceChildren(
      h("p", { class: "g-kind", text: kind(n.type).replace(/s$/, "") }), h("h3", { text: n.label }), h("p", { class: "fine", text: n.detail }),
      n.signals ? h("ul", { class: "g-signals" }, n.signals.map((t) => h("li", { text: t }))) : null,
      insightOf(n.id).length ? h("div", {}, h("h4", { text: "Part of" }), insightOf(n.id).map((i) => h("button", { type: "button", class: "link block", text: i.title, onclick: () => focusInsight(i) }))) : null,
      h("h4", { text: `Linked to ${links.length}` }),
      h("ul", { class: "g-links" }, links.slice(0, 14).map(({ e, other }) => h("li", {}, h("span", { class: "fine", text: (e.label || e.kind) + " " }),
        h("button", { type: "button", class: "link", text: other.label, onclick: () => { select(other); focusNode(other); } })))),
      n.type === "account" ? h("p", {}, h("button", { type: "button", class: "btn small", text: "Open in Accounts", onclick: () => go("accounts") })) : null,
      n.type === "customer" && open ? h("p", {}, h("button", { type: "button", class: "btn small primary", text: "Open this customer's map", onclick: () => open(n.key, "connections") })) : null,
      n.type === "story" ? h("p", {}, h("button", { type: "button", class: "btn small", text: "Open in News", onclick: () => go("news") })) : null,
      n.type === "cause" ? h("p", {}, h("button", { type: "button", class: "btn small", text: "Open in Onboarding", onclick: () => go("onboarding") })) : null);
    reveal();
  };
  const focusNode = (n) => draws.find((d) => d.n === n)?.g.focus({ preventScroll: true });
  const cards = new Map();
  const focusInsight = (i) => {
    pinned = new Set(i.nodes);
    light(pinned);
    fit(pinned);
    for (const [id, c] of cards) c.setAttribute("aria-pressed", String(id === i.id));
    panel.replaceChildren(h("p", { class: "g-kind", text: "Insight" }), h("h3", { text: i.title }), h("p", { text: i.text }),
      h("p", {}, h("b", { text: "Next step: " }), i.action), h("p", { class: "fine", text: "Who: " + i.owner }));
  };

  for (const { n, g } of draws) {
    g.addEventListener("pointerenter", () => { if (!pinned) light(near.get(n.id)); });
    g.addEventListener("pointerleave", () => { if (!pinned) light(null); });
    g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(n); } });
  }

  // pointer: drag a node, or pan the picture; wheel or buttons zoom
  const toWorld = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return { x: (q.x - view.x) / view.k, y: (q.y - view.y) / view.k }; };
  let drag = null;
  svg.addEventListener("pointerdown", (ev) => {
    const g = ev.target.closest && ev.target.closest(".g-node");
    const d = g && draws.find((x) => x.g === g);
    if (ev.pointerType === "touch") {                 // a finger scrolls and pinches the page natively; a tap still selects
      drag = d ? { node: d.n, g, touch: true, x: ev.clientX, y: ev.clientY, moved: false } : null;
      return;
    }
    drag = d ? { node: d.n, g, moved: false } : { pan: true, x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false };
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener("pointercancel", () => { drag = null; });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (drag.touch) { if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) drag.moved = true; return; }
    if (drag.pan) {
      const r = svg.getBoundingClientRect(), scale = W / r.width;
      view.x = drag.vx + (ev.clientX - drag.x) * scale; view.y = drag.vy + (ev.clientY - drag.y) * scale;
      drag.moved = true; apply();
    } else {
      const p = toWorld(ev);
      drag.node.x = p.x; drag.node.y = p.y; drag.moved = true; place();
    }
  });
  svg.addEventListener("pointerup", () => {
    if (drag && drag.node && !drag.moved) select(drag.node);                 // a press without a move is a click
    if (drag && drag.pan && !drag.moved && pinned) { pinned = null; light(null); for (const { g } of draws) g.classList.remove("sel"); }
    drag = null;
  });
  const zoom = (f, cx = W / 2, cy = H / 2) => {
    const k = Math.max(0.4, Math.min(3, view.k * f));
    view.x = cx - ((cx - view.x) / view.k) * k; view.y = cy - ((cy - view.y) / view.k) * k; view.k = k; apply();
  };
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    zoom(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H);
  }, { passive: false });

  // filters by kind, a legend that is also the filter, and the insights beside the picture
  const hidden = new Set();
  const refilter = () => {
    for (const { n, g } of draws) g.classList.toggle("off", hidden.has(n.type));
    for (const { e, el } of lines) el.classList.toggle("off", hidden.has(byId.get(e.source).type) || hidden.has(byId.get(e.target).type));
  };
  const present = Object.keys(TYPES).filter((t) => nodes.some((n) => n.type === t));
  const legend = h("div", { class: "g-legend", role: "group", "aria-label": "Show or hide a kind of item" }, present.map((t) => {
    const b = h("button", { type: "button", class: "tog g-tog", "aria-pressed": "true", "data-tip": `Show or hide ${kind(t).toLowerCase()}.` },
      s("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" }, s("circle", { cx: 7, cy: 7, r: 5.5, fill: TYPES[t].color })), " ", kind(t),
      " ", h("span", { class: "fine", text: String(nodes.filter((n) => n.type === t).length) }));
    b.addEventListener("click", () => { hidden.has(t) ? hidden.delete(t) : hidden.add(t); b.setAttribute("aria-pressed", String(!hidden.has(t))); refilter(); });
    return b;
  }));
  const controls = h("div", { class: "g-zoom", role: "group", "aria-label": "Zoom" },
    h("button", { type: "button", class: "icon-btn", "aria-label": "Zoom in", "data-tip": "Zoom in. The mouse wheel works too.", text: "+", onclick: () => zoom(1.25) }),
    h("button", { type: "button", class: "icon-btn", "aria-label": "Zoom out", "data-tip": "Zoom out.", text: "−", onclick: () => zoom(0.8) }),
    h("button", { type: "button", class: "btn small", "data-tip": "Show everything again and clear the highlight.", text: "Fit", onclick: () => { pinned = null; light(null); fit(null); panel.replaceChildren(intro()); for (const c of cards.values()) c.setAttribute("aria-pressed", "false"); } }));
  const intro = () => h("div", {}, h("p", { class: "g-kind", text: "How to read it" }),
    BOOK ? h("p", { text: "Left to right: the security stories that reach your customers, the capabilities that would cover them and the onboarding blockers they share, then the customers. A line means the customer has that problem; a story or blocker linked to several customers is one piece of work done once." })
      : h("p", { text: "Left to right: the security stories that reach the customer, the protections that are off and the blockers that keep accounts out of view, the accounts, their worst findings, and the teams that own them." }),
    h("p", { class: "fine", text: BOOK ? "Bigger customers carry more of the shared problems. Hover to see what something touches, click to pin it and open the customer's own map." : "Bigger accounts carry more signals; a red ring means separate problems meet on it; a dashed account is not connected. Hover to see what something touches, click to pin it, drag to move it or the picture." }));
  panel.append(intro());

  // what moved since the snapshot this run is compared with: progress first, then what needs a look
  const fresh = new Set(graph.change ? [...graph.change.new_nodes, ...graph.change.worse.map((w) => "acct:" + w.account)].filter((id) => byId.has(id)) : []);
  for (const { n, g } of draws) if (fresh.has(n.id)) g.classList.add("g-new");
  function since(c) {
    const list = (title, rows, text) => (rows.length ? h("div", {}, h("h4", { text: `${title} (${rows.length})` }), h("ul", { class: "g-links" }, rows.slice(0, 12).map((r) => h("li", { text: text(r) })))) : null);
    return h("section", { class: "g-change", "aria-label": "What changed" },
      h("p", { class: "g-kind", text: "What changed" }),
      h("p", { text: c.say }),
      h("p", { class: "fine", text: `Accounts with at least one problem: ${c.before} then, ${c.now} now.` }),
      fresh.size ? h("p", {}, h("button", { type: "button", class: "btn small", text: `Show what is new on the map (${fresh.size})`, onclick: () => { pinned = fresh; light(fresh); fit(fresh); } })) : null,
      h("details", {}, h("summary", { text: "Account by account" }),
        list("No problem left", c.cleared, (a) => a),
        list("Improved", c.better, (r) => `${r.account}: fixed (${r.gone.join(", ")})`),
        list("Now visible", c.revealed, (r) => `${r.account}: connected, and now shows ${r.added.join(", ")}`),
        list("New problems", c.appeared, (a) => a),
        list("Got worse", c.worse, (r) => `${r.account}: ${r.added.join(", ")}`),
        c.insights_new.length ? list("New patterns", c.insights_new, (t) => t) : null,
        c.insights_gone.length ? list("Patterns resolved", c.insights_gone, (t) => t) : null));
  }

  const insights = h("ol", { class: "g-insights" }, graph.insights.map((i) => {
    const b = h("button", { type: "button", class: "g-insight", "aria-pressed": "false", onclick: () => focusInsight(i) },
      h("span", { class: "chip2 " + ({ convergence: "bad", blind_spot: "warn", leverage: "good", concentration: "", root_cause: "warn", shared_cause: "warn", campaign: "bad" }[i.kind] || ""),
        text: BOOK && i.kind === "convergence" ? "start here" : ({ convergence: "problems meet", blind_spot: "blind spot", root_cause: "root cause", shared_cause: "shared blocker", campaign: "one campaign" }[i.kind] || i.kind) }),
      h("b", { text: i.title }), h("small", { text: i.action }));
    cards.set(i.id, b);
    return h("li", {}, b);
  }));
  const st = graph.stats;
  const change = graph.change ? since(graph.change) : null;
  return h("div", { class: "g-wrap" },
    h("div", { class: "g-main" }, h("div", { class: "g-bar" }, legend, controls), h("div", { class: "g-canvas" }, svg)),
    h("div", { class: "g-side" },
      change,
      h("h3", { text: graph.insights.length ? "What the connections say" : "No pattern stands out" }),
      h("p", { class: "fine", text: BOOK ? `${st.accounts_shown} of ${st.customers} customers share at least one story or blocker with the rest of the book.` : `${st.accounts_with_signals} accounts carry at least one signal; the ${st.accounts_shown} that matter most are drawn.${st.converging ? ` ${st.converging} have separate problems meeting on them.` : ""}` }),
      graph.insights.length ? insights : h("p", { class: "fine", text: "The signals do not cluster: each gap stands on its own, and the other views handle them one by one." }),
      panel));
}
