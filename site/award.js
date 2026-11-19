/**
 * Price and quality: who a tender is likely awarded to, when it goes to the best ratio of quality to price.
 * Each bid gets quality points (from the technical response) and price points, from a formula the tender states;
 * the highest total wins. The formulas are those public procurement platforms publish for contracting authorities:
 * lowest price over each price, discount over the largest discount, two slopes around the average discount,
 * discount to a power, and from the dearest to the cheapest. From our offer and the rivals' guessed ones come the
 * standing, the price at which the lead changes hands, and what one point of quality is worth in price.
 * Plain functions, no DOM, so Node can test them; nothing here names a product or a company.
 */

export const FORMULAS = {
  inverse: { label: "Lowest price over each price", base: false,
    hint: "The cheapest bid gets every price point; each other gets lowest ÷ its price of them." },
  linear: { label: "Each discount over the largest", base: true,
    hint: "Points in proportion to the discount on the base amount: its discount ÷ the largest discount offered." },
  bilinear: { label: "Two slopes around the average discount", base: true,
    hint: "Up to the average discount, a share X of the points in proportion; above it, the rest more slowly. A small discount loses much, a large one gains little." },
  concave: { label: "Discount over the largest, to a power", base: true,
    hint: "(its discount ÷ the largest) raised to a power below one: the first discounts gain the most points." },
  minmax: { label: "From the dearest to the cheapest", base: false,
    hint: "The cheapest bid gets every price point, the dearest none, the others in between." },
};
export const MAX_RIVALS = 4;
export const NAME_MAX = 40;
export const AMOUNT_MAX = 1e12;
export const POINTS_MAX = 1000;
export const AWARD_DEFAULTS = Object.freeze({ quality: 70, price: 30, formula: "inverse", x: 0.85, alpha: 0.5, base: null, rescale: false,
  ours: Object.freeze({ quality: null, price: null }), rivals: Object.freeze([]) });

const CONTROL = /[\u0000-\u001f\u007f]/;
const num = (v) => typeof v === "number" && Number.isFinite(v);
const amount = (v) => num(v) && v > 0 && v <= AMOUNT_MAX;
const plain = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const only = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const read = (v) => (v === "" || v == null ? null : Number(v));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Whether a stored award is well formed: every field checked, nothing unexpected. */
export function validAward(a) {
  if (!plain(a) || !only(a, ["quality", "price", "formula", "x", "alpha", "base", "rescale", "ours", "rivals"])) return false;
  if (!num(a.quality) || !num(a.price) || a.quality < 0 || a.price < 0 || a.quality > POINTS_MAX || a.price > POINTS_MAX || a.quality + a.price <= 0) return false;
  if (!Object.hasOwn(FORMULAS, a.formula) || !num(a.x) || a.x < 0.5 || a.x > 0.95 || !num(a.alpha) || a.alpha < 0.1 || a.alpha > 1) return false;
  if (!(a.base === null || amount(a.base)) || typeof a.rescale !== "boolean") return false;
  if (!plain(a.ours) || !only(a.ours, ["quality", "price"])) return false;
  if (!(a.ours.quality === null || (num(a.ours.quality) && a.ours.quality >= 0 && a.ours.quality <= a.quality))) return false;
  if (!(a.ours.price === null || amount(a.ours.price))) return false;
  if (!Array.isArray(a.rivals) || a.rivals.length > MAX_RIVALS) return false;
  return a.rivals.every((r) => plain(r) && only(r, ["name", "quality", "price"]) && typeof r.name === "string" && r.name.length <= NAME_MAX && !CONTROL.test(r.name)
    && num(r.quality) && r.quality >= 0 && r.quality <= a.quality && amount(r.price));
}

/** An award from what a form gives, every value brought in range; a rival without a price is left out. */
export function cleanAward(given = {}) {
  const g = plain(given) ? given : {};
  const pts = (v, d) => { const n = read(v); return n == null || !Number.isFinite(n) ? d : clamp(Math.round(n * 10) / 10, 0, POINTS_MAX); };
  let quality = pts(g.quality, AWARD_DEFAULTS.quality);
  let price = pts(g.price, AWARD_DEFAULTS.price);
  if (quality + price <= 0) ({ quality, price } = AWARD_DEFAULTS);
  const money = (v) => { const n = read(v); return n == null || !Number.isFinite(n) || n <= 0 ? null : Math.min(AMOUNT_MAX, Math.round(n * 100) / 100); };
  const q = (v) => { const n = read(v); return n == null || !Number.isFinite(n) ? null : clamp(Math.round(n * 10) / 10, 0, quality); };
  const x = read(g.x); const alpha = read(g.alpha);
  const ours = plain(g.ours) ? g.ours : {};
  const rivals = (Array.isArray(g.rivals) ? g.rivals : []).filter(plain).map((r, i) => ({
    name: String(r.name == null ? "" : r.name).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) || `Rival ${String.fromCharCode(65 + i)}`,
    quality: q(r.quality) ?? 0, price: money(r.price),
  })).filter((r) => r.price != null).slice(0, MAX_RIVALS);
  return {
    quality, price,
    formula: Object.hasOwn(FORMULAS, g.formula) ? g.formula : AWARD_DEFAULTS.formula,
    x: x == null || !Number.isFinite(x) ? AWARD_DEFAULTS.x : clamp(Math.round(x * 100) / 100, 0.5, 0.95),
    alpha: alpha == null || !Number.isFinite(alpha) ? AWARD_DEFAULTS.alpha : clamp(Math.round(alpha * 100) / 100, 0.1, 1),
    base: money(g.base), rescale: g.rescale === true,
    ours: { quality: q(ours.quality), price: money(ours.price) },
    rivals,
  };
}

/** The price points of each price, by the tender's formula. */
export function pricePoints(a, prices) {
  const M = a.price;
  const lo = Math.min(...prices); const hi = Math.max(...prices);
  if (a.formula === "inverse") return prices.map((p) => M * lo / p);
  if (a.formula === "minmax") return prices.map((p) => (hi === lo ? M : M * (hi - p) / (hi - lo)));
  const d = prices.map((p) => Math.max(0, (a.base - p) / a.base));
  const dmax = Math.max(...d);
  if (dmax <= 0) return prices.map(() => 0);
  if (a.formula === "linear") return d.map((v) => M * v / dmax);
  if (a.formula === "concave") return d.map((v) => M * (v / dmax) ** a.alpha);
  const avg = d.reduce((s, v) => s + v, 0) / d.length;
  return d.map((v) => M * (v <= avg ? (avg > 0 ? a.x * v / avg : 0) : a.x + (1 - a.x) * (v - avg) / (dmax - avg)));
}

/** The quality points as awarded: as given, or rescaled so the best bid gets the maximum when the tender says so. */
export function qualityPoints(a, qualities) {
  if (!a.rescale) return [...qualities];
  const best = Math.max(...qualities);
  return best > 0 ? qualities.map((q) => q * a.quality / best) : [...qualities];
}

/** Our quality points: as typed, or read from the requirements (the points likely won, on the tender's quality scale). */
export function ourQuality(a, likely) {
  if (a.ours.quality != null) return { value: a.ours.quality, from: "typed" };
  if (likely && likely.total > 0) return { value: Math.round(likely.likely / likely.total * a.quality * 10) / 10, from: "requirements" };
  return { value: null, from: "" };
}

/** What the comparison still needs, in words; empty when it can run. */
export function missing(a, quality) {
  const out = [];
  if (FORMULAS[a.formula].base && a.base == null) out.push("the base amount the discounts are taken from");
  if (quality == null) out.push("our quality points (or points on the scored requirements)");
  if (a.ours.price == null) out.push("our price");
  if (!a.rivals.length) out.push("at least one rival's guessed quality and price");
  return out;
}

const totals = (a, quality, price) => {
  const qs = qualityPoints(a, [quality, ...a.rivals.map((r) => r.quality)]);
  const ps = pricePoints(a, [price, ...a.rivals.map((r) => r.price)]);
  return qs.map((q, i) => ({ q, p: ps[i], t: q + ps[i] }));
};
const lead = (a, quality, price) => { const t = totals(a, quality, price); return t[0].t - Math.max(...t.slice(1).map((x) => x.t)); };
/** The price, between lo and hi, where `f` (falling as the price rises) crosses zero. */
const cross = (f, lo, hi) => { for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (f(m) >= 0) lo = m; else hi = m; } return (lo + hi) / 2; };

/**
 * Where each bid stands, ours and the rivals', the highest total first; with how far we lead or trail, the price at
 * which that changes, and what one point of quality is worth in price. `likely` is the tender's points (rfpState).
 */
export function standings(a, likely = null) {
  const oq = ourQuality(a, likely);
  const need = missing(a, oq.value);
  if (need.length) return { ready: false, missing: need, quality_from: oq.from, quality: oq.value };
  const P = a.ours.price;
  const t = totals(a, oq.value, P);
  const bids = [{ name: "Us", us: true, price: P }, ...a.rivals.map((r) => ({ name: r.name, us: false, price: r.price }))]
    .map((b, i) => ({ ...b, quality: t[i].q, price_points: t[i].p, total: t[i].t, discount: a.base ? (a.base - b.price) / a.base : null }));
  const order = [...bids].sort((x, y) => y.total - x.total || (x.us ? -1 : 1));
  const rank = order.findIndex((b) => b.us) + 1;
  const ahead = order.find((b) => !b.us);
  const margin = lead(a, oq.value, P);
  const f = (p) => lead(a, oq.value, p);
  const hi = a.base && a.base > P ? a.base : P * 2;
  const floor = P / 2;
  let turn;
  if (margin < 0) {
    turn = f(floor) < 0 ? { kind: "none", price: floor, gap: -f(floor) } : { kind: "win_below", price: cross(f, floor, P) };
  } else {
    turn = f(hi) >= 0 ? { kind: "hold_up_to", price: hi, all: true } : { kind: "hold_up_to", price: cross(f, P, hi), all: false };
  }
  // what one point of quality is worth: how far our price can move for our lead to move by one point
  const g = (p) => f(p) - (margin - 1);
  const worth = g(hi) >= 0 ? null : cross(g, P, hi) - P;
  const below = a.rivals.length ? P < 0.8 * Math.min(...a.rivals.map((r) => r.price)) : false;
  return {
    ready: true, quality_from: oq.from, quality: oq.value, bids: order, rank, first: order[0], ahead, margin, turn, worth,
    over_base: a.base != null && P > a.base, low: below,
  };
}

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const N = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
export const money = (v) => F.format(Math.round(v));
export const pts = (v) => N.format(Math.round(v * 10) / 10);
export const pct = (v) => `${N.format(Math.round(v * 1000) / 10)}%`;

/** The standing in one sentence, and what changes it, in words. */
export function awardSay(a, s) {
  if (!s.ready) return { lead: `To compare the bids, add ${s.missing.join(", ")}.`, turn: "", worth: "" };
  const P = a.ours.price;
  const rel = (p) => (p < P ? `${pct((P - p) / P)} less than our price` : `${pct((p - P) / P)} more than our price`);
  const leadText = s.rank === 1
    ? (s.margin > 0 ? `We come first, ${pts(s.margin)} points ahead of ${s.ahead.name}.` : `We tie with ${s.ahead.name} for first.`)
    : `${s.first.name} comes first; we come ${ordinal(s.rank)}, ${pts(-s.margin)} points behind.`;
  let turn = "";
  if (s.turn.kind === "win_below") turn = `We would come first below ${money(s.turn.price)} (${rel(s.turn.price)}${a.base ? `, a discount of ${pct((a.base - s.turn.price) / a.base)} on the base` : ""}).`;
  else if (s.turn.kind === "none") turn = `Even at half our price (${money(s.turn.price)}), we stay ${pts(s.turn.gap)} points behind: the gap is in quality, not price.`;
  else if (s.turn.all) turn = `We stay first even at ${a.base && a.base > P ? "the base amount" : "twice our price"} (${money(s.turn.price)}).`;
  else turn = `We stay first up to ${money(s.turn.price)} (${rel(s.turn.price)}).`;
  const worth = s.worth == null ? "" : `Here, one point of quality is worth about ${money(s.worth)} of price.`;
  return { lead: leadText, turn, worth };
}

const ordinal = (n) => ["first", "second", "third", "fourth", "fifth"][n - 1] || `${n}th`;

/** The comparison for the bid summary, in Markdown. */
export function awardMarkdown(a, s) {
  const say = awardSay(a, s);
  const out = ["## Price and quality", ""];
  out.push(`Quality ${pts(a.quality)} points, price ${pts(a.price)}; price scored as: ${FORMULAS[a.formula].label.toLowerCase()}${a.formula === "bilinear" ? ` (X = ${a.x})` : a.formula === "concave" ? ` (power ${a.alpha})` : ""}.`
    + `${a.base ? ` Base amount ${money(a.base)}.` : ""}${a.rescale ? " Quality rescaled so the best bid gets the maximum." : ""}`, "");
  if (!s.ready) return [...out, say.lead, ""].join("\n");
  out.push("| Bid | Quality | Price | Price points | Total |", "|---|---|---|---|---|");
  for (const b of s.bids) out.push(`| ${b.us ? "**Us**" : b.name.replace(/[|\\`*_[\]<>]/g, " ").replace(/\s+/g, " ").trim()} | ${pts(b.quality)} | ${money(b.price)}${b.discount != null ? ` (${pct(b.discount)} off)` : ""} | ${pts(b.price_points)} | ${pts(b.total)} |`);
  out.push("", say.lead, say.turn, say.worth ? say.worth : null, s.over_base ? "Our price is above the base amount: most tenders exclude such a bid." : null,
    s.low ? "Our price is far below the rivals': the contracting authority may ask us to justify it as abnormally low." : null,
    s.quality_from === "requirements" ? "Our quality points are read from the scored requirements, as answered." : null,
    "The rivals' figures are guesses: the result is only as good as they are.", "");
  return out.filter((x) => x !== null).join("\n");
}
