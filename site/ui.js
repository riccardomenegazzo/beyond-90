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
