/**
 * What the deals teach: across every prospect, how they ended and why, what customers pushed back on, which gaps came
 * up most, which tests were not met, and how long each stage took. Built from plain facts per deal, so the same
 * reading works on one engineer's desk and on a team's shared snapshots. No DOM, so Node can test it.
 */
import { assess } from "./workshop.js";
import { progress, OUTCOMES, REASONS } from "./pov.js";

const isExampleId = (id) => /\|example\d$/.test(id || "");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const clean = (t, max = 200) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * One plain record per prospect, newest workshop and newest proof of value under the same name. Only what the
 * lessons need: no notes, no figures, no inventory.
 */
export function dealFacts(workshops, povs, catalog) {
  const by = new Map();
  const slot = (name) => { if (!by.has(name)) by.set(name, { customer: name, workshops: [], povs: [] }); return by.get(name); };
  for (const w of workshops || []) slot(w.customer).workshops.push(w);
  for (const p of povs || []) slot(p.customer).povs.push(p);
  const out = [];
  for (const o of by.values()) {
    const w = [...o.workshops].sort((a, b) => cmp(b.updated_on, a.updated_on))[0] || null;
    const p = [...o.povs].sort((a, b) => cmp(b.updated_on, a.updated_on))[0] || null;
    const res = w && catalog ? assess(catalog, w) : null;
    const pr = p ? progress(p) : null;
    const gaps = [];
    if (w && catalog) {
      for (const [k, v] of Object.entries(w.answers)) {
        if (v.a !== "gap" && v.a !== "unknown") continue;
        const [prof, i] = k.split("#");
        const line = catalog.lines[prof], q = line && line.questions[Number(i)];
        if (q) gaps.push({ line: line.label, q: clean(q.q), a: v.a });
      }
    }
    out.push({
      customer: clean(o.customer), example: isExampleId(w && w.id) || isExampleId(p && p.id),
      started_on: [w && w.created_on, p && p.created_on].filter(Boolean).sort()[0] || "",
      lines: w ? w.scope.map((x) => (catalog && catalog.lines[x] ? catalog.lines[x].label : x)) : [],
      land: res && res.land ? res.land.label : "",
      raised: res ? (res.raised || []).map((x) => ({ line: x.label, says: clean(x.says) })) : [],
      gaps,
      pov: p ? { stage: p.stage, start: p.start || "", end: p.end || "", verdict: pr.verdict, met: pr.met, total: pr.total,
        not_met: p.criteria.filter((c) => c.status === "not_met").map((c) => clean(c.text)) } : null,
      outcome: p && p.outcome ? { result: p.outcome.result, reason: p.outcome.reason, on: p.outcome.on } : null,
    });
  }
  return out.sort((a, b) => cmp(a.customer, b.customer));
}

const median = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
const top = (map, n) => [...map.values()].sort((a, b) => b.count - a.count || cmp(a.key, b.key)).slice(0, n);

/** The lessons: outcomes and reasons, objections, gaps, tests not met, time per stage, where deals start. */
export function lessons(facts, { includeExamples = false } = {}) {
  const deals = (facts || []).filter((f) => includeExamples || !f.example);
  const decided = deals.filter((f) => f.outcome);
  const count = (r) => decided.filter((f) => f.outcome.result === r).length;
  const won = count("won"), lost = count("lost"), none = count("none");
  const reasons = new Map();
  for (const f of decided.filter((x) => x.outcome.result !== "won" && x.outcome.reason)) {
    const k = f.outcome.reason;
    reasons.set(k, { key: k, label: REASONS[k] || k, count: (reasons.get(k) || { count: 0 }).count + 1 });
  }
  const objections = new Map();
  for (const f of deals) {
    for (const o of f.raised) {
      const k = `${o.line}|${o.says}`;
      const have = objections.get(k) || { key: k, line: o.line, says: o.says, count: 0, won: 0, lost: 0 };
      have.count += 1;
      if (f.outcome && f.outcome.result === "won") have.won += 1;
      if (f.outcome && f.outcome.result !== "won") have.lost += 1;
      objections.set(k, have);
    }
  }
  const gaps = new Map();
  for (const f of deals) for (const g of f.gaps) {
    const k = `${g.line}|${g.q}`;
    const have = gaps.get(k) || { key: k, line: g.line, q: g.q, count: 0, unknown: 0 };
    have.count += 1;
    if (g.a === "unknown") have.unknown += 1;
    gaps.set(k, have);
  }
  const notMet = new Map();
  for (const f of deals) for (const t of (f.pov ? f.pov.not_met : [])) notMet.set(t, { key: t, text: t, count: (notMet.get(t) || { count: 0 }).count + 1 });
  const lands = new Map();
  for (const f of deals.filter((x) => x.land)) lands.set(f.land, { key: f.land, label: f.land, count: (lands.get(f.land) || { count: 0 }).count + 1 });
  const proofs = deals.filter((f) => f.pov && f.pov.stage === "done");
  const technical = proofs.filter((f) => f.pov.verdict === "all criteria met" || f.pov.verdict === "mostly met").length;
  return {
    deals: deals.length, decided: decided.length, won, lost, none,
    win_rate: decided.length ? Math.round((won / decided.length) * 100) : null,
    proofs: proofs.length, technical_wins: technical, technical_rate: proofs.length ? Math.round((technical / proofs.length) * 100) : null,
    reasons: top(reasons, 6), objections: top(objections, 6), gaps: top(gaps, 6), not_met: top(notMet, 5), lands: top(lands, 5),
    cycle: {
      to_proof: median(deals.filter((f) => f.pov && f.pov.start && f.started_on).map((f) => days(f.started_on, f.pov.start))),
      proof: median(deals.filter((f) => f.pov && f.pov.start && f.pov.end && f.pov.stage === "done").map((f) => days(f.pov.start, f.pov.end))),
      to_decision: median(decided.filter((f) => f.pov && f.pov.end).map((f) => days(f.pov.end, f.outcome.on))),
    },
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The lessons in Markdown: for enablement, the product team, or a review with leadership. */
export function lessonsMarkdown(l, title = "What our deals teach") {
  const out = [`# ${title}`, "", `${plural(l.deals, "prospect")}; ${plural(l.decided, "decision")} recorded.`, ""];
  if (l.decided) out.push("## How they ended", "", `- Won ${l.won}, lost ${l.lost}, no decision ${l.none}: ${l.win_rate}% won.`);
  if (l.proofs) out.push(`- Proofs of value finished: ${l.proofs}, with the criteria met or mostly met in ${l.technical_wins} (${l.technical_rate}%).`);
  if (l.reasons.length) out.push(`- When not won: ${l.reasons.map((r) => `${r.label.toLowerCase()} (${r.count})`).join(", ")}.`);
  if (l.decided || l.proofs) out.push("");
  if (l.objections.length) out.push("## What customers push back on", "", ...l.objections.map((o) => `- "${o.says}" (${o.line.toLowerCase()}): ${plural(o.count, "prospect")}${o.won + o.lost ? `, ${o.won} won and ${o.lost} not` : ""}.`), "");
  if (l.gaps.length) out.push("## The gaps heard most", "", ...l.gaps.map((g) => `- ${g.q} (${g.line.toLowerCase()}): ${plural(g.count, "prospect")}${g.unknown ? `, ${g.unknown} where nobody knew` : ""}.`), "");
  if (l.not_met.length) out.push("## Tests not met", "", ...l.not_met.map((t) => `- ${t.text} (${t.count})`), "");
  const c = l.cycle;
  if (c.to_proof != null || c.proof != null || c.to_decision != null) {
    out.push("## How long it takes (median days)", "");
    if (c.to_proof != null) out.push(`- First meeting to proof of value: ${c.to_proof}`);
    if (c.proof != null) out.push(`- Proof of value: ${c.proof}`);
    if (c.to_decision != null) out.push(`- End of the proof to decision: ${c.to_decision}`);
    out.push("");
  }
  if (l.lands.length) out.push("## Where deals start", "", ...l.lands.map((x) => `- ${x.label} (${x.count})`), "");
  return out.join("\n");
}

export { OUTCOMES, REASONS };
