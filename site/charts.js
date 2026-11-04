// Charts as SVG built from numbers. Colours come from CSS variables, so light, dark and print all work; every chart
// has a text alternative and the numbers are always also available in a table or a label.
import { s, h, pct } from "./ui.js";

export const STAGE = { L1: "var(--s1)", L2: "var(--s2)", L3: "var(--s3)", L4: "var(--s4)" };
export const STAGE_NAME = { L1: "Connected", L2: "Inventoried", L3: "Controls on", L4: "Findings decided" };

/** Ring gauge for a 0..1 value, with checkpoint ticks and an optional marker (the legacy figure). */
export function gauge({ value, marker = null, ticks = [0.9, 0.95, 0.98], size = 220, label = "Yield" }) {
  const r = 84, c = size / 2, W = 14, start = 135, sweep = 270;
  const pt = (f, rad = r) => { const a = ((start + sweep * f) * Math.PI) / 180; return [c + rad * Math.cos(a), c + rad * Math.sin(a)]; };
  const arc = (f0, f1) => { const [x0, y0] = pt(f0), [x1, y1] = pt(f1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${(f1 - f0) * sweep > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const v = Math.max(0, Math.min(1, value));
  const svg = s("svg", { viewBox: `0 0 ${size} ${size * 0.86}`, class: "gauge", role: "img", "aria-label": `${label} ${pct(value)}${marker != null ? `; the legacy metric says ${pct(marker)}` : ""}` });
  svg.append(s("path", { d: arc(0, 1), fill: "none", stroke: "var(--grid)", "stroke-width": W, "stroke-linecap": "round" }));
  if (v > 0.002) svg.append(s("path", { d: arc(0, v), fill: "none", stroke: "var(--accent)", "stroke-width": W, "stroke-linecap": "round", class: "gauge-fill" }));
  for (const t of ticks) {
    const [x0, y0] = pt(t, r - W / 2 - 3), [x1, y1] = pt(t, r + W / 2 + 3), [lx, ly] = pt(t, r + 20);
    svg.append(s("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "var(--ink2)", "stroke-width": 1.5 }));
    svg.append(s("text", { x: lx, y: ly + 4, "text-anchor": "middle", class: "tick" }, String(Math.round(t * 100))));
  }
  if (marker != null) {
    const [x0, y0] = pt(marker, r - W / 2 - 6), [x1, y1] = pt(marker, r + W / 2 + 6);
    svg.append(s("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "var(--ink)", "stroke-width": 2.5, "stroke-dasharray": "3 2" }, s("title", {}, `Legacy metric ${pct(marker)}`)));
  }
  svg.append(s("text", { x: c, y: c + 8, "text-anchor": "middle", class: "gauge-num" }, (value * 100).toFixed(1)));
  svg.append(s("text", { x: c, y: c + 30, "text-anchor": "middle", class: "gauge-cap" }, label + " %"));
  return svg;
}

/** Horizontal waterfall: 100% → after L1 → … → Yield. Each bar is the share kept; the hatched part is what that stage cost. */
export function waterfall(stages) {
  const order = ["L1", "L2", "L3", "L4"], W = 540, rowH = 46, left = 126, right = 70, H = rowH * 4 + 24;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Yield after each stage: " + order.map((k) => `${k} ${pct(stages[k].value)}`).join(", ") });
  const x = (f) => left + f * (W - left - right);
  svg.append(s("defs", {}, s("pattern", { id: "hatch2", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, s("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--ink2)", "stroke-width": 1.4 }))));
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(s("line", { x1: x(f), x2: x(f), y1: 4, y2: H - 20, stroke: "var(--grid)" }), s("text", { x: x(f), y: H - 6, "text-anchor": "middle", class: "tick" }, Math.round(f * 100) + "%"));
  }
  let acc = 1;
  order.forEach((k, i) => {
    const st = stages[k], after = acc * st.value, y = 8 + i * rowH;
    svg.append(s("text", { x: 0, y: y + 17, class: "lbl" }, k + "  " + STAGE_NAME[k]), s("text", { x: 0, y: y + 33, class: "sub" }, `${st.numerator} of ${st.denominator}`));
    const g = s("g", {}, s("title", {}, `${k}: ${pct(st.value)} pass (${st.numerator}/${st.denominator}); Yield after this stage ${pct(after)}`));
    g.append(s("rect", { x: x(0), y, width: x(after) - x(0), height: 26, rx: 4, fill: STAGE[k], class: "grow", style: `animation-delay:${i * 90}ms` }));
    if (acc - after > 0.0005) g.append(s("rect", { x: x(after), y, width: x(acc) - x(after), height: 26, rx: 4, fill: "url(#hatch2)", stroke: "var(--ink2)", "stroke-width": 0.8 }));
    g.append(s("text", { x: Math.max(x(0) + 6, x(after) - 6), y: y + 18, "text-anchor": x(after) - x(0) > 60 ? "end" : "start", class: "bar-val", fill: x(after) - x(0) > 60 ? "var(--on)" : "var(--ink)" }, pct(after)));
    if (acc - after > 0.0005) g.append(s("text", { x: x(acc) + 6, y: y + 18, class: "sub" }, "−" + ((acc - after) * 100).toFixed(1)));
    svg.append(g);
    acc = after;
  });
  return svg;
}

/** Yield by week. `series` = [{label, points:[[x,y]], dashed?, color?}]; `marks` = horizontal reference lines [{y, label}]. */
export function lineChart({ series, marks = [], xLabel = "week", yMin = null, yMax = 1, W = 560, H = 250, milestones = [] }) {
  const pad = { l: 44, r: 14, t: 12, b: 30 };
  const xs = series.flatMap((q) => q.points.map((p) => p[0])), ys = series.flatMap((q) => q.points.map((p) => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1);
  let lo = yMin ?? Math.max(0, Math.floor((Math.min(...ys, ...marks.map((m) => m.y)) - 0.05) * 20) / 20);
  const hi = Math.min(1, Math.max(yMax, ...ys)), X = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r), Y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": series.map((q) => `${q.label}: from ${pct(q.points[0][1])} to ${pct(q.points.at(-1)[1])}`).join("; ") });
  const step = (hi - lo) > 0.4 ? 0.1 : 0.05;
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: "var(--grid)" }), s("text", { x: pad.l - 6, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, Math.round(v * 100) + "%"));
  const xt = Math.max(1, Math.round((x1 - x0) / 8));
  for (let v = x0; v <= x1; v += xt) svg.append(s("text", { x: X(v), y: H - 10, "text-anchor": "middle", class: "tick" }, String(v)));
  svg.append(s("text", { x: W - pad.r, y: H - 0, "text-anchor": "end", class: "tick" }, xLabel));
  for (const m of marks) if (m.y >= lo && m.y <= hi) svg.append(s("line", { x1: pad.l, x2: W - pad.r, y1: Y(m.y), y2: Y(m.y), stroke: "var(--ink2)", "stroke-dasharray": "4 4" }), s("text", { x: W - pad.r - 2, y: Y(m.y) - 4, "text-anchor": "end", class: "tick" }, m.label));
  for (const ms of milestones) if (ms.x != null) svg.append(s("line", { x1: X(ms.x), x2: X(ms.x), y1: pad.t, y2: H - pad.b, stroke: "var(--accent)", "stroke-dasharray": "2 4" }), s("circle", { cx: X(ms.x), cy: Y(ms.y), r: 4.5, fill: "var(--accent)" }, s("title", {}, ms.label)));
  series.forEach((q, i) => {
    const d = q.points.map((p, j) => `${j ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ");
    if (i === 0 && !q.dashed) svg.append(s("path", { d: d + ` L${X(q.points.at(-1)[0])} ${Y(lo)} L${X(q.points[0][0])} ${Y(lo)} Z`, fill: q.color || "var(--accent)", opacity: 0.1 }));
    svg.append(s("path", { d, fill: "none", stroke: q.color || "var(--accent)", "stroke-width": q.dashed ? 1.8 : 2.6, "stroke-dasharray": q.dashed ? "6 4" : null, "stroke-linejoin": "round", "stroke-linecap": "round" }, s("title", {}, q.label)));
  });
  return svg;
}

/** Diverging bars for contributions in points (positive right, negative left). */
export function contributions(items) {
  const W = 640, rowH = 34, H = items.length * rowH + 12, mid = 372, left = 8;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.points)));
  const sc = 190 / max;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Contribution of each factor to the change in Yield: " + items.map((i) => `${i.label} ${i.points.toFixed(1)} points`).join("; ") });
  svg.append(s("line", { x1: mid, x2: mid, y1: 0, y2: H, stroke: "var(--ink2)" }));
  items.forEach((it, i) => {
    const y = 6 + i * rowH, w = Math.abs(it.points) * sc, pos = it.points >= 0;
    svg.append(s("text", { x: left, y: y + 17, class: "lbl" }, it.label));
    svg.append(s("rect", { x: pos ? mid : mid - w, y: y + 3, width: Math.max(1, w), height: 20, rx: 3, fill: pos ? "var(--pos)" : "var(--neg)", opacity: it.kind === "bar" ? 0.55 : 1 }, s("title", {}, `${it.label}: ${it.points.toFixed(2)} points`)));
    svg.append(s("text", { x: pos ? mid + w + 6 : mid - w - 6, y: y + 18, "text-anchor": pos ? "start" : "end", class: "bar-val" }, (pos ? "+" : "−") + Math.abs(it.points).toFixed(1)));
  });
  return svg;
}

/** Jobs on a timeline: one bar from the week work starts to the week it lands. */
export function timeline(jobs, weeks) {
  const W = 640, rowH = 26, pad = { l: 250, r: 12, t: 6, b: 24 }, list = jobs.slice(0, 14), H = pad.t + pad.b + list.length * rowH;
  const X = (w) => pad.l + (w / Math.max(weeks, 1)) * (W - pad.l - pad.r);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Timeline of the first jobs in the plan" });
  const step = weeks > 30 ? 8 : weeks > 14 ? 4 : 2;
  for (let w = 0; w <= weeks; w += step) svg.append(s("line", { x1: X(w), x2: X(w), y1: pad.t, y2: H - pad.b, stroke: "var(--grid)" }), s("text", { x: X(w), y: H - 8, "text-anchor": "middle", class: "tick" }, String(w)));
  list.forEach((j, i) => {
    const y = pad.t + i * rowH, a = Math.max(0, j.started_week - 1), b = Math.max(a + 0.6, j.done_week);
    const t = j.title.length > 38 ? j.title.slice(0, 37) + "…" : j.title;
    svg.append(s("text", { x: pad.l - 8, y: y + 16, "text-anchor": "end", class: "lbl small" }, t));
    svg.append(s("rect", { x: X(a), y: y + 4, width: Math.max(4, X(b) - X(a)), height: 16, rx: 4, fill: STAGE[j.leak] || "var(--accent)" }, s("title", {}, `${j.title}\n${j.hours.toFixed(1)} h, weeks ${j.started_week}–${j.done_week}, +${j.steady_gain_points.toFixed(1)} pts`)));
  });
  return svg;
}

/** Onboarding funnel: how many units reached each stage, and how many stopped there. */
export function funnel(stages) {
  const W = 560, rowH = 36, left = 150, right = 70, H = stages.length * rowH + 8, total = Math.max(1, stages[0].reached);
  const X = (n) => (n / total) * (W - left - right);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "Onboarding funnel: " + stages.map((st) => `${st.label} ${st.reached}`).join(", ") });
  stages.forEach((st, i) => {
    const y = 4 + i * rowH, w = Math.max(2, X(st.reached)), lost = i ? stages[i - 1].reached - st.reached : 0;
    svg.append(s("text", { x: 0, y: y + 18, class: "lbl" }, st.label));
    svg.append(s("rect", { x: left, y: y + 4, width: X(total), height: 20, rx: 5, fill: "var(--grid)" }));
    svg.append(s("rect", { x: left, y: y + 4, width: w, height: 20, rx: 5, fill: i === stages.length - 1 ? "var(--pos)" : "var(--accent)", class: "grow", style: `animation-delay:${i * 70}ms` }, s("title", {}, `${st.label}: ${st.reached} of ${total}`)));
    svg.append(s("text", { x: left + w + 6, y: y + 18, class: "bar-val" }, String(st.reached)));
    if (lost > 0) svg.append(s("text", { x: W - 2, y: y + 18, "text-anchor": "end", class: "sub" }, `−${lost}`));
  });
  return svg;
}

/** A tiny trend line for tiles. */
export function spark(values, w = 90, hgt = 26) {
  if (values.length < 2) return h("span");
  const lo = Math.min(...values), hi = Math.max(...values), X = (i) => 2 + (i / (values.length - 1)) * (w - 4), Y = (v) => 2 + (1 - (v - lo) / (hi - lo || 1)) * (hgt - 4);
  return s("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: "spark", "aria-hidden": "true" }, s("path", { d: values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" "), fill: "none", stroke: "var(--accent)", "stroke-width": 2 }));
}

/** Stacked share bar: parts = [{label, value, color}]. */
export function shareBar(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const bar = h("div", { class: "sharebar", role: "img", "aria-label": parts.map((p) => `${p.label} ${p.value}`).join(", ") });
  for (const p of parts) if (p.value > 0) bar.append(h("span", { style: `flex:${p.value / total};background:${p.color}`, title: `${p.label}: ${p.value}` }));
  return bar;
}
