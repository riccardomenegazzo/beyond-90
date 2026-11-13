// Keyboard shortcuts for people who live in the tool. Two-key "g then letter" jumps, [ and ] to step through the menu,
// ? for the list. Pure: the caller passes keys in and gets a decision out.

export const JUMPS = { t: "today", o: "overview", a: "actions", f: "findings", c: "accounts", b: "burndown", p: "prep", m: "commitments", v: "pov", w: "week" };
export const LIST = [
  ["g then t", "Today"], ["g then o", "Overview"], ["g then a", "Actions"], ["g then f", "Findings"], ["g then c", "Accounts"],
  ["g then b", "Risk burn-down"], ["g then p", "Prep a call"], ["g then m", "Promises"], ["g then v", "Proof of value"], ["g then w", "This week (book)"],
  ["[ and ]", "Previous and next view in the menu"], ["/ or Ctrl K", "Search and jump"], ["?", "This list"],
];

/** True when the key press belongs to a field the person is typing in. */
export function typing(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || !!target.isContentEditable;
}

/**
 * Decide what a key does. `pending` is true right after a "g". Returns {action, pending}:
 * action is null, {go: id}, {step: -1|1}, {help: true} or {search: true}.
 */
export function decide(key, { pending = false, mods = false } = {}) {
  if (mods) return { action: null, pending: false };
  if (pending) return { action: JUMPS[key] ? { go: JUMPS[key] } : null, pending: false };
  if (key === "g") return { action: null, pending: true };
  if (key === "[") return { action: { step: -1 }, pending: false };
  if (key === "]") return { action: { step: 1 }, pending: false };
  if (key === "?") return { action: { help: true }, pending: false };
  if (key === "/") return { action: { search: true }, pending: false };
  return { action: null, pending: false };
}

/** The view before or after `current` in the menu order, wrapping around. */
export function stepView(ids, current, dir) {
  if (!ids.length) return null;
  const i = ids.indexOf(current);
  return ids[((i < 0 ? 0 : i + dir) + ids.length) % ids.length];
}
