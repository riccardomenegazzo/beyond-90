// One question at a time: the discovery questions as a deck of cards, answered with a gesture, a tap or a key.
//
// The deck is the questions the meeting is narrowed to, in the order the list shows them, starting at the first one
// with no answer. A card is answered by swiping it (right: solved, left: a real gap, up: partly, down: nobody knows),
// by its buttons, or by the arrow keys and 1 to 4. What the customer said is written on the card, and the words
// suggest an answer, which the person takes or ignores: the suggestion never answers on its own.
//
// No DOM, so Node can test it. Nothing here leaves the browser: the suggestion is a few word patterns, read locally.
import { displayOrder, ROLE_WORDS } from "./questions.js";

/** The four answers, in the order of their keys (1 to 4) and of the buttons, with the direction that gives each. */
export const DIRECTIONS = {
  solved: { dx: 1, dy: 0, key: "ArrowRight", arrow: "right" },
  partly: { dx: 0, dy: -1, key: "ArrowUp", arrow: "up" },
  gap: { dx: -1, dy: 0, key: "ArrowLeft", arrow: "left" },
  unknown: { dx: 0, dy: 1, key: "ArrowDown", arrow: "down" },
};
export const ORDER = Object.keys(DIRECTIONS);
export const THRESHOLD = 90;     // how far a card travels, in pixels, before letting go answers it
export const HINT_FROM = 24;     // how far it travels before the answer it is heading for shows on it
export const TONE = { solved: "good", partly: "mid", gap: "bad", unknown: "unknown" };

/** Where a card is heading: the main axis of the drag decides. */
export function heading(dx, dy) {
  if (!dx && !dy) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "solved" : "gap";
  return dy < 0 ? "partly" : "unknown";
}

/** The answer a drag gives when the card is let go, or null when it has not travelled far enough. */
export function released(dx, dy, threshold = THRESHOLD) {
  return Math.hypot(dx, dy) >= threshold ? heading(dx, dy) : null;
}

/** How strongly the answer shows on the card while it is dragged, from 0 to 1. */
export function hintStrength(dx, dy) {
  const d = Math.hypot(dx, dy);
  return d <= HINT_FROM ? 0 : Math.min(1, (d - HINT_FROM) / (THRESHOLD - HINT_FROM));
}

/** The answer a key gives: an arrow, or 1 to 4 as in the list. */
export function forKey(key) {
  if (/^[1-4]$/.test(key)) return ORDER[Number(key) - 1];
  return ORDER.find((a) => DIRECTIONS[a].key === key) || null;
}

/**
 * The deck for this meeting: every question of the lines in scope that `keep` lets through, line by line, in the order
 * the list shows them.
 * @param {{lines:Record<string,{label:string, questions:object[]}>}} catalog
 * @param {string[]} scope
 * @param {(key:string, q:object) => boolean} keep
 */
export function deckFrom(catalog, scope, keep = () => true) {
  const cards = [];
  for (const p of scope) {
    const line = catalog.lines[p];
    if (!line) continue;
    for (const { q, index } of displayOrder(line)) {
      const key = `${p}#${index}`;
      if (keep(key, q)) cards.push({ key, line: p, index, label: line.label, q });
    }
  }
  return cards;
}

/** Where to start: the first card with no answer, else the first card. */
export function firstOpen(cards, answers) {
  const i = cards.findIndex((c) => !answers[c.key]);
  return i < 0 ? 0 : i;
}

/** The next card with no answer after `at`, going round to the top; -1 when every card is answered. */
export function nextOpen(cards, answers, at) {
  for (let k = 1; k <= cards.length; k++) {
    const i = (at + k) % cards.length;
    if (!answers[cards[i].key]) return i;
  }
  return -1;
}

// what the customer said, read for an answer: a few patterns, in order of how much they settle
const UNSURE = /(not sure|don.?t know|do not know|no idea|nobody knows|no one knows|unclear|maybe|i think|probably|need to check|to be checked)/;
const SAFE = /(immutable|cannot|can.?t|locked|nobody can|no one can|second approver|two approvers|read.only)/;
const UNSAFE = /( can | could | any |anyone|wipe|delete|yes)/;
const PARTLY = /( some | partly| only | half| most | a few| but | in part)/;
const GAP = /(never|\bno |none|nobody|no one|not |don.?t|doesn.?t|isn.?t|aren.?t|haven.?t|hasn.?t|years ago|by hand|manual)/;
const SOLVED = /(\byes\b|every|always|quarterly|monthly|weekly|tested|agreed|documented|automated|signed off)/;
// a question a "yes" answers badly: could someone delete, wipe or erase what protects them
const INVERTED = /\b(could|can)\b[^?]{0,60}\b(delete|wipe|erase)\b/i;
const LATENCY = /round-trip|latency/i;
const MS = /(\d+(?:[.,]\d+)?)\s?(?:ms|milliseconds?)\b/;

/**
 * The answer the customer's words suggest, or null when they settle nothing. A round trip under about five
 * milliseconds allows copies with no data loss, as the disaster recovery questions say.
 * @param {{q:string}} question
 * @param {string} said
 * @returns {"solved"|"partly"|"gap"|"unknown"|null}
 */
export function suggest(question, said) {
  const words = String(said == null ? "" : said).trim();
  if (words.length < 4) return null;
  const t = ` ${words.toLowerCase()} `;
  if (UNSURE.test(t)) return "unknown";
  const q = String((question && question.q) || "");
  if (LATENCY.test(q)) {
    const m = t.match(MS);
    if (m) return parseFloat(m[1].replace(",", ".")) < 5 ? "solved" : "partly";
  }
  if (INVERTED.test(q)) {
    if (SAFE.test(t)) return "solved";
    if (UNSAFE.test(t)) return "gap";
  }
  if (PARTLY.test(t)) return "partly";
  if (GAP.test(t)) return "gap";
  if (SOLVED.test(t)) return "solved";
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Where the deck leaves the meeting: how many of each answer, the gaps and the unknowns with what was said, and a
 * line to read first.
 */
export function deckSummary(cards, answers) {
  const counts = { solved: 0, partly: 0, gap: 0, unknown: 0, open: 0 };
  const said = (c) => ({ key: c.key, label: c.label, q: c.q.q, note: (answers[c.key] && answers[c.key].note) || "" });
  const gaps = [], unknown = [];
  for (const c of cards) {
    const a = answers[c.key];
    if (!a) { counts.open += 1; continue; }
    counts[a.a] += 1;
    if (a.a === "gap") gaps.push(said(c));
    if (a.a === "unknown") unknown.push(said(c));
  }
  const parts = [plural(counts.gap, "real gap", "real gaps"), `${counts.unknown} nobody could answer`];
  const head = `${parts.join(", ")}${counts.open ? `, ${counts.open} still to ask` : ""}.`;
  return { counts, gaps, unknown, head, total: cards.length };
}

// ---------- answer sets: any few answers laid on the four directions of a swipe
const ARROWS = {
  right: { dx: 1, dy: 0, key: "ArrowRight" },
  up: { dx: 0, dy: -1, key: "ArrowUp" },
  left: { dx: -1, dy: 0, key: "ArrowLeft" },
  down: { dx: 0, dy: 1, key: "ArrowDown" },
};

/** Where a drag is heading: the main axis decides. */
export function direction(dx, dy) {
  if (!dx && !dy) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy < 0 ? "up" : "down";
}

/**
 * A set of answers, each on a direction, in the order of their keys (1, 2, 3...) and of the buttons.
 * @param {Record<string, "right"|"up"|"left"|"down">} dirs
 */
export function answerSet(dirs) {
  const order = Object.keys(dirs);
  const byDir = Object.fromEntries(order.map((k) => [dirs[k], k]));
  const byKey = Object.fromEntries(order.map((k) => [ARROWS[dirs[k]].key, k]));
  return {
    order,
    dir: (k) => ({ ...ARROWS[dirs[k]], arrow: dirs[k] }),
    toward: (dx, dy) => byDir[direction(dx, dy)] || null,
    released: (dx, dy, threshold = THRESHOLD) => (Math.hypot(dx, dy) >= threshold ? byDir[direction(dx, dy)] || null : null),
    fromKey: (key) => (/^[1-9]$/.test(key) ? order[Number(key) - 1] || null : byKey[key] || null),
  };
}

/** The discovery answers: right solved, up partly, left a real gap, down nobody knows. */
export const DISCOVERY = answerSet({ solved: "right", partly: "up", gap: "left", unknown: "down" });
/** The qualification answers: right known, up partly, left not yet. */
export const QUALIFY = answerSet({ known: "right", partly: "up", unknown: "left" });

/** How many of each answer, and the cards under each with what was said; `answerOf` gives a card's answer or nothing. */
export function tally(cards, answerOf, order) {
  const counts = Object.fromEntries([...order, "open"].map((k) => [k, 0]));
  const under = Object.fromEntries(order.map((k) => [k, []]));
  for (const c of cards) {
    const a = answerOf(c);
    if (!a || !(a.a in under)) { counts.open += 1; continue; }
    counts[a.a] += 1;
    under[a.a].push({ key: c.key, label: c.label, q: c.q.q, note: a.note || "" });
  }
  return { counts, under, total: cards.length };
}

/**
 * The deck in the most useful order: the questions not answered first, the essential ones before the others, then
 * those of the lines least known (most questions open or answered "nobody knows") and of lines nothing was asked on
 * yet; the answered ones last, as listed. Each card says why it comes where it does.
 * @returns {{cards: object[], why: Record<string, string[]>}}
 */
export function bestFirst(cards, answers) {
  const lines = new Map();
  for (const c of cards) {
    const l = lines.get(c.line) || { n: 0, dark: 0, asked: 0 };
    const a = answers[c.key];
    l.n += 1;
    if (!a || a.a === "unknown") l.dark += 1;
    if (a) l.asked += 1;
    lines.set(c.line, l);
  }
  const dark = (p) => lines.get(p).dark / lines.get(p).n;
  const darkest = Math.max(0, ...[...lines.keys()].map(dark));
  const open = cards.filter((c) => !answers[c.key]).map((c, i) => {
    const untouched = lines.get(c.line).asked === 0, least = darkest > 0 && dark(c.line) === darkest;
    return { c, i, untouched, least, s: (c.q.core ? 3 : 0) + 2 * dark(c.line) + (untouched ? 1 : 0) };
  });
  open.sort((a, b) => b.s - a.s || a.i - b.i);
  const why = {};
  for (const x of open) {
    why[x.c.key] = [x.untouched ? "Nothing asked on this line yet" : x.least ? "Least known line" : null].filter(Boolean);
  }
  return { cards: [...open.map((x) => x.c), ...cards.filter((c) => answers[c.key])], why };
}

/**
 * A recap of the deck in plain text, for the account team: how much was asked, the real gaps and what nobody could
 * answer with what was said, and what would need to be true. Internal: it names gaps, so it is not the customer's.
 * @param {string} customer
 * @param {object[]} cards
 * @param {Record<string, {a:string, note?:string}>} answers
 */
export function recapText(customer, cards, answers) {
  const s = deckSummary(cards, answers);
  const asked = s.total - s.counts.open;
  const lines = [`Discovery recap: ${customer}`, "",
    `Asked ${asked} of ${s.total} questions: ${plural(s.counts.gap, "real gap", "real gaps")}, ${s.counts.unknown} nobody could answer, ${s.counts.partly} partly, ${s.counts.solved} solved.`];
  const said = (r) => `- ${r.q}${r.note ? ` "${r.note}"` : ""}`;
  if (s.gaps.length) lines.push("", "Real gaps", ...s.gaps.map(said));
  if (s.unknown.length) lines.push("", "Nobody could answer", ...s.unknown.map(said));
  const needs = [...new Set(cards.filter((c) => answers[c.key] && answers[c.key].a !== "solved" && c.q.need).map((c) => c.q.need))];
  if (needs.length) lines.push("", "What would need to be true", ...needs.map((n) => `- ${n}`));
  const invite = inviteLines(cards, answers);
  if (invite.length) lines.push("", "For the next meeting", ...invite.map((x) => `- ${x.text}`));
  return lines.join("\n");
}

/** A mail link that opens the person's own mail app with the recap written in, kept short enough for every mail app. */
export function recapMailto(subject, body, max = 1800) {
  const text = body.length > max ? `${body.slice(0, max - 1).trimEnd()}…` : body;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/**
 * Who to invite next: the roles that can answer the essential questions still open (no answer, or nobody knew), most
 * questions first. Each with how many and the first of them, to say why in the invitation.
 * @returns {{role:string, n:number, first:string}[]}
 */
export function whoNext(cards, answers) {
  const by = new Map();
  for (const c of cards) {
    const a = answers[c.key];
    if (!c.q.core || !c.q.role || (a && a.a !== "unknown")) continue;
    const r = by.get(c.q.role) || { role: c.q.role, n: 0, first: c.q.q };
    r.n += 1;
    by.set(c.q.role, r);
  }
  return [...by.values()].sort((x, y) => y.n - x.n);
}

/** Who a role is, said as one would invite them. */
export const INVITE = { executive: "the executive sponsor", architect: "the architect", operations: "operations", security: "the security team",
  application: "the application owner", data: "the data team", finance: "finance" };

/** One line per role to invite: "Invite the security team: 3 essential questions still open". */
export function inviteLines(cards, answers) {
  return whoNext(cards, answers).map((r) => ({
    text: `Invite ${INVITE[r.role] || (ROLE_WORDS[r.role] || r.role).toLowerCase()}: ${plural(r.n, "essential question", "essential questions")} still open`,
    first: r.first,
  }));
}
