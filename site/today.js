// The first screen: one sentence on where the customer stands, three things to do, one thing to watch. No DOM, no storage.
// It says nothing the numbers do not support: a stage that has no value is skipped, and it never promises a date.

const NAMES = { L1: "Connected", L2: "Inventoried", L3: "Controls on", L4: "Findings decided" };
const pct = (v) => `${(v * 100).toFixed(1)}%`;

/** The stage that holds the score down most, or null when no stage has a value. */
export function weakest(stages) {
  let best = null;
  for (const k of Object.keys(NAMES)) {
    const v = stages && stages[k] && stages[k].value;
    if (typeof v === "number" && Number.isFinite(v) && (best === null || v < best.value)) best = { stage: k, name: NAMES[k], value: v };
  }
  return best;
}

/** One or two sentences for the top of the page. `target` is a share (0.9 means 90%). */
export function headline({ customer, yield: y, target, stages, openActions }) {
  if (typeof y !== "number" || !Number.isFinite(y)) return `There is not enough data to give ${customer} a score yet.`;
  const w = weakest(stages), goal = typeof target === "number" && target > 0 ? target : 0.9;
  const gap = goal - y;
  const first = gap <= 0 ? `${customer} is at ${pct(y)}, above its ${Math.round(goal * 100)}% target.`
    : `${customer} is at ${pct(y)}, ${(gap * 100).toFixed(1)} points short of its ${Math.round(goal * 100)}% target.`;
  const second = w ? ` The stage holding it down most is ${w.name.toLowerCase()} (${w.stage}), at ${pct(w.value)}.` : "";
  const third = openActions === 0 ? " Nothing is waiting to be done." : "";
  return first + second + third;
}

// The first minute: three things to do with what is on screen, in order. Plain data, so it can be tested.
export function firstMinute(openActions) {
  const steps = [
    { id: "read", text: "Read the sentence at the top. It says where the customer stands and what moves it most.", to: null },
    openActions > 0
      ? { id: "act", text: `Open the first of your ${openActions} actions and copy it as a ticket.`, to: "actions", cta: "Open actions" }
      : { id: "act", text: "Nothing is waiting to be done. Look at the full picture instead.", to: "overview", cta: "Open overview" },
    { id: "call", text: "Before the next call, open Prepare the call. It lists what to say and what to ask.", to: "prep", cta: "Prepare the call" },
  ];
  return steps;
}

/** Rank actions two ways: by the biggest effect (the engine's order) or by points per hour (quick wins). */
export function rankActions(actions, mode = "effect", n = 3) {
  const list = (actions || []).slice();
  if (mode === "quick") list.sort((a, b) => (b.effect / Math.max(b.hours || 0, 0.25)) - (a.effect / Math.max(a.hours || 0, 0.25)) || b.effect - a.effect);
  return list.slice(0, n);
}

/** The multiplication behind Yield, written out: "90% × 97% × 93% × 89% = 73%". */
export function chainText(bars, total) {
  const p = (v) => `${Math.round(v * 100)}%`;
  if (!bars || !bars.length) return "";
  return `${bars.map((b) => p(b.value)).join(" × ")} = ${p(total)}`;
}

/**
 * What the actions marked done this session add up to. Effects overlap, so the sum is an upper estimate: the next data
 * load gives the true figure. Returns {n, points, projected} with projected capped at 100%.
 */
export function doneSummary(actions, doneIds, yieldNow) {
  const done = (actions || []).filter((a) => doneIds && doneIds.has(a.id));
  const points = done.reduce((s, a) => s + (Number(a.effect) || 0), 0);
  return { n: done.length, points, projected: Math.min(1, (Number(yieldNow) || 0) + points / 100) };
}

/** The end-to-end chain as segments of one bar: those that pass every stage, then where the others first stop. */
export function funnelSegments(e) {
  if (!e || !e.total) return [];
  const names = { L1: "stop at connected", L2: "stop at seen", L3: "stop at switched on", L4: "stop at decided" };
  const segs = [{ id: "through", label: "pass every stage", n: e.through }]
    .concat(["L1", "L2", "L3", "L4"].map((k) => ({ id: k, label: names[k], n: (e.first_break || {})[k] || 0 })));
  return segs.filter((s) => s.n > 0).map((s) => ({ ...s, share: s.n / e.total }));
}
