/**
 * The team's desk, for a presales manager: each engineer shares a snapshot of their desk (stages, risks, outcomes,
 * what customers pushed back on, the gaps heard; no notes, no figures, no names of people), and the manager reads the
 * snapshots together. Nothing is stored and nothing is sent: the files are read in the page, checked field by field.
 */
import { STAGES, exampleDesk, pipeline } from "./desk.js";
import { lessons, dealFacts } from "./lessons.js";
import { STAGES as POV_STAGES, OUTCOMES, REASONS } from "./pov.js";

export const KIND = "beyond90-desk-snapshot";
export const FORMAT = 1;
export const MAX_FILE = 2_000_000, MAX_FILES = 40, MAX_DEALS = 500;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_IDS = STAGES.map((s) => s.id);
const clean = (t, max) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** One engineer's snapshot: the desk's opportunities joined with their facts, nothing more. */
export function snapshotFrom(opps, facts, by, today) {
  const factOf = new Map(facts.map((f) => [f.customer, f]));
  return {
    kind: KIND, format: FORMAT, by: clean(by, 100), as_of: today,
    deals: opps.map((o) => {
      const f = factOf.get(clean(o.customer, 200)) || {};
      return {
        customer: clean(o.customer, 200), stage: o.stage, closed: o.outcome || (o.stopped ? "stopped" : ""), example: !!o.example,
        started_on: f.started_on || "", updated_on: o.updated_on || "", lines: (f.lines || []).slice(0, 20).map((x) => clean(x, 100)), land: clean(o.land, 100),
        next: clean(o.next, 300), risks: (o.risks || []).slice(0, 20).map((r) => ({ level: r.level, text: clean(r.text, 300) })),
        pov: f.pov ? { stage: f.pov.stage, start: f.pov.start, end: f.pov.end, verdict: clean(f.pov.verdict, 40), met: f.pov.met, total: f.pov.total, not_met: f.pov.not_met.slice(0, 20) } : null,
        outcome: f.outcome || null, raised: (f.raised || []).slice(0, 40), gaps: (f.gaps || []).slice(0, 200),
      };
    }),
  };
}

const isStr = (v, max, min = 0) => typeof v === "string" && v.length >= min && v.length <= max;
const isDay = (v) => v === "" || (typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v)));
const only = (o, keys) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).every((k) => keys.includes(k));
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function validDeal(d) {
  if (!only(d, ["customer", "stage", "closed", "example", "started_on", "updated_on", "lines", "land", "next", "risks", "pov", "outcome", "raised", "gaps"])) return false;
  if (!isStr(d.customer, 200, 1) || !STAGE_IDS.includes(d.stage) || !["", "won", "lost", "none", "stopped"].includes(d.closed) || typeof d.example !== "boolean") return false;
  if (!isDay(d.started_on) || !isDay(d.updated_on) || !isStr(d.land, 100) || !isStr(d.next, 300)) return false;
  if (!Array.isArray(d.lines) || d.lines.length > 20 || !d.lines.every((x) => isStr(x, 100, 1))) return false;
  if (!Array.isArray(d.risks) || d.risks.length > 20 || !d.risks.every((r) => only(r, ["level", "text"]) && ["high", "watch"].includes(r.level) && isStr(r.text, 300, 1))) return false;
  if (d.pov !== null) {
    const p = d.pov;
    if (!only(p, ["stage", "start", "end", "verdict", "met", "total", "not_met"]) || !POV_STAGES.includes(p.stage) || !isDay(p.start) || !isDay(p.end) || !isStr(p.verdict, 40)) return false;
    if (!intIn(p.total, 0, 20) || !intIn(p.met, 0, p.total) || !Array.isArray(p.not_met) || p.not_met.length > 20 || !p.not_met.every((x) => isStr(x, 200, 1))) return false;
  }
  if (d.outcome !== null && !(only(d.outcome, ["result", "reason", "on"]) && Object.hasOwn(OUTCOMES, d.outcome.result) && (d.outcome.reason === "" || Object.hasOwn(REASONS, d.outcome.reason)) && isDay(d.outcome.on) && d.outcome.on !== "")) return false;
  if (!Array.isArray(d.raised) || d.raised.length > 40 || !d.raised.every((o) => only(o, ["line", "says"]) && isStr(o.line, 100, 1) && isStr(o.says, 240, 1))) return false;
  if (!Array.isArray(d.gaps) || d.gaps.length > 200 || !d.gaps.every((g) => only(g, ["line", "q", "a"]) && isStr(g.line, 100, 1) && isStr(g.q, 300, 1) && ["gap", "unknown"].includes(g.a))) return false;
  return true;
}

/** A snapshot from someone else's file: everything checked, anything unexpected refused whole. */
export function validSnapshot(s) {
  return only(s, ["kind", "format", "by", "as_of", "deals"]) && s.kind === KIND && s.format === FORMAT && isStr(s.by, 100) && isDay(s.as_of) && s.as_of !== ""
    && Array.isArray(s.deals) && s.deals.length <= MAX_DEALS && s.deals.every(validDeal);
}

/** Read the files' text into snapshots; say which were refused and why, in plain words. */
export function readSnapshots(files) {
  const ok = [], refused = [];
  for (const { name, text } of files.slice(0, MAX_FILES)) {
    if (text.length > MAX_FILE) { refused.push({ name, why: "larger than a desk snapshot can be" }); continue; }
    let s;
    try { s = JSON.parse(text); } catch { refused.push({ name, why: "not a JSON file" }); continue; }
    if (!validSnapshot(s)) { refused.push({ name, why: "not a desk snapshot, or changed by hand" }); continue; }
    ok.push(s);
  }
  if (files.length > MAX_FILES) refused.push({ name: `${files.length - MAX_FILES} more`, why: `at most ${MAX_FILES} files at a time` });
  return { ok, refused };
}

const who = (s, i) => s.by || `Engineer ${i + 1}`;

/** The team read together: each engineer's pipeline, the deals that could be lost, and what the deals teach. */
export function teamView(snapshots, { includeExamples = false } = {}) {
  const engineers = snapshots.map((s, i) => {
    const deals = s.deals.filter((d) => includeExamples || !d.example);
    const live = deals.filter((d) => !d.closed);
    return {
      name: who(s, i), as_of: s.as_of, deals: deals.length, live: live.length,
      stages: Object.fromEntries(STAGE_IDS.map((id) => [id, live.filter((d) => d.stage === id).length])),
      won: deals.filter((d) => d.closed === "won").length, lost: deals.filter((d) => d.closed === "lost" || d.closed === "none").length,
      at_risk: live.filter((d) => d.risks.some((r) => r.level === "high")).length,
    };
  });
  const all = snapshots.flatMap((s, i) => s.deals.filter((d) => includeExamples || !d.example).map((d) => ({ ...d, engineer: who(s, i) })));
  const risky = all.filter((d) => !d.closed && d.risks.some((r) => r.level === "high"))
    .map((d) => ({ engineer: d.engineer, customer: d.customer, stage: d.stage, risk: d.risks.find((r) => r.level === "high").text, more: d.risks.length - 1 }));
  const facts = all.map((d) => ({ customer: d.customer, example: d.example, started_on: d.started_on, lines: d.lines, land: d.land, raised: d.raised, gaps: d.gaps,
    pov: d.pov, outcome: d.outcome }));
  const stages = STAGES.map((s) => ({ ...s, count: all.filter((d) => !d.closed && d.stage === s.id).length }));
  return { engineers, stages, risky, lessons: lessons(facts, { includeExamples: true }), deals: all.length, oldest: snapshots.map((s) => s.as_of).sort()[0] || "" };
}

/** The team review in Markdown: for the weekly pipeline review with the presales leadership. */
export function teamMarkdown(t, today) {
  const out = [`# Presales team review, ${today}`, "", `${t.engineers.length} engineer${t.engineers.length === 1 ? "" : "s"}, ${t.deals} deal${t.deals === 1 ? "" : "s"}; snapshots from ${t.oldest} onwards.`, "",
    "| Engineer | Open | Discovery | Journey | Proof | Decision | Won | Lost or no decision | At risk |", "|---|---|---|---|---|---|---|---|---|"];
  for (const e of t.engineers) out.push(`| ${e.name.replace(/\|/g, "/")} | ${e.live} | ${e.stages.discovery} | ${e.stages.journey} | ${e.stages.proof} | ${e.stages.decision} | ${e.won} | ${e.lost} | ${e.at_risk} |`);
  out.push("");
  if (t.risky.length) out.push("## What could lose a deal", "", ...t.risky.map((r) => `- **${r.customer}**, ${r.engineer}: ${r.risk}${r.more ? ` (and ${r.more} more)` : ""}`), "");
  const l = t.lessons;
  if (l.decided) out.push("## How deals ended", "", `Won ${l.won}, lost ${l.lost}, no decision ${l.none}: ${l.win_rate}% won.${l.reasons.length ? ` When not won: ${l.reasons.map((r) => `${r.label.toLowerCase()} (${r.count})`).join(", ")}.` : ""}`, "");
  if (l.objections.length) out.push("## What customers push back on, across the team", "", ...l.objections.map((o) => `- "${o.says}" (${o.line.toLowerCase()}): ${o.count}`), "");
  if (l.gaps.length) out.push("## The gaps heard most", "", ...l.gaps.map((g) => `- ${g.q} (${g.line.toLowerCase()}): ${g.count}`), "");
  return out.join("\n");
}

const shift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** Two invented engineers, to see the team view at work: the invented desk, and a second one three weeks older. */
export function exampleTeam(catalog, today) {
  const a = exampleDesk(today);
  const b = exampleDesk(shift(today, -21));
  const pick = new Set(["Valle Health (mock)", "Ardesia Logistics (mock)", "Orsa Manufacturing (mock)", "Brina Retail (mock)"]);
  const bw = b.workshops.filter((w) => pick.has(w.customer)), bp = b.povs.filter((p) => pick.has(p.customer));
  const one = snapshotFrom(pipeline(a.workshops, a.povs, catalog, today), dealFacts(a.workshops, a.povs, catalog), "Engineer A (mock)", today);
  const two = snapshotFrom(pipeline(bw, bp, catalog, today), dealFacts(bw, bp, catalog), "Engineer B (mock)", today);
  // a second desk of its own: other prospects, so the two do not read the same
  two.deals = two.deals.map((d) => ({ ...d, customer: d.customer.replace(/ \(mock\)$/, " North (mock)") }));
  return [one, two];
}
