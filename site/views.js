// The dashboard views. Each takes a context {result, dash, score, engine, files, options, go} and returns a Node.
import { h, s as svgEl, chip, pct, pts, num, cap, dataTable, chipFilter, searchBox, toCsv, saveBlob, copyText } from "./ui.js";
import { recap } from "./recap.js";
import { OUTCOMES } from "./outcomes.js";
import { newCall, callOutput } from "./callmode.js";
import { ledger, CSV_COLUMNS } from "./commitments.js";
import { buildHandoff } from "./handoff.js";
import * as P from "./pov.js";
import * as A from "./asks.js";
import * as SLA from "./sla.js";
import * as SC from "./scorecard.js";
import * as WS from "./workshop.js";
import * as INV from "./inventory.js";
import * as DESK from "./desk.js";
import * as SZ from "./sizing.js";
import * as WV from "./waves.js";
import * as VC from "./valuecase.js";
import * as DL from "./delivery.js";
import * as GPU from "./gpu.js";
import * as DRS from "./drsketch.js";
import * as NM from "./nextmeeting.js";
import * as OBJ from "./objsketch.js";
import * as LS from "./lessons.js";
import * as TEAM from "./team.js";
import { connections } from "./graph.js";
import { headline, firstMinute, rankActions, chainText, doneSummary, funnelSegments, preview } from "./today.js";
import { stageBars } from "./nav.js";
import { accountsFirst, accountsAnswer, whyAccount, findingsFirst, findingsAnswer, whyFinding } from "./triage.js";
import { gauge, waterfall, lineChart, contributions, timeline, shareBar, funnel, STAGE, STAGE_NAME } from "./charts.js";
import { nOf, verb } from "./words.js";

const card = (title, body, { sub = "", cls = "", actions = null } = {}) =>
  h("section", { class: "card " + cls }, h("header", { class: "cardhead" }, h("h2", { text: title }), actions), sub ? h("p", { class: "note first", text: sub }) : null, body);
// replaceChildren writes null and undefined as the text "null"; every redraw here goes through this instead
const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const stat = (value, label, kind = "") => h("div", { class: "stat " + kind }, h("b", { text: value }), h("span", { text: label }));
const SEV = { critical: "bad", high: "warn", medium: "", low: "" };
const STATUS_KIND = { ok: "good", pass: "good", watch: "warn", risk: "bad", fail: "bad", note: "", warn: "warn", unknown: "" };

function csvButton(name, columns, getRows) {
  return h("button", { class: "btn small", type: "button", text: "Export CSV", onclick: () => saveBlob(toCsv(columns, getRows()), name, "text/csv") });
}

// ------------------------------------------------------------------ today: the screen to open first
export function todayView({ result, dash, score, go, history = [], done = new Set(), markDone = () => {}, marks = { stillOpen: [], confirmed: [] } }) {
  const flags = attention({ result, dash, score });
  if (marks.stillOpen.length) {
    const n = marks.stillOpen.length;
    flags.unshift({ kind: "bad", title: `${n} action${n === 1 ? "" : "s"} you marked done ${n === 1 ? "is" : "are"} still in the newer data`,
      text: marks.stillOpen.slice(0, 2).map((x) => `${x.title} (marked ${x.done_on})`).join("; ") + ". The work did not land, or not everywhere.", go: "actions", cta: "Open actions" });
  }
  const big = (label, hint, to) => h("button", { class: "bigbtn", type: "button", onclick: () => go(to) }, h("b", { text: label }), h("small", { text: hint }));
  const seen = (() => { try { return localStorage.getItem("beyond90.tour") === "1"; } catch { return false; } })();
  const tour = seen ? null : h("section", { class: "card tour", "aria-label": "Your first minute" },
    h("header", { class: "cardhead" }, h("h2", { text: "Your first minute" })),
    h("ol", { class: "tourlist" }, firstMinute(dash.actions.length).map((st) => h("li", {}, h("span", { text: st.text }), st.to ? h("button", { class: "btn small", type: "button", text: st.cta, onclick: () => go(st.to) }) : null))),
    h("button", { class: "btn small", type: "button", text: "Got it, hide this", onclick: (e) => { try { localStorage.setItem("beyond90.tour", "1"); } catch { /* storage may be off */ } e.target.closest(".tour").remove(); } }));

  // the hero: the number, the sentence, and the trend when there are saved snapshots
  const pts_ = history.slice().sort((a, b) => a.as_of.localeCompare(b.as_of)).slice(-8);
  const trend = pts_.length >= 2 ? (() => {
    const W = 160, H = 40, lo = Math.min(...pts_.map((x) => x.yield)) - 0.02, hi = Math.max(...pts_.map((x) => x.yield)) + 0.02;
    const xy = pts_.map((x, i) => [Math.round((i / (pts_.length - 1)) * W), Math.round(H - ((x.yield - lo) / Math.max(hi - lo, 0.01)) * H)]);
    const delta = pts_.at(-1).yield - pts_[0].yield;
    return h("div", { class: "trend" }, h("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `Yield over ${pts_.length} snapshots` }, h("polyline", { points: xy.map((p) => p.join(",")).join(" "), fill: "none", stroke: "#5eead4", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" })),
      h("small", { text: `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pts over ${pts_.length} snapshots` }));
  })() : null;
  // the live preview: pointing at an action shows where Yield would land, and the stage it works on grows in place
  const tprev = h("span", { class: "tprev", "aria-hidden": "true" });
  const hero = h("section", { class: "card todayhero" },
    h("div", { class: "todayscore" }, h("span", { class: "tnum", text: pct(score.yield) }), tprev, h("span", { class: "tcap", text: "Yield" }), trend),
    h("p", { class: "tline", text: headline({ customer: result.customer, yield: score.yield, target: score.target && score.target.value, stages: score.stages, openActions: dash.actions.length }) }));

  // where it leaks: the four stages as bars, the weakest one marked, the multiplication written out
  const bars = stageBars(score);
  const o = dash.outlook || {};
  const leak = card("Where it leaks", h("div", {},
    h("ul", { class: "stagebars" }, bars.map((b) => h("li", { class: b.weakest ? "weak" : "", dataset: { stage: b.id } },
      h("span", { class: "sb-id", text: b.id }), h("span", { class: "sb-l", text: b.label }),
      h("span", { class: "sb-track", "aria-hidden": "true" }, h("i", { class: "ghost" }), h("i", { style: `width:${Math.max(2, b.value * 100).toFixed(1)}%` })),
      h("b", { class: "sb-v", text: pct(b.value) })))),
    h("p", { class: "chain", text: chainText(bars, score.yield) }),
    (() => {
      const e = score.end_to_end, segs = funnelSegments(e);
      if (!segs.length) return null;
      const units = (score.terms && score.terms.units) || "accounts";
      return h("div", { class: "e2e" },
        h("p", { class: "e2e-lead" }, h("b", { text: `${e.through} of ${e.total} ${units}` }), h("span", { text: " pass every stage. Yield gives partial credit; this does not." })),
        h("div", { class: "e2e-bar", role: "img", "aria-label": segs.map((x) => `${x.n} ${x.label}`).join(", ") },
          segs.map((x) => h("i", { class: "seg-" + x.id, style: `width:${(x.share * 100).toFixed(2)}%${x.id === "through" ? "" : `;background:${STAGE[x.id]}`}`, title: `${x.n} ${x.label}` }))),
        h("ul", { class: "e2e-key" }, segs.map((x) => h("li", {}, h("button", { type: "button", class: "e2e-go", dataset: { stop: x.id }, "aria-label": `${x.n} ${x.label}: show them in ${units}`, onclick: () => go("accounts", { open: "stop:" + x.id }) },
          h("span", { class: "sw seg-" + x.id, style: x.id === "through" ? "" : `background:${STAGE[x.id]}` }), h("span", { text: `${x.n} ${x.label}` }))))));
    })(),
    o.loss_points > 0.05 ? h("p", { class: "note", text: `If nothing is done, Yield loses about ${o.loss_points.toFixed(1)} points in ${o.horizon_days} days.` }) : null),
    { cls: "leakcard", actions: h("button", { class: "btn small", type: "button", text: "Full picture", onclick: () => go("overview") }) });

  // do these first, with a switch between the biggest effect and the quickest wins
  let mode = (() => { try { const m = localStorage.getItem("beyond90.rank"); return m === "quick" || m === "finish" ? m : "effect"; } catch { return "effect"; } })();
  const list = h("div", { class: "opps" });
  const left = dash.actions.filter((a) => !done.has(a.id));
  const doneBtn = (a, isDone) => h("button", { type: "button", class: "donebtn", "aria-pressed": String(isDone), "aria-label": `${isDone ? "Undo done" : "Mark done"}: ${a.title}`,
    text: isDone ? "Undo" : "Mark done", onclick: () => markDone(a.id, !isDone) });
  const show = (a) => {
    const p = preview(bars, score.yield, a);
    const root = list.closest(".today");
    if (!p || !root) return;
    tprev.textContent = `→ ${pct(p.yield)}`;
    root.classList.add("previewing");
    for (const li of root.querySelectorAll(".stagebars li")) {
      const g = li.querySelector(".ghost"), v = li.querySelector(".sb-v"), on = li.dataset.stage === p.stage;
      if (!v.dataset.orig) v.dataset.orig = v.textContent;
      li.classList.toggle("moving", on);
      g.style.width = on ? `${(p.stageValue * 100).toFixed(1)}%` : "0";
      v.textContent = on ? pct(p.stageValue) : v.dataset.orig;
    }
  };
  const hide = () => {
    const root = list.closest(".today");
    tprev.textContent = "";
    if (!root) return;
    root.classList.remove("previewing");
    for (const li of root.querySelectorAll(".stagebars li")) {
      const v = li.querySelector(".sb-v");
      li.classList.remove("moving"); li.querySelector(".ghost").style.width = "0";
      if (v.dataset.orig) v.textContent = v.dataset.orig;
    }
  };
  const paint = () => put(list, ...(left.length ? rankActions(left, mode).map((a) => h("div", { class: "opprow", onmouseenter: () => show(a), onmouseleave: hide, onfocusin: () => show(a), onfocusout: hide },
    h("button", { type: "button", class: "opp", onclick: () => go("actions", { open: a.id }) },
      h("span", { class: "stagepip", style: `border-color:${STAGE[a.leak] || "var(--accent)"}`, text: a.leak }),
      h("span", { class: "opp-t" }, h("b", { text: a.title }), h("small", { text: `${a.owner}, due ${a.due}, about ${a.hours.toFixed(1)} h` + (a.unlocks ? `, finishes ${a.unlocks} ${a.unlocks === 1 ? score.terms.unit : score.terms.units}` : "") })),
      h("span", { class: "opp-e", text: "+" + a.effect.toFixed(1) + " pts" })),
    doneBtn(a, false))) : [h("p", { class: "note", text: dash.actions.length ? "Every action is marked done. Load the next data to see the real figure." : "Nothing is waiting to be done." })]));
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Rank the actions by" }, [["effect", "Biggest effect"], ["quick", "Quickest wins"], ["finish", "Most finished"]].map(([id, label]) =>
    h("button", { type: "button", "aria-pressed": String(mode === id), dataset: { rank: id }, text: label, onclick: (e) => {
      mode = id; try { localStorage.setItem("beyond90.rank", id); } catch { /* not kept */ }
      for (const b of e.currentTarget.parentElement.children) b.setAttribute("aria-pressed", String(b.dataset.rank === id));
      paint();
    } })));
  paint();
  const sum = doneSummary(dash.actions, done, score.yield);
  const progress = sum.n ? h("div", { class: "doneprog", role: "status" },
    h("p", {}, h("b", { text: `${sum.n} marked done: up to +${sum.points.toFixed(1)} pts, about ${pct(sum.projected)}` })),
    h("p", { class: "note", text: "Effects overlap, so this is an upper estimate. The marks are kept with this customer's saved data; the next data load checks them." }),
    h("ul", { class: "donelist" }, dash.actions.filter((a) => done.has(a.id)).map((a) => h("li", {}, h("s", { text: a.title }), doneBtn(a, true))))) : null;
  const confirmedNote = marks.confirmed.length ? h("p", { class: "note good-note", text: `${marks.confirmed.length} action${marks.confirmed.length === 1 ? "" : "s"} you marked done earlier ${marks.confirmed.length === 1 ? "is" : "are"} gone from this data: confirmed.` }) : null;
  const todo = card("Do these first", h("div", {}, confirmedNote, progress, list, left.length > 3 ? h("button", { class: "linkbtn", type: "button", text: `See all ${left.length} open actions`, onclick: () => go("actions") }) : null), { cls: "todocard", actions: seg });

  // keep an eye on: up to three, each with its door
  const watch = card("Keep an eye on", flags.length ? h("ul", { class: "watch" }, flags.slice(0, 3).map((f) => h("li", { class: f.kind },
    h("span", { class: "w-t" }, h("b", { text: f.title }), f.text ? h("small", { text: f.text }) : null),
    f.go ? h("button", { class: "btn small", type: "button", text: f.cta || "Open", onclick: () => go(f.go) }) : null)),
    flags.length > 3 ? h("li", { class: "more" }, h("button", { class: "linkbtn", type: "button", text: `${flags.length - 3} more on the overview`, onclick: () => go("overview") })) : null)
    : h("p", { class: "note", text: "Nothing stands out." }), { cls: "watchcard" });

  return h("div", { class: "today" },
    h("div", { class: "t-hero" }, hero), h("div", { class: "t-leak" }, leak),
    tour ? h("div", { class: "t-wide" }, tour) : null,
    h("div", { class: "t-todo" }, todo), h("div", { class: "t-watch" }, watch),
    h("div", { class: "t-wide bigrow" }, big("Prepare the call", "What to say and ask", "prep"), big("Proof of value", "Criteria, sessions, result", "pov"), big("One-page summary", "To send or print", "onepager"), big("Risk burn-down", "Is risk going away?", "burndown")));
}

// ------------------------------------------------------------------ overview
export function overview({ result, dash, score, go }) {
  const st = score.stages, unit = score.terms.units;
  const rub = score.rubric, lv = rub.levels.find((l) => l.level === rub.level), next = rub.next_level;
  const heroRight = h("div", { class: "hero-right" },
    h("div", { class: "levelrow" },
      h("span", { class: "levelbadge lv-" + rub.level, text: cap(rub.level) + (rub.provisional ? " (provisional)" : "") }),
      next ? h("span", { class: "note", text: `${rub.blocking.length} check${rub.blocking.length === 1 ? "" : "s"} to ${cap(next)}` }) : h("span", { class: "note", text: "Top level" })),
    h("p", { class: "legacy" }, "The old metric says ", h("b", { text: pct(score.naive) }), score.naive != null ? h("span", { class: "gap", text: ` (${((score.naive - score.yield) * 100).toFixed(1)} points higher than what is really working)` }) : null),
    h("div", { class: "mini" }, stat(pct(score.target.value, 0), `target (${score.target.mode})`)),
    score.baseline && Math.abs(score.baseline.yield - score.yield) > 0.0005 ? h("p", { class: "note", text: `Against the frozen baseline ceiling (${score.baseline.ceiling}) Yield is ${pct(score.baseline.yield)}; the difference is headroom added by releases since.` }) : null);
  const hero = h("section", { class: "card hero" }, h("div", { class: "gaugebox" }, gauge({ value: score.yield, marker: score.naive })), heroRight);

  const flags = attention({ result, dash, score });
  const top = dash.actions.slice(0, 5);
  const opp = h("div", { class: "opps" }, top.map((a) => h("button", { type: "button", class: "opp", onclick: () => go("actions", { open: a.id }) },
    h("span", { class: "stagepip", style: `border-color:${STAGE[a.leak] || "var(--accent)"}`, text: a.leak }),
    h("span", { class: "opp-t" }, h("b", { text: a.title }), h("small", { text: `${a.owner} · due ${a.due} · ${a.hours.toFixed(1)} h` })),
    h("span", { class: "opp-e", text: "+" + a.effect.toFixed(1) + " pts" }))));

  const p = dash.plan, pw = p.weeks;
  const planChart = lineChart({ series: [{ label: "Planned Yield", points: pw.map((w) => [w.week, w.yield]) }], marks: [{ y: 0.9, label: "90%" }],
    milestones: Object.entries(p.milestones).filter(([, w]) => w != null).map(([k, w]) => ({ x: w, y: pw.find((q) => q.week === w)?.yield ?? 0, label: `${k} in week ${w}` })), H: 210 });

  const { stake, decay } = stakeAndDecay({ dash, go });
  const plan = card("If you follow the plan", planChart, { sub: `${p.hours_per_week} h a week for ${p.horizon_weeks} weeks at ${Math.round(p.realization * 100)}% realization: ` + (p.milestones["90%"] != null ? `90% in week ${p.milestones["90%"]}.` : "90% is not reached in this horizon."), actions: h("button", { class: "btn small", type: "button", text: "What-if", onclick: () => go("planview") }) });
  // Read top to bottom: the score; what needs attention now; where it is lost (by count and by stake); the two futures; what to do.
  return h("div", { class: "grid" },
    hero,
    card("Needs attention", flags.length ? h("ul", { class: "flags" }, flags.map((f) => h("li", { class: f.kind }, h("b", { text: f.title }), h("span", { text: f.text }), f.go ? h("button", { class: "link", type: "button", text: f.cta || "Open", onclick: () => go(f.go) }) : null))) : h("p", { class: "note", text: "Nothing stands out." })),
    h("div", { class: "col2 pair" },
      card("Where Yield is lost", waterfall(st), { sub: `Yield = ${Object.keys(st).join(" × ")}. Each stage is measured against its own denominator of ${unit}.` }),
      stake),
    h("div", { class: "col2 pair" }, plan, decay),
    card("Biggest opportunities", opp, { sub: "Ranked by points of Yield per hour of work. Effects interact; the plan accounts for that.", actions: h("button", { class: "btn small", type: "button", text: "All actions", onclick: () => go("actions") }) }));
}

function stakeAndDecay({ dash, go }) {
  const o = dash.outlook, st = dash.stake;
  if (!o || !st) return { stake: null, decay: null };
  const rows = ["L1", "L2", "L3", "L4"].map((k) => h("li", {}, h("span", { class: "rl", text: `${k} ${STAGE_NAME[k]}` }),
    h("span", { class: "rb two" }, h("i", { class: "cnt", style: `width:${st.count[k] * 100}%` }), h("i", { class: "wgt", style: `width:${st.stages[k] * 100}%` })),
    h("span", { class: "rn", text: `${pct(st.count[k], 0)} → ${pct(st.stages[k], 0)}` })));
  const first = o.events.find((e) => (e.points || 0) < 0);
  return {
    stake: card("Weighted by what is at stake", h("div", {},
      h("div", { class: "kpiline" }, stat(pct(st.yield), "Yield, by count"), stat(pct(st.value), st.criticality_known ? "Yield, by spend, criticality and exposure" : "Yield, by spend and exposure", st.value < st.yield - 0.02 ? "bad" : st.value > st.yield + 0.02 ? "good" : "")),
      st.say.length ? h("p", { class: "bad-text", text: st.say[0] }) : h("p", { class: "note first", text: "Counting and weighting agree: the gaps are where the stake is, not more or less." }),
      h("ul", { class: "rates wide" }, rows), h("p", { class: "legendline note" }, h("i", { class: "sw cnt" }), " by count ", h("i", { class: "sw wgt" }), " by stake")),
      { sub: `Accounts weigh their ${st.weights.accounts}; findings weigh ${st.weights.findings}.` }),
    decay: card("If nothing is done", h("div", {},
      h("div", { class: "kpiline" }, stat(`${o.loss_points.toFixed(1)} pts`, `in ${o.horizon_days} days`, o.loss_points < -1 ? "bad" : ""), first ? stat(first.date, "first drop", "warn") : null, stat(String(o.events.length), "dated events")),
      lineChart({ series: [{ label: "If nothing is done", points: o.curve.map((c) => [c.day, c.yield]), color: "var(--neg)" }], xLabel: "days", H: 170, yMax: Math.min(1, o.curve[0].yield + 0.05) })),
      { sub: "Scored on future dates with only what the data already dates: secrets, acceptances, triage windows.", actions: h("button", { class: "btn small", type: "button", text: "Outlook", onclick: () => go("outlook") }) }),
  };
}

function attention({ result, dash, score }) {
  const out = [], o = score.outcomes, u = score.universe;
  const ob = dash.onboarding;
  if (ob && (ob.listed_but_broken.length || ob.stalled.length)) out.push({ kind: ob.listed_but_broken.length ? "bad" : "warn", title: ob.listed_but_broken.length ? `${ob.listed_but_broken.length} ${ob.listed_but_broken.length === 1 ? "connector counted as connected is" : "connectors counted as connected are"} failing` : `${ob.stalled.length} ${ob.stalled.length === 1 ? score.terms.unit : score.terms.units} stuck in onboarding`, text: ob.waves[0] ? `Unblock first: ${ob.waves[0].title} (${ob.waves[0].count}).` : "", go: "onboarding", cta: "See onboarding" });
  if (ob && ob.secrets.some((x) => x.days_left <= 14)) out.push({ kind: "warn", title: "A connector secret expires within two weeks", text: ob.secrets.filter((x) => x.days_left <= 14).map((x) => `${x.connector} (${x.expires_on})`).join(", "), go: "onboarding" });
  const late = score.relationship?.reliability?.overdue_open || [];
  if (late.length) out.unshift({ kind: "bad", title: `${late.length} promise${late.length === 1 ? "" : "s"} to the customer ${late.length === 1 ? "is" : "are"} overdue`, text: "Keep the date, or tell them early that it will move.", go: "commitments", cta: "Open promises" });
  const rh = dash.rhythm;
  if (rh && (rh.touch.state === "overdue" || rh.touch.state === "never")) out.unshift({ kind: "bad", title: rh.touch.state === "never" ? "No touch on record" : `${rh.touch.days_since} days since the last touch`, text: `The cadence for this customer is every ${rh.touch.cadence_days} days.`, go: "prep", cta: "Prepare the call" });
  const news = rh ? rh.exposures.filter((e) => e.uncovered && (e.severity === "critical" || e.severity === "high")) : [];
  if (news.length) out.push({ kind: "warn", title: `${news.length} advisor${news.length === 1 ? "y" : "ies"} touch${news.length === 1 ? "es" : ""} uncovered ${score.terms.units}`, text: news.map((e) => e.id).join(", "), go: "news", cta: "See the news" });
  if (o.critical_open) out.push({ kind: "bad", title: `${o.critical_open} critical finding${o.critical_open === 1 ? "" : "s"} open`, text: dash.forecast?.available && dash.forecast.p50_days ? `At the current pace, zero is about ${dash.forecast.p50_days} days away.` : "No forecast available.", go: "findings" });
  const ren = dash.renewal;
  if (ren && ren.status && ren.status !== "healthy") out.push({ kind: ren.status === "at_risk" ? "bad" : "warn", title: `Renewal in ${ren.days} days: ${ren.status.replace("_", " ")}`, text: `${num(ren.arr_at_risk || ren.arr || 0)} of annual revenue is involved.`, go: "renewal" });
  if (u && u.estimable && u.unseen_estimate >= 1) out.push({ kind: "warn", title: `About ${Math.round(u.unseen_estimate)} ${score.terms.units} no source has seen`, text: `If unconnected, the real L1 is ${pct(u.pessimistic_l1)}.`, go: "renewal", cta: "See estimate" });
  if (o.reclassification_suspects?.length) out.push({ kind: "warn", title: `${o.reclassification_suspects.length} severity downgrade${o.reclassification_suspects.length === 1 ? "" : "s"} near a deadline`, text: "Remediation times may look better than they are.", go: "findings" });
  if (result.confidence && result.confidence !== "high") out.push({ kind: "warn", title: `Input confidence: ${result.confidence}`, text: "Some checks on the files themselves did not pass; Yield is unchanged, trust it less.", go: "maturity" });
  const ent = (score.entitlements || []).filter((e) => e.below_target);
  if (ent.length) out.push({ kind: "warn", title: `${ent.length} licence${ent.length === 1 ? "" : "s"} under-used`, text: ent.map((e) => `${e.unit} ${pct(e.utilization, 0)}`).join(", "), go: "renewal" });
  if (dash.drift && dash.drift.status && dash.drift.status !== "ok") out.push({ kind: "warn", title: "The inputs look different in a suspicious way", text: "Check before presenting the change.", go: "changes" });
  return out;
}

// ------------------------------------------------------------------ actions
export function actionsView({ dash, score, focus }) {
  const rows = dash.actions.map((a, i) => ({ ...a, rank: i + 1 }));
  let q = "", leaks = new Set();
  const cols = [
    { key: "rank", label: "#", num: true },
    { key: "leak", label: "Stage", render: (r) => h("span", { class: "stagepip", style: `border-color:${STAGE[r.leak] || "var(--accent)"}`, text: r.leak }) },
    { key: "title", label: "Action", render: (r) => h("span", {}, h("b", { text: r.title }), h("small", { class: "block", text: r.detail })) },
    { key: "effect", label: "Effect", num: true, render: (r) => "+" + r.effect.toFixed(1) + " pts" },
    { key: "unlocks", label: `${cap(score.terms.units)} finished`, num: true, sort: (r) => r.unlocks ?? -1, render: (r) => (r.unlocks == null ? h("span", { class: "dim", text: "—" }) : String(r.unlocks)) },
    { key: "hours", label: "Hours", num: true, render: (r) => r.hours.toFixed(1) },
    { key: "owner", label: "Owner" },
    { key: "due", label: "Due" },
  ];
  const t = dataTable({ columns: cols, rows, pageSize: 25, label: "Actions", empty: "No action matches.",
    expand: (r) => h("div", { class: "expand" },
      r.steps.length ? h("div", {}, h("h3", { text: "Steps" }), h("ol", {}, r.steps.map((s) => h("li", { text: s })))) : null,
      r.success ? h("p", {}, h("b", { text: "Done when: " }), r.success) : null,
      r.question ? h("p", {}, h("b", { text: "Ask the customer: " }), r.question) : null,
      r.commit ? h("p", {}, h("b", { text: "We commit to: " }), r.commit) : null,
      h("button", { class: "btn small", type: "button", text: "Copy as ticket", onclick: (e) => copyText(ticket(r, score)).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) })) });
  const apply = () => t.setFilter((r) => (!leaks.size || leaks.has(r.leak)) && (!q || (r.title + " " + r.detail + " " + r.owner).toLowerCase().includes(q)));
  const total = rows.reduce((a, r) => a + r.effect, 0), hrs = rows.reduce((a, r) => a + r.hours, 0);
  const start = rows.slice(0, 3).map((r) => h("article", { class: "startcard" },
    h("div", { class: "startgain" }, h("span", { class: "gn", text: "+" + r.effect.toFixed(1) }), h("span", { class: "gl", text: "points" })),
    h("div", { class: "startbody" },
      h("h3", {}, h("span", { class: "stagepip", style: `border-color:${STAGE[r.leak] || "var(--accent)"}`, text: r.leak }), " ", r.title),
      h("p", { class: "startdetail", text: r.detail }),
      h("p", { class: "startmeta", text: `${r.hours.toFixed(1)} h of work · ${r.owner} · due ${r.due}` }),
      r.steps.length || r.success || r.question ? h("details", { class: "how" }, h("summary", { text: "How to do it" }),
        r.steps.length ? h("ol", {}, r.steps.map((s) => h("li", { text: s }))) : null,
        r.success ? h("p", {}, h("b", { text: "Done when: " }), r.success) : null,
        r.question ? h("p", {}, h("b", { text: "Ask the customer: " }), r.question) : null) : null,
      h("button", { class: "btn small", type: "button", text: "Copy as ticket", onclick: (e) => copyText(ticket(r, score)).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }))));
  return h("div", {},
    rows.length ? h("section", { class: "startrow", "aria-label": "Start with these" }, h("h3", { class: "sect", text: rows.length > 3 ? "Start with these three" : "Start with these" }), start) : null,
    rows.length > 3 ? h("h3", { class: "sect", text: `All ${rows.length} actions` }) : null,
    h("div", { class: "toolbar" }, searchBox("Search actions", (v) => { q = v; apply(); }),
      chipFilter("Stage", ["L1", "L2", "L3", "L4"], (s) => { leaks = s; apply(); }),
      csvButton("beyond90-actions.csv", [{ key: "rank", label: "rank" }, { key: "leak", label: "stage" }, { key: "title", label: "action" }, { key: "detail", label: "detail" }, { key: "effect", label: "effect_points" }, { key: "hours", label: "hours" }, { key: "owner", label: "owner" }, { key: "due", label: "due" }], () => t.rows())),
    h("p", { class: "note", text: `${rows.length} actions, ${hrs.toFixed(0)} hours in all. Effects are estimates that treat each stage on its own; use them to rank, not to add up (the sum here would be ${total.toFixed(0)} points).` }),
    t.el);
}
const ticket = (a, score) => [`[${score.customer}] ${a.title}`, "", a.detail, "", `Stage: ${a.leak}  ·  Effect: +${a.effect.toFixed(1)} pts  ·  Effort: ${a.hours.toFixed(1)} h  ·  Owner: ${a.owner}  ·  Due: ${a.due}`, "", ...(a.steps.length ? ["Steps:", ...a.steps.map((s, i) => `${i + 1}. ${s}`), ""] : []), a.success ? `Done when: ${a.success}` : ""].join("\n").trim();

// ------------------------------------------------------------------ accounts
const STOP_LABEL = { L1: "connected", L2: "seen", L3: "switched on", L4: "decided" };
export function accountsView({ dash, score, focus }) {
  const A = dash.accounts, unit = cap(score.terms.unit), rows = A.rows;
  let q = "", prov = new Set(), flt = new Set(), stop = new Set();
  const cols = [
    { key: "id", label: unit, render: (r) => h("b", { text: r.id }) },
    { key: "provider", label: "Provider" },
    { key: "owner", label: "Owner", render: (r) => r.owner || h("span", { class: "dim", text: "—" }) },
    { key: "spend", label: "Spend", num: true, render: (r) => num(r.spend) },
    { key: "connected", label: "State", sort: (r) => (r.connected ? 1 : 0), render: (r) => chip(r.connected ? "connected" : "not connected", r.connected ? "good" : "bad") },
    { key: "issues", label: "Gaps", num: true, render: (r) => (r.issues ? chip(String(r.issues), r.issues > 3 ? "bad" : "warn") : chip("0", "good")) },
    { key: "stop", label: "Stops at", sort: (r) => (r.stop ? Number(r.stop[1]) : 9), render: (r) => (r.stop ? chip(`${r.stop} ${STOP_LABEL[r.stop]}`, r.stop === "L1" ? "bad" : "warn") : chip("passes all", "good")) },
    { key: "open_findings", label: "Open findings", num: true, render: (r) => (r.open_critical ? `${r.open_findings} (${r.open_critical} critical)` : String(r.open_findings)) },
  ];
  const t = dataTable({ columns: cols, rows, pageSize: 40, label: "Accounts", empty: `No ${score.terms.unit} matches.`,
    expand: (r) => h("div", { class: "expand" },
      h("p", {}, h("b", { text: "Seen by: " }), r.sources.join(", ") || "none"),
      r.connected ? null : h("p", { class: "bad-text", text: "Not connected: it counts against L1." }),
      r.missing_types.length ? h("p", {}, h("b", { text: "Not inventoried: " }), r.missing_types.join(", ")) : null,
      r.inactive_modules.length ? h("p", {}, h("b", { text: "Capabilities off: " }), r.inactive_modules.join(", ")) : null,
      !r.issues ? h("p", { class: "dim", text: "Nothing missing." }) : null) });
  const apply = () => t.setFilter((r) => (!stop.size || stop.has(r.stop || "through")) && (!prov.size || prov.has(r.provider)) && (!flt.size || [...flt].every((f) => (f === "gaps" ? r.issues > 0 : f === "unconnected" ? !r.connected : f === "critical" ? r.open_critical > 0 : f === "unowned" ? !r.owner : true))) &&
    (!q || (r.id + " " + r.owner + " " + r.provider).toLowerCase().includes(q)));
  const conn = rows.filter((r) => r.connected).length;
  const ans = accountsAnswer(rows, score.terms), first = accountsFirst(rows);
  const stopPick = chipFilter("Stops at", [{ label: "passes all", value: "through" }, ...["L1", "L2", "L3", "L4"].map((k) => ({ label: `${k} ${STOP_LABEL[k]}`, value: k }))], (s) => { stop = s; apply(); });
  const preset = typeof focus === "string" && focus.startsWith("stop:") ? focus.slice(5) : "";
  if (preset) { const b = [...stopPick.querySelectorAll("button")].find((x) => x.textContent.startsWith(preset === "through" ? "passes" : preset + " ")); if (b) queueMicrotask(() => b.click()); }
  return h("div", {},
    h("section", { class: "card bdhero" }, h("p", { class: "bdlead", role: "status", text: ans.lead }), h("p", { class: "bdnoise", text: ans.detail })),
    first.length ? h("section", { class: "worklist", "aria-label": "Look at these first" }, h("h3", { class: "sect", text: "Look at these first" }),
      h("ul", { class: "firstlist" }, first.map((r) => h("li", {}, h("b", { text: r.id }), h("span", { text: ` (${r.provider}${r.owner ? `, ${r.owner}` : ", no owner"})` }), h("small", { class: "block", text: whyAccount(r) }))))) : null,
    h("div", { class: "kpiline" }, stat(String(A.total), `${score.terms.units} in scope`), stat(String(conn), "connected", "good"), stat(String(A.total - conn), "not connected", A.total - conn ? "bad" : ""), stat(String(rows.filter((r) => r.issues).length), "with at least one gap")),
    h("div", { class: "toolbar" }, searchBox(`Search ${score.terms.units} or owner`, (v) => { q = v; apply(); }),
      stopPick,
      chipFilter("Provider", A.providers, (s) => { prov = s; apply(); }),
      chipFilter("Show", [{ label: "with gaps", value: "gaps" }, { label: "not connected", value: "unconnected" }, { label: "critical findings", value: "critical" }, { label: "no owner", value: "unowned" }], (s) => { flt = s; apply(); }),
      csvButton("beyond90-accounts.csv", [{ key: "id", label: "id" }, { key: "stop", label: "stops_at" }, { key: "provider", label: "provider" }, { key: "owner", label: "owner" }, { key: "spend", label: "last_spend" }, { key: "connected", label: "connected" }, { key: "issues", label: "gaps" }, { key: "missing_types", label: "not_inventoried", csv: (r) => r.missing_types.join(";") }, { key: "inactive_modules", label: "capabilities_off", csv: (r) => r.inactive_modules.join(";") }, { key: "open_findings", label: "open_findings" }], () => t.rows())),
    A.truncated ? h("p", { class: "note", text: `Showing the ${rows.length} with the most gaps of ${A.total}.` }) : null,
    t.el);
}

// ------------------------------------------------------------------ findings
export function findingsView({ dash, score }) {
  const F = dash.findings, rows = F.rows, S = F.states;
  const label = { unowned: "no owner", no_decision: "no decision", accepted_without_expiry: "accepted, no expiry", expired_acceptance: "acceptance expired", ok: "owned and decided", in_window: `inside the ${F.triage_window_days}-day window` };
  const color = { unowned: "var(--neg)", no_decision: "var(--s2)", accepted_without_expiry: "var(--s4)", expired_acceptance: "var(--s1)", ok: "var(--pos)", in_window: "var(--grid)" };
  let q = "", sev = new Set(), st = new Set();
  const cols = [
    { key: "id", label: "Finding", render: (r) => h("b", { text: r.id }) },
    { key: "severity", label: "Severity", sort: (r) => ["critical", "high", "medium", "low"].indexOf(r.severity), render: (r) => chip(r.severity, SEV[r.severity] || "") },
    { key: "account", label: cap(score.terms.unit) },
    { key: "exposure", label: "Exposure" },
    { key: "age_days", label: "Age (days)", num: true },
    { key: "owner", label: "Owner", render: (r) => r.owner || h("span", { class: "bad-text", text: "none" }) },
    { key: "decision", label: "Decision", render: (r) => (r.decision ? r.decision.replace("_", " ") + (r.expiry ? ` until ${r.expiry}` : "") : h("span", { class: "dim", text: "—" })) },
    { key: "state", label: "Status", render: (r) => chip(label[r.state] || r.state, r.state === "ok" ? "good" : r.state === "in_window" ? "" : "warn") },
  ];
  const t = dataTable({ columns: cols, rows, pageSize: 40, label: "Open findings", empty: "No finding matches." });
  const apply = () => t.setFilter((r) => (!sev.size || sev.has(r.severity)) && (!st.size || st.has(r.state)) && (!q || (r.id + " " + r.account + " " + r.owner).toLowerCase().includes(q)));
  const ans = findingsAnswer(F), first = findingsFirst(rows);
  return h("div", {},
    h("section", { class: "card bdhero" }, h("p", { class: "bdlead", role: "status", text: ans.lead }), h("p", { class: "bdnoise", text: ans.detail })),
    first.length ? h("section", { class: "worklist", "aria-label": "Look at these first" }, h("h3", { class: "sect", text: "Look at these first" }),
      h("ul", { class: "firstlist" }, first.map((r) => h("li", {}, h("b", { text: r.id }), h("span", { text: ` (${r.account})` }), h("small", { class: "block", text: whyFinding(r) }))))) : null,
    card("Open findings past triage", shareBar(Object.keys(label).filter((k) => S[k]).map((k) => ({ label: label[k], value: S[k], color: color[k] }))), { sub: "L4 counts a finding as good when it has an owner and a decision; an accepted risk also needs an expiry that has not passed." }),
    h("ul", { class: "legend" }, Object.keys(label).filter((k) => S[k]).map((k) => h("li", {}, h("i", { style: `background:${color[k]}` }), `${label[k]}: ${S[k]}`))),
    h("div", { class: "toolbar" }, searchBox("Search finding, account or owner", (v) => { q = v; apply(); }),
      chipFilter("Severity", ["critical", "high", "medium", "low"], (s) => { sev = s; apply(); }),
      chipFilter("Status", Object.keys(label).filter((k) => S[k]).map((k) => ({ label: label[k], value: k })), (s) => { st = s; apply(); }),
      csvButton("beyond90-findings.csv", cols.map((c) => ({ key: c.key, label: c.label })), () => t.rows())),
    F.truncated ? h("p", { class: "note", text: `Showing ${rows.length} of ${F.total}, worst first.` }) : null,
    t.el);
}

// ------------------------------------------------------------------ plan and what-if
export function planView({ dash, score, files, engine, options }) {
  const base = dash.plan;
  let cur = base, seq = 0, timer = null;
  const out = h("div", { class: "planout" });
  const inputs = {
    hours: slider("Hours per week", 1, 40, 0.5, base.hours_per_week, (v) => `${v} h`),
    weeks: slider("Horizon", 4, 104, 1, base.horizon_weeks, (v) => `${v} weeks`),
    real: slider("Realization", 0.3, 1, 0.05, base.realization, (v) => `${Math.round(v * 100)}%`),
  };
  const status = h("p", { class: "note", role: "status" });
  function draw() {
    const w = cur.weeks, dw = base.weeks;
    const series = [{ label: "This scenario", points: w.map((x) => [x.week, x.yield]) }];
    if (cur !== base) series.push({ label: "Original plan", points: dw.map((x) => [x.week, x.yield]), dashed: true, color: "var(--ink2)" });
    const chart = lineChart({ series, marks: [{ y: 0.9, label: "90%" }, { y: 0.95, label: "95%" }], milestones: Object.entries(cur.milestones).filter(([, k]) => k != null).map(([k, wk]) => ({ x: wk, y: w.find((q) => q.week === wk)?.yield ?? 0, label: `${k} in week ${wk}` })) });
    const end = w.at(-1).yield, hrs = w.reduce((a, x) => a + x.hours, 0);
    put(out, 
      h("div", { class: "kpiline" }, stat(pct(w[0].yield), "now"), stat(pct(end), `after ${cur.horizon_weeks} weeks`, end >= 0.9 ? "good" : ""), stat(cur.milestones["90%"] != null ? `week ${cur.milestones["90%"]}` : "not reached", "90%"), stat(cur.milestones["95%"] != null ? `week ${cur.milestones["95%"]}` : "not reached", "95%"), stat(hrs.toFixed(0) + " h", "hours spent")),
      card("Yield by week", chart, { sub: cur.dips.length ? `Expect a dip around week ${cur.dips[0].week} (${cur.dips[0].drop_points.toFixed(1)} pts): ${cur.dips[0].cause}` : "No dip expected." }),
      card("What gets done, and when", timeline(cur.jobs, cur.horizon_weeks), { sub: "Bars run from the week work starts to the week it lands; colour is the stage it helps." }),
      Object.keys(cur.residual).length ? card("What the plan cannot close", h("ul", {}, Object.entries(cur.residual).map(([k, n]) => h("li", { text: `${n} ${k}` }))), { sub: cur.notes.join(" ") }) : null);
  }
  function slider(label, min, max, step, value, fmt) {
    const input = h("input", { type: "range", min, max, step, value, "aria-label": label });
    const val = h("output", { text: fmt(value) });
    input.addEventListener("input", () => { val.textContent = fmt(Number(input.value)); schedule(); });
    return { el: h("label", { class: "slider" }, h("span", {}, label, " ", val), input), get: () => Number(input.value) };
  }
  function schedule() { clearTimeout(timer); status.textContent = "Recomputing…"; timer = setTimeout(recompute, 350); }
  async function recompute() {
    const mine = ++seq;
    try {
      const r = await engine.json("plan", { files, options: { hours: inputs.hours.get(), weeks: Math.round(inputs.weeks.get()), realization: inputs.real.get() } });
      if (mine !== seq) return;                                    // a newer slider position superseded this answer
      if (!r.ok) { status.textContent = r.errors.join("; "); return; }
      cur = r.plan; status.textContent = ""; draw();
    } catch (e) { if (mine === seq) status.textContent = e.cancelled ? "" : "Could not recompute: " + e.message; }
  }
  draw();
  return h("div", {},
    h("div", { class: "card controls" }, h("h2", { text: "What if…" }), h("div", { class: "sliders" }, inputs.hours.el, inputs.weeks.el, inputs.real.el),
      h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Reset", onclick: () => { for (const [k, v] of [["hours", base.hours_per_week], ["weeks", base.horizon_weeks], ["real", base.realization]]) { const i = inputs[k].el.querySelector("input"); i.value = v; i.dispatchEvent(new Event("input")); } } }), status),
      h("p", { class: "note", text: "The plan is a model: it spends your hours on the action with the best gain per hour, applies a ramp for new connections, and recomputes. Use it to compare scenarios, not to promise dates." })),
    out);
}

// ------------------------------------------------------------------ promises
let promiseScope = "all";                                   // survives the redraw that follows every change
export function commitmentsView({ result, commitments, today, addCommitment, setCommitmentStatus, removeCommitment }) {
  const scope = h("select", { "aria-label": "Show promises for" }, h("option", { value: "all", text: "All customers" }), h("option", { value: "this", text: result.customer }));
  scope.value = promiseScope;
  const body = h("div", {});
  const say = h("p", { class: "note", role: "status" });
  const f = { what: h("input", { type: "text", maxlength: 300, "aria-label": "What was promised", placeholder: "What was promised" }),
    who: h("input", { type: "text", maxlength: 100, "aria-label": "Who owes it", placeholder: "Who (a name, or us)" }),
    due: h("input", { type: "date", "aria-label": "Due date" }) };
  const act = (fn) => async () => { try { await fn(); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const row = (c, { late = false } = {}) => h("li", { class: "promise" },
    h("span", { class: "pmain" }, scope.value === "all" ? h("b", { text: c.customer + ": " }) : null, c.what,
      h("small", { class: "muted", text: ` ${c.who || "owner not said"}${c.due ? `, due ${c.due}` : ", no date"}${late ? `, ${c.days_overdue} days late` : ""}${c.status !== "open" ? `, ${c.status} on ${c.closed_on}` : ""}` })),
    h("span", { class: "btnrow" },
      c.status === "open"
        ? [h("button", { class: "btn small", type: "button", text: "Done", "aria-label": `Mark done: ${c.what}`, onclick: act(() => setCommitmentStatus(c.id, "done")) }),
          h("button", { class: "btn small quiet", type: "button", text: "Drop", "aria-label": `Drop: ${c.what}`, onclick: act(() => setCommitmentStatus(c.id, "dropped")) })]
        : h("button", { class: "btn small quiet", type: "button", text: "Reopen", "aria-label": `Reopen: ${c.what}`, onclick: act(() => setCommitmentStatus(c.id, "open")) }),
      h("button", { class: "icon-btn", type: "button", text: "×", "aria-label": `Delete: ${c.what}`, onclick: act(() => removeCommitment(c.id)) })));
  const group = (title, list, opt) => list.length ? card(title, h("ul", { class: "promises" }, list.map((c) => row(c, opt)))) : null;
  const draw = () => {
    const l = ledger(commitments, today, { customer: scope.value === "this" ? result.customer : "" });
    const n = l.counts;
    put(body, 
      h("div", { class: "kpiline" }, stat(String(n.open), "open"), stat(String(n.overdue), "late", n.overdue ? "bad" : ""), stat(String(n.soon), "due this week", n.soon ? "warn" : ""), stat(String(n.we_owe), "we owe")),
      !commitments.length ? h("p", { class: "note", text: "Nothing is kept yet. Add a promise below, or finish a call and choose “Keep in the ledger”." }) : null,
      group("Late", l.late, { late: true }), group("Due this week", l.soon), group("Open", [...l.later, ...l.undated]), group("Closed in the last 30 days", l.recent),
      l.customers.length > 1 ? card("By customer", h("ul", { class: "rates wide" }, l.customers.map((c) => h("li", {}, h("span", { class: "rl", text: c.customer }), h("span", { class: "rn", text: `${c.open} open${c.overdue ? `, ${c.overdue} late (oldest ${c.oldest_overdue_days} days)` : ""}` }))))) : null);
  };
  scope.addEventListener("change", () => { promiseScope = scope.value; draw(); });
  draw();
  return h("div", {},
    card("Add a promise", h("div", {}, h("div", { class: "formgrid" }, h("label", { class: "wide2" }, "What", f.what), h("label", {}, "Who", f.who), h("label", {}, "By when", f.due)),
      h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Keep in the ledger", onclick: act(async () => { await addCommitment({ what: f.what.value, who: f.who.value, due: f.due.value }); f.what.value = ""; }) })), say),
    { sub: `For ${result.customer}. Promises are kept in this browser, sealed with your passphrase if you set one, and travel with an exported workspace.` }),
    card("Promises", h("div", {}, h("div", { class: "row left" }, h("label", { class: "inline" }, "Show ", scope),
      h("button", { class: "btn small", type: "button", text: "Export CSV", onclick: () => saveBlob(toCsv(CSV_COLUMNS, [...commitments].sort((a, b) => a.customer.localeCompare(b.customer) || a.created_on.localeCompare(b.created_on))), "beyond90-promises.csv", "text/csv") })), body),
    { sub: "Late first, then this week. A promise stays open until you mark it done or drop it." }));
}

// ------------------------------------------------------------------ handoff
export function handoffView({ result, dash, score, commitments, outcomes, history, today }) {
  const from = h("input", { type: "text", maxlength: 80, "aria-label": "From (optional)", placeholder: "From (optional)" });
  const to = h("input", { type: "text", maxlength: 80, "aria-label": "To (optional)", placeholder: "To (optional)" });
  const pre = h("pre", { class: "recap", tabindex: "0", "aria-label": "Handoff note" });
  const build = () => buildHandoff({ score, dash, result, commitments, outcomes, history, today, from: from.value, to: to.value });
  const draw = () => { pre.textContent = build(); };
  from.addEventListener("input", draw); to.addEventListener("input", draw);
  draw();
  return card("Handoff note", h("div", {},
    h("div", { class: "formgrid" }, h("label", {}, "From", from), h("label", {}, "To", to)), pre,
    h("div", { class: "row left" },
      h("button", { class: "btn small primary", type: "button", text: "Copy", onclick: (e) => copyText(build()).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Download .md", onclick: () => saveBlob(build(), `beyond90-handoff-${result.customer.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${today}.md`, "text/markdown") }))),
  { sub: "Built from what this page holds now: the reading, the promises kept here, the renewal log and the saved history. It leaves out your private call notes. Read it before you hand it over." });
}

// ------------------------------------------------------------------ try a combination
const WHATIF_STEPS = [
  { id: "connect", label: "Connect every account that is not connected", steps: [{ kind: "connect_all" }] },
  { id: "enable", label: "Switch on every module that can run", steps: [{ kind: "enable_all" }] },
  { id: "own", label: "Give an owner to findings without one", steps: [{ kind: "fix_findings", leak: "unowned" }] },
  { id: "decide", label: "Record a decision on owned findings", steps: [{ kind: "fix_findings", leak: "no_decision" }] },
  { id: "expire", label: "Put an expiry on accepted risks", steps: [{ kind: "fix_findings", leak: "accepted_without_expiry" }, { kind: "fix_findings", leak: "expired_acceptance" }] },
];

export function whatifView({ dash, score, files, engine }) {
  const tryOut = h("div", { class: "whatifout whatif-try", "aria-live": "polite" });
  const reachOut = h("div", { class: "whatifout whatif-reach", "aria-live": "polite" });
  const status = h("p", { class: "note", role: "status" });
  const boxes = WHATIF_STEPS.map((s) => ({ s, input: h("input", { type: "checkbox", id: "wi-" + s.id }) }));
  const target = h("input", { type: "range", min: 50, max: 99, step: 1, value: 90, "aria-label": "Target Yield" });
  const targetVal = h("output", { text: "90%" });
  let seqTry = 0, seqReach = 0, timer = null;

  async function ask(options) {
    const r = await engine.json("whatif", { files, options });
    if (!r.ok) throw new Error(r.errors.join("; "));
    return r.result;
  }
  function drawTry(sc) {
    const dip = sc.dip ? "warn" : "";
    const t = sc.touched;
    put(tryOut, 
      h("div", { class: "kpiline" },
        stat(pct(sc.today.yield), "today"),
        stat(pct(sc.right_after.yield), "right after", dip),
        stat(pct(sc.steady.yield), `once settled (${pts(sc.steady.delta_points)})`, sc.steady.delta_points > 0 ? "good" : "")),
      h("p", { class: "note", text: `Touches ${t.accounts_connected} accounts to connect, ${t.activations_added} modules to switch on and ${t.findings_fixed} findings to repair.` }),
      ...sc.notes.map((n) => h("p", { class: "note", text: n })));
  }
  async function recomputeTry() {
    const picked = boxes.filter((b) => b.input.checked).flatMap((b) => b.s.steps);
    const mine = ++seqTry;
    if (!picked.length) { put(tryOut, h("p", { class: "note", text: "Tick one or more changes to see where Yield would land." })); return; }
    try {
      const res = await ask({ scenarios: [{ name: "Your combination", steps: picked }] });
      if (mine === seqTry) { status.textContent = ""; drawTry(res.scenarios[0]); }
    } catch (e) { if (mine === seqTry) status.textContent = e.cancelled ? "" : "Could not compute: " + e.message; }
  }
  function drawReach(r) {
    put(reachOut, 
      h("div", { class: "kpiline" }, stat(pct(r.start_yield), "today"), stat(pct(r.end_yield), `after ${r.path.length} step${r.path.length === 1 ? "" : "s"}`, r.reached ? "good" : "warn")),
      r.path.length ? h("ol", { class: "whatif-path" }, r.path.map((p) => h("li", {}, h("b", { text: p.title }), " ", h("span", { class: "muted", text: `${pts(p.gain_points)} → ${pct(p.yield_after)}` })))) : h("p", { class: "note", text: r.reached ? "Already there." : "Nothing this tool can model gets closer." }),
      ...r.notes.map((n) => h("p", { class: "note", text: n })));
  }
  async function recomputeReach() {
    const mine = ++seqReach;
    try {
      const res = await ask({ reach: Number(target.value) / 100 });
      if (mine === seqReach) { status.textContent = ""; drawReach(res); }
    } catch (e) { if (mine === seqReach) status.textContent = e.cancelled ? "" : "Could not compute: " + e.message; }
  }
  function schedule(fn) { clearTimeout(timer); status.textContent = "Recomputing…"; timer = setTimeout(fn, 300); }
  for (const b of boxes) b.input.addEventListener("change", () => schedule(recomputeTry));
  target.addEventListener("input", () => { targetVal.textContent = `${target.value}%`; schedule(recomputeReach); });
  recomputeTry(); recomputeReach();
  return h("div", {},
    card("Try a combination", h("div", {},
      h("fieldset", { class: "checks" }, h("legend", { class: "sr", text: "Changes to try" }),
        boxes.map((b) => h("label", { class: "check" }, b.input, h("span", { text: b.s.label })))),
      tryOut), { sub: "Nothing here changes your data: each combination is tried on a copy." }),
    card("What it takes to reach a target", h("div", {},
      h("label", { class: "slider" }, h("span", {}, "Target Yield ", targetVal), target), reachOut),
      { sub: "The biggest gain first. Effort is not estimated: a small gain can be hard and a large one easy. The roadmap has hours and weeks." }),
    status,
    h("p", { class: "note", text: "Connecting an account first lowers Yield, because it enters the denominators before its inventory and modules arrive. That dip is real, and it is why \"right after\" can sit below \"today\"." }));
}

// ------------------------------------------------------------------ maturity
export function maturityView({ score, dash }) {
  const rub = score.rubric, levels = ["bronze", "silver", "gold"];
  const ladder = h("div", { class: "ladder" }, levels.map((l) => {
    const s = rub.levels.find((x) => x.level === l), done = s.failed === 0 && s.not_measured === 0, here = rub.level === l;
    return h("div", { class: "rung lv-" + l + (done ? " done" : "") + (here ? " here" : "") },
      h("b", { text: cap(l) }), h("span", { text: `${s.passed} of ${s.total} checks` }),
      h("div", { class: "prog" }, h("i", { style: `width:${(s.passed / s.total) * 100}%` })), here ? h("em", { text: "you are here" }) : null);
  }));
  const groups = levels.map((l) => card(cap(l) + " checks", h("ul", { class: "checks" }, rub.checks.filter((c) => c.level === l).map((c) => h("li", { class: c.status },
    chip(c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "not measured", STATUS_KIND[c.status] || ""),
    h("span", {}, h("b", { text: c.title }), h("small", { class: "block", text: `now ${fmtVal(c.value)}, needs ${c.op} ${fmtVal(c.target)}` })))))));
  const lad = dash.ladder;
  const uc = score.views.use_cases.filter((u) => u.rate != null);
  const fn = Object.entries(score.views.csf.functions);
  return h("div", {},
    ladder,
    lad && lad.week != null ? h("p", { class: "note", text: `At ${lad.hours_per_week} hours a week, the roadmap passes the stage checks for ${cap(lad.level)} in week ${lad.week}, after about ${lad.hours.toFixed(0)} hours.` + (lad.outside_plan.length ? ` ${nOf(lad.outside_plan.length, "check")} ${verb(lad.outside_plan.length, "needs", "need")} a decision or a conversation, not hours.` : "") }) : null,
    h("div", { class: "col2" }, card("Adoption by use case", rateBars(uc.map((u) => ({ label: u.label, rate: u.rate, note: `${u.active} of ${u.relevant}` })))),
      card("NIST CSF 2.0 functions", rateBars(fn.map(([k, v]) => ({ label: cap(k), rate: v.rate, note: v.rate == null ? "no capability serves it" : `${v.active} of ${v.relevant}` }))), { sub: "Capability adoption, not a compliance statement." })),
    h("div", { class: "col3" }, groups));
}
const fmtVal = (v) => (v == null ? "n/a" : Math.abs(v) <= 1 && v !== 0 && !Number.isInteger(v) ? pct(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));
function rateBars(items) {
  return h("ul", { class: "rates" }, items.map((i) => h("li", {}, h("span", { class: "rl", text: i.label }), h("span", { class: "rb", role: "img", "aria-label": `${i.label} ${i.rate == null ? "n/a" : pct(i.rate, 0)}` }, i.rate == null ? null : h("i", { style: `width:${i.rate * 100}%` })), h("span", { class: "rn", text: i.rate == null ? "n/a" : pct(i.rate, 0) }), h("small", { text: i.note }))));
}

// ------------------------------------------------------------------ renewal and relationship
function healthCard(hl) {
  if (!hl) return null;
  const kind = hl.band === "healthy" ? "good" : hl.band === "watch" ? "warn" : "bad";
  const weak = hl.weakest ? hl.components.find((c) => c.id === hl.weakest) : null;
  return card("Customer health", h("div", {},
    h("div", { class: "kpiline" }, stat(hl.score == null ? "n/a" : String(hl.score), "out of 100", kind), stat(cap(hl.band), "band", kind), stat(`${hl.measured} of ${hl.of}`, "parts measured")),
    rateBars(hl.components.map((c) => ({ label: `${c.label} · weight ${Math.round(c.weight * 100)}%`, rate: c.value == null ? null : c.value / 100, note: c.reason }))),
    weak ? h("p", { class: "note", text: `The weakest part is ${weak.label.toLowerCase()}, and the band follows it.` }) : null,
    h("p", { class: "note", text: hl.note })), { sub: "Adoption, outcomes, relationship and trajectory in one number you can discuss." });
}

// ------------------------------------------------------------------ on the call
const calls = new Map();   // one call in progress per customer and data date, kept while the person moves between views

/** One screen to use during the call: the agenda to tick off and annotate, what is agreed and what we owe as it happens, then the recap, the actions and the log line. */
export function callView({ result, dash, score, logTouch, go, keepFromCall }) {
  const prep = dash.rhythm.prep, key = `${result.customer}|${result.as_of}`;
  if (!calls.has(key)) calls.set(key, { ...newCall(prep), logged: false });
  const call = calls.get(key);
  const contacts = (score.relationship && score.relationship.contacts) || [];
  const lead = contacts.find((c) => /champion|sponsor|lead|owner/i.test(c.role || "")) || contacts[0];
  const who = h("select", { "aria-label": "The call was with" }, h("option", { value: "", text: "(everyone)" }), contacts.map((c) => h("option", { value: c.id, text: c.name })));
  if (lead) who.value = lead.id;
  const nameOf = () => (contacts.find((c) => c.id === who.value) || { name: "" }).name;
  const date = h("input", { type: "date", value: result.as_of, max: result.as_of, "aria-label": "Date of the call" });
  const preview = h("pre", { class: "recap", tabindex: "0", "aria-label": "Recap draft" });
  const count = h("p", { class: "note", role: "status" });
  const logBtn = h("button", { class: "btn small", type: "button", text: "Log this call", disabled: call.logged });
  const say = h("p", { class: "note", role: "status" });
  const out = () => callOutput({ customer: result.customer, date: date.value, contact: nameOf(), call });
  const refresh = () => {
    const o = out();
    preview.textContent = `Subject: ${o.recap.subject}\n\n${o.recap.body}`;
    count.textContent = `${o.covered.length} of ${call.items.length} agenda items covered, ${nOf(o.agreed.length, "thing")} agreed, ${call.ours.length} we owe.`;
  };
  const agenda = h("div", { class: "agenda" }, call.items.map((it) => h("details", { class: "agitem", open: it.covered ? null : true },
    h("summary", {}, h("label", { class: "inline" }, h("input", { type: "checkbox", checked: it.covered, "aria-label": `${it.title}: covered`, onchange: (e) => { it.covered = e.target.checked; refresh(); } }), h("b", { text: it.title }))),
    h("ul", {}, it.points.map((p) => h("li", { text: p }))),
    h("textarea", { rows: 2, maxlength: 600, "aria-label": `Your private notes on ${it.title}`, placeholder: "Your notes. They stay here: they are never in the recap.", oninput: (e) => { it.note = e.target.value; } }, it.note))));
  const rows = h("div", { class: "agreed" });
  const drawRows = () => {
    put(rows, ...call.agreed.map((a, i) => h("div", { class: "agrow" },
      h("input", { type: "text", maxlength: 200, value: a.what, "aria-label": `Agreed thing ${i + 1}`, placeholder: "What was agreed", oninput: (e) => { a.what = e.target.value; refresh(); } }),
      h("input", { type: "text", maxlength: 80, value: a.who, "aria-label": `Who, for thing ${i + 1}`, placeholder: "Who", oninput: (e) => { a.who = e.target.value; refresh(); } }),
      h("input", { type: "date", value: a.when, "aria-label": `By when, for thing ${i + 1}`, onchange: (e) => { a.when = e.target.value; refresh(); } }),
      h("button", { class: "icon-btn", type: "button", "aria-label": `Remove agreed thing ${i + 1}`, text: "×", onclick: () => { call.agreed.splice(i, 1); drawRows(); refresh(); } }))));
  };
  const owed = h("textarea", { rows: 3, maxlength: 1200, "aria-label": "What we owe, one per line", oninput: (e) => { call.ours = e.target.value.split("\n"); refresh(); } }, call.ours.join("\n"));
  logBtn.addEventListener("click", () => {
    const t = out().touch;
    const msg = logTouch({ date: date.value, kind: "call", contact_id: who.value, summary: t.summary || "Call", next_step: t.next_step, next_due: t.next_due });
    if (msg === "Added.") { call.logged = true; logBtn.disabled = true; say.textContent = "Logged in interactions.csv in this tab."; } else say.textContent = msg;
  });
  drawRows(); refresh();
  return h("div", {},
    h("div", { class: "col2" },
      card("The agenda", h("div", {}, agenda, count), { sub: "Tick what you cover and write notes as you go. Notes are private to you." }),
      h("div", {},
        card("What was agreed", h("div", {}, rows, h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Add something agreed", onclick: () => { call.agreed.push({ what: "", who: "", when: "" }); drawRows(); refresh(); rows.lastElementChild.querySelector("input").focus(); } }))),
          { sub: "One line per commitment, with who and by when." }),
        card("What we owe", h("div", {}, owed), { sub: "Taken from the preparation, one per line: edit freely." }))),
    card("After the call", h("div", {},
      h("div", { class: "formgrid" }, h("label", {}, "With", who), h("label", {}, "Date", date)),
      preview,
      h("div", { class: "row left" },
        h("button", { class: "btn small primary", type: "button", text: "Copy the recap", onclick: (e) => copyText(preview.textContent).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Download the actions (CSV)", onclick: () => saveBlob(out().csv, `beyond90-call-actions-${date.value}.csv`, "text/csv") }),
        logBtn,
        h("button", { class: "btn small", type: "button", text: "Keep in the ledger", onclick: async () => { try { const o = out(); const n = await keepFromCall({ agreed: o.agreed, ours: call.ours, date: date.value }); say.textContent = n ? `${nOf(n, "promise")} kept in the ledger (see Promises).` : "Nothing new to keep: what you agreed is already in the ledger."; } catch (e) { say.textContent = e.message; } } }),
        h("button", { class: "btn small quiet", type: "button", text: "Start a new call", onclick: () => { calls.delete(key); go("call"); } })),
      say),
    { sub: "The recap names only what you marked as covered and what you agreed, in the customer's words. Nothing is sent: you copy it. Logging adds a line to interactions.csv and re-runs." }));
}

/** Record what happened at renewal, next to the reading on screen. Nothing leaves the browser. */
function outcomeCard({ result, dash, recordOutcome, go }) {
  const hl = dash.health;
  const f = { outcome: h("select", { "aria-label": "What happened" }, OUTCOMES.map((o) => h("option", { value: o, text: cap(o) }))),
    date: h("input", { type: "date", value: result.as_of, "aria-label": "Date the customer decided" }),
    note: h("input", { type: "text", maxlength: 300, placeholder: "Optional: why, in a few words", "aria-label": "Note" }) };
  const out = h("p", { class: "note", role: "status" });
  return card("Record what happened", h("div", {},
    h("div", { class: "formgrid" }, h("label", {}, "What happened", f.outcome), h("label", {}, "Decided on", f.date), h("label", { class: "wide2" }, "Note", f.note)),
    h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", disabled: !hl || hl.score == null, text: "Record with this reading",
      onclick: async () => {
        try { await recordOutcome({ outcome: f.outcome.value, decidedOn: f.date.value, note: f.note.value }); go("calibration"); }
        catch (e) { out.textContent = e.message; }
      } })), out),
  { sub: `Keeps this reading (data as of ${result.as_of}, health ${hl && hl.score != null ? hl.score : "n/a"}) with the outcome, so it can be compared later. Load the data as it was before the decision: the reading should come from before the outcome.` });
}

const OUTCOME_KIND = { renewed: "good", expanded: "good", reduced: "bad", churned: "bad" };

/** What the recorded outcomes say about the health reading, and the weights to apply if the person agrees. */
export function calibrationView({ outcomes, calibration: cal, healthWeights, applyWeights, resetWeights, removeOutcome, go }) {
  const list = outcomes || [];
  if (!list.length) {
    return h("div", {}, card("Nothing recorded yet", h("div", {},
      h("p", { text: "The health reading starts as a judgement. Recording what happens at each renewal is how it earns trust, or loses it." }),
      h("p", { class: "note", text: "Open a customer, go to Renewal and trust, and record whether it renewed, expanded, reduced or churned, with the reading taken before the decision. With at least three that stayed and three that left, this page shows which parts told them apart." }),
      h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Go to Renewal and trust", onclick: () => go("renewal") }))),
    { sub: "Recorded on this device, sealed with your passphrase when you use one, and included in exported workspaces." }));
  }
  const table = dataTable({ label: "Recorded outcomes", rows: list, pageSize: 20, columns: [
    { key: "customer", label: "Customer", render: (o) => h("b", { text: o.customer }) },
    { key: "outcome", label: "What happened", render: (o) => chip(o.outcome, OUTCOME_KIND[o.outcome]) },
    { key: "decided_on", label: "Decided on" },
    { key: "score", label: "Health then", num: true, sort: (o) => o.reading.score, render: (o) => (o.reading.score == null ? "n/a" : String(o.reading.score)) },
    { key: "note", label: "Note" },
    { key: "x", label: "", render: (o) => h("button", { class: "btn small danger", type: "button", text: "Remove", "aria-label": `Remove the outcome of ${o.customer}, ${o.decided_on}`, onclick: async () => { await removeOutcome(o.id); go("calibration"); } }) },
  ] });
  const parts = cal ? card("What the outcomes say", h("div", {},
    h("div", { class: "kpiline" }, stat(String(cal.stayed), "stayed"), stat(String(cal.left), "left"), stat(cal.concordance == null ? "n/a" : pct(cal.concordance, 0), "pairs the score ordered right")),
    cal.findings.length ? h("ul", {}, cal.findings.map((t) => h("li", { text: t }))) : h("p", { class: "note", text: cal.why }),
    dataTable({ label: "Parts compared", rows: cal.parts, pageSize: 10, columns: [
      { key: "label", label: "Part", render: (p) => h("b", { text: p.label }) },
      { key: "stayed", label: "Stayed", num: true, render: (p) => (p.stayed == null ? "n/a" : String(p.stayed)) },
      { key: "left", label: "Left", num: true, render: (p) => (p.left == null ? "n/a" : String(p.left)) },
      { key: "gap", label: "Gap", num: true, render: (p) => (p.gap == null ? "too few" : (p.gap > 0 ? "+" : "") + p.gap) },
      { key: "n_stayed", label: "Measured (stayed / left)", num: true, render: (p) => `${p.n_stayed} / ${p.n_left}` },
    ] }).el,
    h("p", { class: "note", text: cal.caveat })), { sub: "A part is only compared once at least three customers on each side were measured on it." }) : null;
  const sw = cal && cal.suggested_weights;
  const row = (w) => Object.entries(w).map(([k, v]) => `${cap(k)} ${Math.round(v * 100)}%`).join(" · ");
  const weights = card("Weights", h("div", {},
    h("p", { text: healthWeights ? `In use now (yours): ${row(healthWeights)}.` : "In use now: the defaults (Adoption 40% · Outcomes 20% · Relationship 25% · Trajectory 15%)." }),
    sw ? h("div", {}, h("p", { text: `Suggested: ${row(sw)}.` }), h("p", { class: "note", text: cal.why })) : h("p", { class: "note", text: cal ? cal.why : "" }),
    h("div", { class: "row left" },
      sw ? h("button", { class: "btn small primary", type: "button", text: "Apply the suggested weights", onclick: () => applyWeights(sw) }) : null,
      healthWeights ? h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: () => resetWeights() }) : null)),
  { sub: "Applying changes how every customer's health is read on this device. It is your decision, and it can be undone." });
  return h("div", {}, h("div", { class: "col2" }, parts, weights), card("Recorded outcomes", table.el));
}

export function renewalView({ score, dash, result, recordOutcome, go }) {
  const r = dash.renewal, rel = score.relationship, u = score.universe, ent = score.entitlements || [];
  const head = r ? h("div", { class: "card callout " + (r.status === "at_risk" ? "bad" : r.status === "watch" ? "warn" : "good") },
    h("h2", { text: `Renewal ${r.date} · in ${r.days} days` }), h("p", { text: `${r.status.replace("_", " ")}${r.arr_at_risk ? `; ${num(r.arr_at_risk)} of annual revenue involved` : ""}.` })) : card("Renewal", h("p", { class: "note", text: "Add renewal_date to customer.toml to see renewal readiness." }));
  const sig = r ? card("Signals", h("ul", { class: "checks" }, r.signals.map((s) => h("li", {}, chip(s.status, STATUS_KIND[s.status] || ""), h("span", {}, h("b", { text: s.label }), h("small", { class: "block", text: s.detail })))))) : null;
  const licences = ent.length ? card("Licences", h("ul", { class: "rates" }, ent.map((e) => h("li", {}, h("span", { class: "rl", text: e.unit }), h("span", { class: "rb" }, h("i", { style: `width:${Math.min(1, e.utilization) * 100}%;background:${e.below_target ? "var(--neg)" : "var(--pos)"}` })), h("span", { class: "rn", text: pct(e.utilization, 0) }), h("small", { text: `${num(e.used)} of ${num(e.licensed)}, target ${pct(e.target, 0)}` }))))) : null;
  const universe = u && u.estimable ? card("How complete is the universe?", h("div", {}, h("div", { class: "kpiline" }, stat(String(u.observed), `${score.terms.units} known`), stat(`~${u.unseen_estimate.toFixed(1)}`, "estimated unseen"), stat(pct(u.completeness, 0), "completeness"), stat(pct(u.pessimistic_l1), "L1 if all unseen are unconnected")),
    h("p", { class: "note", text: `Capture-recapture over ${u.sources.join(", ")} (${u.method}); confidence ${u.confidence}. A prompt to look for ${score.terms.units}, not a count.` }))) : null;
  const contacts = rel ? card("Relationship", h("div", {}, h("div", { class: "kpiline" }, stat(rel.weighted_trust.toFixed(1), `trust index (${rel.weighted_band})`), stat(`${rel.reliability.on_time} of ${rel.reliability.due_in_window}`, "promises kept on time"), stat(String(rel.coverage.contacts), "contacts"), stat(rel.coverage.sponsor ? "yes" : "none", "executive sponsor", rel.coverage.sponsor ? "good" : "bad")),
    dataTable({ label: "Contacts", rows: rel.contacts, pageSize: 20, columns: [
      { key: "name", label: "Contact", render: (c) => h("b", { text: c.name }) }, { key: "role", label: "Role" }, { key: "trust", label: "Trust", num: true, render: (c) => c.trust.toFixed(1) },
      { key: "band", label: "Band", render: (c) => chip(c.band, c.band === "strong" ? "good" : c.band === "fragile" ? "bad" : "warn") }, { key: "limiting", label: "Weakest", render: (c) => c.limiting.replace("_", " ") }, { key: "days_since_contact", label: "Days since contact", num: true }] }).el)) : null;
  return h("div", {}, healthCard(dash.health), outcomeCard({ result, dash, recordOutcome, go }), head, h("div", { class: "col2" }, sig, h("div", {}, licences, universe)), contacts);
}

// ------------------------------------------------------------------ portfolio
export function bookView({ book, openCustomer }) {
  const cs = book.customers, totalArr = cs.reduce((a, c) => a + c.arr, 0);
  const heat = (v) => `background:color-mix(in srgb,var(--heat) ${Math.round(Math.max(0, Math.min(1, (v - 0.5) / 0.5)) * 55)}%,transparent)`;
  const cols = [
    { key: "name", label: "Customer", render: (c) => h("b", { text: c.name }) },
    { key: "arr", label: "ARR", num: true, render: (c) => h("span", {}, num(c.arr), h("i", { class: "arrbar", style: `width:${(c.arr / Math.max(...cs.map((x) => x.arr))) * 60}px` })) },
    ...["L1", "L2", "L3", "L4"].map((k) => ({ key: k, label: k + " " + STAGE_NAME[k], num: true, sort: (c) => c.stages[k], render: (c) => h("span", { class: "heatcell", style: heat(c.stages[k]), text: pct(c.stages[k]) }) })),
    { key: "yield", label: "Yield", num: true, render: (c) => h("b", { text: pct(c.yield) }) },
    { key: "through", label: "End to end", num: true, sort: (c) => (c.units_total ? c.through / c.units_total : -1), render: (c) => (c.units_total ? `${c.through} of ${c.units_total}` : "—") },
    { key: "planned_yield", label: "After the plan", num: true, render: (c) => pct(c.planned_yield) },
    { key: "hours", label: "Hours", num: true, render: (c) => c.hours.toFixed(0) },
    { key: "level", label: "Level", render: (c) => h("span", { class: "levelbadge small lv-" + c.level, text: cap(c.level) }) },
    { key: "critical_open", label: "Critical open", num: true },
    { key: "open", label: "Report", render: (c) => h("button", { class: "btn small", type: "button", text: "Open", onclick: () => openCustomer(c.key) }) },
  ];
  const worst = [...cs].sort((a, b) => a.yield - b.yield)[0], gain = [...cs].sort((a, b) => (b.planned_yield - b.yield) * b.arr - (a.planned_yield - a.yield) * a.arr)[0];
  return h("div", {},
    h("div", { class: "kpiline" }, stat(pct(book.arr_weighted_yield), "ARR-weighted Yield"), stat(pct(book.weighted_end), "after the plan", "good"), stat(String(cs.length), "customers"), stat(num(totalArr), "ARR in the book"), stat(String(book.patterns), "shared patterns")),
    h("div", { class: "col2" },
      card("Where to look first", h("ul", { class: "flags" }, [
        h("li", { class: "bad" }, h("b", { text: `${worst.name} has the lowest Yield (${pct(worst.yield)})` }), h("span", { text: `${nOf(worst.critical_open, "critical finding")} open.` }), h("button", { class: "link", type: "button", text: "Open", onclick: () => openCustomer(worst.key) })),
        h("li", {}, h("b", { text: `${gain.name} gains the most weighted Yield from your hours` }), h("span", { text: `${pct(gain.yield)} to ${pct(gain.planned_yield)} for ${gain.hours.toFixed(0)} hours.` }), h("button", { class: "link", type: "button", text: "Open", onclick: () => openCustomer(gain.key) }))]), { sub: "From the plan that spends one budget of hours across the whole book." }),
      card("Reading the map", h("p", { class: "note first", text: "Each cell is one stage's pass rate; darker means closer to 100%. A column that is pale across many customers is a product or process problem, not one customer's." }))),
    card("The book", dataTable({ columns: cols, rows: cs, label: "Customers", pageSize: 100 }).el));
}

// ------------------------------------------------------------------ the week and the call
const TIER_KIND = { top: "bad", mid: "warn", other: "" };
const TIER_LABEL = { top: "top tier", mid: "mid tier", other: "other" };
const STATE_LABEL = { never: "no touch on record", overdue: "overdue", due_soon: "due soon", ok: "on cadence" };
const STATE_KIND = { never: "bad", overdue: "bad", due_soon: "warn", ok: "good" };

/** The agenda for a call, as the engine built it. */
function agenda(prep) {
  return h("div", { class: "agenda" }, prep.items.map((it, i) => h("section", { class: "agitem" },
    h("h3", {}, h("span", { class: "agn", text: String(i + 1) }), it.title), h("p", { class: "note first", text: it.why }), h("ul", {}, it.points.map((p) => h("li", { text: p }))))));
}

function briefButtons(markdown, name) {
  return h("span", { class: "btnrow" },
    h("button", { class: "btn small", type: "button", text: "Copy", onclick: (e) => copyText(markdown).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
    h("button", { class: "btn small", type: "button", text: "Download .md", onclick: () => saveBlob(markdown, name, "text/markdown") }));
}

/** Book mode: the order of the week, with the reason for each place and the call prepared behind it. */
export function weekView({ book, openCustomer, markdown }) {
  const w = book.week;
  const cols = [
    { key: "n", label: "#", num: true, sort: (r) => r.n },
    { key: "name", label: "Customer", render: (r) => h("span", {}, h("b", { text: r.name }), h("small", { class: "block", text: r.reasons.join("; ") })) },
    { key: "class", label: "Tier", render: (r) => chip((r.tier || "no tier") + (r.class !== "other" ? "" : ""), TIER_KIND[r.class]) },
    { key: "touch", label: "Touch", sort: (r) => r.touch.days_since ?? 9999, render: (r) => h("span", {}, chip(STATE_LABEL[r.touch.state], STATE_KIND[r.touch.state]), h("small", { class: "block", text: r.touch.last_touch ? `${r.touch.days_since} days ago, every ${r.touch.cadence_days}` : `every ${r.touch.cadence_days} days` })) },
    { key: "day", label: "Day" },
    { key: "hours", label: "Hours", num: true, render: (r) => r.hours.toFixed(1) },
    { key: "priority", label: "Priority", num: true },
  ];
  const rows = w.rows.map((r, i) => ({ ...r, n: i + 1, id: r.key }));
  const t = dataTable({ columns: cols, rows, label: "The week", pageSize: 100,
    expand: (r) => { const p = book.preps[r.key]; return h("div", { class: "expand wide" }, h("div", { class: "cardhead" }, h("h3", { text: "Call prep" }), briefButtons(p.markdown, `beyond90-prep-${r.key}.md`)), agenda(p.prep), h("button", { class: "btn small", type: "button", text: "Open the customer's dashboard", onclick: () => openCustomer(r.key) })); } });
  const top = rows.filter((r) => r.class === "top"), mid = rows.filter((r) => r.class === "mid");
  return h("div", {},
    h("div", { class: "kpiline" }, stat(String(top.length), "top-tier customers"), stat(String(mid.length), "mid-tier customers"), stat(String(rows.filter((r) => r.touch.state === "overdue" || r.touch.state === "never").length), "touches overdue", rows.some((r) => r.touch.state === "overdue") ? "bad" : ""), stat(w.hours_per_week + " h", "budget for the week"), stat(String(book.advisories), "advisories loaded")),
    w.over_budget ? h("div", { class: "card callout bad" }, h("h2", { text: "The week does not fit" }), h("p", { text: `Calls and preparation alone need ${w.fixed_hours} hours. Something has to give: a lower-tier cadence, a shorter call, or help.` })) : null,
    card("Who to talk to, in this order", t.el, { sub: "Priority is a sum of points, each with its reason. Open a row for the prepared call.", actions: briefButtons(book.week_markdown, "beyond90-week.md") }),
    book.advisories ? null : h("p", { class: "note", text: "No advisories are loaded, so the plan ignores security news. Add a feed under News and advisories, above." }));
}

/** One customer: when to call, what to say, in the order that earns attention. */
export function prepView({ dash, score, result, logTouch }) {
  const rh = dash.rhythm, t = rh.touch, prep = rh.prep, ex = rh.expansion;
  const touchCard = card("Rhythm", h("div", {},
    h("div", { class: "kpiline" }, stat(t.last_touch ? `${t.days_since} days` : "never", "since the last touch", t.state === "overdue" || t.state === "never" ? "bad" : t.state === "due_soon" ? "warn" : "good"), stat(`every ${t.cadence_days} days`, `${TIER_LABEL[t.class]}${dash.rhythm.touch.tier ? ` (${t.tier})` : ""}`), stat(String(t.touches_90d), "touches in 90 days")),
    t.follow_up ? h("p", { class: t.follow_up.overdue ? "bad-text" : "note" }, h("b", { text: "Open follow-up: " }), `${t.follow_up.step}${t.follow_up.due ? ` (due ${t.follow_up.due})` : ""}`) : null,
    t.last_summary ? h("p", { class: "note", text: `Last time (${t.last_touch}, ${t.last_kind}): ${t.last_summary}` }) : null));
  const expCard = card("Growth, only if earned", h("div", {},
    h("p", { class: ex.gate.ready ? "note first" : "bad-text", text: ex.say }),
    !ex.gate.ready ? h("ul", {}, ex.gate.reasons.map((r) => h("li", { text: r }))) : null,
    ex.signals.length ? h("ul", { class: "signals" + (ex.gate.ready ? "" : " later") }, ex.signals.map((s) => h("li", {}, chip(s.kind, ex.gate.ready ? "good" : ""), h("span", {}, h("b", { text: s.title }), h("small", { class: "block", text: s.why }), h("small", { class: "block", text: "Ask: " + s.ask }))))) : h("p", { class: "note", text: "No expansion signal right now." })),
    { sub: "A commercial conversation follows adoption and trust; it does not lead them." });
  return h("div", {},
    h("div", { class: "col2" }, h("div", {}, touchCard, logForm({ score, result, logTouch })), card("The call, in order", h("div", {}, h("div", { class: "cardhead" }, h("span", { class: "note", text: "Derived from the customer's files." }), briefButtons(rh.prep_markdown, "beyond90-call-prep.md")), agenda(prep)))),
    discoveryCard(dash.discovery || [], result.customer),
    expCard, recapCard({ score, result, prep, contacts: (score.relationship && score.relationship.contacts) || [] }));
}

/** Questions to ask, value first, then the customer's weakest stage first. Copy gives a plain list for notes. */
function discoveryCard(qs, customer) {
  if (!qs.length) return null;
  const NAME = { value: "value", L1: "L1 connected", L2: "L2 seen", L3: "L3 switched on", L4: "L4 decided" };
  const text = () => `Questions for ${customer}\n\n` + qs.map((x, i) => `${i + 1}. ${x.q}`).join("\n");
  return card("Questions to ask", h("div", {},
    h("ol", { class: "disco" }, qs.map((x) => h("li", { class: x.focus ? "focus" : "" },
      h("span", { class: "disco-q" }, h("b", { text: x.q }), h("small", { text: x.why })),
      chip(x.focus ? `${NAME[x.stage]}, weakest` : NAME[x.stage], x.focus ? "warn" : "")))),
    h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Copy the questions", onclick: (e) => copyText(text()).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
  { sub: "Business value first, then the stage where this customer loses most. Ask, then listen: the answers are the plan." });
}

/** After the call: a recap email from the agenda and what was agreed. Nothing is sent; it is copied or downloaded. */
function recapCard({ score, result, prep, contacts }) {
  const covered = prep.items.filter((it) => !["close", "ask"].includes(it.id)).map((it) => it.title);
  const ours = prep.items.filter((it) => it.id === "owed").flatMap((it) => it.points);
  const lead = contacts.find((c) => /champion|sponsor|lead|owner/i.test(c.role || "")) || contacts[0];
  const to = h("select", { "aria-label": "Recap addressed to" }, h("option", { value: "", text: "(everyone)" }), contacts.map((c) => h("option", { value: c.name, text: c.name })));
  if (lead) to.value = lead.name;
  const agreed = h("textarea", { rows: 4, maxlength: 2000, "aria-label": "Agreed next steps", placeholder: "One per line: what | who | by when\nGrant admin consent | identity team | 2026-11-11" });
  const out = h("pre", { class: "recap", tabindex: "0", "aria-label": "Recap draft" });
  let draft = null;
  const build = () => {
    const lines = agreed.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((x) => x[0]);
    draft = recap({ customer: score.customer, contact: to.value, date: result.as_of, covered, agreed: lines.map(([what, who, when]) => ({ what, who, when })), ours });
    out.textContent = `Subject: ${draft.subject}\n\n${draft.body}`;
  };
  to.addEventListener("change", build); agreed.addEventListener("input", build); build();
  return card("Recap after the call", h("div", {},
    h("div", { class: "formgrid" }, h("label", {}, "To", to), h("label", { class: "wide2" }, "What we agreed", agreed)),
    h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Copy recap", onclick: (e) => copyText(out.textContent).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Download .txt", onclick: () => saveBlob(out.textContent, `beyond90-recap-${result.as_of}.txt`, "text/plain") })),
    out), { sub: "Covered = the agenda; promises = what we owe. Written in the customer's words, with no scores. Nothing leaves the browser." });
}

function logForm({ score, result, logTouch }) {
  const contacts = (score.relationship && score.relationship.contacts) || [];
  const f = { date: h("input", { type: "date", value: result.as_of, "aria-label": "Date" }), kind: h("select", { "aria-label": "Kind" }, ["call", "meeting", "email", "qbr", "workshop", "support", "advisory", "escalation", "other"].map((k) => h("option", { value: k, text: k }))),
    who: h("select", { "aria-label": "Contact" }, h("option", { value: "", text: "(no one in particular)" }), contacts.map((c) => h("option", { value: c.id, text: c.name }))),
    summary: h("input", { type: "text", placeholder: "What was said or decided", maxlength: 300, "aria-label": "Summary" }),
    step: h("input", { type: "text", placeholder: "Next step we agreed (optional)", maxlength: 200, "aria-label": "Next step" }),
    due: h("input", { type: "date", "aria-label": "Next step due" }) };
  const out = h("p", { class: "note", role: "status" });
  return card("Log a touch", h("div", {},
    h("div", { class: "formgrid" }, h("label", {}, "Date", f.date), h("label", {}, "Kind", f.kind), h("label", {}, "With", f.who), h("label", { class: "wide2" }, "Summary", f.summary), h("label", { class: "wide2" }, "Next step", f.step), h("label", {}, "Due", f.due)),
    h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Add and re-run", onclick: () => { out.textContent = logTouch({ date: f.date.value, kind: f.kind.value, contact_id: f.who.value, summary: f.summary.value, next_step: f.step.value, next_due: f.due.value }) || ""; } }), out)),
    { sub: "Adds a line to interactions.csv in this tab, then re-runs. Download the file to keep it; nothing is uploaded. The date cannot be after the customer's as_of." });
}

/** Badges that say why a story matters now: exploited, likely to be, new, and how many sources carry it. */
function newsBadges(e, asOf) {
  const fresh = e.first_seen && asOf && (Date.parse(asOf) - Date.parse(e.first_seen)) / 86400000 <= 7;
  return [chip(e.severity, SEV[e.severity] || ""), e.kev ? chip("known exploited", "bad") : null, e.ransomware ? chip("ransomware", "bad") : null,
    e.epss != null && e.epss >= 0.1 ? chip(`EPSS ${Math.round(e.epss * 100)}%`, e.epss >= 0.5 ? "warn" : "") : null,
    fresh ? chip("new", "good") : null, e.kind && e.kind !== "vulnerability" && e.kind !== "advisory" ? chip(e.kind, "") : null];
}
function sourceLinks(e) {
  const list = (e.sources && e.sources.length ? e.sources : [{ name: e.source || "source", url: e.url }]).filter((x) => x.name);
  return list.map((x, i) => [i ? " · " : "", x.url && x.url.startsWith("https://") ? h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.name }) : h("span", { text: x.name })]);
}

/** The security news that touches this customer, in plain words, with a note to send. */
export function newsView({ dash, score, result, advisories }) {
  const list = dash.rhythm.exposures;
  if (!list.length) return card("News and advisories", h("p", { class: "note", text: advisories ? "None of the loaded advisories touch this customer's inventoried resources." : "No advisories are loaded. In step 1, use today's cloud news, add a feed (a JSON file) or try the demo feed, and each one is matched to this customer's inventory." }));
  const units = score.terms.units;
  const exploited = list.filter((e) => e.kev && e.uncovered).length;
  return h("div", {},
    h("div", { class: "card callout " + (exploited ? "bad" : "") }, h("h2", { text: exploited ? `${exploited} known exploited ${exploited === 1 ? "story lands" : "stories land"} on ${units} with no mitigation` : `${list.length} ${list.length === 1 ? "story touches" : "stories touch"} this customer` }),
      h("p", { text: "Matched against what is inventoried here. An advisory can also touch resources that were never inventoried; those are counted as unknown, not as safe." }),
      result.briefing_markdown ? h("span", { class: "btnrow" },
        h("button", { class: "btn small primary", type: "button", text: "Copy the briefing for the customer", onclick: (ev) => copyText(result.briefing_markdown).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Download briefing (.md)", onclick: () => saveBlob(result.briefing_markdown, `beyond90-security-briefing-${result.as_of}.md`, "text/markdown") })) : null),
    list.map((e) => card(`${e.id}: ${e.title}`, h("div", {},
      h("div", { class: "kpiline" }, stat(String(e.exposed), `exposed ${units}`), stat(String(e.covered), "covered", e.covered ? "good" : ""), stat(String(e.uncovered), "not covered", e.uncovered ? "bad" : "good"), stat(String(e.unknown), "cannot be assessed", e.unknown ? "warn" : ""), e.yield_gain_points ? stat("+" + e.yield_gain_points.toFixed(1) + " pts", "Yield if covered") : null),
      e.summary ? h("p", { text: e.summary }) : null,
      h("p", { class: "note" }, newsBadges(e, result.as_of), ` published ${e.published || "n/a"}${e.age_days != null ? ` (${e.age_days} days ago)` : ""} · mitigated by ${e.mitigated_by.join(", ")}`, e.severity_why ? ` · ${e.severity} because ${e.severity_why}` : ""),
      h("p", { class: "note" }, "Sources: ", sourceLinks(e)),
      e.uncovered_ids.length ? h("p", { class: "note", text: `Not covered: ${e.uncovered_ids.join(", ")}${e.uncovered > e.uncovered_ids.length ? ` and ${e.uncovered - e.uncovered_ids.length} more` : ""}` }) : null,
      h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Copy a note for the customer", onclick: (ev) => copyText(customerNote(e, score)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
      { cls: "news" })));
}

/** Book mode: every story against every customer, so one advisory becomes one round of calls, worst first. */
export function bookNewsView({ book, advisories, openCustomer }) {
  const news = book.news || [];
  const daily = advisories && !Array.isArray(advisories) && advisories.schema === "beyond90-feed/1" ? advisories : null;
  if (!news.length) return card("Cloud news across the book", h("p", { class: "note first", text: advisories ? "None of the loaded stories touch a customer in this book." : "No news is loaded. In step 1, use today's cloud news (or the demo advisories), then run the book again." }));
  const asOf = daily ? daily.as_of : "";
  let prov = new Set(), only = new Set();
  const cards = news.map((e) => ({ e, el: card(`${e.id}: ${e.title}`, h("div", {},
    h("p", { class: "note first" }, newsBadges(e, asOf), ` published ${e.published || "n/a"} · ${(e.platforms.length ? e.platforms : ["any provider"]).join(", ")}${e.providers.length ? "" : " (matched on every provider)"} · ${e.resource_types.join(", ")}`),
    e.summary ? h("p", { text: e.summary }) : null,
    h("table", { class: "dt", "aria-label": `Customers touched by ${e.id}` }, h("thead", {}, h("tr", {}, ["Customer", "Exposed", "Not covered", "Cannot tell"].map((t) => h("th", { scope: "col", text: t })), h("th", { scope: "col" }, h("span", { class: "sr-only", text: "Open" })))),
      h("tbody", {}, e.customers.map((c) => h("tr", {}, h("td", {}, h("b", { text: c.name })), h("td", { class: "num", text: String(c.exposed) }),
        h("td", { class: "num" }, h("span", { class: c.uncovered ? "bad-text" : "", text: String(c.uncovered) })), h("td", { class: "num", text: String(c.unknown) }),
        h("td", {}, h("button", { class: "btn small", type: "button", text: "Open", "aria-label": `Open ${c.name} on the news`, onclick: () => openCustomer(c.key, "news") })))))),
    h("p", { class: "note" }, "Sources: ", sourceLinks(e), e.severity_why ? ` · ${e.severity} because ${e.severity_why}` : "")),
    { sub: e.uncovered_customers ? `${nOf(e.uncovered_customers, "customer")} with exposed resources and no mitigation on.` : e.customers.some((c) => c.exposed) ? "Every exposed customer is covered: a reassuring note is still worth sending." : "No customer is known to be exposed, but some cannot be assessed: their inventory is incomplete.", cls: "news" }) }));
  const holder = h("div", {}, cards.map((c) => c.el));
  const apply = () => cards.forEach(({ e, el }) => { el.hidden = (prov.size && !e.platforms.some((p) => prov.has(p))) || (only.has("kev") && !e.kev) || (only.has("uncovered") && !e.uncovered_customers) || (only.has("new") && !(e.first_seen && asOf && (Date.parse(asOf) - Date.parse(e.first_seen)) / 86400000 <= 7)); });
  const providers = [...new Set(news.flatMap((e) => e.platforms))].sort();
  const kev = news.filter((e) => e.kev && e.uncovered_customers).length;
  const general = daily && Array.isArray(daily.general) ? daily.general.slice(0, 12) : [];
  const failed = daily ? (daily.sources || []).filter((x) => !x.ok) : [];
  return h("div", {},
    h("div", { class: "card callout " + (kev ? "bad" : "") }, h("h2", { text: `${news.length} ${news.length === 1 ? "story touches" : "stories touch"} this book${kev ? `; ${kev} known exploited on uncovered accounts` : ""}` }),
      h("p", { text: "Ranked by known exploitation, then by how many customers have exposed accounts with no mitigation, then by severity and ARR. Open a customer to send them their briefing." }),
      daily ? h("p", { class: "note", text: `Feed as of ${daily.as_of}, last ${daily.window_days} days.${failed.length ? ` Not read today: ${failed.map((x) => x.name).join(", ")}.` : " Every source was read."}` }) : null),
    h("div", { class: "toolbar" }, providers.length ? chipFilter("Provider", providers, (v) => { prov = v; apply(); }) : null,
      chipFilter("Only", [{ label: "known exploited", value: "kev" }, { label: "not covered somewhere", value: "uncovered" }, { label: "new this week", value: "new" }], (v) => { only = v; apply(); })),
    holder,
    general.length ? card("Also worth reading", h("ul", { class: "checks" }, general.map((g) => h("li", {}, chip(g.published, ""), h("span", {}, g.url && g.url.startsWith("https://") ? h("a", { href: g.url, target: "_blank", rel: "noopener noreferrer", text: g.title }) : h("b", { text: g.title }), h("small", { class: "block", text: `${g.source}${(g.platforms || g.providers).length ? " · " + (g.platforms || g.providers).join(", ") : ""}` }))))),
      { sub: "Cloud news that names no resource type the catalogue knows, so it is not matched to inventories." }) : null);
}

function customerNote(e, score) {
  const units = score.terms.units;
  const lines = [`${e.id}: ${e.title}`, ""];
  if (e.kev) lines.push(`This one is known to be exploited in the wild${e.kev_due ? `; public agencies must fix it by ${e.kev_due}` : ""}.`, "");
  if (e.summary) lines.push(e.summary, "");
  if (!e.exposed) lines.push(`We could not find the affected resources in your inventoried ${units}.${e.unknown ? ` ${e.unknown} ${units} have not been inventoried, so we cannot rule them out.` : ""}`);
  else if (!e.uncovered) lines.push(`${e.exposed} of your ${units} are in scope, and all of them already have the protection that addresses this switched on. No action is needed from you.`);
  else lines.push(`${e.exposed} of your ${units} are in scope. ${e.uncovered} do not yet have ${e.mitigated_by.join(" or ")} switched on, which is what addresses this.`, "", `Suggested next step: enable it on ${e.uncovered_ids.slice(0, 5).join(", ")}${e.uncovered > 5 ? " and the rest" : ""}. We can do it with you this week.`);
  if (e.unknown) lines.push("", `${e.unknown} more ${units} are not inventoried yet, so we cannot say whether they are affected.`);
  const links = (e.sources || []).filter((x) => x.url).slice(0, 3);
  if (links.length || e.url) lines.push("", "Read more: " + (links.length ? links.map((x) => `${x.name} ${x.url}`).join("; ") : e.url));
  return lines.join("\n");
}

// ------------------------------------------------------------------ onboarding
const STAGE_KIND = { discovered: "bad", deployed: "warn", authenticated: "warn", authorized: "warn", scanning: "", complete: "good" };
const SEC_KIND = { critical: "bad", high: "bad", medium: "warn", low: "" };

function waveTicket(w, customer, units) {
  return [`[${customer}] ${w.title}`, "", w.why, "", `${units}: ${w.accounts.join(", ")}`, `Owner: ${w.owner} · About ${w.hours} h${w.once ? " · one fix covers them all" : ""}`, "", "Steps:",
    ...w.steps.map((x, i) => `${i + 1}. ${x}`), "", `Verify: ${w.verify}`].join("\n");
}

export function onboardingView({ dash, score, result, engine }) {
  const o = dash.onboarding, units = score.terms.units, Unit = cap(score.terms.unit);
  const f = Object.fromEntries(o.funnel.map((x) => [x.stage, x.reached]));
  const stageLabel = Object.fromEntries(o.stages.map((x) => [x.id, x.label]));
  const head = h("div", { class: "kpiline" },
    stat(`${f.complete} of ${f.discovered}`, "complete and fresh", f.complete === f.discovered ? "good" : ""),
    stat(pct(o.healthy_l1), "healthy connection rate", o.healthy_l1 < o.listed_l1 - 0.0005 ? "warn" : "good"),
    stat(pct(o.listed_l1), "counted as connected (L1)"),
    stat(String(o.stalled.length), "stuck for more than a week", o.stalled.length ? "bad" : "good"),
    stat(o.time_to_deploy.median == null ? "n/a" : `${o.time_to_deploy.median} d`, "median time to connect"),
    stat(String(o.secrets.length), "secrets expiring", o.secrets.length ? "warn" : ""));
  const gap = o.listed_but_broken.length ? h("div", { class: "card callout bad" }, h("h2", { text: `${o.listed_but_broken.length} ${o.listed_but_broken.length === 1 ? score.terms.unit + " is" : units + " are"} counted as connected, but the connector is failing` }),
    h("p", { text: `L1 says ${pct(o.listed_l1)}; connectors that actually work say ${pct(o.healthy_l1)}. ${o.listed_but_broken.join(", ")}.` })) : null;
  const noDetail = o.has_detail ? null : h("div", { class: "card callout" }, h("h2", { text: "Add connectors.csv for the full diagnosis" }),
    h("p", { text: `Without it, onboarding is read from accounts.csv alone: discovered or connected. With one row per connector (status, the error the platform shows, dates, scope, how it signs in), each ${score.terms.unit} gets a stage, a cause, an owner and a fix. See docs/onboarding.md.` }));

  const waves = o.waves.length ? h("div", { class: "waves" }, o.waves.map((w, i) => h("details", { class: "wave" },
    h("summary", {}, h("span", { class: "agn", text: String(i + 1) }), h("span", { class: "wt" }, h("b", { text: w.title }), h("small", { class: "block", text: `${w.count} ${w.count === 1 ? score.terms.unit : units} · about ${w.hours} h · ${w.owner}` })),
      w.once ? chip("fix once", "good") : null),
    h("div", { class: "expand" }, h("p", { class: "note first", text: w.why }), h("ol", {}, w.steps.map((x) => h("li", { text: x }))), h("p", {}, h("b", { text: "Verify: " }), w.verify),
      commands(w.checks),
      h("p", { class: "note", text: `${Unit}s: ${w.accounts.join(", ")}` }),
      h("button", { class: "btn small", type: "button", text: "Copy as ticket", onclick: (e) => copyText(waveTicket(w, result.customer, Unit + "s")).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }))))) : h("p", { class: "note", text: "Nothing is blocked." });

  let q = "", st = new Set(), pv = new Set();
  const cols = [
    { key: "id", label: Unit, render: (r) => h("b", { text: r.id }) },
    { key: "provider", label: "Provider" },
    { key: "stage", label: "Stage", sort: (r) => o.stages.findIndex((x) => x.id === r.stage), render: (r) => chip(stageLabel[r.stage], STAGE_KIND[r.stage]) },
    { key: "issue", label: "Cause", render: (r) => (r.issue ? causeTitle(o, r.issue) : h("span", { class: "dim", text: "—" })) },
    { key: "days_in_stage", label: "Days at stage", num: true, render: (r) => (r.stage === "complete" ? "" : h("span", { class: r.stalled ? "bad-text" : "", text: r.days_in_stage == null ? "?" : String(r.days_in_stage) })) },
    { key: "owner", label: "Owner", render: (r) => r.owner || h("span", { class: "dim", text: "—" }) },
  ];
  const rows = o.accounts.map((r) => ({ ...r }));
  const t = dataTable({ columns: cols, rows, pageSize: 30, label: "Onboarding by account", empty: "Nothing matches.",
    expand: (r) => h("div", { class: "expand" },
      r.error ? h("p", {}, h("b", { text: "The platform says: " }), h("code", { class: "err", text: r.error })) : null,
      r.issue ? fixBlock(o, r.issue) : h("p", { class: "dim", text: "No problem found." }),
      r.connector ? h("p", { class: "note", text: `Connector: ${r.connector.status}${r.connector.scope ? ", scope " + r.connector.scope : ""}${r.connector.auth ? ", signs in with " + r.connector.auth.replace(/_/g, " ") : ""}${r.connector.deployed_at ? ", deployed " + r.connector.deployed_at : ""}${r.connector.last_success_at ? ", last success " + r.connector.last_success_at : ""}${r.connector.regions[1] ? `, regions ${r.connector.regions[0]} of ${r.connector.regions[1]}` : ""}.` }) : null,
      r.extensions.length ? h("p", { class: "note", text: "Also here: " + r.extensions.map((e) => `${e.kind} ${e.name || ""} ${e.ok ? "ok" : "failing"}`).join("; ") }) : null) });
  const apply = () => t.setFilter((r) => (!st.size || st.has(r.stage)) && (!pv.size || pv.has(r.provider)) && (!q || (r.id + " " + r.owner + " " + (r.issue || "") + " " + r.error).toLowerCase().includes(q)));
  const providers = [...new Set(rows.map((r) => r.provider))].sort();

  const ext = o.extensions.failing.length ? card("Clusters and sensors that are failing", h("ul", { class: "checks" }, o.extensions.failing.map((e) => h("li", {}, chip(e.kind, "warn"),
    h("span", {}, h("b", { text: `${e.account_id}${e.name ? " / " + e.name : ""}` }), h("small", { class: "block", text: e.issue ? causeTitle(o, e.issue) : "unclassified" }), e.error ? h("small", { class: "block dim", text: e.error }) : null))))) : null;
  const secrets = o.secrets.length ? card("Secrets that expire", h("ul", { class: "checks" }, o.secrets.map((x) => h("li", {}, chip(x.state === "expired" ? "expired" : `${x.days_left} days`, x.state === "expired" || x.days_left <= 14 ? "bad" : "warn"),
    h("span", {}, h("b", { text: x.connector }), h("small", { class: "block", text: `${x.auth.replace(/_/g, " ")} expires ${x.expires_on}. A connector that worked stops on that day.` }))))),
    { sub: "Rotate early, and move to a role, federation or certificate where there is nothing to expire." }) : null;
  const sec = card("Connector security review", o.security.length ? h("ul", { class: "checks" }, o.security.map((x) => h("li", {}, chip(x.severity, SEC_KIND[x.severity]),
    h("span", {}, h("b", { text: `${x.connector}: ${x.title}` }), h("small", { class: "block", text: `${x.stride}. ${x.fix}` }))))) : h("p", { class: "note", text: o.has_detail ? "Every connector reads only and signs in without a long-lived secret." : "Needs connectors.csv (auth and privilege columns)." }),
    { sub: `The connectors are an attack surface of their own: they hold standing access to every ${score.terms.unit}. Read-only and secret-free is the goal.` });

  const dl = o.delta;
  const since = dl ? card(`Since ${dl.since}`, h("div", {},
    h("div", { class: "kpiline" }, stat(`+${dl.finished.length}`, "completed", dl.finished.length ? "good" : ""), stat(String(dl.forward.length), "moved forward"), stat(String(dl.back.length), "went back", dl.back.length ? "bad" : ""),
      stat(dl.per_week.toFixed(1), `completed per week`), stat(dl.forecast.state === "on_track" ? dl.forecast.date : dl.forecast.state === "done" ? "done" : "no progress", "all complete around", dl.forecast.state === "stalled" ? "bad" : "")),
    dl.back.length ? h("p", { class: "bad-text", text: "Went back: " + dl.back.map((b) => `${b.id} (${stageLabel[b.from]} → ${stageLabel[b.to]})`).join(", ") }) : null,
    dl.fixed.length ? h("p", {}, h("b", { text: "Fixed: " }), dl.fixed.map((x) => `${x.title} (${x.count})`).join("; ")) : null,
    dl.appeared.length ? h("p", {}, h("b", { text: "New: " }), dl.appeared.map((x) => `${x.title} (${x.count})`).join("; ")) : null),
    { sub: "The forecast extends the pace between the two snapshots. It is a direction, not a date to promise." }) : null;
  const share = h("div", { class: "row left" },
    h("button", { class: "btn small primary", type: "button", text: "Status page for the customer (.html)", onclick: () => saveBlob(result.onboarding_status_html, `onboarding-status-${result.as_of}.html`, "text/html") }),
    h("button", { class: "btn small", type: "button", text: "As Markdown", onclick: () => saveBlob(result.onboarding_status_markdown, `onboarding-status-${result.as_of}.md`, "text/markdown") }),
    h("button", { class: "btn small", type: "button", text: "Copy for an email", onclick: (e) => copyText(result.onboarding_status_markdown).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
    h("span", { class: "note", text: "What is done, what waits on whose team, and the read-only commands to check. No internal scores." }));
  return h("div", {},
    head, share, gap, noDetail, since,
    h("div", { class: "col2" }, card(`Where ${score.terms.units} stop`, funnel(o.funnel), { sub: o.has_detail ? `Median ${o.time_to_deploy.median == null ? "n/a days" : nOf(o.time_to_deploy.median, "day")} from discovery to a deployed connector (90th percentile ${o.time_to_deploy.p90 == null ? "n/a days" : nOf(o.time_to_deploy.p90, "day")}); ${o.time_to_first_scan.median == null ? "n/a days" : nOf(o.time_to_first_scan.median, "day")} from deployment to the first scan.` : "From accounts.csv only." }),
      card("Unblock in this order", waves, { sub: "Grouped by cause and ordered by accounts unblocked per hour. Causes fixed once for the organization come first when they hold many back.",
        actions: h("button", { class: "btn small", type: "button", text: "Download plan", onclick: () => saveBlob(result.onboarding_markdown, "beyond90-onboarding.md", "text/markdown") }) })),
    card("Every " + score.terms.unit + ", by stage", h("div", {},
      h("div", { class: "toolbar" }, searchBox(`Search ${units}, owner, cause or error`, (v) => { q = v; apply(); }),
        chipFilter("Stage", o.stages.filter((x) => rows.some((r) => r.stage === x.id)).map((x) => ({ label: x.label, value: x.id })), (v) => { st = v; apply(); }),
        chipFilter("Provider", providers, (v) => { pv = v; apply(); }),
        csvButton("beyond90-onboarding.csv", [{ key: "id", label: "id" }, { key: "provider", label: "provider" }, { key: "stage", label: "stage" }, { key: "issue", label: "cause" }, { key: "days_in_stage", label: "days_at_stage" }, { key: "owner", label: "owner" }, { key: "error", label: "error" }], () => t.rows())),
      t.el)),
    h("div", { class: "col2" }, h("div", {}, ext, secrets), sec),
    // the error catalogue and the kickoff checklist know public clouds and Kubernetes only: shown for that profile alone
    (!score.provenance || !score.provenance.profile || score.provenance.profile === "cnapp") ? h("div", { class: "col2" }, triageCard(engine), preflightCard(engine)) : null);
}

function commands(list) {
  if (!list || !list.length) return null;
  const text = list.join("\n");
  return h("div", { class: "cmds" }, h("div", { class: "cmdhead" }, h("span", { text: "To check (read-only)" }),
    h("button", { class: "btn small", type: "button", text: "Copy commands", onclick: (e) => copyText(text).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) })),
    h("pre", { text }));
}

function causeTitle(o, id) {
  const c = o.causes.find((x) => x.issue === id);
  return c ? c.title : id.replace(/_/g, " ");
}

function fixBlock(o, id) {
  const w = o.waves.find((x) => x.issue === id || (id === "not_deployed" && x.issue === "deploy_org"));
  if (!w) return h("p", { text: causeTitle(o, id) });
  return h("div", {}, h("p", {}, h("b", { text: causeTitle(o, id) + ". " }), w.why), h("ol", {}, w.steps.map((x) => h("li", { text: x }))), h("p", { class: "note", text: "Verify: " + w.verify + " Owner: " + w.owner + "." }));
}

/** Paste what the customer sees; get the cause, the owner and the fix. The text stays in this tab. */
function triageCard(engine) {
  const ta = h("textarea", { rows: 5, placeholder: "Paste the error a connector shows, for example: AADSTS65001: The user or administrator has not consented…", "aria-label": "Error message", maxlength: 4000 });
  const prov = h("select", { "aria-label": "Provider" }, ["", "aws", "azure", "gcp", "oci"].map((p) => h("option", { value: p, text: p || "any provider" })));
  const kind = h("select", { "aria-label": "Connector kind" }, ["", "cloud", "kubernetes", "sensor", "registry"].map((k) => h("option", { value: k, text: k || "any connector" })));
  const out = h("div", { class: "triage-out", role: "status" });
  const run = async () => {
    if (!ta.value.trim()) { put(out, h("p", { class: "note", text: "Paste a message first." })); return; }
    put(out, h("p", { class: "note", text: "Reading…" }));
    try {
      const r = await engine.json("triage", { text: ta.value, options: { provider: prov.value, kind: kind.value } });
      const m = r.match;
      if (!m) { put(out, h("p", { class: "note", text: "No known cause matches. Collect the full error, the connector ID and the time, and open a support case." })); return; }
      put(out, h("div", { class: "card inset" }, h("h3", { text: m.title }), h("p", { class: "note first", text: `${m.owner} · about ${m.hours} h${m.scope === "org" ? " · one fix covers the organization" : ""}` }),
        h("p", { text: m.why }), h("ol", {}, m.steps.map((x) => h("li", { text: x }))), commands(m.checks), h("p", {}, h("b", { text: "Verify: " }), m.verify),
        r.also.length ? h("p", { class: "note", text: "Also possible: " + r.also.map((x) => x.title).join("; ") }) : null));
    } catch (e) { if (!e.cancelled) put(out, h("p", { class: "note", text: "Could not read it: " + e.message })); }
  };
  return card("Explain a connector error", h("div", { class: "triage" }, ta, h("div", { class: "row left" }, prov, kind, h("button", { class: "btn small primary", type: "button", text: "Explain", onclick: run })), out),
    { sub: "Matched against a catalogue of the usual causes for cloud accounts, clusters and sensors. Nothing leaves this page." });
}

/** The kickoff checklist, before any connector exists. */
function preflightCard(engine) {
  const boxes = {}, provs = {};
  const opt = (k, label) => { const i = h("input", { type: "checkbox" }); boxes[k] = i; return h("label", { class: "inline check" }, i, label); };
  const prov = (k, label) => { const i = h("input", { type: "checkbox", checked: k === "aws" }); provs[k] = i; return h("label", { class: "inline check" }, i, label); };
  const out = h("div", { class: "preflight-out" });
  let md = "";
  const go = async () => {
    const options = { providers: Object.keys(provs).filter((k) => provs[k].checked), org: !boxes.per_account.checked };
    for (const k of ["kubernetes", "sensor", "cmk", "guardrails", "private_clusters", "pod_security", "proxy"]) options[k] = boxes[k].checked;
    try {
      const r = await engine.json("preflight", { options });
      md = r.markdown;
      put(out, ...r.sections.map((sct) => h("section", { class: "agitem" }, h("h3", { text: sct.title }), h("ul", { class: "todo" }, sct.items.map((x) => h("li", {}, h("input", { type: "checkbox", "aria-label": x }), " ", x))))),
        h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Copy", onclick: (e) => copyText(md).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
          h("button", { class: "btn small", type: "button", text: "Download .md", onclick: () => saveBlob(md, "beyond90-preflight.md", "text/markdown") })));
    } catch (e) { if (!e.cancelled) put(out, h("p", { class: "note", text: "Could not build it: " + e.message })); }
  };
  return card("Pre-flight checklist for a kickoff", h("div", {},
    h("div", { class: "row left wrap" }, prov("aws", "AWS"), prov("azure", "Azure"), prov("gcp", "Google Cloud"), prov("oci", "Oracle Cloud")),
    h("div", { class: "row left wrap" }, opt("per_account", "account by account"), opt("guardrails", "guardrails in force"), opt("cmk", "customer-managed keys"),
      opt("kubernetes", "clusters"), opt("sensor", "runtime sensor"), opt("private_clusters", "private clusters"), opt("pod_security", "pod security enforced"), opt("proxy", "egress proxy")),
    h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Build the checklist", onclick: go })), out),
    { sub: "What to prepare and who must be in the room, so deployment day is not where the blockers are found." });
}

/** Book mode: onboarding across customers, and the causes they share. */
export function bookOnboardView({ book }) {
  const ob = book.onboarding, rows = Object.entries(ob.customers).map(([key, c]) => ({ key, ...c, id: key }));
  const cols = [
    { key: "name", label: "Customer", render: (c) => h("b", { text: c.name }) },
    { key: "complete", label: "Complete", num: true, sort: (c) => c.complete / Math.max(1, c.total), render: (c) => `${c.complete} of ${c.total}` },
    { key: "healthy_l1", label: "Healthy", num: true, render: (c) => h("span", { class: c.healthy_l1 < c.listed_l1 - 0.0005 ? "bad-text" : "", text: pct(c.healthy_l1) }) },
    { key: "listed_l1", label: "Counted (L1)", num: true, render: (c) => pct(c.listed_l1) },
    { key: "stalled", label: "Stuck > 1 week", num: true },
    { key: "secrets", label: "Secrets expiring", num: true },
    { key: "security", label: "Security notes", num: true },
    { key: "loss_points_90d", label: "90 days, if idle", num: true, render: (c) => h("span", { class: c.loss_points_90d < -2 ? "bad-text" : "", text: `${c.loss_points_90d.toFixed(1)} pts` }) },
    { key: "top", label: "Unblock first", sort: (c) => (c.top_wave ? -c.top_wave.per_hour : 0), render: (c) => (c.top_wave ? h("span", {}, c.top_wave.title, h("small", { class: "block", text: `${c.top_wave.count} · ${c.top_wave.owner}` })) : h("span", { class: "dim", text: "nothing blocked" })) },
  ];
  return h("div", {},
    card("Onboarding across the book", dataTable({ columns: cols, rows, label: "Onboarding by customer", pageSize: 100 }).el, { sub: "Healthy counts connectors that actually work; Counted is what L1 believes. A gap between them is a connector that broke after it was counted." }),
    card("Causes more than one customer shares", ob.shared.length ? h("ul", { class: "checks" }, ob.shared.map((x) => h("li", {}, chip(`${x.customers.length} customers`, "warn"), h("span", {}, h("b", { text: x.title }), h("small", { class: "block", text: `${x.accounts} accounts: ${x.customers.join(", ")}` }))))) : h("p", { class: "note", text: "No cause is shared." }),
      { sub: "Write the fix once, as a short guide or a template, and use it everywhere." }));
}

// ------------------------------------------------------------------ outlook: if nothing is done
const EVENT_LABEL = { secret_expiry: "secret expires", acceptance_expiry: "acceptance expires", triage_entry: "enters triage", sla_critical: "critical deadline", sla_high: "high deadline",
  commitment: "our promise due", cadence: "touch due", renewal: "renewal" };
const EVENT_KIND = { secret_expiry: "bad", acceptance_expiry: "warn", triage_entry: "warn", sla_critical: "bad", sla_high: "warn", commitment: "warn", cadence: "", renewal: "bad" };

export function outlookView({ dash, result }) {
  const o = dash.outlook;
  const curve = lineChart({ series: [{ label: "If nothing is done", points: o.curve.map((c) => [c.day, c.yield]), color: "var(--neg)" }], marks: [{ y: o.curve[0].yield, label: "today" }], xLabel: "days from now", yMax: Math.min(1, o.curve[0].yield + 0.05) });
  let who = new Set(), kinds = new Set();
  const rows = o.events.map((e, i) => ({ ...e, id: String(i) }));
  const t = dataTable({ label: "Dated events", rows, pageSize: 40, empty: "Nothing is dated in this window.", columns: [
    { key: "date", label: "Date" },
    { key: "kind", label: "What", render: (e) => chip(EVENT_LABEL[e.kind] || e.kind, EVENT_KIND[e.kind] || "") },
    { key: "text", label: "Detail", render: (e) => h("span", {}, e.text, e.refs.length ? h("small", { class: "block dim", text: e.refs.slice(0, 8).join(", ") + (e.refs.length > 8 ? ` +${e.refs.length - 8}` : "") }) : null) },
    { key: "points", label: "Effect", num: true, sort: (e) => e.points || 0, render: (e) => (e.points ? h("span", { class: e.points < 0 ? "bad-text" : "", text: `${e.points > 0 ? "+" : ""}${e.points.toFixed(1)} pts` }) : h("span", { class: "dim", text: "—" })) },
    { key: "who", label: "Whose move", render: (e) => ({ customer: "theirs", us: "ours", both: "both" })[e.who] || e.who },
  ] });
  const apply = () => t.setFilter((e) => (!who.size || who.has(e.who)) && (!kinds.size || kinds.has(e.kind)));
  const present = [...new Set(rows.map((e) => e.kind))];
  const lvl = o.curve.filter((c) => c.level);
  return h("div", {},
    h("div", { class: "card callout " + (o.loss_points <= -2 ? "bad" : o.loss_points < 0 ? "" : "good") }, h("h2", { text: o.loss_points < 0 ? `Waiting costs ${Math.abs(o.loss_points).toFixed(1)} points in ${o.horizon_days} days` : "Nothing already dated lowers the score" }), h("p", { text: o.summary })),
    h("div", { class: "col2" }, card("Yield if nothing is done", curve, { sub: o.note + (lvl.length ? " Level: " + lvl.map((c) => `day ${c.day} ${c.level}`).join(", ") + "." : "") }),
      card("The first things to break", h("ul", { class: "checks" }, o.events.filter((e) => (e.points || 0) < 0 || e.kind === "sla_critical" || e.kind === "secret_expiry").slice(0, 6).map((e) => h("li", {}, chip(e.date, EVENT_KIND[e.kind] || ""), h("span", {}, h("b", { text: EVENT_LABEL[e.kind] || e.kind }), h("small", { class: "block", text: e.text + (e.points ? ` ${e.points.toFixed(1)} pts.` : "") }))))),
        { sub: "Each one has a date, so each one can be prevented." })),
    card("Every dated event in the next " + o.horizon_days + " days", h("div", {},
      h("div", { class: "toolbar" }, chipFilter("Whose move", [{ label: "theirs", value: "customer" }, { label: "ours", value: "us" }, { label: "both", value: "both" }], (v) => { who = v; apply(); }),
        chipFilter("What", present.map((k) => ({ label: EVENT_LABEL[k] || k, value: k })), (v) => { kinds = v; apply(); }),
        h("button", { class: "btn small primary", type: "button", text: "Add to calendar (.ics)", onclick: () => saveBlob(result.outlook_ics, `beyond90-outlook-${result.as_of}.ics`, "text/calendar") }),
        csvButton("beyond90-outlook.csv", [{ key: "date", label: "date" }, { key: "kind", label: "kind" }, { key: "text", label: "detail" }, { key: "points", label: "points" }, { key: "who", label: "whose_move" }], () => t.rows())),
      t.el), { sub: "The effect is exact: the estate is scored the day before and the day of each event, with nothing else changed." }));
}

// ------------------------------------------------------------------ changes
export function changesView({ dash }) {
  const a = dash.attribution;
  if (!a) return card("What changed", h("p", { class: "note", text: "Choose an earlier snapshot to compare with, in the bar above the tabs. Snapshots are saved in this browser (section 'Saved in this browser')." }));
  const items = a.factors.map((f) => ({ label: f.label, points: f.points, kind: f.kind }));
  return h("div", {},
    h("div", { class: "kpiline" }, stat(`${pct(a.yield_from)} → ${pct(a.yield_to)}`, `${a.from_as_of} to ${a.to_as_of}`), stat(pts(a.delta_points), "change in Yield"), stat(pts(a.customer_points), "from the customer's work", a.customer_points >= 0 ? "good" : "bad"), stat(pts(a.bar_points), "from a moving bar", a.bar_points < 0 ? "warn" : "")),
    card("Contribution of each factor", contributions(items), { sub: "Exact: the contributions sum to the change. The hatched-looking bars are headroom from newer capabilities, not the customer's doing." }),
    a.notes.length ? h("ul", {}, a.notes.map((n) => h("li", { text: n }))) : null,
    dash.drift ? card("Did the inputs change?", h("ul", { class: "checks" }, dash.drift.items.map((i) => h("li", {}, chip(i.status, STATUS_KIND[i.status] || ""), h("span", { text: i.text })))), { sub: "These look for artefacts of the export, not for progress." }) : null);
}

// ------------------------------------------------------------------ value
/** What changed since the last snapshot, as evidence: what moved, what we did around it, and what did not move. */
export function valueView({ dash, result }) {
  const v = dash.impact;
  if (!v) return h("div", {}, card("Value receipt", h("p", { class: "note first", text: "Pick a saved snapshot in \u201cCompare with\u201d to see what moved since then. The receipt needs a before and an after." })));
  const sev = v.findings.by_severity || {};
  const buttons = h("span", { class: "btnrow" },
    h("button", { class: "btn small primary", type: "button", text: "Download receipt (.html)", onclick: () => saveBlob(result.receipt_html, `beyond90-value-receipt-${result.as_of}.html`, "text/html") }),
    h("button", { class: "btn small", type: "button", text: "Copy as Markdown", onclick: (e) => copyText(result.receipt_markdown).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }));
  const tl = v.touches.timeline;
  return h("div", {},
    h("div", { class: "card callout " + (v.headline.length ? "good" : "") }, h("h2", { text: `${v.from} \u2192 ${v.to} (${v.days} days)` }),
      h("p", { text: v.headline.length ? v.headline.join("; ") + "." : "Nothing measurable moved in this window." }), buttons),
    h("div", { class: "kpiline" }, stat(String(v.connected.accounts.length), "accounts connected", v.connected.accounts.length ? "good" : ""),
      stat(num(v.connected.spend), "monthly spend now watched"), stat(String(v.findings.closed), "findings closed", v.findings.closed ? "good" : ""),
      stat(String(sev.critical || 0), "of them critical", sev.critical ? "good" : ""), stat(String(v.capabilities.gained), "capability activations"),
      stat(`${v.yield.customer_points >= 0 ? "+" : ""}${v.yield.customer_points.toFixed(1)}`, "points from the customer's work", v.yield.customer_points > 0 ? "good" : v.yield.customer_points < 0 ? "bad" : "")),
    h("div", { class: "col2" },
      card("What happened around it", tl.length ? h("ul", { class: "checks" }, tl.map((t) => h("li", {}, chip(t.date, ""), h("span", {}, h("b", { text: `${t.kind}: ${t.summary}` }),
        h("small", { class: "block", text: t.followed_count ? `Followed within 21 days by: ${t.followed_by.join("; ")}${t.followed_count > t.followed_by.length ? ` (+${t.followed_count - t.followed_by.length})` : ""}` : "Nothing measurable followed within 21 days." }))))) : h("p", { class: "note first", text: "No touches logged in this window." }),
        { sub: `Followed, not caused: a timeline is evidence for a conversation, not proof. Promises kept: ${v.promises.kept} (${v.promises.on_time} on time).` }),
      card("What did not move", v.remaining.length ? h("ul", {}, v.remaining.map((r) => h("li", { text: r }))) : h("p", { class: "note first", text: "No open gap worth naming." }),
        { sub: v.connected.lost.length ? `Also lost: ${nOf(v.connected.lost.length, "account")} no longer connected.` : "A receipt that hides the gaps is a sales sheet." })));
}

// ------------------------------------------------------------------ teams
/** One digest per customer team, ranked by what is at stake on their side, each with a message ready to send. */
export function teamsView({ dash }) {
  const list = dash.teams.teams;
  return h("div", {},
    h("p", { class: "note", text: "A champion cannot fix everything. Each team gets only its own accounts, its own blockers and at most three asks, ranked by spend not connected, critical findings and blocked connectors." }),
    h("div", { class: "teamgrid" }, list.map((t, i) => card(`${i + 1}. ${t.name}`, h("div", {},
      h("div", { class: "kpiline" }, stat(String(t.accounts), "accounts"), stat(pct(t.spend_share), "of spend"),
        stat(String(t.unconnected.length), "not connected", t.unconnected.length ? "warn" : "good"), stat(String(t.findings.filter((f) => f.severity === "critical").length), "critical open", t.findings.some((f) => f.severity === "critical") ? "bad" : "good")),
      t.asks.length ? h("ol", {}, t.asks.map((a) => h("li", { text: a }))) : h("p", { class: "note first", text: "Nothing to ask this month." }),
      h("details", {}, h("summary", { text: t.contacts.length ? `Message for ${t.contacts.map((c) => c.name).join(", ")}` : "Message (no contact on record)" }), h("pre", { class: "recap", tabindex: "0", text: t.message })),
      h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Copy message", onclick: (e) => copyText(t.message).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
      { sub: t.contacts.length ? t.contacts.map((c) => c.role ? `${c.name} (${c.role})` : c.name).join(", ") : "No contact on record for this team." }))));
}

// ------------------------------------------------------------------ risk burn-down
const SEV_ORDER = ["critical", "high", "medium", "low"];

/** Whether the findings that matter are going away: open now, how old, how long fixes take, and the last six months. */
export function burndownView({ dash, setSla }) {
  const b = dash.burndown;
  if (!b) return h("p", { class: "note", text: "No findings were loaded, so there is nothing to burn down." });
  const z = b.zero_critical;
  const zeroText = z.never_had ? "No critical finding is on record."
    : z.now ? (z.days != null ? `Zero critical findings open, for ${z.days} day${z.days === 1 ? "" : "s"} (since ${z.since}).` : "Zero critical findings open.")
      : `${b.open.critical} critical finding${b.open.critical === 1 ? "" : "s"} open${z.last_zero ? `; the last time there were none was ${z.last_zero}` : "; there has been no day without one on record"}.`;
  const peak = Math.max(1, ...b.flow.map((m) => Math.max(m.opened, m.closed)));
  const bar = (n, kind) => h("span", { class: "bd-bar " + kind, style: `width:${Math.round((n / peak) * 100)}%`, title: String(n) });
  const flow = h("div", { class: "bd-flow", role: "table", "aria-label": "Opened and closed by month" },
    h("div", { class: "bd-row bd-head", role: "row" }, h("span", { role: "columnheader", text: "Month" }), h("span", { role: "columnheader", text: "Opened and closed" }), h("span", { role: "columnheader", text: "Critical open at month end" }), h("span", { role: "columnheader", text: "High" })),
    ...b.flow.map((m) => h("div", { class: "bd-row", role: "row" },
      h("span", { role: "cell", text: m.month }),
      h("span", { role: "cell", class: "bd-bars" }, bar(m.opened, "opened"), h("small", { text: `${m.opened} opened` }), bar(m.closed, "closed"), h("small", { text: `${m.closed} closed` })),
      h("span", { role: "cell", text: String(m.open_critical) }), h("span", { role: "cell", text: String(m.open_high) }))));
  const table = h("div", { class: "tablewrap" }, h("table", { class: "dt", "aria-label": "By severity" },
    h("thead", {}, h("tr", {}, ["Severity", "Open", `Older than target`, "0-7 days", "8-30", "31-90", "91+", `Mean days to fix (last ${b.mttr_window_days})`].map((t) => h("th", { text: t })))),
    h("tbody", {}, SEV_ORDER.map((sv) => h("tr", {},
      h("td", {}, chip(sv, SEV[sv])),
      h("td", { text: String(b.open[sv]) }),
      h("td", { text: `${b.past_sla[sv]} (target ${b.sla_days[sv]}d)` }),
      ...Object.values(b.aging[sv]).map((n) => h("td", { text: String(n) })),
      h("td", { text: b.mttr[sv].days == null ? (b.mttr[sv].n ? `too few (${b.mttr[sv].n})` : "none closed") : `${b.mttr[sv].days} (${b.mttr[sv].n})` }))))));
  const oldest = b.oldest_urgent.length ? h("ol", {}, b.oldest_urgent.map((o) => h("li", { text: `${o.severity} ${o.id} in ${o.account_id}: ${o.age_days} days old, ${o.owner ? "owner " + o.owner : "no owner"}` })))
    : h("p", { class: "note first", text: "No critical or high finding is open." });
  const f = b.focus;
  return h("div", {},
    h("section", { class: "card bdhero" },
      h("p", { class: "bdlead", role: "status", text: zeroText }),
      f && f.raw ? h("p", { class: "bdnoise" }, h("b", { text: `${f.raw} open` }), " → ", h("b", { text: `${f.matter} need a decision now` }), h("small", { text: `${Math.round(f.share * 100)}% of what is open. ${f.rule} A rule on severity and age, not a judgement of what is exploitable.` })) : null),
    h("div", { class: "kpiline" }, stat(String(b.open.critical), "critical open", b.open.critical ? "bad" : "good"), stat(String(b.open.high), "high open", b.open.high ? "warn" : "good"),
      stat(String(b.past_sla_total), "older than target", b.past_sla_total ? "warn" : "good"), stat(String(b.unowned_urgent), "critical or high with no owner", b.unowned_urgent ? "warn" : "good")),
    card("Start with the oldest critical and high", oldest),
    card("By severity and age", table, { sub: b.sla_is_default ? "Target ages are the default (7, 30, 90, 180 days). Set the customer's own below before quoting a figure." : "Target ages as set for this customer." }),
    slaCard(b, setSla),
    closureCard(b.closure),
    automationCard(b.automation),
    card("The last six months", flow, { sub: "Rebuilt from each finding's open and close dates." }),
    h("p", { class: "note", text: b.note }));
}

// ------------------------------------------------------------------ executive QBR
const quarterOf = (iso) => { const [y, m] = iso.split("-").map(Number); const q = Math.floor((m - 1) / 3); const s = `${y}-${String(3 * q + 1).padStart(2, "0")}-01`;
  const e = new Date(Date.UTC(y, 3 * q + 3, 0)).toISOString().slice(0, 10); return { from: s, to: e, label: `Q${q + 1} ${y}` }; };

/** The review a CISO reads, built when it is needed from everything saved for this customer. */
export function execQbrView({ score, result, engine, files, saved, advisories, frameHtml }) {
  const mine = (saved || []).filter((s) => s.customer === score.customer).sort((a, b) => a.as_of.localeCompare(b.as_of));
  const dates = [...new Set([...mine.map((s) => s.as_of), result.as_of])].sort();
  const quarters = [...new Map(dates.map((d) => [quarterOf(d).label, quarterOf(d)])).values()].reverse();
  const preset = h("select", { "aria-label": "Period" }, quarters.map((q) => h("option", { value: q.label, text: q.label })), h("option", { value: "custom", text: "Custom dates" }));
  const from = h("input", { type: "date", "aria-label": "From", value: quarters[0].from }), to = h("input", { type: "date", "aria-label": "To", value: quarters[0].to });
  const used = h("p", { class: "note", role: "status" });
  const out = h("div", {});
  const showUsed = () => {
    const before = dates.filter((d) => d < from.value), inside = dates.filter((d) => d >= from.value && d <= to.value);
    used.textContent = inside.length ? `Compared with ${before.length ? before[before.length - 1] + " (the last snapshot before the period)" : inside[0] + " (the first in the period)"}; ${nOf(inside.length, "snapshot")} in the period: ${inside.join(", ")}.`
      : "No snapshot falls in this period.";
  };
  preset.addEventListener("change", () => { const q = quarters.find((x) => x.label === preset.value); if (q) { from.value = q.from; to.value = q.to; } from.disabled = to.disabled = !!q; showUsed(); });
  from.disabled = to.disabled = true;
  for (const i of [from, to]) i.addEventListener("change", showUsed);
  showUsed();
  const build = h("button", { class: "btn primary", type: "button", text: "Build the executive review" });
  build.addEventListener("click", async () => {
    build.disabled = true; put(out, h("p", { class: "note", role: "status", text: "Building from the history…" }));
    try {
      const r = await engine.json("execqbr", { snapshots: [...mine.map((s) => s.files), files], from: from.value, to: to.value, advisories });
      if (!r.ok) { put(out, h("p", { class: "bad-text", role: "alert", text: r.errors.join(" ") })); return; }
      const q = r.review, name = `beyond90-executive-review-${q.period.label.replace(/\W+/g, "-")}`;
      const frame = h("iframe", { class: "qbrframe", title: "Executive review preview", sandbox: "" });
      frameHtml(frame, r.html);
      put(out, 
        h("div", { class: "card callout good" }, h("h2", { text: `${q.customer}: ${q.period.label}` }), h("ul", {}, q.headline.map((x) => h("li", { text: x + "." }))),
          h("span", { class: "btnrow" },
            h("button", { class: "btn small primary", type: "button", text: "Download slides (.pptx)", "data-tip": "The review as a PowerPoint deck to present: six slides, the numbers large, no internal jargon.",
              onclick: () => saveBlob(Uint8Array.from(atob(r.pptx), (c) => c.charCodeAt(0)), name + ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation") }),
            h("button", { class: "btn small", type: "button", text: "Download (.html, prints to PDF)", onclick: () => saveBlob(r.html, name + ".html", "text/html") }),
            h("button", { class: "btn small", type: "button", text: "Download (.md)", onclick: () => saveBlob(r.markdown, name + ".md", "text/markdown") }),
            h("button", { class: "btn small", type: "button", text: "Copy as Markdown", onclick: (e) => copyText(r.markdown).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
        q.decisions.length ? card("Decisions to ask for", h("ol", {}, q.decisions.map((d) => h("li", { text: d })))) : null,
        card("Preview", frame, { sub: `Built from ${nOf(q.snapshots.length, "snapshot")}: ${q.snapshots.join(", ")}. Written for an executive reader: no internal scores or stage names.` }));
    } catch (e) { if (!e.cancelled) put(out, h("p", { class: "bad-text", role: "alert", text: "Could not build it: " + e.message })); }
    finally { build.disabled = false; }
  });
  const timeline = h("ol", { class: "snaptl", "aria-label": "Saved snapshots" }, dates.map((d) => h("li", {}, h("span", { class: "dot" }), h("b", { text: d }), h("small", { text: mine.some((s) => s.as_of === d) ? "saved" : "this analysis, not saved" }))));
  return h("div", {},
    card(`History of ${score.customer}`, h("div", {}, timeline,
      h("p", { class: "note", text: mine.length ? `${nOf(mine.length, "saved snapshot")} in this browser. Every analysis is added automatically (step 1, "Keep every analysis in the customer's history"); export the workspace to keep it elsewhere.` : "Nothing saved yet for this customer: this analysis will be the only point. Turn on “Keep every analysis” in step 1 and each run adds to the history." })),
      { sub: "Contacts, commitments and interactions are saved only if you choose so; the review takes them from the latest analysis." }),
    card("Build a review", h("div", {},
      h("div", { class: "formgrid" }, h("label", {}, "Period", preset), h("label", {}, "From", from), h("label", {}, "To", to)),
      used, h("div", { class: "row left" }, build)),
      { sub: "One page per section when printed: where they stand, what the quarter delivered, working together, exposure today, next quarter and the decisions you need." }),
    out);
}

// ------------------------------------------------------------------ connections
/** Where the separate signals meet, as an interactive graph with the insights it supports. */
export function connectionsView({ dash, go }) {
  return connections(dash.graph, { go });
}

/** The same across the book: what several customers share, so one piece of work serves them all. */
export function bookConnectionsView({ book, openCustomer }) {
  return book.graph ? connections(book.graph, { go: () => {}, open: openCustomer }) : h("p", { class: "note first", text: "Run the book again to see what its customers share." });
}

// ------------------------------------------------------------------ asks to the vendor
let askScope = "all";
export function asksView({ result, asks, today, addAsk, setAskStatus, removeAsk }) {
  const say = h("p", { class: "note", role: "status" });
  const act = (fn) => async () => { try { await fn(); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const f = {
    kind: h("select", { "aria-label": "Kind of ask" }, A.KINDS.map((k) => h("option", { value: k, text: A.KIND_TEXT[k] }))),
    title: h("input", { type: "text", maxlength: 120, "aria-label": "What is being asked", placeholder: "What is being asked" }),
    stake: h("input", { type: "number", min: 0, step: 1, "aria-label": "What is at stake (a number, optional)", placeholder: "At stake (optional)" }),
    ref: h("input", { type: "text", maxlength: 60, "aria-label": "Ticket or reference (optional)", placeholder: "Ticket (optional)" }),
    detail: h("input", { type: "text", maxlength: 500, "aria-label": "Detail (optional)", placeholder: "Detail (optional)" }),
  };
  const scope = h("select", { "aria-label": "Show asks for" }, h("option", { value: "all", text: "All customers" }), h("option", { value: "this", text: result.customer }));
  scope.value = askScope;
  const body = h("div", {});
  const row = (a) => h("li", { class: "promise" },
    h("span", { class: "pmain" }, h("b", { text: a.customer + ": " }), a.title,
      h("small", { class: "muted", text: ` ${A.KIND_TEXT[a.kind].toLowerCase()}, ${a.status}${a.at_stake ? `, at stake ${a.at_stake.toLocaleString("en-US")}` : ""}${a.ref ? `, ${a.ref}` : ""}, raised ${a.created_on}` })),
    h("span", { class: "btnrow" },
      a.status === "open" || a.status === "shared"
        ? [a.status === "open" ? h("button", { class: "btn small", type: "button", text: "Passed on", "aria-label": `Mark passed on: ${a.title}`, onclick: act(() => setAskStatus(a.id, "shared")) }) : null,
          h("button", { class: "btn small", type: "button", text: "Done", "aria-label": `Mark done: ${a.title}`, onclick: act(() => setAskStatus(a.id, "done")) }),
          h("button", { class: "btn small quiet", type: "button", text: "Declined", "aria-label": `Mark declined: ${a.title}`, onclick: act(() => setAskStatus(a.id, "declined")) })]
        : h("button", { class: "btn small quiet", type: "button", text: "Reopen", "aria-label": `Reopen: ${a.title}`, onclick: act(() => setAskStatus(a.id, "open")) }),
      h("button", { class: "icon-btn", type: "button", text: "×", "aria-label": `Delete: ${a.title}`, onclick: act(() => removeAsk(a.id)) })));
  const draw = () => {
    const list = scope.value === "this" ? asks.filter((a) => a.customer === result.customer) : asks;
    const d = A.digest(list, today);
    const open = list.filter((a) => a.status === "open" || a.status === "shared");
    put(body, 
      h("div", { class: "kpiline" }, stat(String(d.counts.open), "open"), stat(String(d.counts.themes), "different asks"), stat(String(d.counts.escalations), "escalations", d.counts.escalations ? "warn" : ""), stat(String(d.counts.customers), "customers")),
      !asks.length ? h("p", { class: "note", text: "Nothing is kept yet. Add what a customer asked for below." }) : null,
      d.themes.length ? card("Asked by several customers first", h("ul", { class: "rates wide" }, d.themes.map((t) => h("li", {}, h("span", { class: "rl", text: t.title }),
        h("span", { class: "rn", text: `${t.customers.length} customer${t.customers.length === 1 ? "" : "s"}: ${t.customers.join(", ")}${t.at_stake ? `; at stake ${t.at_stake.toLocaleString("en-US")}` : ""}` }))))) : null,
      open.length ? card("Open", h("ul", { class: "promises" }, open.map(row))) : null,
      list.length > open.length ? card("Closed", h("ul", { class: "promises" }, list.filter((a) => !open.includes(a)).map(row))) : null,
      h("div", { class: "row left" },
        h("button", { class: "btn small primary", type: "button", text: "Copy digest", onclick: (e) => copyText(A.digestMarkdown(d, today)).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Export CSV", onclick: () => saveBlob(toCsv(A.CSV_COLUMNS, [...list].sort((x, y) => x.customer.localeCompare(y.customer) || x.created_on.localeCompare(y.created_on))), "beyond90-asks.csv", "text/csv") })));
  };
  scope.addEventListener("change", () => { askScope = scope.value; draw(); });
  draw();
  return h("div", {},
    card("Add an ask", h("div", {}, h("div", { class: "formgrid" }, h("label", {}, "Kind", f.kind), h("label", { class: "wide2" }, "What", f.title), h("label", {}, "At stake", f.stake), h("label", {}, "Ticket", f.ref), h("label", { class: "wide2" }, "Detail", f.detail)),
      h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Keep in the ledger", onclick: act(async () => { await addAsk({ kind: f.kind.value, title: f.title.value, atStake: f.stake.value, ref: f.ref.value, detail: f.detail.value }); f.title.value = ""; f.detail.value = ""; }) })), say),
    { sub: `For ${result.customer}. At stake is a figure you type (a renewal amount, say): the page does not measure it. Kept in this browser; erasing a customer removes their asks.` }),
    card("Asks", h("div", {}, h("div", { class: "row left" }, h("label", { class: "inline" }, "Show ", scope)), body)),
    );
}

// ------------------------------------------------------------------ proof of value
let povPick = "";
/** How the deal ended, and why: recorded on the proof of value, read back by the desk's lessons. */
function dealOutcomeCard(p, today, edit) {
  const o = p.outcome || { result: "", reason: "", note: "", on: today };
  const result = h("select", { "aria-label": "Outcome" }, [["", "Not decided yet"], ...Object.entries(P.OUTCOMES)].map(([v, t]) => h("option", { value: v, text: t })));
  result.value = o.result;
  const reason = h("select", { "aria-label": "Main reason" }, [["", "No reason given"], ...Object.entries(P.REASONS)].map(([v, t]) => h("option", { value: v, text: t })));
  reason.value = o.reason;
  const note = h("input", { type: "text", maxlength: 300, value: o.note, "aria-label": "In a sentence", placeholder: "In a sentence: what decided it" });
  const on = h("input", { type: "date", value: o.on, "aria-label": "Decided on" });
  return card("The outcome", h("div", {},
    h("div", { class: "formgrid" }, h("label", {}, "Outcome", result), h("label", {}, "Main reason", reason), h("label", {}, "Decided on", on), h("label", { class: "wide2" }, "In a sentence", note)),
    h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Record the outcome",
      onclick: edit((q) => P.setOutcome(q, result.value ? { result: result.value, reason: reason.value, note: note.value, on: on.value || today } : null, today)) }))),
  { sub: p.outcome ? `Recorded: ${P.OUTCOMES[p.outcome.result].toLowerCase()} on ${p.outcome.on}. The desk counts it in what the deals teach.` : "Once the customer decides: won, lost or no decision, and the main reason. The desk learns from it across deals." });
}

export function povView({ result, book, povs, today, savePov, removePov, dash }) {
  const suggested = (dash && Array.isArray(dash.pov_criteria)) ? dash.pov_criteria : [];
  const customers = book ? book.customers.map((r) => r.customer) : [result.customer];
  const say = h("p", { class: "note", role: "status" });
  const act = (fn) => async () => { try { await fn(); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const mine = book ? povs : povs.filter((p) => p.customer === result.customer);
  const body = h("div", {});
  const sel = h("select", { "aria-label": "Proof of value to show" }, mine.map((p) => h("option", { value: p.id, text: `${p.customer}, ${p.start || p.created_on}` })));
  if (mine.some((p) => p.id === povPick)) sel.value = povPick;
  const nf = { cust: h("select", { "aria-label": "Customer" }, customers.map((c) => h("option", { value: c, text: c }))),
    sponsor: h("input", { type: "text", maxlength: 100, "aria-label": "Sponsor" }), champion: h("input", { type: "text", maxlength: 100, "aria-label": "Champion" }),
    problem: h("input", { type: "text", maxlength: 300, "aria-label": "The problem to settle" }), scope: h("input", { type: "text", maxlength: 300, "aria-label": "Out of scope" }),
    start: h("input", { type: "date", "aria-label": "Start date" }), end: h("input", { type: "date", "aria-label": "End date" }) };
  const draw = () => {
    povPick = sel.value;
    const p = mine.find((x) => x.id === sel.value);
    if (!p) { put(body, h("p", { class: "note", text: "No proof of value yet. Fill in the plan above to start one with starter criteria you can change." })); return; }
    const pr = P.progress(p);
    const edit = (fn) => act(async () => { await savePov(fn(p)); });
    const crit = p.criteria.map((c) => {
      const st = h("select", { "aria-label": `Result for: ${c.text}` }, P.STATUSES.map((s) => h("option", { value: s, text: P.STATUS_TEXT[s] })));
      st.value = c.status;
      const ev = h("input", { type: "text", maxlength: 300, value: c.evidence, "aria-label": `What was seen for: ${c.text}`, placeholder: "What was seen" });
      return h("li", { class: "promise" }, h("span", { class: "pmain" }, c.text, h("small", { class: "muted", text: c.target ? ` Target: ${c.target}` : "" })),
        h("span", { class: "btnrow" }, st, ev, h("button", { class: "btn small", type: "button", text: "Save", "aria-label": `Save result for: ${c.text}`, onclick: edit((q) => P.setCriterion(q, c.id, { status: st.value, evidence: ev.value }, today)) })));
    });
    const ready = p.readiness.map((r) => h("li", {}, h("label", { class: "inline" }, h("input", { type: "checkbox", checked: r.done, onchange: edit((q) => P.setReady(q, r.id, !r.done, today)) }), " " + r.text)));
    const nc = h("input", { type: "text", maxlength: 200, "aria-label": "New criterion", placeholder: "New criterion" }), nt = h("input", { type: "text", maxlength: 200, "aria-label": "How we will know", placeholder: "How we will know" });
    const sd = h("input", { type: "date", "aria-label": "Session date" }), st2 = h("input", { type: "text", maxlength: 120, "aria-label": "Session topic", placeholder: "Session topic" });
    const summ = h("textarea", { rows: 3, maxlength: 1000, "aria-label": "Summary in your words", placeholder: "Summary in your words" }); summ.value = p.summary;
    const stage = h("select", { "aria-label": "Stage" }, P.STAGES.map((s) => h("option", { value: s, text: s }))); stage.value = p.stage;
    const ql = P.qualify(p), ttv = P.timeToFirstValue(p);
    put(body, 
      h("section", { class: "card bdhero" },
        h("p", { class: "bdlead", role: "status", text: `${p.customer}: ${pr.met} of ${pr.total} criteria met.` }),
        h("p", { class: "bdnoise" }, h("b", { text: ql.verdict }), ttv == null ? "" : ` · first value after ${ttv} day${ttv === 1 ? "" : "s"}`)),
      h("div", { class: "kpiline" }, stat(pr.verdict, "result so far"), stat(`${pr.met}/${pr.total}`, "criteria met"), stat(`${pr.ready}/${pr.ready_total}`, "ready"), stat(String(p.sessions.length), "sessions"), stat(P.timeToFirstValue(p) == null ? "not set" : `${P.timeToFirstValue(p)} d`, "to first value")),
      card("Success criteria", h("ul", { class: "promises" }, crit), { sub: "Agree these with the sponsor before you start. Mark each one when you have seen it, and write what you saw." }),
      card("Add a criterion", h("div", { class: "formgrid" }, h("label", { class: "wide2" }, "Criterion", nc), h("label", { class: "wide2" }, "How we will know", nt),
        h("button", { class: "btn small", type: "button", text: "Add criterion", onclick: edit((q) => P.addCriterion(q, { text: nc.value, target: nt.value }, today)) }))),
      (() => {
        const have = new Set(p.criteria.map((c) => c.text.trim().toLowerCase()));
        const left = suggested.filter((c) => !have.has(c.text.trim().toLowerCase()));
        return left.length ? card("Suggested for this kind of product", h("ul", { class: "suggest" }, left.map((c) => h("li", {},
          h("span", {}, h("b", { text: c.text }), c.how ? h("small", { class: "block", text: `How: ${c.how}` }) : null),
          h("button", { class: "btn small", type: "button", text: "Add", "aria-label": `Add criterion: ${c.text}`, onclick: edit((q) => P.addCriterion(q, { text: c.text, target: c.how }, today)) })))),
        { sub: "Typical tests for this kind of product, written so a sponsor can sign them off. Add the ones that fit, then edit them to the customer's numbers." }) : null;
      })(),
      qualCard(p, edit, today),
      card("Ready to start?", h("ul", { class: "plain" }, ready)),
      (() => {
        const steps = P.mutualPlan(p, today);
        const ws = h("input", { type: "date", value: p.start || "", "aria-label": "Window start" }), we = h("input", { type: "date", value: p.end || "", "aria-label": "Window end" });
        const windowForm = h("div", { class: "row left winform" }, h("label", { class: "inline" }, "Start ", ws), h("label", { class: "inline" }, "End ", we),
          h("button", { class: "btn small", type: "button", text: p.start || p.end ? "Move the window" : "Set the window", onclick: edit((q) => P.setWindow(q, ws.value, we.value, today)) }));
        if (!steps) return card("Mutual plan to signature", h("div", {}, h("p", { class: "note", text: "Set the start and end of the window, and the plan from sign-off to signature is dated for you." }), windowForm));
        const WHO = { customer: p.customer, us: "Us", both: "Both" };
        return card("Mutual plan to signature", h("div", {},
          windowForm,
          h("ol", { class: "mplan" }, steps.map((s) => h("li", { class: "st-" + s.state },
            h("span", { class: "mp-d", text: s.due }), h("span", { class: "mp-w" }, h("b", { text: s.what }), h("small", { text: WHO[s.who] })),
            chip(s.state, s.state === "done" ? "good" : s.state === "late" ? "bad" : "")))),
          h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Copy the mutual plan", onclick: (e) => copyText(P.mutualPlanMarkdown(p, today)).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
        { sub: "Both sides' steps from sign-off to signature, dated from the window. Dates after the readout are proposals: agree them with the sponsor." });
      })(),
      card("Working sessions", h("div", {}, p.sessions.length ? h("ul", { class: "plain" }, p.sessions.map((s) => h("li", { text: `${s.on}: ${s.topic}${s.who ? ` (${s.who})` : ""}` }))) : h("p", { class: "note", text: "No sessions yet." }),
        h("div", { class: "formgrid" }, h("label", {}, "Date", sd), h("label", { class: "wide2" }, "Topic", st2), h("button", { class: "btn small", type: "button", text: "Add session", onclick: edit((q) => P.addSession(q, { on: sd.value, topic: st2.value }, today)) })))),
      dealOutcomeCard(p, today, edit),
      card("Summary and stage", h("div", {}, h("label", {}, "Stage ", stage), summ,
        h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Save summary", onclick: edit((q) => P.edit(q, { summary: summ.value.trim(), stage: stage.value }, today)) })))),
      h("div", { class: "row left" },
        h("button", { class: "btn small primary", type: "button", text: "Copy plan", onclick: (e) => copyText(P.planMarkdown(p)).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small primary", type: "button", text: "Copy result", onclick: (e) => copyText(P.valueReport(p, today)).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Download result .md", onclick: () => saveBlob(P.valueReport(p, today), `beyond90-pov-${p.customer.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${today}.md`, "text/markdown") }),
        h("button", { class: "icon-btn", type: "button", text: "×", "aria-label": `Delete proof of value for ${p.customer}`, onclick: act(() => removePov(p.id)) })));
  };
  sel.addEventListener("change", draw);
  draw();
  const startForm = (inner) => h("details", { class: "startpov", open: !mine.length }, h("summary", { text: mine.length ? "Start another proof of value" : "Start a proof of value" }), inner);
  const startCard = card("The plan", h("div", {}, h("div", { class: "formgrid" }, book ? h("label", {}, "Customer", nf.cust) : null, h("label", {}, "Sponsor", nf.sponsor), h("label", {}, "Champion", nf.champion), h("label", {}, "Start", nf.start), h("label", {}, "End", nf.end),
      h("label", { class: "wide2" }, "The problem to settle", nf.problem), h("label", { class: "wide2" }, "Out of scope", nf.scope)),
      h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Create the plan", onclick: act(async () => { await savePov(P.makePov({ customer: nf.cust.value, sponsor: nf.sponsor.value, champion: nf.champion.value, start: nf.start.value, end: nf.end.value, createdOn: today, problem: nf.problem.value, outOfScope: nf.scope.value }), true); }) })), say),
    { sub: "A proof of value is only worth what was agreed before it started. Kept in this browser, sealed with your passphrase if you set one." });
  return h("div", {}, ...(mine.length ? [card("Your proofs of value", h("div", {}, h("label", { class: "inline" }, "Show ", sel), body)), startForm(startCard)] : [startForm(startCard), body]));
}

function qualCard(p, edit, today) {
  const q = P.qualify(p);
  const prob = h("input", { type: "text", maxlength: 300, value: p.problem || "", "aria-label": "The problem to settle" });
  const scope = h("input", { type: "text", maxlength: 300, value: p.out_of_scope || "", "aria-label": "Out of scope" });
  const signed = h("input", { type: "date", value: p.signed_off_on || "", "aria-label": "Date the criteria were signed off" });
  const first = h("input", { type: "date", value: p.first_value_on || "", "aria-label": "Date the first value was seen" });
  return card(`Worth starting? ${q.verdict}`, h("div", {},
    h("ul", { class: "plain" }, q.items.map((i) => h("li", {}, h("strong", { text: i.ok ? "Yes: " : "Not yet: " }), i.text, i.ok ? null : h("small", { class: "muted", text: ` ${i.fix}` })))),
    h("div", { class: "formgrid" }, h("label", { class: "wide2" }, "The problem to settle", prob), h("label", { class: "wide2" }, "Out of scope", scope),
      h("label", {}, "Criteria signed off on", signed), h("label", {}, "First value seen on", first),
      h("button", { class: "btn small", type: "button", text: "Save answers", onclick: edit((x) => P.edit(x, { problem: P.clean(prob.value, 300), out_of_scope: P.clean(scope.value, 300), signed_off_on: signed.value, first_value_on: first.value }, today)) }))),
  { sub: "Asked before the first session. A proof that starts without these usually ends in an argument about what it was meant to show. Time to first value runs from the start date to the day the customer first saw something useful." });
}

// ------------------------------------------------------------------ the book's risk burn-down
export function bookBurndownView({ book, openCustomer }) {
  const rows = book.customers.map((c) => ({ c, b: (book.burndown || {})[c.key] })).filter((x) => x.b)
    .sort((x, y) => y.b.open_critical - x.b.open_critical || (y.b.oldest_urgent_days || 0) - (x.b.oldest_urgent_days || 0) || x.c.name.localeCompare(y.c.name));
  if (!rows.length) return h("p", { class: "note", text: "No findings were loaded for these customers, so there is nothing to burn down." });
  const sum = (f) => rows.reduce((t, r) => t + f(r.b), 0);
  const zero = rows.filter((r) => r.b.zero_critical.now || r.b.zero_critical.never_had).length;
  const head = ["Customer", "Critical open", "High open", "Older than target", "Oldest urgent", "No owner", "Critical state"];
  return h("div", {},
    h("div", { class: "kpiline" }, stat(String(sum((b) => b.open_critical)), "critical open", sum((b) => b.open_critical) ? "bad" : "good"), stat(String(sum((b) => b.open_high)), "high open"),
      stat(String(sum((b) => b.past_sla_total)), "older than target", sum((b) => b.past_sla_total) ? "warn" : "good"), stat(`${zero}/${rows.length}`, "at zero criticals")),
    card("By customer", h("div", { class: "tablewrap" }, h("table", { class: "dt", "aria-label": "Risk by customer" },
      h("thead", {}, h("tr", {}, head.map((t) => h("th", { text: t })))),
      h("tbody", {}, rows.map(({ c, b }) => h("tr", {},
        h("td", {}, h("button", { class: "btn small quiet", type: "button", text: c.name, "aria-label": `Open ${c.name}'s risk burn-down`, onclick: () => openCustomer(c.key, "burndown") })),
        h("td", { text: String(b.open_critical) }), h("td", { text: String(b.open_high) }), h("td", { text: String(b.past_sla_total) }),
        h("td", { text: b.oldest_urgent_days == null ? "none open" : `${b.oldest_urgent_days} days` }), h("td", { text: String(b.unowned_urgent) }),
        h("td", { text: b.zero_critical.never_had ? "none on record" : b.zero_critical.now ? (b.zero_critical.days != null ? `zero for ${b.zero_critical.days} days` : "zero") : "open" })))))),
      { sub: "Most critical findings first, then the oldest. Target ages are the default (7, 30, 90, 180 days) until you set the customer's own, so compare customers with care." }));
}

function slaCard(b, setSla) {
  const say = h("p", { class: "note", role: "status" });
  const pick = h("select", { "aria-label": "Preset target ages" }, [...SLA.PRESETS.map((p) => h("option", { value: p.id, text: p.label })), h("option", { value: "custom", text: "Custom" })]);
  pick.value = SLA.preset(b.sla_days);
  const box = Object.fromEntries(SLA.SEVERITIES.map((s) => [s, h("input", { type: "number", min: 1, max: 730, step: 1, value: b.sla_days[s], "aria-label": `Target age for ${s} findings, in days` })]));
  pick.addEventListener("change", () => { const p = SLA.PRESETS.find((x) => x.id === pick.value); if (p) for (const s of SLA.SEVERITIES) box[s].value = p.days[s]; });
  const apply = async () => {
    const days = Object.fromEntries(SLA.SEVERITIES.map((s) => [s, Number(box[s].value)]));
    try { await setSla(days); } catch (e) { say.textContent = e.message; }
  };
  return card("Target ages", h("div", {}, h("div", { class: "formgrid" }, h("label", {}, "Preset", pick), SLA.SEVERITIES.map((s) => h("label", {}, `${s} (days)`, box[s]))),
    h("div", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Apply and recompute", onclick: apply })), say),
    { sub: "Saved in the customer's own file (customer.toml, settings.sla_days), so a snapshot keeps it and the score and this view always agree. Pick the ages the customer has agreed; the presets are only starting points." });
}

const RUNG = { manual: "By hand", assisted: "With a tool's help", automated: "With no one involved" };
function automationCard(a) {
  if (!a || !a.closed) return null;
  if (!a.tracked) return card("How fixes get made", h("p", { class: "note first", text: `${a.closed} finding${a.closed === 1 ? " was" : "s were"} closed in the last ${a.window_days} days, but the file does not say how. Add a closed_by column (manual, assisted or automated) to see how much of the fixing no longer needs a person.` }));
  const top = Math.max(1, ...Object.values(a.rungs).map((r) => r.n));
  return card("How fixes get made", h("div", {},
    h("p", { class: "note first", text: `${Math.round(a.automated_share * 100)}% of the ${a.tracked} fixes recorded in the last ${a.window_days} days needed no one.${a.tracked < a.closed ? ` (${a.closed - a.tracked} more were not recorded.)` : ""}` }),
    h("ol", { class: "ladder" }, ["automated", "assisted", "manual"].map((k) => {
      const r = a.rungs[k];
      return h("li", {}, h("span", { class: "rname", text: RUNG[k] }),
        h("span", { class: "rbar" }, h("i", { class: "r-" + k, style: `width:${Math.round((r.n / top) * 100)}%` })),
        h("span", { class: "rnum", text: `${r.n} fixed${r.mean_days == null ? "" : `, ${r.mean_days} days on average`}` }));
    }))), { sub: "As recorded by the customer. The more of it is automatic, the less of your time it takes." });
}

function closureCard(c) {
  if (!c || !c.raised) return null;
  const rows = [["Critical and high raised", c.raised], ["With an owner", c.with_owner], ["With a recorded decision", c.with_decision], ["Closed", c.closed]];
  if (c.tracks_verification) rows.push(["Confirmed fixed by a later scan", c.verified], ["Came back after closing", c.reopened]);
  return card(`From raised to confirmed (last ${c.window_days} days)`, h("div", {},
    h("ul", { class: "rates wide" }, rows.map(([l, n]) => h("li", {}, h("span", { class: "rl", text: l }), h("span", { class: "rn", text: `${n} of ${c.raised}` })))),
    c.tracks_verification ? h("p", { class: "note", text: c.recurrence_rate == null ? "Nothing has closed yet, so there is no recurrence rate." : `${Math.round(c.recurrence_rate * 100)}% of closed findings came back.` })
      : h("p", { class: "note", text: "A closed finding is not the same as a confirmed fix. Add verified_at and reopened columns to the findings file to see how many fixes held." })),
  { sub: "Counts from the findings file. A stage is only as good as the dates and owners recorded in it." });
}

// ------------------------------------------------------------------ the scorecard
export function scorecardView({ result, dash, score, engine, today }) {
  const text = () => SC.scorecard({ result, score, burndown: dash.burndown, today, engine: engine ? engine.version : "" });
  const pre = h("pre", { class: "recap", tabindex: "0", "aria-label": "Posture scorecard" }, text());
  const paste = h("input", { type: "text", "aria-label": "Fingerprint to check", placeholder: "Paste a fingerprint to check it against the data loaded now" });
  const verdict = h("p", { class: "note", role: "status" });
  paste.addEventListener("input", () => {
    if (!paste.value.trim()) { verdict.textContent = ""; return; }
    verdict.textContent = SC.matches(paste.value, result.input_hash) ? "This fingerprint matches the data loaded now." : "This fingerprint does not match the data loaded now (or it is shorter than 12 characters).";
  });
  const file = `beyond90-scorecard-${result.customer.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${today}.md`;
  return h("div", {},
    card("Posture scorecard", h("div", {}, pre, h("div", { class: "row left" },
      h("button", { class: "btn small primary", type: "button", text: "Copy", onclick: (e) => copyText(text()).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Download .md", onclick: () => saveBlob(text(), file, "text/markdown") }))),
    { sub: "One page a customer can show their own buyers or auditors. It names no finding, account or person. It is tied to the exact input files by a fingerprint." }),
    card("Check a fingerprint", h("div", {}, h("label", {}, "Fingerprint", paste), verdict),
    { sub: "Load the same input files, paste the fingerprint from a scorecard you were given, and see whether it matches. It proves the numbers came from those files, not that the files are true." }));
}

// ------------------------------------------------------------------ one customer, every product line
const SHORT = { "platform-migration": "Migration", "private-ai": "AI", "hybrid-cloud": "Hybrid cloud", euc: "Desktops", microsegmentation: "Segmentation", hci: "Platform", dbaas: "Databases", "file-storage": "Files", "object-storage": "Objects", "kubernetes-platform": "Kubernetes", "dr-backup": "Recovery",
  cnapp: "Cloud", identity: "Identity", saas: "SaaS", siem: "Monitoring", endpoint: "Endpoint", ai: "AI" };
const shortName = (p, label) => SHORT[p] || label.split(" ")[0];

/** The estate as a map: the first line of the family in the middle, the others around it, the links between them coloured by what they say. */
function estateMap(estate, onNode, opt = {}) {
  const value = opt.value || ((l) => l.yield), toneOf = opt.tone || ((v) => (v < 0.6 ? "weak" : v < 0.7 ? "mid" : "strong"));
  const subOf = opt.sub || ((l) => (l.naive != null ? `not ${pct(l.naive).replace(/\.\d%$/, "%")}` : ""));
  const say = opt.say || ((n, l) => (l ? `${n.label}: Yield ${pct(l.yield)}. Open this line.` : `${n.label}: not in place yet. See why it could be next.`));
  const nodes = estate.map, many = nodes.length > 7;      // a whole portfolio needs more room, and smaller rings
  const W = many ? 680 : 560, H = many ? 470 : 380, cx = W / 2, cy = H / 2 + 6, R = many ? 190 : 150;
  const byProfile = Object.fromEntries(estate.lines.map((l) => [l.profile, l]));
  const pos = {};
  nodes.forEach((n, i) => {
    if (i === 0) { pos[n.profile] = [cx, cy]; return; }
    const a = -Math.PI / 2 + ((i - 1) / (nodes.length - 1)) * 2 * Math.PI;
    pos[n.profile] = [cx + R * 1.32 * Math.cos(a), cy + R * Math.sin(a)];
  });
  const edges = estate.links.filter((l) => pos[l.from] && pos[l.to]).map((l) => {
    const [x1, y1] = pos[l.from], [x2, y2] = pos[l.to];
    return svgEl("line", { x1, y1, x2, y2, class: "elink " + l.state }, svgEl("title", {}, `${l.state === "risk" ? "At risk: " : l.state === "grow" ? "Next: " : ""}${l.why}`));
  });
  const r = many ? 34 : 40, c = 2 * Math.PI * r;
  const dots = nodes.map((n) => {
    const [x, y] = pos[n.profile], ln = byProfile[n.profile];
    const tone = !ln ? "absent" : toneOf(value(ln), ln);
    const g = svgEl("g", { class: "enode " + tone, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: 0, role: "button",
      "aria-label": say(n, ln) },
      svgEl("circle", { r, class: "ebg" }),
      ln ? svgEl("circle", { r, class: "earc", "stroke-dasharray": `${(Math.max(0.01, value(ln)) * c).toFixed(1)} ${c.toFixed(1)}`, transform: "rotate(-90)" }) : null,
      svgEl("text", { y: ln ? -2 : 4, class: "eval" }, ln ? pct(value(ln)).replace(/\.\d%$/, "%") : "+"),
      ln ? svgEl("text", { y: 15, class: "esub" + (opt.sub ? " plain" : "") }, subOf(ln)) : null,
      svgEl("text", { y: r + 18, class: "ename" }, shortName(n.profile, n.label)));
    const go = () => onNode(n, ln);
    g.addEventListener("click", go);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return g;
  });
  return svgEl("svg", { viewBox: `0 0 ${W} ${H + 24}`, class: "estatemap" + (opt.cls ? " " + opt.cls : ""), role: "group", "aria-label": opt.label || `${estate.customer}: ${estate.lines.length} lines in place, ${estate.whitespace.length} to open` }, edges, dots);
}

export function estateView({ estate, openLine, go, present }) {
  const e = estate, open = (n, ln) => (ln ? openLine(ln.key) : go("estategrow", { open: n.profile }));
  const gap = e.naive != null ? e.naive - e.yield : null;
  const hero = h("section", { class: "card estatehero" },
    h("div", { class: "ehead" },
      e.naive != null ? h("div", { class: "eusual" }, h("small", { text: "The usual number" }), h("s", { text: pct(e.naive) })) : null,
      h("div", { class: "ereal" }, h("small", { text: "What really works, across the estate" }), h("b", { text: pct(e.yield) }))),
    h("p", { class: "tline", text: e.headline }),
    h("ul", { class: "elines" }, e.lines.map((l) => h("li", {}, h("span", { class: "en", text: shortName(l.profile, l.label) }),
      h("span", { class: "ebar", title: `${l.label}: ${pct(l.yield)} really works${l.naive != null ? `, ${pct(l.naive)} on the usual number` : ""}` },
        l.naive != null ? h("i", { class: "eu", style: `width:${(l.naive * 100).toFixed(1)}%` }) : null,
        h("i", { class: "er" + (l.yield < 0.6 ? " weak" : ""), style: `width:${(l.yield * 100).toFixed(1)}%` })),
      h("b", { text: pct(l.yield) })))),
    gap != null ? h("p", { class: "note", text: `${(gap * 100).toFixed(0)} points between the two numbers. ${e.arr_below ? `${num(e.arr_below)} of ARR sits on lines below 60%.` : ""}` }) : null);
  const legend = h("ul", { class: "elegend" }, h("li", { class: "risk", text: "a solid line leaning on a weak one" }), h("li", { class: "grow", text: "the next line it leads to" }), h("li", { class: "ok", text: "both in place" }));
  const mapCard = card("The estate", h("div", {}, estateMap(e, open), legend), { sub: "Each ring is a product line: how much of what was sold really works. Dashed circles are lines not in place yet. Select one to open it." });
  const risks = e.risks.length ? card("Where one line puts another at risk", h("ul", { class: "flags" }, e.risks.map((r) =>
    h("li", { class: "bad" }, h("b", { text: `${shortName(r.from, r.from_label)} ${pct(r.from_yield)}, ${shortName(r.to, r.to_label).toLowerCase()} ${pct(r.to_yield)}` }), h("span", { text: cap(r.why) + "." }),
      r.step ? h("span", { class: "jhow", text: `First step: ${r.step} (+${r.points.toFixed(1)} pts)` }) : null,
      h("button", { class: "link", type: "button", text: `Open ${shortName(r.to, r.to_label).toLowerCase()}`, onclick: () => openLine(e.lines.find((l) => l.profile === r.to).key) })))),
  { sub: "What the customer bought works; what it depends on does not yet. These are the conversations that protect the renewal." }) : null;
  const heat = (v) => `background:color-mix(in srgb,var(--heat) ${Math.round(Math.max(0, Math.min(1, (v - 0.5) / 0.5)) * 55)}%,transparent)`;
  const cols = [
    { key: "label", label: "Line", render: (l) => h("b", { text: l.label }) },
    { key: "arr", label: "ARR", num: true, render: (l) => num(l.arr) },
    ...["L1", "L2", "L3", "L4"].map((k) => ({ key: k, label: k + " " + STAGE_NAME[k], num: true, sort: (l) => l.stages[k], render: (l) => h("span", { class: "heatcell" + (l.weakest === k ? " weakest" : ""), style: heat(l.stages[k]), text: pct(l.stages[k]) }) })),
    { key: "yield", label: "Yield", num: true, render: (l) => h("b", { text: pct(l.yield) }) },
    { key: "naive", label: "Usual number", num: true, render: (l) => (l.naive != null ? pct(l.naive) : "—") },
    { key: "through", label: "End to end", num: true, sort: (l) => (l.total ? l.through / l.total : -1), render: (l) => (l.total ? `${l.through} of ${nOf(l.total, l.unit, l.units)}` : "—") },
    { key: "open", label: "Report", render: (l) => h("button", { class: "btn small", type: "button", text: "Open", "aria-label": `Open ${l.label}`, onclick: () => openLine(l.key) }) },
  ];
  const next = card("The next move on each line", h("ul", { class: "enext" }, e.lines.filter((l) => l.top_action).map((l) =>
    h("li", {}, h("span", { class: "eline", text: shortName(l.profile, l.label) }), h("span", { text: l.top_action.title }), h("b", { class: "pos", text: `+${l.top_action.points.toFixed(1)} pts` })))),
  { sub: "The action with the biggest effect on each line's Yield, from its own playbooks." });
  return h("div", {}, presentBtn(present), h("div", { class: "col2 estatetop" }, hero, mapCard), risks, h("div", { class: "col2" }, next,
    card("Reading the estate", h("p", { class: "note first", text: "Each line is scored on its own profile, in its own units: clusters, database environments, sites. The estate figure weights each line by its ARR. A pale column across lines is a process problem, not a product one." }))),
  card("Every line, four stages", dataTable({ columns: cols, rows: e.lines, label: "Lines", pageSize: 50 }).el));
}

export function growView({ estate, focus, startWorkshop }) {
  const e = estate;
  if (!e.whitespace.length) return card("Where to grow", h("p", { class: "note first", text: `${e.customer} already runs every line of the ${e.family} portfolio. Growth here is depth: the next action on each line.` }));
  const items = e.whitespace.map((w, i) => h("section", { class: "card grow" + (focus === w.profile ? " focus" : ""), id: "grow-" + w.profile },
    h("header", { class: "cardhead" }, h("h2", {}, h("span", { class: "growrank", text: String(i + 1) }), w.label)),
    h("p", { class: "note first", text: w.description }),
    w.reasons.length ? h("ul", { class: "growwhy" }, w.reasons.map((r) => h("li", {}, h("b", { text: `${r.from_label} runs here (${pct(r.strength)})` }), h("span", { text: cap(r.why) + "." }))))
      : h("p", { class: "note", text: "Nothing in place leads here yet: worth a question, not a proposal." }),
    w.opener ? h("div", { class: "growask" }, h("small", { text: "Open with" }), h("q", { text: w.opener.q }), h("span", { class: "note", text: w.opener.why }),
      h("button", { class: "btn small", type: "button", text: "Copy the question", onclick: (ev) => copyText(w.opener.q).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) })) : null,
    w.proof ? h("div", { class: "growproof" }, h("small", { text: "A proof to offer" }), h("p", { text: w.proof.text + "." }), h("span", { class: "note", text: "How: " + w.proof.how })) : null,
    startWorkshop ? h("div", { class: "btnrow" }, h("button", { class: "btn", type: "button", text: "Start a discovery workshop on this line", onclick: () => startWorkshop(e.customer, [w.profile]) })) : null));
  if (focus) requestAnimationFrame(() => { const el = document.getElementById("grow-" + focus); if (el) el.scrollIntoView({ block: "start" }); });
  return h("div", {}, h("p", { class: "note first", text: `The lines ${e.customer} does not run yet, in the order they follow from what it already runs. A line that several solid lines lead to comes first.` }), items);
}

// ------------------------------------------------------------------ the discovery workshop: before there is any data
const STAGE_TAG = { value: "Value", L1: "L1 connected", L2: "L2 seen", L3: "L3 switched on", L4: "L4 decided" };
const painPct = (v) => `${Math.round(v * 100)}%`;

export function workshopView({ workshop: w, catalog, list, answer, worth, rename, preparedBy, setScope, inventory, sizing, waves, gpu, dr, obj, today, newWorkshop, openWorkshop, removeWorkshop, presets = [], go, focus }) {
  const say = h("p", { class: "note", role: "status" });
  const act = (fn) => async (...a) => { try { await fn(...a); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  let cur = w;
  // the meeting: who it is with, which workshop, which lines are in scope
  const name = h("input", { type: "text", maxlength: 200, value: w.customer, "aria-label": "Who the workshop is with" });
  const pick = h("select", { "aria-label": "Open another workshop" }, list.map((x) => h("option", { value: x.id, text: `${x.customer}, ${x.created_on}` })));
  pick.value = w.id;
  const fam = Object.entries(catalog.families).filter(([, ps]) => ps.length);
  const scopeRow = h("div", { class: "wsscope" }, fam.map(([f, ps]) => h("div", { class: "wsfam", role: "group", "aria-label": `${cap(f)} lines` },
    h("span", { class: "wsfamname", text: cap(f) }),
    ps.map((p) => h("button", { type: "button", class: "kindchip", "aria-pressed": String(w.scope.includes(p)), text: catalog.lines[p].label,
      onclick: act(async () => { const next = cur.scope.includes(p) ? cur.scope.filter((x) => x !== p) : [...cur.scope, p]; await setScope(next); }) })))));
  const meeting = card("The meeting", h("div", { class: "wsmeet" },
    h("div", { class: "btnrow" }, name, h("button", { class: "btn small", type: "button", text: "Save the name", onclick: act(() => rename(name.value)) })),
    preparedBy ? (() => {
      const me = h("input", { type: "text", maxlength: 80, value: w.prepared_by || "", placeholder: "Your name, as the readout should sign it", "aria-label": "Prepared by" });
      me.addEventListener("change", act(() => preparedBy(me.value)));
      return h("div", { class: "btnrow" }, me);
    })() : null,
    list.length > 1 ? h("div", { class: "btnrow" }, pick, h("button", { class: "btn small", type: "button", text: "Open", onclick: act(() => openWorkshop(pick.value)) })) : null,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "New workshop", onclick: act(() => newWorkshop()) }),
      h("button", { class: "btn small danger", type: "button", text: "Delete this workshop", onclick: act(async () => {
        if (!confirm(`Delete the workshop with ${w.customer}? Its answers and notes are removed from this browser. This cannot be undone.`)) return;
        await removeWorkshop(w.id);
      }) })),
    presets.length ? h("div", { class: "wsfam", role: "group", "aria-label": "Start from a conversation about" },
      h("span", { class: "wsfamname", text: "Start from" }),
      presets.map((p) => h("button", { type: "button", class: "kindchip", "aria-pressed": String(p.scope.length === w.scope.length && p.scope.every((x) => w.scope.includes(x))),
        "data-tip": `Lines in scope: ${p.scope.map((x) => catalog.lines[x].label).join(", ")}. Answers already given are kept.`, text: p.label, onclick: act(() => setScope(p.scope)) }))) : null,
    scopeRow, h("p", { class: "note", text: "In the meeting: select an answer and the next question is selected for you; the keys 1 to 4 answer it (Solved, Partly, A real gap, Nobody knows)." }), say),
  { sub: "Choose the product lines in scope, then record what the customer says to each question. Nothing leaves this browser; it is sealed when you set a passphrase." });

  // progress, kept current as answers come in
  const prog = h("div", { class: "wsprog" });
  const drawProg = () => {
    const res = WS.assess(catalog, cur);
    put(prog, h("span", { text: `${res.answered} of ${res.total} questions answered` }), h("span", { class: "ebar wsbar" }, h("i", { class: "er", style: `width:${(res.coverage * 100).toFixed(1)}%` })),
      h("button", { class: "btn", type: "button", text: "See the journey", onclick: () => go("journey") }));
  };
  drawProg();

  const lines = cur.scope.filter((p) => catalog.lines[p]).map((p, li) => {
    const line = catalog.lines[p];
    const head = h("span", { class: "wshead" });
    const drawHead = () => {
      const st = WS.lineState(catalog, p, cur.answers);
      put(head, h("b", { text: line.label }), h("span", { class: "muted", text: `${st.answered} of ${st.total}` }),
        st.answered ? h("span", { class: "wspain " + (st.pain >= 0.6 ? "hi" : st.pain >= 0.35 ? "mid" : "lo"), text: `${painPct(st.pain)} missing` }) : null);
    };
    drawHead();
    const items = line.questions.map((q, i) => {
      const li = h("li", { class: "wsq" });
      const draw = () => {
        const ans = cur.answers[`${p}#${i}`];
        const note = h("input", { type: "text", class: "wsnote", maxlength: 300, value: ans ? ans.note : "", placeholder: "What they said, in a few words", "aria-label": `Note for: ${q.q}` });
        note.addEventListener("change", act(async () => { if (!cur.answers[`${p}#${i}`]) return; cur = await answer(p, i, cur.answers[`${p}#${i}`].a, note.value); }));
        put(li, 
          h("div", { class: "wsqtext" }, h("span", { class: "wsstage s-" + q.stage, text: STAGE_TAG[q.stage] || q.stage }), h("span", { text: q.q }), q.why ? h("small", { class: "muted", text: q.why }) : null,
            WS.factFor(cur, p, i) ? h("small", { class: "wsfact", text: "From their inventory: " + WS.factFor(cur, p, i) }) : null),
          h("div", { class: "wsans", role: "group", "aria-label": `Answer to: ${q.q}` }, Object.entries(WS.ANSWERS).map(([k, v]) =>
            h("button", { type: "button", class: "wsopt o-" + k, "aria-pressed": String(!!ans && ans.a === k), text: v.label,
              onclick: act(async () => {
                const again = ans && ans.a === k; cur = await answer(p, i, again ? "" : k, again ? "" : note.value); draw(); drawHead(); drawProg();
                // in a meeting the next question is the next thing to ask: select it, so the keys 1 to 4 answer it
                const next = again ? null : li.nextElementSibling;
                (next ? next.querySelector(".wsopt") : li.querySelector(`.o-${k}`)).focus();
              }) }))),
          ans ? note : null,
          ans && q.stage === "value" ? worthRow(ans) : null);
      };
      // a value question can carry a figure: what a day down costs, what a terabyte costs, what an incident cost
      const worthRow = (ans) => {
        const amt = h("input", { type: "text", inputmode: "numeric", maxlength: 18, value: ans.amount != null ? String(ans.amount) : "", placeholder: "e.g. 250000", "aria-label": `Figure for: ${q.q}` });
        const per = h("select", { "aria-label": `Counted per, for: ${q.q}` }, WS.PER.map((x) => h("option", { value: x, text: "per " + x })));
        per.value = ans.per || "day";
        const save = act(async () => { cur = await worth(p, i, amt.value.trim(), per.value); });
        amt.addEventListener("change", save); per.addEventListener("change", () => { if (amt.value.trim()) save(); });
        return h("div", { class: "wsworth" }, h("span", { class: "muted", text: "What is at stake, as a figure (optional)" }), amt, per);
      };
      draw();
      // keys 1 to 4 answer the question that has the focus (and do not switch views, as digits do elsewhere)
      li.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === "INPUT" || !/^[1-4]$/.test(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        li.querySelectorAll(".wsopt")[Number(e.key) - 1].click();
      });
      return li;
    });
    const st = WS.lineState(catalog, p, cur.answers);
    return h("details", { class: "card wsline", id: "ws-" + p, open: focus === p || (!focus && (li === 0 || (st.answered > 0 && st.answered < st.total))) ? "" : null }, h("summary", {}, head), h("ol", { class: "wslist" }, items));
  });
  if (focus) requestAnimationFrame(() => { const el = document.getElementById("ws-" + focus); if (el) el.scrollIntoView({ block: "start" }); });
  return h("div", {}, meeting, inventory ? inventoryCard(w, inventory) : null, w.inventory && sizing ? sizingCard(w, sizing) : null,
    w.inventory && waves ? wavesCard(w, waves, today) : null, w.scope.includes("private-ai") && gpu ? gpuCard(w, gpu) : null,
    w.scope.includes("dr-backup") && dr ? drCard(w, dr) : null, w.scope.includes("object-storage") && obj ? objCard(w, obj) : null, h("div", { class: "card wsprogcard" }, prog), lines);
}

/** The customer's VM inventory: read in the page, kept as totals, shown as the numbers a sizing starts from. */
function inventoryCard(w, inventory) {
  const say = h("p", { class: "note", role: "status" });
  const file = h("input", { type: "file", accept: ".csv,text/csv", "aria-label": "A virtual machine inventory export, as CSV" });
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { say.textContent = "That file is over 50 MB: export only the sheet with one virtual machine per row."; return; }
    const read = INV.readInventory(await f.text());
    if (!read.ok) { say.textContent = read.error; return; }
    try { await inventory({ ...INV.summarise(read), imported_on: new Date().toISOString().slice(0, 10) }); } catch (e) { say.textContent = e.message; }
  });
  const s = w.inventory;
  const intro = h("p", { class: "note first", text: "Optional. A virtual machine inventory export as CSV (the sheet with one machine per row, such as vInfo). It is read in this page and only the totals are kept: no machine names. It brings the migration line into scope and answers part of its questions." });
  const tryExample = h("button", { class: "btn small quiet", type: "button", text: "Try it with an invented export", onclick: async () => {
    const read = INV.readInventory(await (await fetch("./demo-inventory.csv")).text());
    try { await inventory({ ...INV.summarise(read), imported_on: new Date().toISOString().slice(0, 10) }); } catch (e) { say.textContent = e.message; }
  } });
  if (!s) return card("Their inventory", h("div", {}, intro, h("div", { class: "btnrow" }, h("label", { class: "btn small filebtn" }, "Read an inventory export", file), tryExample), say));
  const k = (v, l) => h("div", { class: "invk" }, h("b", { text: v }), h("small", { text: l }));
  const top = s.clusters.slice(0, 8);
  return card("Their inventory", h("div", { class: "inv" },
    h("div", { class: "invkpis" }, k(INV.fmt(s.vms), `virtual machines, ${INV.fmt(s.on)} running`), k(INV.fmt(s.vcpu_on), "vCPU in use"), k(`${INV.fmt(s.mem_on_gib)} GiB`, "memory in use"),
      k(`${INV.fmt(s.used_tib != null ? s.used_tib : s.prov_tib)} TiB`, s.used_tib != null ? "storage used" : "storage provisioned"), k(INV.fmt(s.hosts), `hosts, ${INV.fmt(s.clusters.length)} clusters`)),
    h("div", { class: "col2" },
      h("div", {}, h("h3", { text: "Largest clusters" }), h("table", { class: "invtable" }, h("thead", {}, h("tr", {}, ["Cluster", "Machines", "Running", "vCPU", "Memory GiB", "Past support"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, top.map((c) => h("tr", {}, h("td", { text: c.name }), ...[c.vms, c.on, c.vcpu, c.mem_gib, c.past].map((v) => h("td", { class: "num", text: INV.fmt(v) }))))))),
      h("div", {}, h("h3", { text: "Worth knowing before a move" }), h("ul", { class: "growwhy" },
        s.off ? h("li", { text: `${INV.fmt(s.off)} machines are powered off: candidates to retire rather than move.` }) : null,
        s.past_total ? h("li", { text: `${INV.fmt(s.past_total)} run operating systems past general support: ${Object.entries(s.past).map(([k2, v]) => `${k2} (${INV.fmt(v)})`).join(", ")}.` }) : null,
        s.first_wave ? h("li", { text: `A first test could be ${s.first_wave.name}: ${INV.fmt(s.first_wave.vms)} machines, ${INV.fmt(s.first_wave.past)} past support. It teaches the most for the least risk.` }) : null,
        h("li", { text: `On average ${INV.fmt(s.vcpu_per_vm)} vCPU and ${INV.fmt(s.mem_per_vm_gib)} GiB per running machine: the starting point for a sizing tool, not a sizing.` })))),
    h("div", { class: "btnrow" }, h("label", { class: "btn small filebtn" }, "Read a newer export", file),
      h("button", { class: "btn small", type: "button", text: "Remove the inventory", onclick: async () => { try { await inventory(null); } catch (e) { say.textContent = e.message; } } })), say),
  { sub: `Read on ${s.imported_on}. Totals only; the file itself was not kept.` });
}

/** A first sizing sketch from the inventory: the arithmetic of a whiteboard, every assumption editable, not a sizing. */
function sizingCard(w, sizing) {
  const a = SZ.clean(w.sizing || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [
    ["growth_pct", "Growth over the platform's life", "%"], ["vcpu_per_core", "vCPU per physical core", ":1"], ["reduction", "Data reduction counted", ":1"],
    ["cold_pct", "Data no longer written to (for erasure coding)", "%"], ["fill_pct", "Keep storage below, after a failure", "%"], ["spare_nodes", "Spare servers for failures", ""], ["node_cores", "Cores per server", ""],
    ["node_mem_gib", "Memory per server", "GiB"], ["node_raw_tib", "Raw storage per server", "TiB"], ["overhead_cores", "Cores kept for the platform, per server", ""],
    ["overhead_mem_gib", "Memory kept for the platform, per server", "GiB"],
  ];
  const inputs = {};
  const prot = h("select", { "aria-label": "How data is protected" }, Object.entries(SZ.PROTECTION).map(([k, v]) => h("option", { value: k, text: v.label })));
  prot.value = a.protection;
  const current = () => {
    const v = { protection: prot.value };
    for (const [k] of fields) v[k] = Number(inputs[k].value);
    return SZ.clean(v);
  };
  const draw = (assumptions) => {
    const sk = SZ.sketch(w.inventory, assumptions);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    const bar = (label, v) => h("li", {}, h("span", { text: label }), h("span", { class: "ebar wsbar" }, h("i", { class: "er" + (v > 90 ? " weak" : ""), style: `width:${Math.min(100, v)}%` })), h("b", { text: `${v}%` }));
    const name = { compute: "compute", memory: "memory", storage: "storage", minimum: "the minimum for the copies" }[sk.decided];
    put(out,
      h("div", { class: "szhead" }, h("b", { text: String(sk.nodes) }), h("span", {}, h("strong", { text: "servers" }), h("small", { text: `decided by ${name}; compute ${sk.by.compute}, memory ${sk.by.memory}, storage ${sk.by.storage}` }))),
      h("ul", { class: "szuse" }, h("li", { class: "szlabel", text: "With the spare servers out" }), bar("CPU", sk.use.cpu), bar("Memory", sk.use.mem), bar("Storage", sk.use.storage)),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Design notes" }), h("ul", {}, SZ.designNotes(assumptions).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await sizing(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" },
    h("label", { class: "szf wide" }, h("span", { text: "How data is protected" }), prot),
    fields.map(([k, label, unit]) => {
      inputs[k] = h("input", { type: "number", step: "any", value: String(a[k]), "aria-label": label });
      inputs[k].addEventListener("change", save);
      return h("label", { class: "szf" }, h("span", { text: label + (unit ? ` (${unit})` : "") }), inputs[k]);
    }));
  prot.addEventListener("change", save);
  draw(a);
  return card("A first sizing sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The assumptions, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(SZ.DEFAULTS[k]);
      prot.value = SZ.DEFAULTS.protection;
      draw(SZ.DEFAULTS);
      try { await sizing(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "The arithmetic before the sizing tool: how many servers the inventory needs, which resource decides, and what it runs at with a server down. Every assumption is open; it is not a sizing." });
}

/** The handover to the team that delivers and runs it, with the promises they inherit. */
export function deliveryView({ workshop: w, catalog, povs, commitments, keepPromises, today, go }) {
  const pov = DL.povFor(povs, w.customer);
  const promises = DL.promisesFrom(catalog, w, pov);
  const md = DL.handoverMarkdown(catalog, w, pov, today);
  const mine = (commitments || []).filter((c) => c.customer.toLowerCase() === w.customer.toLowerCase()).map((c) => c.what.toLowerCase());
  const kept = new Set(mine);
  const fresh = promises.filter((p) => !kept.has(p.what.toLowerCase()));
  const say = h("p", { class: "note", role: "status" });
  const FROM = { proven: "Proven", agreed: "Agreed", asked: "Asked by the customer" };
  const keep = h("button", { class: "btn primary", type: "button", disabled: fresh.length ? null : true,
    text: fresh.length ? `Keep ${nOf(fresh.length, "promise")} as commitments for ${w.customer}` : promises.length ? "All promises are kept as commitments" : "No promises yet",
    onclick: async () => {
      try {
        const n = await keepPromises(fresh);
        keep.disabled = true; keep.textContent = "All promises are kept as commitments";
        say.textContent = `${nOf(n, "commitment")} added for ${w.customer}: they show with the customer's other promises once it is a customer.`;
      } catch (e) { say.textContent = e.message; }
    } });
  const slug = w.customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  return h("div", {},
    card("Handover to delivery", h("div", {},
      h("p", { class: "note first", text: pov ? "Built from the workshop and its proof of value. Check it with the delivery lead before the kickoff." : "No proof of value is kept for this prospect yet: the handover lists what was agreed and asked, and gains what is proven once the proof runs." }),
      !pov ? h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Go to where to start", onclick: () => go("hurt") })) : null,
      h("h3", { class: "objtitle", text: `Promises to keep after go-live (${promises.length})` }),
      promises.length ? h("ul", { class: "dlpromises" }, promises.map((p) => h("li", { class: kept.has(p.what.toLowerCase()) ? "kept" : "" },
        h("span", { class: "chip2 dl-" + p.from, text: FROM[p.from] }), h("span", { text: p.what }),
        p.who || p.due ? h("small", { text: [p.who && `Owner: ${p.who.toLowerCase()}`, p.due && `by ${p.due}`].filter(Boolean).join(", ") }) : null)))
        : h("p", { class: "note", text: "None yet: a criterion met, a condition we agreed to make true, or a concern the customer raised becomes one." }),
      h("div", { class: "btnrow" }, keep,
        h("button", { class: "btn small", type: "button", text: "Copy the handover", onclick: (ev) => copyText(md).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Download it (.md)", onclick: () => saveBlob(md, `${slug}-handover.md`, "text/markdown") })),
      say),
    { sub: "What the delivery team inherits: what was proven, what the customer asked us to prove, what each side agreed to make true and by when, the numbers it rests on, and what is still open." }),
    card("The note", h("pre", { class: "dldoc", text: md, tabindex: "0", role: "region", "aria-label": "The handover note" }), { sub: "As it will be copied or downloaded; names pass through the same check as every export." }));
}

/** Cumulative cost of staying and of moving, month by month: where the lines cross, the move has paid back. */
function caseChart(c) {
  const W = 640, H = 230, pad = { l: 64, r: 16, t: 14, b: 30 };
  const top = Math.max(1, ...c.stayCum, ...c.moveCum);
  const X = (i) => pad.l + (i / Math.max(1, c.months)) * (W - pad.l - pad.r), Y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const short = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart vcchart", role: "img", "aria-label": `Cumulative cost, month by month. ${VC.caseLine(c)}` });
  for (let k = 0; k <= 4; k++) {
    const v = (top * k) / 4;
    svg.append(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), stroke: "var(--grid)" }), svgEl("text", { x: pad.l - 8, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, short(v)));
  }
  for (let y = 0; y <= c.years; y++) svg.append(svgEl("text", { x: X(y * 12), y: H - 10, "text-anchor": "middle", class: "tick" }, y ? `year ${y}` : "now"));
  const path = (cum) => [[0, 0], ...cum.map((v, i) => [i + 1, v])].map(([i, v], j) => `${j ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  svg.append(svgEl("path", { d: path(c.stayCum), fill: "none", stroke: "var(--neg, #c2410c)", "stroke-width": 2.4, "stroke-dasharray": "6 4" }, svgEl("title", {}, "Staying")),
    svgEl("path", { d: path(c.moveCum), fill: "none", stroke: "var(--accent)", "stroke-width": 2.8 }, svgEl("title", {}, "Moving")));
  if (c.payback) svg.append(svgEl("circle", { cx: X(c.payback), cy: Y(c.moveCum[c.payback - 1]), r: 5, fill: "var(--accent)" }, svgEl("title", {}, `Paid back by month ${c.payback}`)));
  return h("figure", { class: "vcfig" }, svg, h("figcaption", { class: "vclegend" }, h("span", { class: "vcstay", text: "Staying" }), h("span", { class: "vcmove", text: "Moving" }),
    c.payback ? h("span", { text: `Dot: paid back by month ${c.payback}` }) : null));
}

/** The case for change: what staying and moving cost over a few years, in the customer's figures, the arithmetic shown. */
export function caseView({ workshop: w, catalog, setCase }) {
  const a = VC.cleanCase(w.case || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "vcout" });
  const inputs = {};
  const years = h("select", { "aria-label": "Over how many years" }, [1, 2, 3, 4, 5, 6, 7].map((y) => h("option", { value: String(y), text: `${y} year${y === 1 ? "" : "s"}` })));
  years.value = String(a.years);
  const inReadout = h("input", { type: "checkbox", "aria-label": "Show the case in the customer readout" });
  inReadout.checked = a.in_readout;
  const current = () => {
    const v = { years: Number(years.value), in_readout: inReadout.checked };
    for (const [k, el] of Object.entries(inputs)) if (el.value !== "") v[k] = Number(el.value);
    return VC.cleanCase(v);
  };
  const draw = (figures) => {
    const c = VC.buildCase(figures);
    if (!c.ok) { put(out, h("p", { class: "note first", text: "Type the figures the customer gave: what the current platform costs and when it renews, what moving would cost, the hours spent on routine work, the cost of an hour down. Blanks count as nothing; every figure stays in this browser." })); copy.hidden = true; return; }
    copy.hidden = false;
    put(out,
      h("p", { class: "tline vcline", text: VC.caseLine(c) }),
      caseChart(c),
      h("div", { class: "tablewrap" }, h("table", { class: "wvtable vctable" },
        h("thead", {}, h("tr", {}, ["Cost", "Staying", "Moving", "Difference"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, c.rows.map((r) => h("tr", {}, h("th", { scope: "row", text: r.label }), h("td", { class: "n", text: VC.money(r.stay) }), h("td", { class: "n", text: VC.money(r.move) }),
          h("td", { class: "n" + (r.diff < 0 ? " neg" : ""), text: VC.money(r.diff) }))),
        h("tr", { class: "vctotal" }, h("th", { scope: "row", text: `Total over ${c.years} year${c.years === 1 ? "" : "s"}` }), h("td", { class: "n", text: VC.money(c.stay) }), h("td", { class: "n", text: VC.money(c.move) }),
          h("td", { class: "n" + (c.saving < 0 ? " neg" : ""), text: VC.money(c.saving) }))))),
      h("div", { class: "growproof" }, h("small", { text: "The arithmetic" }), h("ul", {}, VC.caseSteps(c).map((x) => h("li", { text: x })))));
  };
  const save = async () => { const v = current(); draw(v); try { await setCase(VC.hasCase(v) || v.in_readout ? v : null); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  // outside what is redrawn, so a change made by leaving a field never takes them away mid-click
  const copy = h("button", { class: "btn small", type: "button", text: "Copy for finance", hidden: true,
    onclick: (ev) => copyText(VC.caseMarkdown(VC.buildCase(current()))).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) });
  const heard = VC.hourlyFrom(WS.figuresHeard(catalog, w));
  const groups = VC.FIELDS.map((g) => h("fieldset", { class: "vcgroup" }, h("legend", { text: g.group }),
    g.fields.map(([k, label, unit]) => {
      inputs[k] = h("input", { type: "number", step: "any", min: "0", value: a[k] == null ? "" : String(a[k]), "aria-label": label, placeholder: "—" });
      inputs[k].addEventListener("change", save);
      const extra = k === "downtime_cost_hour" && heard.length ? h("span", { class: "vcheard" }, heard.slice(0, 2).map((f) => h("button", { class: "btn small", type: "button",
        text: `Use ${VC.money(f.hourly)}`, "data-tip": `Heard in the workshop: ${VC.money(f.amount)} per ${f.per}${f.what ? `, in answer to "${f.what}"` : ""}${f.per === "day" ? "; a day counted as 24 hours" : ""}.`,
        onclick: () => { inputs[k].value = String(f.hourly); save(); } }))) : null;
      return h("label", { class: "szf" }, h("span", { text: `${label} (${unit})` }), inputs[k], extra);
    })));
  years.addEventListener("change", save);
  inReadout.addEventListener("change", save);
  draw(a);
  const res = WS.assess(catalog, w);
  const told = res.land ? WS.stories(catalog, w, res).find((x) => x.land) : null;
  const finance = told && told.audiences.financial ? h("p", { class: "note first", text: `How finance hears ${told.label.toLowerCase()}: ${told.audiences.financial}` }) : null;
  return h("div", {},
    card("The case for change", h("div", {}, finance, out, h("div", { class: "btnrow" }, copy,
      h("label", { class: "vcopt" }, inReadout, h("span", { text: "Show it in the customer readout" }))), say),
    { sub: "What staying costs and what moving costs, month by month, in the customer's own figures. The arithmetic is shown so anyone can check it; it is not a quote." }),
    card("The figures", h("div", {}, h("label", { class: "szf vcyears" }, h("span", { text: "Over" }), years), h("div", { class: "vcgroups" }, groups)),
    { sub: "In the customer's currency, as they gave them. Leave blank what was not discussed." }));
}

/** A first capacity sketch for backups on object storage: retention, reduction, protection, growth, the nightly window. */
function objCard(w, obj) {
  const a = OBJ.cleanObj(w.obj || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [
    ["data_tib", "Protected data (TiB, 0: from the inventory)"], ["change_pct", "Data changed each day (%)"], ["daily_days", "Daily restore points kept"],
    ["weekly_weeks", "Weekly fulls kept"], ["monthly_months", "Monthly fulls kept"], ["reduction", "Data reduction counted (ratio)"],
    ["protection", "Raw over usable for protection (x)"], ["growth_pct", "Growth over the system's life (%)"], ["fill_pct", "Keep the store below (%)"], ["window_h", "Nightly backup window (hours)"],
  ];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return OBJ.cleanObj(v); };
  const draw = (settings) => {
    const sk = OBJ.objSketch(settings, w.inventory);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.usable) }), h("span", {}, h("strong", { text: "TiB usable" }), h("small", { text: `${INV.fmt(sk.raw)} TiB raw; about ${INV.fmt(sk.gbps)} Gbit/s in the nightly window` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, OBJ.objNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await obj(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" }, fields.map(([k, label]) => {
    inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
  }));
  draw(a);
  return card("A first backup capacity sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The retention and the assumptions, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(OBJ.OBJ_DEFAULTS[k]);
      draw(OBJ.OBJ_DEFAULTS);
      try { await obj(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For backups kept on object storage: what the retention holds after reduction, with protection and room to grow, and what the nightly window needs. The backup product's own calculator, on the customer's data, has the last word." });
}

/** A first recovery design: per tier, the replication its recovery point calls for, the bandwidth, a retention. */
function drCard(w, dr) {
  const a = DRS.cleanDr(w.dr || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const top = [["data_tib", "Protected data (TiB, 0: from the inventory)"], ["change_pct", "Data written each day (%)"], ["peak", "Busiest hour against the day's average (x)"], ["latency_ms", "Round trip between the sites (ms)"]];
  const inputs = {}, tierIn = [];
  const current = () => {
    const v = { tiers: tierIn.map((t) => Object.fromEntries(Object.entries(t).map(([k, el]) => [k, Number(el.value)]))) };
    for (const [k] of top) v[k] = Number(inputs[k].value);
    return DRS.cleanDr(v);
  };
  const draw = (settings) => {
    const sk = DRS.drSketch(settings, w.inventory);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.mbps) }), h("span", {}, h("strong", { text: "Mbit/s between the sites" }), h("small", { text: `to keep ${INV.fmt(sk.data)} TiB protected in three tiers, before compression` }))),
      h("div", { class: "tablewrap" }, h("table", { class: "drtable" },
        h("thead", {}, h("tr", {}, ["Tier", "Data", "Recovery point", "Recovery time", "Replication", "Bandwidth", "Retention to agree"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, sk.tiers.map((t) => h("tr", {}, h("td", { text: String(t.n) }), h("td", { text: `${INV.fmt(t.tib)} TiB` }), h("td", { text: DRS.duration(t.rpo_min) }), h("td", { text: DRS.duration(t.rto_min) }),
          h("td", {}, h("span", { text: t.mode }), t.ok ? null : h("small", { class: "neg drwhy", text: `Not at this distance: ${t.why}.` })),
          h("td", { text: `~${INV.fmt(t.mbps)} Mbit/s` }), h("td", { text: t.retention })))))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, DRS.drNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await dr(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const field = (el, label) => { el.addEventListener("change", save); return h("label", { class: "szf" }, h("span", { text: label }), el); };
  const grid = h("div", { class: "szgrid" }, top.map(([k, label]) => field(inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label }), label)));
  const tiers = h("div", { class: "szgrid drtiers" }, a.tiers.flatMap((t, i) => {
    const row = {
      share_pct: h("input", { type: "number", step: "any", min: "0", value: String(t.share_pct), "aria-label": `Tier ${i + 1}: share of the data (%)` }),
      rpo_min: h("input", { type: "number", step: "any", min: "0", value: String(t.rpo_min), "aria-label": `Tier ${i + 1}: recovery point (minutes)` }),
      rto_min: h("input", { type: "number", step: "any", min: "0", value: String(t.rto_min), "aria-label": `Tier ${i + 1}: recovery time (minutes)` }),
    };
    tierIn.push(row);
    return [field(row.share_pct, `Tier ${i + 1}: share of the data (%)`), field(row.rpo_min, `Tier ${i + 1}: recovery point (minutes)`), field(row.rto_min, `Tier ${i + 1}: recovery time (minutes)`)];
  }));
  draw(a);
  return card("A first recovery design", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The data, the distance and the tiers, to agree with the customer" }), grid, tiers,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of top) inputs[k].value = String(DRS.DR_DEFAULTS[k]);
      tierIn.forEach((row, i) => { for (const k of Object.keys(row)) row[k].value = String(DRS.DR_DEFAULTS.tiers[i][k]); });
      draw(DRS.DR_DEFAULTS);
      try { await dr(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For each tier of applications: the replication its recovery point calls for, whether the distance allows it, the bandwidth its data needs, and a retention to agree. The replication product's own calculator has the last word." });
}

/** A first GPU sketch for serving a model: memory for the weights and the conversations, copies, servers. */
function gpuCard(w, gpu) {
  const a = GPU.cleanGpu(w.gpu || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const fields = [
    ["params_b", "Model size", "billion parameters"], ["bits", "Bits per weight as served", "16, 8 or 4"], ["context_k", "Tokens kept per request", "thousands"],
    ["concurrent", "Requests in flight at the busiest time", ""], ["kv_kib_per_token", "Cache per token, from the model card", "KiB"], ["overhead_pct", "Runtime overhead", "%"],
    ["gpu_mem_gib", "Memory per GPU", "GiB"], ["fill_pct", "Use each GPU's memory up to", "%"], ["gpus_per_server", "GPUs per server", ""], ["min_replicas", "Copies of the model at least", ""],
    ["tps_per_user", "Tokens per second each user should see (0: not counted)", ""], ["tps_per_gpu", "Tokens per second one GPU was measured to give (0: unknown)", ""],
  ];
  const inputs = {};
  const current = () => { const v = {}; for (const [k] of fields) v[k] = Number(inputs[k].value); return GPU.cleanGpu(v); };
  const draw = (assumptions) => {
    const sk = GPU.gpuSketch(assumptions);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: String(sk.gpus) }), h("span", {}, h("strong", { text: "GPUs" }),
        h("small", { text: `in ${sk.servers} server${sk.servers === 1 ? "" : "s"}: ${sk.copies} copies of the model on ${sk.shape} GPU${sk.shape === 1 ? "" : "s"} each, decided by ${sk.decided}` }))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Check before relying on it" }), h("ul", {}, GPU.gpuNotes(assumptions).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await gpu(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" }, fields.map(([k, label, unit]) => {
    inputs[k] = h("input", { type: "number", step: "any", value: String(a[k]), "aria-label": label });
    inputs[k].addEventListener("change", save);
    return h("label", { class: "szf" }, h("span", { text: label + (unit ? ` (${unit})` : "") }), inputs[k]);
  }));
  draw(a);
  return card("A first GPU sketch", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The assumptions, to agree with the customer" }), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of fields) inputs[k].value = String(GPU.GPU_DEFAULTS[k]);
      draw(GPU.GPU_DEFAULTS);
      try { await gpu(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "For serving a model on the customer's own GPUs: memory for the weights and for the conversations in flight, the GPUs one copy takes, the copies the load and availability need. A starting point for a benchmark on their prompts, not a sizing." });
}

/** A plan in waves from the inventory: a test wave, then cluster by cluster, the same steps every time. */
function wavesCard(w, waves, today) {
  const a = WV.cleanWaves(w.waves || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "wvout" });
  const start = h("input", { type: "date", value: a.start, "aria-label": "First wave on" });
  const nums = [["per_wave", "Machines per wave at most"], ["every_days", "Days between waves"], ["pilot", "Machines in the test wave (0 for none)"]];
  const inputs = {};
  const off = h("input", { type: "checkbox", "aria-label": "Move the powered-off machines too" });
  off.checked = a.include_off;
  const current = () => {
    const v = { start: start.value || "", include_off: off.checked };
    for (const [k] of nums) v[k] = Number(inputs[k].value);
    return WV.cleanWaves(v);
  };
  const draw = (settings) => {
    const p = WV.planWaves(w.inventory, settings, today);
    if (!p.ok) { put(out, h("p", { class: "note", text: p.error })); ics.hidden = true; return; }
    const name = (wv) => (wv.test ? "Test wave" : `Wave ${wv.n}`);
    put(out,
      h("p", { class: "tline", text: WV.wavesLine(p) }),
      p.past ? h("p", { class: "note", text: `${INV.fmt(p.past)} machines across the waves run operating systems past general support: check that backup, monitoring and security agents support them before their wave.` }) : null,
      h("div", { class: "tablewrap" }, h("table", { class: "wvtable" },
        h("thead", {}, h("tr", {}, ["Date", "Wave", "Cluster", "Machines", "vCPU", "Memory GiB", "Past support"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, p.waves.map((wv) => h("tr", { class: wv.test ? "wvtest" : "" },
          h("td", { text: wv.date }), h("td", { text: name(wv) }), h("td", { text: wv.cluster }), h("td", { class: "n", text: INV.fmt(wv.machines) }),
          h("td", { class: "n", text: INV.fmt(wv.vcpu) }), h("td", { class: "n", text: INV.fmt(wv.mem_gib) }), h("td", { class: "n", text: INV.fmt(wv.past) })))))));
    ics.hidden = false;
  };
  // outside what is redrawn: leaving a changed field redraws the plan, and must not take the button away mid-click
  const ics = h("button", { class: "btn small", type: "button", text: "Add the waves to a calendar (.ics)", hidden: true,
    onclick: () => {
      const p = WV.planWaves(w.inventory, current(), today);
      if (p.ok) saveBlob(WV.wavesIcs(w, p, new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"), `${w.customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer"}-waves.ics`, "text/calendar");
    } });
  const save = async () => { const v = current(); draw(v); try { await waves(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const grid = h("div", { class: "szgrid" },
    h("label", { class: "szf" }, h("span", { text: "First wave on" }), start),
    nums.map(([k, label]) => {
      inputs[k] = h("input", { type: "number", step: "1", min: "0", value: String(a[k]), "aria-label": label });
      inputs[k].addEventListener("change", save);
      return h("label", { class: "szf" }, h("span", { text: label }), inputs[k]);
    }),
    h("label", { class: "szf wvoff" }, off, h("span", { text: "Move the powered-off machines too" })));
  start.addEventListener("change", save);
  off.addEventListener("change", save);
  draw(a);
  return card("A plan in waves", h("div", { class: "sz" }, out, h("div", { class: "btnrow" }, ics),
    h("details", { class: "szassume" }, h("summary", { text: "The settings, to agree with the customer" }), grid),
    h("details", { class: "szassume wvrun" }, h("summary", { text: "What every wave goes through" }),
      h("div", { class: "wvbook" }, WV.RUNBOOK.map((r) => h("div", { class: "growproof" }, h("small", { text: r.when }), h("ul", {}, r.steps.map((x) => h("li", { text: x }))))))), say),
  { sub: "A test wave first, from the cluster that teaches the most for the least risk; then cluster by cluster, the least risky first. Clusters move whole, so machines that talk to each other inside one stay together; dependencies across clusters still have to be checked with the owners." });
}

/** The next meeting, from what the last one left open: an agenda to copy, or an invitation that carries it. */
function nextMeetingCard(w, catalog, today) {
  const m = NM.nextMeeting(catalog, w, today);
  const inWeek = new Date(Date.parse(today + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
  const day = h("input", { type: "date", value: inWeek, min: today, "aria-label": "Day of the next meeting" });
  const longDay = () => new Date(day.value + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const text = () => NM.agendaText(m, day.value ? longDay() : "");
  const pre = h("pre", { class: "dldoc", text: text(), tabindex: "0", role: "region", "aria-label": "Agenda of the next meeting" });
  day.addEventListener("change", () => { pre.textContent = text(); });
  const slug = w.customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  return card("The next meeting", h("div", {},
    m.empty ? h("p", { class: "note first", text: "Nothing is open yet: the agenda is the next steps, with owners and dates." }) : null,
    h("label", { class: "szf nmday" }, h("span", { text: "On" }), day), pre,
    h("div", { class: "btnrow" },
      h("button", { class: "btn small", type: "button", text: "Copy the agenda", onclick: (ev) => copyText(text()).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Invitation (.ics)", onclick: () => { if (day.value) saveBlob(NM.meetingIcs(w, m, day.value, new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"), `${slug}-next-meeting.ics`, "text/calendar"); } }))),
  { sub: "From what the last meeting left open: what slipped, the questions nobody could answer, the concerns to prove, what is due soon, and who to bring." });
}

export function hurtView({ workshop: w, catalog, go, startPov, today }) {
  const res = WS.assess(catalog, w);
  const say = h("p", { class: "note", role: "status" });
  if (!res.answered) return card("Where to start", h("div", {}, h("p", { class: "note first", text: "Nothing recorded yet. Answer a few questions in the workshop and this page shows where to start, what is still missing on each line and what to find out next." }),
    h("button", { class: "btn", type: "button", text: "Open the questions", onclick: () => go("workshop") })));
  const order = res.land ? [res.land.profile, ...w.scope.filter((p) => p !== res.land.profile)] : [...w.scope];
  const heard = res.lines.filter((l) => l.answered);
  const pseudo = { customer: w.customer, lines: heard, whitespace: [], map: order.filter((p) => catalog.lines[p]).map((p) => ({ profile: p, label: catalog.lines[p].label })),
    links: catalog.links.filter(([a, b]) => order.includes(a) && order.includes(b)).map(([a, b, why]) => ({ from: a, to: b, why, state: res.land && a === res.land.profile ? "grow" : "ok" })) };
  const map = estateMap(pseudo, (n) => go("workshop", { open: n.profile }), {
    value: (l) => l.pain, tone: (v) => (v >= 0.6 ? "weak" : v >= 0.35 ? "mid" : "strong"), sub: (l) => `${l.answered} of ${l.total}`, cls: "painmap",
    say: (n, l) => (l ? `${n.label}: ${painPct(l.pain)} still missing, from ${l.answered} answers.` : `${n.label}: not discussed yet.`), label: `${w.customer}: what is still missing, by product line` });
  const hero = h("section", { class: "card estatehero" },
    res.land ? h("div", { class: "ehead" }, h("div", { class: "ereal" }, h("small", { text: "Start here" }), h("b", { class: "wsland", text: res.land.label })))
      : h("p", { class: "tline", text: res.waiting },),
    res.land ? h("p", { class: "tline", text: `${painPct(res.land.pain)} still missing, from ${res.land.answered} answers: ${nOf(res.land.gaps.length, "real gap")}, ${res.land.partly.length} partly solved${res.land.unknowns.length ? `, ${res.land.unknowns.length} nobody could answer` : ""}.` }) : null,
    h("ul", { class: "elines" }, res.lines.map((l) => h("li", {}, h("span", { class: "en", text: shortName(l.profile, l.label) }),
      h("span", { class: "ebar", title: `${l.label}: ${l.answered ? painPct(l.pain) + " still missing" : "not discussed"}` }, h("i", { class: "er" + (l.pain >= 0.6 ? " weak" : ""), style: `width:${(l.pain * 100).toFixed(1)}%` })),
      h("b", { text: l.answered ? painPct(l.pain) : "—" })))),
    h("p", { class: "note", text: "How much is missing: real gaps count fully, partly solved half, \"nobody knows\" most of the way; answers on business value count double." }));
  const mapCard = card("What is still missing", h("div", {}, map, h("ul", { class: "elegend" }, h("li", { class: "grow", text: "where the first line leads" }), h("li", { class: "ok", text: "lines that work together" }))),
    { sub: "Each ring is a product line in scope, filled by how much is still missing there, from the customer's answers. Dashed circles have not been discussed yet. Select one to open its questions." });
  const out = [h("div", { class: "col2 estatetop" }, hero, mapCard)];
  if (res.land) {
    const reasons = [...res.land.gaps, ...res.land.partly].slice(0, 4);
    out.push(card(`Why ${res.land.label.toLowerCase()} first`, h("div", {},
      h("ul", { class: "growwhy" }, reasons.map((q) => h("li", {}, h("b", { text: q.q }), q.note ? h("span", { text: `They said: ${q.note}` }) : null))),
      res.proof.length ? h("div", { class: "growproof" }, h("small", { text: "Proof of value to propose" }), h("ul", {}, res.proof.slice(0, 3).map((c) => h("li", { text: c.text + "." })))) : null,
      h("div", { class: "btnrow" }, h("button", { class: "btn", type: "button", text: "Start the proof of value", onclick: async () => { try { await startPov(res); } catch (e) { say.textContent = e.message; } } })), say),
    { sub: "What the customer said that points here, and the proof that would settle it." }));
    if (res.expand.length) out.push(card("Then", h("ol", { class: "enext wsthen" }, res.expand.map((e) => h("li", {}, h("span", { class: "eline", text: shortName(e.profile, e.label) }),
      h("span", { text: e.why ? cap(e.why) + "." : "Something is missing here too." }), h("b", { class: e.pain >= 0.6 ? "neg" : "", text: e.answered ? `${painPct(e.pain)} missing` : "not discussed" })))),
    { sub: "The path after the first line: what it leads to, and how much is still missing on each, from the customer's answers." }));
  }
  if (res.unknowns.length) {
    const text = res.unknowns.map((u) => `- ${u.label}: ${u.q}`).join("\n");
    out.push(card("Find out before the next meeting", h("div", {}, h("ul", { class: "flags" }, res.unknowns.map((u) => h("li", {}, h("b", { text: u.label }), h("span", { text: u.q })))),
      h("button", { class: "btn small", type: "button", text: "Copy the list", onclick: (ev) => copyText(text).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) })),
    { sub: "Questions nobody in the room could answer. Each one is a reason for the next meeting, and often the real gap." }));
  }
  out.push(nextMeetingCard(w, catalog, today));
  return h("div", {}, out);
}

/** Before and during the meeting: the line in one sentence for each audience, who to bring, and the objections to expect,
 *  each with the question to ask before answering, the answer, and how to prove it. Raised objections go to the proof. */
export function wsPrepView({ workshop: w, catalog, raise, go }) {
  const res = WS.assess(catalog, w);
  const told = WS.stories(catalog, w, res);
  if (!told.length) return card("Prepare", h("p", { class: "note first", text: "The product lines in scope do not come with messages or objections yet. Add a story.json to their profiles to see them here." }));
  const count = h("b", { text: String((w.raised || []).length) });
  const summary = h("p", { class: "tline" }, count, " raised so far. Each one raised goes to the customer readout as something to prove, and into the proof of value when it starts.");
  const say = h("p", { class: "note", role: "status" });
  const hero = h("section", { class: "card" }, h("h2", { text: "Prepare the conversation" }),
    h("p", { class: "note first", text: res.land ? `Starting with ${res.land.label.toLowerCase()}, from what the customer said. Mark an objection when the customer raises it: ask the question first, then answer.` : "For every line in scope. Mark an objection when the customer raises it: ask the question first, then answer." }),
    summary, say);
  const block = (t) => {
    const text = [...Object.entries(t.audiences).map(([k, v]) => `${WS.AUDIENCE_WORDS[k]}: ${v}`), t.people.length ? `Who to involve: ${t.people.join("; ")}.` : ""].filter(Boolean).join("\n");
    const objs = h("ol", { class: "objs" }, t.objections.map((o) => {
      const btn = h("button", { class: "btn small objraise", type: "button", "aria-pressed": String(o.raised), text: o.raised ? "Raised" : "They raised it",
        "aria-label": `${o.raised ? "Raised" : "Mark as raised"}: ${o.says}`,
        onclick: async () => {
          const on = btn.getAttribute("aria-pressed") !== "true";
          try {
            const next = await raise(t.profile, o.index, on);
            btn.setAttribute("aria-pressed", String(on)); btn.textContent = on ? "Raised" : "They raised it";
            btn.setAttribute("aria-label", `${on ? "Raised" : "Mark as raised"}: ${o.says}`);
            btn.closest("li").classList.toggle("on", on);
            count.textContent = String(((next && next.raised) || []).length);
            say.textContent = on ? "Marked as raised: it is now in the readout and will be in the proof of value." : "No longer marked as raised.";
          } catch (e) { say.textContent = e.message; }
        } });
      return h("li", { class: o.raised ? "obj on" : "obj" },
        h("div", { class: "objhead" }, h("q", { class: "objsays", text: o.says }), btn),
        h("dl", { class: "objdl" }, h("dt", { text: "Ask first" }), h("dd", { text: o.clarify }), h("dt", { text: "Answer" }), h("dd", { text: o.answer }), h("dt", { text: "Prove it" }), h("dd", { text: o.prove })));
    }));
    return card(t.land ? `${t.label}: start here` : t.label, h("div", {},
      Object.keys(t.audiences).length ? h("dl", { class: "tellit" }, Object.entries(t.audiences).flatMap(([k, v]) => [h("dt", { text: WS.AUDIENCE_WORDS[k] }), h("dd", { text: v })])) : null,
      t.people.length ? h("div", { class: "growproof" }, h("small", { text: "Who to have in the room" }), h("ul", {}, t.people.map((x) => h("li", { text: x })))) : null,
      t.objections.length ? h("h3", { class: "objtitle", text: `Objections to expect (${t.objections.length})` }) : null, t.objections.length ? objs : null,
      h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Copy the messages", onclick: (ev) => copyText(text).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Open its questions", onclick: () => go("workshop", { open: t.profile }) }))),
    { sub: "The line in one sentence for each audience, who to bring, and what the customer is likely to push back on." });
  };
  return h("div", {}, hero, ...told.map(block));
}

const STATUS_TODAY = { gap: "Today: a real gap", partly: "Today: partly", unknown: "Today: nobody knows yet" };

/** From "can we?" to "what would need to be true?": the path from today to where the customer could be, step by step. */
const presentBtn = (present) => (present ? h("div", { class: "presentrow" }, h("button", { class: "btn quiet", type: "button", text: "Present", "data-tip": "Show this view alone and larger, for a shared screen. Esc brings the app back.", onclick: present })) : null);

export function journeyView({ workshop: w, catalog, go, startPov, present, plan }) {
  const res = WS.assess(catalog, w);
  const j = WS.journey(catalog, w, res);
  if (!j) return card("The journey", h("div", {}, h("p", { class: "note first", text: res.waiting + " The journey then shows, for each step, what would need to be true, the first step towards it, and how it is validated." }),
    h("button", { class: "btn", type: "button", text: "Open the questions", onclick: () => go("workshop") })));
  const say = h("p", { class: "note", role: "status" });
  // who makes each condition true, and by when: saved as it changes, shown as text when presenting
  const planRow = (c) => {
    const shown = h("span", { class: "jplanv" });
    const paint = (who, by) => { shown.textContent = [who ? WS.WHO[who] : "", by ? `by ${by}` : ""].filter(Boolean).join(", "); };
    const who = h("select", { "aria-label": `Who makes this true: ${c.need}` }, h("option", { value: "", text: "Who?" }), Object.entries(WS.WHO).map(([k, v]) => h("option", { value: k, text: v })));
    who.value = c.who;
    const by = h("input", { type: "date", value: c.by, min: w.created_on, "aria-label": `By when: ${c.need}` });
    const save = async () => { try { const next = await plan(c.profile, c.index, who.value, by.value); paint(who.value, by.value); say.textContent = ""; if (next) drawCalendar(next); } catch (e) { say.textContent = e.message; } };
    who.addEventListener("change", save); by.addEventListener("change", save);
    paint(c.who, c.by);
    return h("span", { class: "jplan" }, who, by, shown);
  };
  const hero = h("section", { class: "card estatehero jhero" },
    h("p", { class: "jyes", text: "Yes, this is possible." }),
    h("p", { class: "tline", text: `Here is what would need to be true for ${w.customer}, how we get there, and how we prove each step along the way.` }),
    h("div", { class: "ehead jstats" },
      h("div", {}, h("b", { text: String(j.need) }), h("small", { text: "to make true" })),
      h("div", {}, h("b", { class: "ok", text: String(j.done) }), h("small", { text: "already true" })),
      h("div", {}, h("b", { text: String(j.unknown) }), h("small", { text: "still to find out" }))),
    w.inventory ? h("p", { class: "jfrom" }, h("small", { text: "Where they start from" }), h("span", { text: WS.inventoryLine(w.inventory) })) : null,
    j.stakes.length || j.impact.length ? h("div", { class: "jimpact" }, h("small", { text: "What is at stake, in their words" }),
      j.stakes.map((x) => h("p", { class: "jfig" }, h("b", { text: x.text }), h("small", { text: `in answer to "${x.what}"` }))),
      j.impact.length ? h("q", { text: j.impact.join("; ") }) : null) : null);
  const steps = h("ol", { class: "journey" }, j.steps.map((st) => h("li", { class: "jstep k-" + st.kind },
    h("header", {}, h("h2", { text: st.title }), st.kind === "then" && !st.discussed ? h("span", { class: "wsstage", text: "not discussed yet" }) : null),
    st.why ? h("p", { class: "note first", text: cap(st.why) + "." }) : null,
    st.conditions.length ? h("ul", { class: "jconds" }, st.conditions.map((c) => h("li", { class: "s-" + c.status },
      h("b", { text: c.need }),
      h("span", { class: "jtoday", text: STATUS_TODAY[c.status] + (c.note ? `: "${c.note}"` : "") }),
      c.how ? h("span", { class: "jhow", text: (c.status === "unknown" ? "Find out, then: " : "First step: ") + c.how + "." }) : null,
      c.fact ? h("span", { class: "wsfact", text: "From their inventory: " + c.fact }) : null,
      plan ? planRow(c) : null))) : null,
    st.already.length ? h("p", { class: "jalready" }, h("small", { text: "Already true" }), h("span", { text: st.already.join(". ") + "." })) : null,
    st.validate.length ? h("div", { class: "growproof" }, h("small", { text: "Validated by" }), h("ul", {}, st.validate.map((v) => h("li", { text: v + "." })))) : null,
    st.kind === "prove" ? h("div", { class: "btnrow" }, h("button", { class: "btn", type: "button", text: "Start the proof of value", onclick: async () => { try { await startPov(res); } catch (e) { say.textContent = e.message; } } }), say) : null)));
  // the plan by date, redrawn whenever an owner or a date changes above
  const calBody = h("div", {});
  const month = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const datedItem = (c) => h("li", {}, h("span", { class: "jdate", text: c.by.slice(8) }),
    h("span", {}, h("b", { text: c.need }), h("small", { class: "muted", text: c.step + (c.who ? `. Owner: ${WS.WHO[c.who].toLowerCase()}` : "") })));
  function drawCalendar(cw) {
    const cj = WS.journey(catalog, cw, WS.assess(catalog, cw));
    const dated = WS.datedPlan(cj);
    if (!dated.length) {
      put(calBody, h("p", { class: "note first", text: "Give a condition an owner and a date above, and the plan appears here by month, ready to add to a calendar." }));
      return;
    }
    const byMonth = dated.reduce((m, c) => { (m[month(c.by)] = m[month(c.by)] || []).push(c); return m; }, {});
    const months = Object.entries(byMonth).map(([m, list]) => h("div", { class: "jmonth" }, h("h3", { text: m }), h("ul", { class: "jdated" }, list.map(datedItem))));
    const fileName = `${cw.customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "discovery"}-plan.ics`;
    const calButton = h("button", { class: "btn small", type: "button", text: "Add to a calendar (.ics)",
      onclick: () => saveBlob(WS.planIcs(cw, cj, new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"), fileName, "text/calendar"),
      "data-tip": "One all-day event per dated condition, for Outlook, Google Calendar or Apple Calendar. Made here; nothing is sent." });
    put(calBody, months, h("div", { class: "btnrow" }, calButton));
  }
  drawCalendar(w);
  const calendar = card("The plan by date", calBody, { sub: "The dated conditions, earliest first: what each side said it would make true, and by when." });
  const dest = card("Where it can go", h("p", { class: "note first", text: `With these steps done, ${w.customer} runs ${j.destination.join(", then ").toLowerCase()} with every condition above made true, validated as it went rather than promised up front.` }));
  return h("div", {}, presentBtn(present), hero, steps, calendar, dest);
}

// ------------------------------------------------------------------ the presales desk

const STAGE_SHORT = Object.fromEntries(DESK.STAGES.map((s) => [s.id, s.label]));

/** Every prospect from discovery to decision: where each stands, what is due, what is late, the note for the account team. */
/** What the deals teach, read from every prospect: for the engineer, a manager, enablement and the product team. */
function lessonsView(ls, examples, title = "What the deals teach") {
  const pct = (v) => (v == null ? "—" : `${v}%`);
  const stats = h("div", { class: "lsstats" },
    h("div", {}, h("b", { text: String(ls.decided) }), h("small", { text: "decided" })),
    h("div", {}, h("b", { class: "ok", text: pct(ls.win_rate) }), h("small", { text: ls.decided ? `won (${ls.won} of ${ls.decided})` : "won: no outcome recorded yet" })),
    h("div", {}, h("b", { text: pct(ls.technical_rate) }), h("small", { text: ls.proofs ? `proofs met (${ls.technical_wins} of ${ls.proofs})` : "proofs met: none finished yet" })),
    h("div", {}, h("b", { text: ls.cycle.to_proof == null ? "—" : String(ls.cycle.to_proof) }), h("small", { text: "median days, first meeting to proof" })));
  const list = (label, rows) => (rows.length ? h("div", { class: "growproof" }, h("small", { text: label }), h("ul", {}, rows)) : null);
  const md = LS.lessonsMarkdown(ls, title);
  return card(title, h("div", {},
    examples ? h("p", { class: "note first", text: "Read from the invented examples: with your own prospects, only theirs count." }) : null, stats,
    h("div", { class: "lsgrid" },
      list("What customers push back on", ls.objections.map((o) => h("li", {}, h("span", { text: `"${o.says}"` }), h("small", { class: "muted", text: ` ${o.line.toLowerCase()}: ${o.count} prospect${o.count === 1 ? "" : "s"}${o.won + o.lost ? `, ${o.won} won, ${o.lost} not` : ""}` })))),
      list("The gaps heard most", ls.gaps.map((g) => h("li", {}, h("span", { text: g.q }), h("small", { class: "muted", text: ` ${g.line.toLowerCase()}: ${g.count}${g.unknown ? `, ${g.unknown} where nobody knew` : ""}` })))),
      list("When not won", ls.reasons.map((r) => h("li", { text: `${r.label}: ${r.count}` }))),
      list("Tests not met", ls.not_met.map((t) => h("li", { text: `${t.text} (${t.count})` }))),
      list("Where deals start", ls.lands.map((x) => h("li", { text: `${x.label}: ${x.count}` })))),
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Copy for enablement and leadership", onclick: (ev) => copyText(md).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
  { sub: "Across every prospect: how deals ended and why, what customers push back on, the gaps heard most, the tests not met, and how long each stage takes. Record the outcome of each proof of value to complete it." });
}

export function deskView({ workshops, povs, catalog, today, openOpp, newWorkshop, example, fillExamples, removeExamples }) {
  const opps = DESK.pipeline(workshops, povs, catalog, today);
  const items = DESK.agenda(workshops, povs, catalog, today);
  const f = DESK.funnel(opps);
  const late = items.filter((i) => i.late).length, soon = items.filter((i) => !i.late).length;
  const when = new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const hero = h("section", { class: "card estatehero deskhero" },
    h("p", { class: "deskdate", text: when }),
    h("h2", { class: "desktitle", text: "Your presales desk" }),
    h("div", { class: "ehead jstats" },
      h("div", {}, h("b", { text: String(opps.filter((o) => !o.stopped).length) }), h("small", { text: "open opportunities" })),
      h("div", {}, h("b", { text: String(f.stages.find((s) => s.id === "proof").count) }), h("small", { text: "in proof of value" })),
      h("div", {}, h("b", { class: "ok", text: String(soon) }), h("small", { text: "due in two weeks" })),
      h("div", {}, h("b", { class: late ? "bad" : "", text: String(late) }), h("small", { text: "late" }))),
    h("div", { class: "btnrow" }, h("button", { class: "btn primary", type: "button", text: "Start a discovery workshop", onclick: newWorkshop }),
      opps.some((o) => o.example)
        ? h("button", { class: "btn", type: "button", text: "Remove the invented examples", onclick: removeExamples })
        : h("button", { class: "btn", type: "button", text: "Fill it with invented examples", "data-tip": "Made-up prospects at every stage, and two already decided, dated around today, to see the desk at work. Remove them in one click.", onclick: fillExamples })));
  if (!opps.length) {
    return h("div", {}, hero, card("Nothing here yet", h("p", { class: "note first", text: "Each discovery workshop and each proof of value you keep in this browser becomes an opportunity here, placed at its stage: discovery, journey agreed, proof of value, decision. Start one, or fill the desk with invented examples to see it at work." })));
  }
  // the funnel: a real sequence, so its stages are numbered and joined
  const funnelRow = h("ol", { class: "deskfunnel" }, f.stages.map((s) => h("li", { title: s.hint }, h("b", { text: String(s.count) }), h("span", { text: s.label }))));
  // what the deals teach: outcomes and reasons, objections, gaps, tests not met, time per stage
  const facts = LS.dealFacts(workshops, povs, catalog);
  const onlyExamples = facts.length && facts.every((x) => x.example);
  const ls = LS.lessons(facts, { includeExamples: onlyExamples });
  const lessonsCard = ls.deals ? lessonsView(ls, onlyExamples) : null;
  const agendaCard = card("This week and next", items.length
    ? h("ul", { class: "jdated deskagenda" }, items.map((i) => h("li", { class: i.late ? "late" : "" },
      h("span", { class: "jdate", text: i.late ? "late" : i.on.slice(8) }),
      h("span", {}, h("b", { text: `${i.customer}: ${i.what}` }), h("small", { class: "muted", text: `${i.on}${i.who ? `, owner: ${i.who}` : ""}${i.kind === "pov" ? ", proof of value" : ""}` })))))
    : h("p", { class: "note first", text: "Nothing dated in the next two weeks. Give the conditions in a journey an owner and a date, or set the dates of a proof of value." }),
  { sub: "Dated conditions from every journey and the start and end of every proof of value; what is late comes first." });
  const cols = [
    { key: "customer", label: "Prospect", render: (o) => h("span", {}, h("b", { text: o.customer }), o.example ? h("small", { class: "muted", text: " (example)" }) : null) },
    { key: "stage", label: "Stage", sort: (o) => (o.stopped ? -1 : DESK.STAGES.findIndex((s) => s.id === o.stage)), render: (o) => h("span", { class: "deskstage s-" + (o.outcome || (o.stopped ? "stopped" : o.stage)), text: o.outcome ? DESK.OUTCOME_WORDS[o.outcome] : o.stopped ? "Stopped" : STAGE_SHORT[o.stage] }) },
    { key: "land", label: "Start with", render: (o) => o.land || "—" },
    { key: "answered", label: "Answered", num: true, sort: (o) => o.coverage, render: (o) => (o.total ? `${o.answered} of ${o.total}` : "—") },
    { key: "stakes", label: "At stake", render: (o) => o.stakes.join(", ") || "—" },
    { key: "pov", label: "Proof", num: true, sort: (o) => (o.pov_total ? o.pov_met / o.pov_total : -1), render: (o) => (o.pov_total ? `${o.pov_met} of ${o.pov_total} met` : "—") },
    { key: "next", label: "Next", render: (o) => h("span", { class: o.overdue ? "neg" : "", text: o.next || "—" }) },
    { key: "evidence", label: "Evidence", num: true, sort: (o) => (o.evidence ? o.evidence.score : -1),
      render: (o) => (o.stopped ? "—" : h("span", { class: "deskev", title: o.evidence.missing.length ? `What would raise it:\n${o.evidence.missing.join("\n")}` : "Every item is in place",
        style: `--ev:${o.evidence.score}%` }, h("span", { class: "deskevbar", "aria-hidden": "true" }), h("b", { text: String(o.evidence.score) }), h("span", { class: "sr-only", text: " of 100" }))) },
    { key: "risks", label: "To watch", num: true, sort: (o) => o.risks.filter((r) => r.level === "high").length * 10 + o.risks.length,
      render: (o) => (o.risks.length ? h("span", { class: "deskrisk" + (o.risks.some((r) => r.level === "high") ? " high" : ""), title: o.risks.map((r) => r.text).join("\n"), text: String(o.risks.length) }) : "—") },
    { key: "open", label: "Open", render: (o) => (o.workshop ? h("button", { class: "btn small", type: "button", text: "Open", "aria-label": `Open ${o.customer}`, onclick: () => openOpp(o) }) : h("small", { class: "muted", text: o.example ? "an invented proof" : "from its analysis" })) },
  ];
  const table = dataTable({ columns: cols, rows: opps, label: "Opportunities", pageSize: 50 });
  const md = DESK.weeklyMarkdown(opps, items, today);
  // what could stop a deal: the risks that can lose one on their own first, each with what to do, and the way back to it
  const flagged = opps.filter((o) => !o.stopped && o.risks.length);
  const riskCard = flagged.length ? card("What could stop a deal", h("ul", { class: "deskrisks" }, flagged.flatMap((o) => o.risks.map((r) => ({ o, r })))
    .sort((x, y) => (x.r.level === y.r.level ? 0 : x.r.level === "high" ? -1 : 1)).slice(0, 12).map(({ o, r }) => h("li", { class: r.level },
      h("span", { class: "chip2 " + (r.level === "high" ? "bad" : "warn"), text: r.level === "high" ? "Can lose it" : "Watch" }),
      h("span", {}, h("b", { text: o.customer }), " ", h("span", { text: r.text })),
      o.workshop ? h("button", { class: "btn small", type: "button", text: "Open", "aria-label": `Open ${o.customer}`, onclick: () => openOpp(o) }) : null))),
  { sub: "Read from what is recorded: late conditions, a proof without a sponsor or ending with tests not tried, concerns left out of the proof, no figures for finance. Each says what to do." }) : null;
  const me = h("input", { type: "text", maxlength: 100, value: [...workshops].sort((a, b) => (b.updated_on > a.updated_on ? 1 : -1)).map((w) => w.prepared_by || "").find(Boolean) || "",
    "aria-label": "Your name, as your manager should see it", placeholder: "Your name" });
  const snapshot = () => TEAM.snapshotFrom(opps, facts, me.value, today);
  const docs = card("For the account team", h("div", {},
    h("p", { class: "note first", text: "The Monday note: where each opportunity stands, what is late, what is next. And the pipeline as a sheet for a forecast call or a CRM import." }),
    h("div", { class: "btnrow" },
      h("button", { class: "btn small", type: "button", text: "Copy the weekly update", onclick: (ev) => copyText(md).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Download it (.md)", onclick: () => saveBlob(md, `presales-update-${today}.md`, "text/markdown") }),
      h("button", { class: "btn small", type: "button", text: "Pipeline (.csv)", onclick: () => saveBlob(DESK.pipelineCsv(opps), `presales-pipeline-${today}.csv`, "text/csv") })),
    h("p", { class: "note", text: "For your manager: a snapshot of this desk (stages, risks, outcomes, what customers pushed back on, the gaps heard), without notes, figures or the names of people. Names of prospects can be swapped for aliases on the way out." }),
    h("div", { class: "btnrow" }, h("label", { class: "szf deskme" }, h("span", { text: "Your name" }), me),
      h("button", { class: "btn small", type: "button", text: "Snapshot for my manager (.json)",
        onclick: () => saveBlob(JSON.stringify(snapshot(), null, 1), `desk-snapshot-${(me.value || "engineer").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "engineer"}-${today}.json`, "application/json") })))
  );
  return h("div", {}, hero, h("div", { class: "card deskfunnelcard" }, funnelRow), riskCard, lessonsCard, h("div", { class: "col2" }, agendaCard, docs), card("Opportunities", table.el, { sub: "Furthest along first. Open one to carry on: its questions, its journey, its proof of value." }),
    teamCard(catalog, today));
}

// the team's snapshots, read for this visit only: never stored, gone when the page closes
let teamSnaps = null;

/** For a presales manager: the team's desk snapshots read together, in this page only. */
function teamCard(catalog, today) {
  const body = h("div", { class: "teambody" });
  const say = h("p", { class: "note", role: "status" });
  const draw = () => {
    if (!teamSnaps || !teamSnaps.ok.length) {
      put(body, teamSnaps && teamSnaps.refused.length ? h("ul", { class: "plain" }, teamSnaps.refused.map((r) => h("li", { text: `${r.name}: ${r.why}.` }))) : null);
      return;
    }
    const examples = teamSnaps.ok.every((s) => s.deals.every((d) => d.example));
    const t = TEAM.teamView(teamSnaps.ok, { includeExamples: examples });
    const md = TEAM.teamMarkdown(t, today);
    put(body,
      teamSnaps.refused.length ? h("ul", { class: "plain" }, teamSnaps.refused.map((r) => h("li", { class: "neg", text: `Not read: ${r.name}: ${r.why}.` }))) : null,
      examples ? h("p", { class: "note first", text: "Two invented engineers: with real snapshots, their invented examples are left out." }) : null,
      h("div", { class: "tablewrap" }, h("table", { class: "drtable teamtable" },
        h("thead", {}, h("tr", {}, ["Engineer", "Open", "Discovery", "Journey", "Proof", "Decision", "Won", "Lost or no decision", "At risk", "Evidence (median)", "Snapshot of"].map((x) => h("th", { scope: "col", text: x })))),
        h("tbody", {}, t.engineers.map((e) => h("tr", {}, h("th", { scope: "row", text: e.name }), h("td", { text: String(e.live) }),
          ...["discovery", "journey", "proof", "decision"].map((id) => h("td", { text: String(e.stages[id]) })),
          h("td", { text: String(e.won) }), h("td", { text: String(e.lost) }), h("td", { class: e.at_risk ? "neg" : "", text: String(e.at_risk) }), h("td", { text: e.evidence == null ? "—" : `${e.evidence}/100` }), h("td", { text: e.as_of })))))),
      t.risky.length ? h("div", { class: "growproof" }, h("small", { text: "What could lose a deal, across the team" }),
        h("ul", {}, t.risky.slice(0, 12).map((r) => h("li", {}, h("b", { text: r.customer }), h("span", { class: "muted", text: `, ${r.engineer}: ` }), h("span", { text: r.risk }))))) : null,
      t.lessons.deals ? lessonsView(t.lessons, false, "What the team's deals teach") : null,
      h("div", { class: "btnrow" },
        h("button", { class: "btn small", type: "button", text: "Copy the team review", onclick: (ev) => copyText(md).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Download it (.md)", onclick: () => saveBlob(md, `presales-team-review-${today}.md`, "text/markdown") }),
        h("button", { class: "btn small", type: "button", text: "Clear the team", onclick: () => { teamSnaps = null; files.value = ""; draw(); say.textContent = "Cleared: nothing was kept."; } })));
  };
  const files = h("input", { type: "file", multiple: true, accept: ".json,application/json", "aria-label": "The team's desk snapshots" });
  files.addEventListener("change", async () => {
    const list = [...files.files];
    const read = await Promise.all(list.slice(0, TEAM.MAX_FILES + 1).map(async (f) => ({ name: f.name, text: f.size > TEAM.MAX_FILE ? "x".repeat(TEAM.MAX_FILE + 1) : await f.text() })));
    teamSnaps = TEAM.readSnapshots(read);
    say.textContent = `${teamSnaps.ok.length} snapshot${teamSnaps.ok.length === 1 ? "" : "s"} read${teamSnaps.refused.length ? `, ${teamSnaps.refused.length} not` : ""}.`;
    draw();
  });
  draw();
  return card("Your team", h("div", {},
    h("p", { class: "note first", text: "For a presales manager: each engineer downloads a snapshot from their desk and sends it to you; read them here together. They are checked field by field, read for this visit only, never stored and never sent." }),
    h("div", { class: "btnrow" }, h("label", { class: "szf" }, h("span", { text: "Read the team's snapshots" }), files),
      h("button", { class: "btn small", type: "button", text: "Try it with two invented engineers", onclick: () => { teamSnaps = { ok: TEAM.exampleTeam(catalog, today), refused: [] }; say.textContent = ""; draw(); } })),
    say, body),
  { sub: "Each engineer's pipeline, the deals that could be lost across the team, and what the team's deals teach, for the weekly review." });
}
