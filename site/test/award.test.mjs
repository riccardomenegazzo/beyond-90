import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMULAS, AWARD_DEFAULTS, MAX_RIVALS, validAward, cleanAward, pricePoints, qualityPoints, ourQuality, standings, awardSay, awardMarkdown } from "../award.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const award = (over = {}) => cleanAward({ quality: 70, price: 30, ...over });

test("price points follow the formulas the procurement platforms publish", () => {
  const prices = [900000, 1000000, 1100000];
  // the cheapest gets every point; the others lowest ÷ theirs
  pricePoints(award({ formula: "inverse" }), prices).forEach((v, i) => near(v, [30, 27, 30 * 9 / 11][i]));
  // from the dearest (none) to the cheapest (all)
  pricePoints(award({ formula: "minmax" }), prices).forEach((v, i) => near(v, [30, 15, 0][i]));
  // discounts on a base of 1.2 million: 25%, 16.7%, 8.3%
  const base = 1200000;
  pricePoints(award({ formula: "linear", base }), prices).forEach((v, i) => near(v, [30, 20, 10][i]));
  pricePoints(award({ formula: "concave", base, alpha: 0.5 }), prices).forEach((v, i) => near(v, 30 * Math.sqrt([1, 2 / 3, 1 / 3][i])));
  // two slopes: X of the points up to the average discount (16.7%), the rest above it
  pricePoints(award({ formula: "bilinear", base, x: 0.85 }), prices).forEach((v, i) => near(v, [30, 25.5, 12.75][i]));
  // nobody discounts: no price points on the discount formulas; the same price for all: every point on the dearest-to-cheapest
  assert.deepEqual(pricePoints(award({ formula: "linear", base }), [1200000, 1300000]), [0, 0]);
  assert.deepEqual(pricePoints(award({ formula: "minmax" }), [5, 5]), [30, 30]);
});

test("quality points as given, or rescaled so the best bid gets the maximum", () => {
  assert.deepEqual(qualityPoints(award(), [35, 50]), [35, 50]);
  assert.deepEqual(qualityPoints(award({ rescale: true }), [35, 50]), [49, 70]);
  assert.deepEqual(qualityPoints(award({ rescale: true }), [0, 0]), [0, 0]);
});

test("our quality points: as typed, or read from the scored requirements on the tender's scale", () => {
  assert.deepEqual(ourQuality(award({ ours: { quality: 52 } }), { likely: 10, total: 20 }), { value: 52, from: "typed" });
  assert.deepEqual(ourQuality(award(), { likely: 30, total: 40 }), { value: 52.5, from: "requirements" });
  assert.deepEqual(ourQuality(award(), null), { value: null, from: "" });
});

test("who comes first, by how much, and the price at which that changes", () => {
  const a = award({ formula: "inverse", ours: { quality: 50, price: 900000 }, rivals: [{ name: "Rival A", quality: 60, price: 1000000 }] });
  const s = standings(a);
  assert.equal(s.ready, true);
  assert.deepEqual(s.bids.map((b) => [b.name, b.total]), [["Rival A", 87], ["Us", 80]]);
  assert.deepEqual([s.rank, s.margin, s.turn.kind], [2, -7, "win_below"]);
  near(s.turn.price, 2000000 / 3, 0.01);
  near(s.worth, 100000 / 3, 0.01);
  const say = awardSay(a, s);
  assert.equal(say.lead, "Rival A comes first; we come second, 7 points behind.");
  assert.equal(say.turn, "We would come first below 666,667 (25.9% less than our price).");
  assert.equal(say.worth, "Here, one point of quality is worth about 33,333 of price.");
  // ahead: how far the price can rise before the lead is lost
  const b = award({ formula: "inverse", ours: { quality: 62, price: 950000 }, rivals: [{ name: "Rival A", quality: 60, price: 1000000 }] });
  const t = standings(b);
  assert.deepEqual([t.rank, t.turn.kind], [1, "hold_up_to"]);
  assert.ok(t.turn.price > 950000 && t.turn.price < 1100000);
  assert.match(awardSay(b, t).turn, /^We stay first up to [\d,]+ \([\d.]+% more than our price\)\.$/);
  // far behind on quality: no price closes it
  const c = award({ formula: "linear", base: 1000000, ours: { quality: 20, price: 900000 }, rivals: [{ name: "Rival A", quality: 69, price: 990000 }] });
  const u = standings(c);
  assert.equal(u.turn.kind, "none");
  assert.match(awardSay(c, u).turn, /^Even at half our price \(450,000\), we stay [\d.]+ points behind: the gap is in quality, not price\.$/);
});

test("what is still needed is said in words; a price above the base or far below the rivals is flagged", () => {
  const empty = standings(award({ formula: "linear" }));
  assert.equal(empty.ready, false);
  assert.match(awardSay(award({ formula: "linear" }), empty).lead, /^To compare the bids, add the base amount the discounts are taken from, our quality points .*our price, at least one rival's guessed quality and price\.$/);
  const over = standings(award({ formula: "linear", base: 800000, ours: { quality: 50, price: 900000 }, rivals: [{ name: "R", quality: 50, price: 700000 }] }));
  assert.equal(over.over_base, true);
  const low = standings(award({ ours: { quality: 50, price: 500000 }, rivals: [{ name: "R", quality: 50, price: 900000 }] }));
  assert.equal(low.low, true);
});

test("a form's values are brought in range, and stored awards are checked field by field", () => {
  const a = cleanAward({ quality: "80", price: "20", formula: "bilinear", x: "0.99", alpha: "7", base: "-5", rescale: true,
    ours: { quality: "95", price: "1e13" }, rivals: [{ name: " A\u0007b ", quality: "10", price: "100" }, { name: "", quality: "", price: "" }, { quality: "5", price: "50" }] });
  assert.deepEqual(a, { quality: 80, price: 20, formula: "bilinear", x: 0.95, alpha: 1, base: null, rescale: true, ours: { quality: 80, price: 1e12 },
    rivals: [{ name: "A b", quality: 10, price: 100 }, { name: "Rival C", quality: 5, price: 50 }] });
  assert.equal(validAward(a), true);
  assert.equal(validAward(cleanAward({})), true);
  assert.deepEqual(cleanAward({ quality: 0, price: 0 }), { ...AWARD_DEFAULTS, ours: { quality: null, price: null }, rivals: [] });
  assert.equal(cleanAward({ rivals: Array.from({ length: 9 }, () => ({ price: 1 })) }).rivals.length, MAX_RIVALS);
  for (const bad of [null, [], { ...a, extra: 1 }, { ...a, formula: "lottery" }, { ...a, x: 0.2 }, { ...a, base: 0 }, { ...a, rescale: "yes" },
    { ...a, ours: { quality: 81, price: null } }, { ...a, ours: { quality: null } }, { ...a, rivals: [{ name: "<b>", quality: 1, price: 0 }] },
    { ...a, rivals: [{ name: "x\u0000", quality: 1, price: 1 }] }, { ...a, rivals: [{ name: "x", quality: 1, price: 1, note: "" }] },
    { ...a, rivals: Array.from({ length: 5 }, () => ({ name: "x", quality: 1, price: 1 })) }, { ...a, quality: Infinity }]) {
    assert.equal(validAward(bad), false, JSON.stringify(bad));
  }
  assert.ok(Object.values(FORMULAS).every((f) => f.label && f.hint && typeof f.base === "boolean"));
});

test("the comparison for the bid review, with names kept out of the table's markup", () => {
  const a = award({ formula: "bilinear", base: 1200000, ours: { quality: 50, price: 900000 },
    rivals: [{ name: "Rival | A", quality: 60, price: 1000000 }, { name: "Rival B", quality: 55, price: 1100000 }] });
  const md = awardMarkdown(a, standings(a));
  assert.match(md, /^## Price and quality\n\nQuality 70 points, price 30; price scored as: two slopes around the average discount \(X = 0.85\)\. Base amount 1,200,000\./);
  assert.match(md, /\| Rival A \| 60 \| 1,000,000 \(16.7% off\) \| 25.5 \| 85.5 \|/);
  assert.match(md, /\| \*\*Us\*\* \| 50 \| 900,000 \(25% off\) \| 30 \| 80 \|/);
  assert.match(md, /We would come first below 735,000/);
  assert.match(awardMarkdown(award(), standings(award())), /To compare the bids, add/);
});
