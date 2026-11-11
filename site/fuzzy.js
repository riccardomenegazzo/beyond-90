// Forgiving search for the command palette: whole or partial words, letters in order, and a slip of the keys.
// Written here, not taken from a library, so there is nothing more to trust. No DOM, no storage.

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Edit distance with swaps of neighbouring letters counted as one change; gives up beyond `max`. */
export function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < low) low = v;
    }
    if (low > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

/** How well one word of the query matches a label: higher is better, 0 means not at all. */
function tokenScore(tok, label, labelWords) {
  if (labelWords.includes(tok)) return 100;
  if (labelWords.some((w) => w.startsWith(tok))) return 80 - Math.min(20, tok.length < 2 ? 10 : 0);
  if (label.includes(tok)) return 55;
  if (tok.length >= 4) {
    const max = tok.length >= 8 ? 2 : 1;
    let best = max + 1;
    for (const w of labelWords) best = Math.min(best, distance(tok, w, max));
    if (best <= max) return 45 - 10 * best;
  }
  // letters in order, e.g. "rbd" for "risk burn-down"
  if (tok.length >= 3) {
    let at = 0, gaps = 0, last = -1;
    for (const ch of tok) {
      const i = label.indexOf(ch, at);
      if (i < 0) return 0;
      if (last >= 0 && i > last + 1) gaps += 1;
      last = i; at = i + 1;
    }
    return Math.max(5, 30 - 4 * gaps);
  }
  return 0;
}

/** The items that match every word of the query, best first; ties keep their order. An empty query keeps all. */
export function rank(query, items, get = (x) => x) {
  const toks = words(query);
  if (!toks.length) return items.slice();
  const scored = [];
  items.forEach((item, index) => {
    const label = String(get(item)).toLowerCase(), lw = words(label);
    let total = 0;
    for (const t of toks) {
      const s = tokenScore(t, label, lw);
      if (!s) return;
      total += s;
    }
    scored.push({ item, index, total });
  });
  scored.sort((a, b) => b.total - a.total || a.index - b.index);
  return scored.map((s) => s.item);
}
