// Small DOM helpers. Text always goes in as text, never as markup, so nothing in a customer's files can inject anything.
const SVGNS = "http://www.w3.org/2000/svg";

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, kids);
  return el;
}

export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, String(v));
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(d) + "%");
export const pts = (x, d = 1) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d) + " pts";
export const num = (x) => Math.round(x).toLocaleString("en");
export const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** A spreadsheet treats a cell that starts with = + - @ as a formula. Prefix those so an exported value stays a value. */
export function csvCell(v) {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
export function toCsv(columns, rows) {
  return [columns.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => columns.map((c) => csvCell(c.csv ? c.csv(r) : r[c.key])).join(","))].join("\n") + "\n";
}

export function saveBlob(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function chip(text, kind = "") { return h("span", { class: "chip2 " + kind, text }); }

/**
 * A sortable, filterable table over plain rows. Columns: {key, label, num?, render?(row)->Node|string, sort?(row)->value, csv?(row)}.
 * Returns {el, setFilter(fn), rows()} so a view can put its own controls around it.
 */
export function dataTable({ columns, rows, pageSize = 50, empty = "Nothing matches.", expand = null, label = "Table" }) {
  let sortKey = null, sortDir = 1, filter = () => true, shown = pageSize, open = new Set();
  const wrap = h("div", { class: "tablewrap" });
  const info = h("p", { class: "note", role: "status" });
  const more = h("button", { class: "btn small", type: "button", text: "Show more" });
  const table = h("table", { class: "dt", "aria-label": label });
  wrap.append(table, info, more);

  const visible = () => {
    const r = rows.filter(filter);
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      const val = col.sort || ((x) => x[col.key]);
      r.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
    }
    return r;
  };

  function draw() {
    const all = visible();
    const head = h("tr", {}, expand ? h("th", { class: "x" }, h("span", { class: "sr", text: "Details" })) : null, columns.map((c) => {
      const th = h("th", { class: c.num ? "n" : "", scope: "col", "aria-sort": sortKey === c.key ? (sortDir > 0 ? "ascending" : "descending") : "none" });
      const b = h("button", { type: "button", class: "sortbtn", text: c.label + (sortKey === c.key ? (sortDir > 0 ? " ▲" : " ▼") : "") });
      b.addEventListener("click", () => { if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = 1; } shown = pageSize; draw(); });
      th.append(b);
      return th;
    }));
    const body = h("tbody");
    for (const r of all.slice(0, shown)) {
      const id = r.id ?? r.key ?? all.indexOf(r);
      const tr = h("tr", { class: open.has(id) ? "open" : "" });
      if (expand) {
        const t = h("button", { type: "button", class: "twisty", "aria-expanded": String(open.has(id)), "aria-label": "Details", text: open.has(id) ? "▾" : "▸" });
        t.addEventListener("click", () => { open.has(id) ? open.delete(id) : open.add(id); draw(); });
        tr.append(h("td", { class: "x" }, t));
      }
      for (const c of columns) tr.append(h("td", { class: c.num ? "n" : "" }, c.render ? c.render(r) : r[c.key]));
      body.append(tr);
      if (expand && open.has(id)) body.append(h("tr", { class: "detail" }, h("td", { colspan: columns.length + 1 }, expand(r))));
    }
    if (!all.length) body.append(h("tr", {}, h("td", { colspan: columns.length + (expand ? 1 : 0), class: "emptycell", text: empty })));
    table.replaceChildren(h("thead", {}, head), body);
    info.textContent = `${Math.min(shown, all.length)} of ${all.length}${all.length !== rows.length ? ` (filtered from ${rows.length})` : ""}`;
    more.hidden = shown >= all.length;
  }
  more.addEventListener("click", () => { shown += pageSize; draw(); });
  draw();
  return { el: wrap, setFilter(fn) { filter = fn; shown = pageSize; draw(); }, rows: visible, columns };
}

/** A row of toggle chips; `onChange(Set)` gets the selected values. Empty selection means "all". */
export function chipFilter(label, values, onChange) {
  const sel = new Set();
  const box = h("div", { class: "chipfilter", role: "group", "aria-label": label }, h("span", { class: "cflabel", text: label }));
  for (const v of values) {
    const b = h("button", { type: "button", class: "tog", "aria-pressed": "false", text: v.label ?? v });
    b.addEventListener("click", () => { const k = v.value ?? v; sel.has(k) ? sel.delete(k) : sel.add(k); b.setAttribute("aria-pressed", String(sel.has(k))); onChange(sel); });
    box.append(b);
  }
  return box;
}

export function searchBox(placeholder, onInput) {
  const i = h("input", { type: "search", class: "search", placeholder, "aria-label": placeholder });
  i.addEventListener("input", () => onInput(i.value.trim().toLowerCase()));
  return i;
}

// A small set of line icons drawn for this app, so the interface needs no icon font and no request.
const ICONS = {
  overview: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/>',
  prep: '<path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  actions: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  accounts: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  findings: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5M12 16h.01"/>',
  news: '<path d="M5 4h11v16H7a2 2 0 0 1-2-2z"/><path d="M16 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3"/>',
  planview: '<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/>',
  maturity: '<circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2 4 2-1-7.5"/>',
  renewal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  changes: '<path d="M7 7h10l-3-3M17 17H7l3 3"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  week: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 14h3M13 14h3M8 17h3"/>',
  bookmap: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
  onboarding: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
};
export function icon(name, size = 18) {
  const el = document.createElementNS(SVGNS, "svg");
  el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("width", size); el.setAttribute("height", size);
  el.setAttribute("fill", "none"); el.setAttribute("stroke", "currentColor"); el.setAttribute("stroke-width", "1.8");
  el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round"); el.setAttribute("aria-hidden", "true"); el.setAttribute("class", "ico");
  // The markup above is ours and fixed; it is turned into elements without parsing HTML, which Trusted Types would rightly refuse.
  for (const m of (ICONS[name] || "").matchAll(/<(path|circle|rect)\s+([^>]*?)\/>/g)) {
    const node = document.createElementNS(SVGNS, m[1]);
    for (const at of m[2].matchAll(/([a-z-]+)="([^"]*)"/g)) node.setAttribute(at[1], at[2]);
    el.append(node);
  }
  return el;
}
