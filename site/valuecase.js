/**
 * The case for change, in the customer's own figures: what staying costs and what moving costs, month by month over a
 * few years, with the arithmetic shown. Every number is typed in from the conversation; nothing is a price or a quote.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
export const money = (v) => F.format(Math.round(v));

/** The inputs, grouped as they are asked. Each: key, label, unit, [min, max]. Amounts are in the customer's currency. */
export const FIELDS = [
  { group: "Staying as you are", fields: [
    ["stay_run", "What the current platform costs per year (licences, subscriptions, support)", "per year", [0, 1e10]],
    ["stay_uplift_pct", "Expected rise at the next renewal", "%", [0, 1000]],
    ["renewal_in_months", "The next renewal is in", "months", [0, 84]],
    ["stay_refresh", "Hardware refresh due if you stay", "one-off", [0, 1e10]],
    ["refresh_in_months", "The refresh is due in", "months", [0, 84]],
  ] },
  { group: "Moving", fields: [
    ["move_run", "What the new platform would cost per year", "per year", [0, 1e10]],
    ["move_once", "One-off cost of the move: services, migration, training", "one-off", [0, 1e10]],
    ["move_hardware", "Hardware bought for the move (0 if existing servers are reused)", "one-off", [0, 1e10]],
  ] },
  { group: "Running it", fields: [
    ["ops_hours_now", "Hours a month on routine work today: patching, upgrades, provisioning", "hours", [0, 1e6]],
    ["ops_hours_after", "Hours a month on the same work after the move", "hours", [0, 1e6]],
    ["hour_cost", "Cost of one hour of that work", "per hour", [0, 1e6]],
  ] },
  { group: "Downtime", fields: [
    ["downtime_cost_hour", "Cost of one hour down", "per hour", [0, 1e10]],
    ["downtime_hours_now", "Hours down per year today", "hours", [0, 8760]],
    ["downtime_hours_after", "Hours down per year expected after", "hours", [0, 8760]],
  ] },
];
const KEYS = Object.fromEntries(FIELDS.flatMap((g) => g.fields.map(([k, , , r]) => [k, r])));
export const YEARS = [1, 7];
export const CASE_DEFAULTS = { years: 3, in_readout: false };

/** Only what was typed, brought into range; blanks stay out (they count as nothing). Never throws. */
export function cleanCase(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...CASE_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(KEYS)) {
    if (a[k] === undefined || a[k] === "" || a[k] === null) continue;
    const v = Number(a[k]);
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  const y = Number(a.years);
  if (Number.isFinite(y)) out.years = Math.round(Math.min(YEARS[1], Math.max(YEARS[0], y)));
  if (typeof a.in_readout === "boolean") out.in_readout = a.in_readout;
  return out;
}

/** Stored with a workshop: own keys only, numbers in range. */
export function validCase(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) {
    if (k === "years") { if (!Number.isInteger(v) || v < YEARS[0] || v > YEARS[1]) return false; continue; }
    if (k === "in_readout") { if (typeof v !== "boolean") return false; continue; }
    if (!Object.hasOwn(KEYS, k) || typeof v !== "number" || !Number.isFinite(v) || v < KEYS[k][0] || v > KEYS[k][1]) return false;
  }
  return true;
}

const has = (a, k) => typeof a[k] === "number";
const v = (a, k) => (has(a, k) ? a[k] : 0);

/** Enough figures to say something: a cost on each side, or a saving that does not need one. */
export function hasCase(a) {
  const c = cleanCase(a);
  return has(c, "stay_run") || has(c, "move_run") || has(c, "stay_refresh") || (has(c, "hour_cost") && (has(c, "ops_hours_now") || has(c, "ops_hours_after")))
    || (has(c, "downtime_cost_hour") && (has(c, "downtime_hours_now") || has(c, "downtime_hours_after")));
}

/**
 * Month by month over the horizon: the cost of staying and of moving, each line on its own, cumulated.
 * The renewal rise starts at the renewal month; one-off costs fall in their month; a move's one-off costs fall first.
 */
export function buildCase(given) {
  const a = cleanCase(given);
  const months = a.years * 12;
  const rise = 1 + v(a, "stay_uplift_pct") / 100;
  const lines = {
    platform: { label: "The platform", stay: 0, move: 0 },
    refresh: { label: "Hardware", stay: 0, move: 0 },
    change: { label: "The move itself", stay: 0, move: 0 },
    ops: { label: "Routine work", stay: 0, move: 0 },
    downtime: { label: "Downtime", stay: 0, move: 0 },
  };
  const stayCum = [], moveCum = [];
  let s = 0, m = 0;
  for (let i = 0; i < months; i++) {
    const stayPlatform = (v(a, "stay_run") / 12) * (i >= v(a, "renewal_in_months") ? rise : 1);
    const stayRefresh = has(a, "stay_refresh") && i === Math.min(months - 1, v(a, "refresh_in_months")) && v(a, "refresh_in_months") < months ? a.stay_refresh : 0;
    const movePlatform = v(a, "move_run") / 12;
    const moveOnce = i === 0 ? v(a, "move_once") + v(a, "move_hardware") : 0;
    const opsStay = v(a, "ops_hours_now") * v(a, "hour_cost"), opsMove = (has(a, "ops_hours_after") ? a.ops_hours_after : v(a, "ops_hours_now")) * v(a, "hour_cost");
    const downStay = (v(a, "downtime_hours_now") * v(a, "downtime_cost_hour")) / 12;
    const downMove = ((has(a, "downtime_hours_after") ? a.downtime_hours_after : v(a, "downtime_hours_now")) * v(a, "downtime_cost_hour")) / 12;
    lines.platform.stay += stayPlatform; lines.platform.move += movePlatform;
    lines.refresh.stay += stayRefresh; lines.refresh.move += i === 0 ? v(a, "move_hardware") : 0;
    lines.change.move += i === 0 ? v(a, "move_once") : 0;
    lines.ops.stay += opsStay; lines.ops.move += opsMove;
    lines.downtime.stay += downStay; lines.downtime.move += downMove;
    s += stayPlatform + stayRefresh + opsStay + downStay;
    m += movePlatform + moveOnce + opsMove + downMove;
    stayCum.push(s); moveCum.push(m);
  }
  // the first month from which moving has cost no more than staying, and stays so to the end of the horizon
  let payback = null;
  for (let i = months - 1; i >= 0; i--) { if (moveCum[i] <= stayCum[i]) payback = i + 1; else break; }
  const rows = Object.values(lines).filter((l) => l.stay || l.move).map((l) => ({ ...l, stay: Math.round(l.stay), move: Math.round(l.move), diff: Math.round(l.stay - l.move) }));
  return { assumptions: a, years: a.years, months, stay: Math.round(s), move: Math.round(m), saving: Math.round(s - m), payback, rows, stayCum, moveCum,
    ok: hasCase(a) };
}

/** The case in one sentence, for the top of the card, the summary and the readout. */
export function caseLine(c) {
  if (!c.ok) return "Not enough figures yet.";
  const y = `${c.years} year${c.years === 1 ? "" : "s"}`;
  const head = `Over ${y}, staying would cost ${money(c.stay)} and moving ${money(c.move)}`;
  if (c.saving > 0) return `${head}: ${money(c.saving)} less by moving${c.payback ? `, with the move paid back by month ${c.payback}` : ""}.`;
  if (c.saving < 0) return `${head}: moving costs ${money(-c.saving)} more over this horizon. The case rests on what the figures leave out, or on a longer horizon.`;
  return `${head}: the same over this horizon.`;
}

/** What each figure means, in the order of the arithmetic: for anyone who checks the case. */
export function caseSteps(c) {
  const a = c.assumptions, out = [];
  if (has(a, "stay_run")) out.push(`Staying: ${money(a.stay_run)} a year${has(a, "stay_uplift_pct") && a.stay_uplift_pct ? `, rising ${a.stay_uplift_pct}% from month ${v(a, "renewal_in_months") + 1}` : ""}.`);
  if (has(a, "stay_refresh") && v(a, "refresh_in_months") < c.months) out.push(`A hardware refresh of ${money(a.stay_refresh)} in month ${v(a, "refresh_in_months") + 1} if nothing changes.`);
  if (has(a, "move_run")) out.push(`Moving: ${money(a.move_run)} a year for the new platform.`);
  if (has(a, "move_once") || has(a, "move_hardware")) out.push(`One-off at the start of the move: ${money(v(a, "move_once") + v(a, "move_hardware"))}${has(a, "move_hardware") ? ` (of which hardware ${money(a.move_hardware)})` : ""}.`);
  if (has(a, "hour_cost") && (has(a, "ops_hours_now") || has(a, "ops_hours_after"))) out.push(`Routine work at ${money(a.hour_cost)} an hour: ${v(a, "ops_hours_now")} hours a month today, ${has(a, "ops_hours_after") ? a.ops_hours_after : v(a, "ops_hours_now")} after.`);
  if (has(a, "downtime_cost_hour") && (has(a, "downtime_hours_now") || has(a, "downtime_hours_after"))) out.push(`Downtime at ${money(a.downtime_cost_hour)} an hour: ${v(a, "downtime_hours_now")} hours a year today, ${has(a, "downtime_hours_after") ? a.downtime_hours_after : v(a, "downtime_hours_now")} after.`);
  return out;
}

/** The case in Markdown, for finance and the account team. */
export function caseMarkdown(c) {
  const out = ["### The case for change, in the customer's figures", "", caseLine(c), "", "| Cost | Staying | Moving | Difference |", "|---|---|---|---|"];
  for (const r of c.rows) out.push(`| ${r.label} | ${money(r.stay)} | ${money(r.move)} | ${money(r.diff)} |`);
  out.push(`| **Total over ${c.years} year${c.years === 1 ? "" : "s"}** | **${money(c.stay)}** | **${money(c.move)}** | **${money(c.saving)}** |`, "", ...caseSteps(c).map((x) => `- ${x}`), "",
    "_Every figure was given by the customer or agreed with them; the arithmetic is shown. It is not a quote._");
  return out.join("\n");
}

/** Hourly figures heard in the workshop, to offer as the cost of an hour down: per hour as said, per day as a 24th. */
export function hourlyFrom(figures) {
  return (figures || []).filter((f) => f && Number.isFinite(f.amount) && (f.per === "hour" || f.per === "day"))
    .map((f) => ({ ...f, hourly: f.per === "hour" ? f.amount : Math.round(f.amount / 24) }));
}
