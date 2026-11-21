// One question at a time: the discovery questions as a deck of cards, answered with a gesture, a tap or a key.
//
// The deck is the questions the meeting is narrowed to, in the order the list shows them, starting at the first one
// with no answer. A card is answered by swiping it (right: solved, left: a real gap, up: partly, down: nobody knows),
// by its buttons, or by the arrow keys and 1 to 4. What the customer said is written on the card, and the words
// suggest an answer, which the person takes or ignores: the suggestion never answers on its own.
//
// No DOM, so Node can test it. Nothing here leaves the browser: the suggestion is a few word patterns, read locally.
import { displayOrder } from "./questions.js";

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
