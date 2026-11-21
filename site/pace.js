// The meeting's clock: how long is left, and whether the essential questions still fit in it.
//
// A clock starts with a tap (30, 45 or 60 minutes) and lives in the browser tab, not in the workshop: it is the
// meeting's, not the customer's. The pace compares the share of essential questions asked with the share of the
// time gone, with a little slack, and says it in one line. No DOM, so Node can test it.

export const LENGTHS = [30, 45, 60];
const SLACK = 0.1;          // ten points behind the time is still on pace: the first minutes go on introductions

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Minutes and seconds, as a clock shows them: 7:05. */
export function mmss(seconds) {
  const s = Math.max(0, Math.floor(Math.abs(seconds)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A clock as kept: started at a time, for a number of minutes. */
export function validClock(c) {
  return !!c && typeof c === "object" && Number.isFinite(c.start) && c.start > 0 && Number.isInteger(c.minutes) && c.minutes >= 5 && c.minutes <= 240;
}

/** Where the clock is at `now` (milliseconds): seconds gone, seconds left (below zero once over). */
export function reading(c, now) {
  const elapsed = Math.max(0, Math.floor((now - c.start) / 1000));
  return { elapsed, left: c.minutes * 60 - elapsed, timeShare: Math.min(1, elapsed / (c.minutes * 60)) };
}

/**
 * Whether the essential questions fit in the time left.
 * @param {{minutes:number}} c the clock
 * @param {number} elapsed seconds gone
 * @param {number} essentials how many essential questions the meeting has
 * @param {number} covered how many of them have an answer, nobody knows included: they were asked
 * @returns {{state:"none"|"done"|"over"|"on"|"behind", line:string, share:number, timeShare:number, open:number}}
 */
export function pace(c, elapsed, essentials, covered) {
  const total = c.minutes * 60, left = total - elapsed;
  const timeShare = Math.min(1, Math.max(0, elapsed / total));
  const open = Math.max(0, essentials - covered);
  const share = essentials ? Math.min(1, covered / essentials) : 1;
  const mins = Math.max(0, Math.floor(left / 60));
  const at = (state, line) => ({ state, line, share, timeShare, open });
  if (!essentials) return at("none", "No essential question in scope: the clock just keeps the time.");
  if (!open) return at("done", "Every essential question is asked. Use the time left to go deeper.");
  if (left <= 0) return at("over", `Over time, with ${plural(open, "essential question")} still open: agree a follow-up before you leave.`);
  if (share + SLACK >= timeShare) return at("on", `On pace: ${plural(open, "essential question")} left, ${plural(mins, "minute")} to go.`);
  const each = mins >= open ? `about ${plural(Math.floor(mins / open), "minute")} each` : "less than a minute each";
  return at("behind", `Behind: ${plural(open, "essential question")} in ${plural(mins, "minute")}, ${each}.`);
}
