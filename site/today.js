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
