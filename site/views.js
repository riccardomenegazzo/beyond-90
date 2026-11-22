// The dashboard views. Each takes a context {result, dash, score, engine, files, options, go} and returns a Node.
import { h, s as svgEl, chip, pct, pts, num, cap, dataTable, chipFilter, searchBox, toCsv, saveBlob, copyText, mailText } from "./ui.js";
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
import * as EDGE from "./edgesketch.js";
import * as UNIT from "./unitcost.js";
import * as RFP from "./rfp.js";
import * as AWD from "./award.js";
import * as BID from "./bidcall.js";
import * as QL from "./qlist.js";
import * as DECK from "./deck.js";
import * as HEARD from "./heard.js";
import * as PACE from "./pace.js";
import * as LS from "./lessons.js";
import * as TEAM from "./team.js";
import * as QD from "./qualify.js";
import * as FW from "./forward.js";
import * as DEMO from "./demo.js";
import * as RO from "./readout.js";
import * as PT from "./partners.js";
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
  const tour = seen ? null : h("section", { class: "card firstmin", "aria-label": "Your first minute" },
    h("header", { class: "cardhead" }, h("h2", { text: "Your first minute" })),
    h("ol", { class: "tourlist" }, firstMinute(dash.actions.length).map((st) => h("li", {}, h("span", { text: st.text }), st.to ? h("button", { class: "btn small", type: "button", text: st.cta, onclick: () => go(st.to) }) : null))),
    h("button", { class: "btn small", type: "button", text: "Got it, hide this", onclick: (e) => { try { localStorage.setItem("beyond90.tour", "1"); } catch { /* storage may be off */ } e.target.closest(".firstmin").remove(); } }));

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
  // the distance to the target, drawn: what really works, the target's mark, and where an action would take it
  const goal = score.target && score.target.value;
  const tghost = h("i", { class: "tm-ghost" });
  const meter = goal > 0 && goal <= 1 ? h("div", { class: "tmeter", role: "img",
    "aria-label": score.yield >= goal ? `${pct(score.yield)}, at or above the ${pct(goal, 0)} target` : `${pct(score.yield)}, ${((goal - score.yield) * 100).toFixed(1)} points below the ${pct(goal, 0)} target` },
  h("div", { class: "tm-track" }, tghost, h("i", { class: "tm-fill", style: `width:${(Math.min(1, Math.max(0, score.yield)) * 100).toFixed(1)}%` }),
    h("i", { class: "tm-goal", style: `left:${(goal * 100).toFixed(1)}%` })),
  h("div", { class: "tm-key", "aria-hidden": "true" }, h("span", { class: "tm-lab", style: `left:${(goal * 100).toFixed(1)}%`, text: `target ${pct(goal, 0)}` }))) : null;
  const hero = h("section", { class: "card todayhero" },
    h("div", { class: "todayscore" }, h("span", { class: "tnum", text: pct(score.yield) }), tprev, h("span", { class: "tcap", text: "Yield" }), trend),
    h("p", { class: "tline", text: headline({ customer: result.customer, yield: score.yield, target: score.target && score.target.value, stages: score.stages, openActions: dash.actions.length }) }),
    meter);

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
    tghost.style.width = `${(Math.min(1, Math.max(0, p.yield)) * 100).toFixed(1)}%`;
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
    tghost.style.width = "0";
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
  const text = () => `Questions for ${customer}\n\n` + qs.map((x, i) => [`${i + 1}. ${x.q}${x.core ? " (essential)" : ""}`,
    x.role && WS.ROLE_WORDS[x.role] ? `   Ask: ${WS.ROLE_WORDS[x.role].toLowerCase()}` : "", x.listen ? `   Listen for: ${x.listen}` : "", x.probe ? `   Then ask: ${x.probe}` : ""].filter(Boolean).join("\n")).join("\n");
  return card("Questions to ask", h("div", {},
    h("ol", { class: "disco" }, qs.map((x) => h("li", { class: x.focus ? "focus" : "" },
      h("span", { class: "disco-q" }, h("b", { text: x.q }), h("small", { text: x.why }),
        x.core || x.role ? h("span", { class: "wstags" }, x.core ? h("span", { class: "wscore", text: "Essential" }) : null, x.role && WS.ROLE_WORDS[x.role] ? h("span", { class: "wsrole", text: "Ask: " + WS.ROLE_WORDS[x.role].toLowerCase() }) : null) : null,
        x.listen || x.probe ? h("details", { class: "wshow" }, h("summary", { text: "How to ask it" }), h("dl", { class: "objdl" },
          x.listen ? [h("dt", { text: "Listen for" }), h("dd", { text: x.listen })] : null, x.probe ? [h("dt", { text: "Then ask" }), h("dd", { text: x.probe })] : null)) : null),
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
    // the readout, criterion by criterion: the same cards as the questions, with the evidence written on each
    const runReadout = () => {
      let cur = p;
      const cards = RO.readoutCards(cur);
      const roSet = {
        ...RO.READOUT,
        label: (k) => RO.RESULTS[k].label,
        tone: (k) => RO.RESULTS[k].tone,
        suggest: (q, said) => RO.readoutSuggest(said),
        tag: (c) => c.tag,
        hint: "Swipe it by what was seen, or tap",
        how: "What counts as evidence",
        openText: "Back to what is not tried",
        doneWord: "tried",
        summary: (cs, answerOf) => RO.readoutSummary(cs, answerOf),
        recap: (cs, answerOf) => RO.readoutText(cur, cs, answerOf),
        recapSubject: `Proof of value readout: ${p.customer}`,
        get end() {
          return cur.stage === "done" ? { text: "Back to the proof", view: "" }
            : { text: "Mark the readout as held", view: "", act: async () => { cur = P.edit(cur, { stage: "done" }, today); await savePov(cur); } };
        },
      };
      openDeck({ cards, state: { at: Math.max(0, cards.findIndex((c) => !RO.resultOf(cur)(c))), drafts: new Map() }, set: roSet, go: () => {},
        answerOf: (c) => RO.resultOf(cur)(c),
        answer: async (c, a, note) => { cur = P.setCriterion(cur, c.key, { status: a, evidence: note }, today); await savePov(cur); return cur; },
        onClose: () => {} });
    };
    const readoutBtn = pr.total ? h("button", { class: "btn small primary", type: "button", text: "Go criterion by criterion",
      "data-tip": "The readout with the sponsor, full screen: one card per criterion, swiped by what was seen, with the evidence written on it. Ends with what was not met and what it means." , onclick: runReadout }) : null;
    put(body, 
      h("section", { class: "card bdhero" },
        h("p", { class: "bdlead", role: "status", text: `${p.customer}: ${pr.met} of ${pr.total} criteria met.` }),
        h("p", { class: "bdnoise" }, h("b", { text: ql.verdict }), ttv == null ? "" : ` · first value after ${ttv} day${ttv === 1 ? "" : "s"}`)),
      h("div", { class: "kpiline" }, stat(pr.verdict, "result so far"), stat(`${pr.met}/${pr.total}`, "criteria met"), stat(`${pr.ready}/${pr.ready_total}`, "ready"), stat(String(p.sessions.length), "sessions"), stat(P.timeToFirstValue(p) == null ? "not set" : `${P.timeToFirstValue(p)} d`, "to first value")),
      card("Success criteria", h("div", {}, readoutBtn ? h("div", { class: "btnrow" }, readoutBtn) : null, h("ul", { class: "promises" }, crit)),
        { sub: "Agree these with the sponsor before you start. Mark each one when you have seen it, and write what you saw; at the readout, go through them one by one." }),
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
const SHORT = { "cloud-operations": "Operations", "edge-sites": "Edge", "service-provider-cloud": "Provider cloud", "platform-migration": "Migration", "private-ai": "AI", "hybrid-cloud": "Hybrid cloud", euc: "Desktops", microsegmentation: "Segmentation", hci: "Platform", dbaas: "Databases", "file-storage": "Files", "object-storage": "Objects", "kubernetes-platform": "Kubernetes", "dr-backup": "Recovery",
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

// ---------- one question at a time: the deck
// A card per question. Swipe it, tap an answer, or press an arrow or a number; what they said is written on the card
// and saved with the answer. The same deck sits at the top of a view and opens full screen; both share where they are
// and what was typed. The answers are a set laid on the four directions: discovery has four, qualification three.
const DECK_ARROW = { right: "M9 6l6 6-6 6", left: "M15 6l-6 6 6 6", up: "M6 15l6-6 6 6", down: "M6 9l6 6 6-6" };
const DECK_TALLY = { gap: (n) => (n === 1 ? "real gap" : "real gaps"), unknown: () => "nobody knows", partly: () => "partly", solved: () => "solved" };
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The discovery questions as a deck: four answers, what was said suggesting one, the journey at the end. */
const DISCOVERY_DECK = {
  ...DECK.DISCOVERY,
  label: (k) => WS.ANSWERS[k].label,
  tone: (k) => DECK.TONE[k],
  suggest: (q, said) => DECK.suggest(q, said),
  tag: (c) => (c.q.role && WS.ROLE_WORDS[c.q.role] ? `Ask: ${WS.ROLE_WORDS[c.q.role].toLowerCase()}` : null),
  hint: "Swipe the card, or tap an answer",
  summary: (cards, answerOf) => {
    const answers = {};
    for (const c of cards) { const a = answerOf(c); if (a) answers[c.key] = a; }
    const s = DECK.deckSummary(cards, answers);
    const invite = DECK.inviteLines(cards, answers).map((r) => ({ q: r.text, label: `For example: ${r.first}`, note: "" }));
    return { head: s.head, total: s.total, open: s.counts.open, counts: s.counts, tallies: ["gap", "unknown", "partly", "solved"].map((k) => [k, DECK_TALLY[k](s.counts[k])]),
      lists: [["The gaps, with what they said", s.gaps], ["Nobody could answer", s.unknown], ["For the next meeting", invite]] };
  },
  end: { text: "See the journey", view: "journey" },
  more: { text: "Write the meeting summary", view: "wsummary" },
  // what an answer that is not solved puts on the journey: the condition that would need to be true
  after: (c, k) => (k !== "solved" && c.q.need ? c.q.need : ""),
};

/**
 * One deck, drawn into its own element: in the page (`inline`, with Full screen) or in a dialog (with Close).
 * `state` = {at, drafts}: where the deck is and the words typed on cards not answered yet, shared by both.
 * `answerOf(card)` gives a card's answer ({a, note}) or nothing; `answer(card, a, note)` saves one.
 */
function deckPane({ cards, state, answerOf, answer, go, pfx, inline, set = DISCOVERY_DECK, kicker = "Ask next", clock = null, onAnswered = () => {}, onFull = () => {}, onDone = () => {} }) {
  let busy = false, now = null, wasOpen = false;
  const title = h("h2", { id: `${pfx}-title`, class: "deckline" });
  const pos = h("span", { class: "deckpos" });
  const marks = h("div", { class: "deckmarks" + (cards.length > 30 ? " many" : ""), "aria-hidden": "true" });
  const main = h("div", { class: "deckmain" });
  const status = h("p", { class: "sr-only", role: "status" });
  const action = inline
    ? h("button", { type: "button", class: "linkbtn deckclose deckfull", text: "Full screen", onclick: () => onFull(),
      "data-tip": "The deck on the whole screen: nothing else in view, the same cards and answers." })
    : h("button", { type: "button", class: "linkbtn deckclose", text: "Close", onclick: () => onDone() });
  const root = h("div", { class: "deckpane" + (inline ? " inpage" : "") },
    h("div", { class: "deckhead" }, h("div", { class: "decktop" }, inline ? h("span", { class: "deckkicker", text: kicker }) : null, title, pos, clock ? clock() : null, action), marks), main, status);

  const drawMarks = () => {
    put(marks, cards.map((c, j) => { const a = answerOf(c); return h("i", { class: a ? `t-${set.tone(a.a)}` : j === state.at ? "now" : "" }); }));
  };
  const place = (card, dx, dy) => {
    card.style.setProperty("--dx", `${dx}px`);
    card.style.setProperty("--dy", `${dy}px`);
    card.style.setProperty("--rot", `${(dx / 16).toFixed(2)}deg`);
  };
  const stampOn = (stamp, k, strength) => {
    stamp.textContent = k ? set.label(k) : "";
    stamp.className = "deckstamp" + (k ? ` t-${set.tone(k)}` : "");
    stamp.style.setProperty("--on", String(k ? strength : 0));
  };
  const snapBack = () => { if (!now) return; now.card.classList.add("back"); place(now.card, 0, 0); stampOn(now.stamp, null, 0); };
  const fly = (k) => new Promise((resolve) => {
    stampOn(now.stamp, k, 1);
    if (reducedMotion()) { resolve(); return; }
    const d = set.dir(k);
    now.card.classList.remove("enter");
    now.card.classList.add("fly");
    place(now.card, d.dx * 520, d.dy * 760);
    setTimeout(resolve, 220);
  });
  const commit = async (k) => {
    if (busy || !now) return;
    busy = true;
    const c = cards[state.at];
    try {
      await answer(c, k, now.said.value);
      state.drafts.delete(c.key);
      state.after = set.after ? set.after(c, k) : "";
      status.textContent = `${set.label(k)}.${state.after ? ` ${state.after}` : ""}`;
      onAnswered(c.key);
      await fly(k);
      state.at += 1;
      busy = false;
      draw(true);
    } catch (e) {
      busy = false;
      status.textContent = e.message;
      snapBack();
    }
  };
  const drag = (card, stamp) => {
    let from = null;
    card.addEventListener("pointerdown", (e) => {
      if (busy || e.button > 0 || e.target.closest("button, textarea, input, select, a, label, .deckguide")) return;
      from = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { card.setPointerCapture(e.pointerId); } catch { /* capturing is a nicety: the drag works without it */ }
      card.classList.remove("back", "enter");
      card.classList.add("dragging");
    });
    card.addEventListener("pointermove", (e) => {
      if (!from || e.pointerId !== from.id) return;
      const dx = e.clientX - from.x, dy = e.clientY - from.y;
      place(card, dx, dy);
      stampOn(stamp, set.toward(dx, dy), DECK.hintStrength(dx, dy));
    });
    const end = (e) => {
      if (!from || e.pointerId !== from.id) return;
      const k = e.type === "pointerup" ? set.released(e.clientX - from.x, e.clientY - from.y) : null;
      from = null;
      card.classList.remove("dragging");
      if (k) {
        try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* a buzz is a nicety */ }
        commit(k);
      } else snapBack();
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);       // in the page, a drag up or down scrolls it instead
  };

  const drawCard = (focus) => {
    const c = cards[state.at], ans = answerOf(c), q = c.q;
    wasOpen = !ans;
    title.textContent = c.label;
    pos.textContent = `${state.at + 1} of ${cards.length}`;
    drawMarks();
    const stamp = h("div", { class: "deckstamp", "aria-hidden": "true" });
    const ask = h("p", { class: "deckq", id: `${pfx}-q`, tabindex: "-1", text: q.q });
    const said = h("textarea", { id: `${pfx}-said`, class: "decksaid", maxlength: 300, rows: 3, placeholder: set.saidHint || "Their words, a number, a name" });
    said.value = state.drafts.has(c.key) ? state.drafts.get(c.key) : ans ? ans.note : "";
    const sug = h("span", { class: "decksug", "aria-live": "polite" });
    const opts = set.order.map((k, i) => h("button", { type: "button", class: `deckopt o-${k} t-${set.tone(k)}`, "data-a": k, "aria-pressed": String(!!ans && ans.a === k),
      "aria-keyshortcuts": `${set.dir(k).key} ${i + 1}`, onclick: () => commit(k) },
    svgEl("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      svgEl("path", { d: DECK_ARROW[set.dir(k).arrow] })),
    h("span", { text: set.label(k) })));
    let shown = null;
    const paintSug = () => {
      const s = set.suggest ? set.suggest(q, said.value) : null;
      for (const b of opts) b.classList.toggle("sug", b.dataset.a === s);
      if (s === shown) return;
      shown = s;
      sug.className = "decksug" + (s ? ` t-${set.tone(s)}` : "");
      sug.textContent = s ? `Sounds like ${set.label(s).toLowerCase()}` : "";
    };
    said.addEventListener("input", () => { state.drafts.set(c.key, said.value); paintSug(); });
    // how to ask it: the other side of the card
    const guide = q.why || q.listen || q.probe;
    const front = h("div", { class: "deckfront" });
    const back = h("div", { class: "deckguide", hidden: true });
    const howBtn = guide ? h("button", { type: "button", class: "linkbtn", "aria-expanded": "false", text: set.how || "How to ask it" }) : null;
    const backBtn = h("button", { type: "button", class: "linkbtn", text: "Back to the question" });
    const flip = (on) => {
      front.hidden = on; back.hidden = !on;
      if (howBtn) howBtn.setAttribute("aria-expanded", String(on));
      (on ? backBtn : howBtn || ask).focus({ preventScroll: true });
    };
    if (howBtn) howBtn.addEventListener("click", () => flip(true));
    backBtn.addEventListener("click", () => flip(false));
    const tag = set.tag ? set.tag(c) : null;
    put(front,
      h("div", { class: "decktags" }, q.core ? h("span", { class: "decktag core", text: "Essential" }) : null,
        tag ? h("span", { class: "decktag", text: tag }) : null,
        ans ? null : (c.why || []).map((w) => h("span", { class: "decktag why", text: w })),
        ans ? h("span", { class: `decktag t-${set.tone(ans.a)}`, text: `Answered: ${set.label(ans.a).toLowerCase()}` }) : null),
      ask,
      h("label", { for: `${pfx}-said`, class: "decklabel", text: set.saidLabel || "What they said" }), said,
      h("div", { class: "deckfoot" }, howBtn, sug));
    const L = { why: "Why it matters", listen: "Listen for", probe: "Then ask", ...(set.backLabels || {}) };
    put(back,
      h("dl", { class: "deckdl" }, q.why ? [h("dt", { text: L.why }), h("dd", { text: q.why })] : null,
        q.listen ? [h("dt", { text: L.listen }), h("dd", { text: q.listen })] : null,
        q.probe ? [h("dt", { text: L.probe }), h("dd", { class: "deckprobe", text: q.probe })] : null,
        q.need ? [h("dt", { text: "What would need to be true" }), h("dd", { text: q.need })] : null,
        q.how ? [h("dt", { text: "A first step" }), h("dd", { text: q.how })] : null),
      backBtn);
    const card = h("article", { class: "deckcard" + (reducedMotion() || !focus ? "" : " enter"), "aria-labelledby": `${pfx}-q` }, stamp, front, back);
    now = { card, stamp, said };
    const prev = h("button", { type: "button", class: "linkbtn", text: "Previous", disabled: state.at === 0, onclick: () => { state.after = ""; state.at -= 1; draw(true); } });
    const skip = h("button", { type: "button", class: "linkbtn", text: "Skip", onclick: () => { state.after = ""; state.at += 1; draw(true); } });
    const after = state.after ? h("p", { class: "deckafter" }, h("b", { text: "On the journey: " }), state.after) : null;
    const noted = set.note ? set.note(c, state.at) : null;
    const pace = noted && noted.line ? h("p", { class: `decknote p-${noted.state}`, role: "status", text: noted.line }) : null;
    state.after = "";
    put(main, h("div", { class: "deckstage" }, card), after, pace,
      h("div", { class: `deckans n${set.order.length}`, role: "group", "aria-label": `Answer to: ${q.q}` }, opts),
      h("div", { class: "deckbar" }, prev, h("span", { class: "deckhint", text: set.hint }), skip));
    paintSug();
    drag(card, stamp);
    if (focus) requestAnimationFrame(() => ask.focus({ preventScroll: true }));
    nudgeOnce(card, stamp);
  };
  // the first card this browser shows leans right, then left, once, with the answer each way faintly stamped:
  // a card that can be swiped says so without a word; never with reduced motion, never twice
  const nudgeOnce = (card, stamp) => {
    let seen = true;
    try { seen = localStorage.getItem("beyond90.deckhint") === "1"; localStorage.setItem("beyond90.deckhint", "1"); } catch { /* without storage, no hint */ }
    if (seen || reducedMotion()) return;
    const right = set.order.find((k) => set.dir(k).arrow === "right"), left = set.order.find((k) => set.dir(k).arrow === "left");
    setTimeout(() => { if (!card.isConnected || card.classList.contains("dragging")) return; card.classList.add("nudge"); stampOn(stamp, right, 0.55); }, 700);
    setTimeout(() => { if (card.isConnected && card.classList.contains("nudge")) stampOn(stamp, left, 0.55); }, 1200);
    setTimeout(() => { card.classList.remove("nudge"); if (card.isConnected && !card.classList.contains("dragging")) stampOn(stamp, null, 0); }, 1750);
  };

  const drawEnd = (focus) => {
    now = null;
    wasOpen = false;
    const s = set.summary(cards, answerOf);
    title.textContent = "Where it stands";
    pos.textContent = `${s.total - s.open} of ${s.total} ${set.doneWord || "answered"}`;
    drawMarks();
    const said = ([heading, rows]) => (rows.length ? [h("h3", { class: "decksub", text: heading }),
      h("ul", { class: "deckgaps" }, rows.map((r) => h("li", {}, h("span", { text: r.q }), h("small", { class: "muted", text: r.label }),
        r.note ? h("span", { class: "decksaidline", text: `“${r.note}”` }) : null)))] : null);
    const headline = h("p", { class: "deckheadline", tabindex: "-1", text: s.head });
    const open = cards.findIndex((c) => !answerOf(c));
    put(main, h("div", { class: "decksum" }, headline,
      h("div", { class: "decktallies" }, s.tallies.map(([k, words]) => h("div", { class: `decktally t-${set.tone(k)}` },
        h("b", { text: String(s.counts[k]) }), h("span", { text: words })))),
      s.lists.map(said),
      set.recap ? h("div", { class: "btnrow deckrecap" },
        h("button", { class: "btn", type: "button", text: "Copy the recap", onclick: (ev) => copyText(set.recap(cards, answerOf)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn", type: "button", text: "Email the recap", onclick: () => mailText(set.recapSubject || "Discovery recap", set.recap(cards, answerOf), DECK.recapMailto),
          "data-tip": "Opens your own mail app with the recap written in, for the account team, after the same check as a copy. It names the gaps: it is not for the customer." }),
        set.share ? h("button", { class: "btn", type: "button", text: set.share.text, "data-tip": set.share.tip || "",
          onclick: (ev) => copyText(set.share.make(cards, answerOf)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }) : null) : null,
      h("div", { class: "btnrow deckendrow" },
        set.end ? h("button", { class: "btn primary", type: "button", text: set.end.text, onclick: async (ev) => {
          if (set.end.act) { try { await set.end.act(); } catch (e) { ev.target.textContent = e.message; return; } }
          onDone(); go(set.end.view);
        } }) : null,
        set.more ? h("button", { class: "btn", type: "button", text: set.more.text, onclick: () => { onDone(); go(set.more.view); } }) : null,
        open >= 0 ? h("button", { class: "btn", type: "button", text: set.openText || "Ask what is still open", onclick: () => { state.at = open; draw(true); } }) : null,
        inline ? null : h("button", { class: "btn", type: "button", text: "Back to the list", onclick: () => onDone() })),
      h("button", { class: "linkbtn", type: "button", text: "Go back to the last question", onclick: () => { state.at = cards.length - 1; draw(true); } })));
    if (focus) requestAnimationFrame(() => headline.focus({ preventScroll: true }));
  };
  const draw = (focus = false) => (state.at >= cards.length ? drawEnd(focus) : drawCard(focus));

  // the keys answer the card in view; in the dialog the app's own shortcuts wait until it is closed
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return;
    if (!inline) e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey || !now || e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    const k = set.fromKey(e.key);
    if (k) { e.preventDefault(); e.stopPropagation(); commit(k); }
  });
  /** After an answer given elsewhere: a card that was open and is now answered gives way to the next one still open. */
  const sync = () => {
    if (busy) return;
    if (state.at < cards.length && wasOpen && answerOf(cards[state.at])) {
      const n = cards.findIndex((c, i) => i > state.at && !answerOf(c));
      const m = n >= 0 ? n : cards.findIndex((c) => !answerOf(c));
      state.at = m < 0 ? cards.length : m;
    }
    draw(false);
  };
  return { el: root, draw, sync };
}

/**
 * Heard something: what the customer said out of turn, written as it was said, matched to the question it answers among
 * every question in scope and the ten of the qualification, and filed with a tap (or Ctrl+Enter), undoable. Shared by
 * the questions and the qualification. `get`/`set` read and keep the workshop; `onFiled(key)` lets the view follow.
 */
function heardPanel({ catalog, get, set, answer, worth, setDeal, raise = null, onFiled = () => {}, id = "wsheard" }) {
  // heard something: written as it was said; the question it answers is found among every question in scope
  const heardIn = h("textarea", { id, class: "heardin", rows: 2, maxlength: HEARD.NOTE_MAX, placeholder: "e.g. any domain admin can wipe the backup repository",
    "aria-keyshortcuts": "Control+Enter" });
  const heardOut = h("div", { class: "heardout" });
  const heardSay = h("p", { class: "note heardsay", role: "status" });
  const fileHeard = async (card, k, said) => {
    const before = get().answers[card.key];
    const fig = card.q.stage === "value" ? HEARD.figureIn(said, card.q) : null;      // a figure heard on a value question goes with it
    set(await answer(card.line, card.index, k, HEARD.joinNote(before && before.note, said)));
    if (fig) set(await worth(card.line, card.index, fig.amount, fig.per));
    heardIn.value = "";
    put(heardOut);
    const moved = () => onFiled(card.key);
    // a tap in a meeting can land on the wrong question: undo puts back what was there, and the words in the box
    const undo = h("button", { type: "button", class: "linkbtn", text: "Undo", onclick: async () => {
      set(await answer(card.line, card.index, before ? before.a : "", before ? before.note : ""));
      if (before && fig) set(await worth(card.line, card.index, before.amount == null ? "" : before.amount, before.per || ""));
      heardIn.value = said;
      put(heardSay, h("span", { text: `Undone: ${card.q.q}` }));
      moved();
      drawHeard();
      heardIn.focus({ preventScroll: true });
    } });
    put(heardSay, h("span", { text: `Filed as ${WS.ANSWERS[k].label.toLowerCase()}${fig ? `, with ${WS.worthText(fig)} as the figure` : ""}: ${card.q.q} ` }), undo);
    moved();
    heardIn.focus({ preventScroll: true });
  };
  // the qualification questions are heard too: the deal is talked about in the same meeting
  const DEAL_TONE = { known: "good", partly: "mid", unknown: "unknown" };
  const DEAL_FROM = { solved: "known", partly: "partly", gap: "unknown", unknown: "unknown" };
  const dealCards = QD.DEAL.map((x) => ({ key: `deal#${x.id}`, id: x.id, label: `Qualify the deal, ${x.tag.toLowerCase()}`, q: x, deal: true }));
  const fileDeal = async (card, k, said) => {
    const before = get().deal && get().deal[card.id];
    set(await setDeal(card.id, k, HEARD.joinNote(before && before.note, said)));
    heardIn.value = "";
    put(heardOut);
    const undo = h("button", { type: "button", class: "linkbtn", text: "Undo", onclick: async () => {
      set(await setDeal(card.id, before ? before.a : "", before ? before.note : ""));
      heardIn.value = said;
      put(heardSay, h("span", { text: `Undone: ${card.q.q}` }));
      onFiled(null);
      drawHeard();
      heardIn.focus({ preventScroll: true });
    } });
    put(heardSay, h("span", { text: `Filed in Qualify the deal as ${QD.STATES[k].label.toLowerCase()}: ${card.q.q} ` }), undo);
    onFiled(null);
    heardIn.focus({ preventScroll: true });
  };
  const dealHit = (card, said) => {
    const before = get().deal && get().deal[card.id], sug = DEAL_FROM[DECK.suggest(card.q, said)] || null;
    return h("div", { class: "heardhit" },
      h("small", { class: "muted", text: card.label + (before ? `, ${QD.STATES[before.a].label.toLowerCase()}` : "") }),
      h("span", { class: "heardq", text: card.q.q }),
      h("div", { class: "heardopts", role: "group", "aria-label": `File it under: ${card.q.q}` },
        ["known", "partly", "unknown"].map((k) => h("button", { type: "button", class: `heardopt t-${DEAL_TONE[k]}` + (k === sug ? " sug" : ""), text: QD.STATES[k].label,
          "aria-describedby": k === sug ? `${id}-sug` : null, onclick: () => fileDeal(card, k, said) }))));
  };
  // a concern the line expects, said as the customer says it: what to ask first, the answer, the proof; a tap marks it
  const fileConcern = async (card, on) => {
    set(await raise(card.line, card.index, on));
    const undo = on ? h("button", { type: "button", class: "linkbtn", text: "Undo", onclick: () => fileConcern(card, false) }) : null;
    put(heardSay, h("span", { text: on ? `Marked as raised: “${card.o.says}” It goes to the customer readout and into the proof of value. ` : `No longer marked as raised: “${card.o.says}”` }), undo);
    onFiled(null);
    drawHeard();
    heardIn.focus({ preventScroll: true });
  };
  const concernHit = (card) => {
    const raised = (get().raised || []).includes(`${card.line}#${card.index}`);
    return h("div", { class: "heardhit heardconcern" },
      h("small", { class: "muted", text: `A concern to expect on ${card.label.toLowerCase()}${raised ? ", marked as raised" : ""}` }),
      h("span", { class: "heardq", text: `“${card.o.says}”` }),
      h("dl", { class: "objdl" }, h("dt", { text: "Ask first" }), h("dd", { text: card.o.clarify }), h("dt", { text: "Answer" }), h("dd", { text: card.o.answer }),
        h("dt", { text: "Prove it" }), h("dd", { text: card.o.prove })),
      raise && !raised ? h("div", { class: "heardopts" }, h("button", { type: "button", class: "heardopt t-mid", text: "Mark it raised",
        "aria-label": `Mark it raised: ${card.o.says}`, onclick: () => fileConcern(card, true) })) : null);
  };
  const drawHeard = () => {
    const said = heardIn.value.trim();
    if (said.length < 6) { put(heardOut); return; }
    const hits = HEARD.match([...DECK.deckFrom(catalog, get().scope), ...dealCards], said, 3);
    const concern = HEARD.concernsHeard(HEARD.concernCards(catalog, get().scope), said)[0];
    if (!hits.length && !concern) { put(heardOut, h("p", { class: "note", text: "No question in scope uses these words. Try the words of the question, or write it on the card." })); return; }
    put(heardOut, concern ? concernHit(concern.card) : null, hits.map(({ card }) => {
      if (card.deal) return dealHit(card, said);
      const sug = DECK.suggest(card.q, said), before = get().answers[card.key];
      const fig = card.q.stage === "value" ? HEARD.figureIn(said, card.q) : null;
      return h("div", { class: "heardhit" },
        h("small", { class: "muted", text: card.label + (before ? `, answered ${WS.ANSWERS[before.a].label.toLowerCase()}` : "") }),
        h("span", { class: "heardq", text: card.q.q }),
        fig ? h("small", { class: "heardfig", text: `Figure heard: ${WS.worthText(fig)}. It goes with the answer.` }) : null,
        h("div", { class: "heardopts", role: "group", "aria-label": `File it under: ${card.q.q}` },
          DECK.ORDER.map((k) => h("button", { type: "button", class: `heardopt o-${k}` + (k === sug ? " sug" : ""), text: WS.ANSWERS[k].label,
            "aria-describedby": k === sug ? `${id}-sug` : null, onclick: () => fileHeard(card, k, said) }))));
    }), h("span", { id: `${id}-sug`, class: "sr-only", text: "Suggested by the words" }));
  };
  heardIn.addEventListener("input", drawHeard);
  // on a keyboard, Ctrl+Enter files it under the first match, with the answer the words suggest
  heardIn.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const firstQ = heardOut.querySelector(".heardhit:not(.heardconcern)");          // a concern is marked by its own button
    const first = firstQ && firstQ.querySelector(".heardopt.sug");
    if (first) first.click();
    else if (heardIn.value.trim()) put(heardSay, h("span", { text: "Nothing is suggested for the first match: tap the answer that fits." }));
  });
  const heardBox = h("div", { class: "heard" },
    h("label", { for: id, class: "decklabel", text: "Heard something else? Write it as it was said" }), heardIn, heardOut, heardSay);
  return { el: heardBox };
}

/** The deck on the whole screen. `aside`, when given, is lent to it under the cards (heard something) and given back on close. */
/** The meeting clock of a workshop, as kept in this browser tab, or null. */
function clockOf(id) {
  try { const c = JSON.parse(sessionStorage.getItem(`beyond90.clock.${id}`) || "null"); return PACE.validClock(c) ? c : null; } catch { return null; }
}

/** A small clock for a deck's header: the time left on the meeting clock, kept up to date while it is on the page. */
function miniClock(id) {
  const m = h("span", { class: "deckmini" });
  const tick = () => {
    const c = clockOf(id);
    if (!c) { m.textContent = ""; return; }
    const r = PACE.reading(c, Date.now());
    m.textContent = `${PACE.mmss(r.left)} ${r.left >= 0 ? "left" : "over"}`;
  };
  tick();
  const t = setInterval(() => { if (!m.isConnected && m.dataset.seen) { clearInterval(t); return; } if (m.isConnected) m.dataset.seen = "1"; tick(); }, 1000);
  return m;
}

function openDeck({ clock, onClose, aside = null, asideTitle = "", ...rest }) {
  const dlg = h("dialog", { class: "deck", "aria-labelledby": "deck-title" });
  const pane = deckPane({ ...rest, pfx: "deck", inline: false, clock, onDone: () => dlg.close() });
  dlg.append(pane.el);
  const home = aside ? { parent: aside.parentNode, next: aside.nextSibling } : null;
  if (aside) dlg.append(h("details", { class: "deckaside" }, h("summary", { text: asideTitle }), aside));
  dlg.addEventListener("close", () => {
    if (home && home.parent) home.parent.insertBefore(aside, home.next);
    dlg.remove();
    onClose();
  });
  document.body.append(dlg);
  dlg.showModal();
  pane.draw(true);
  return pane;
}

const wsFilter = { core: false, roles: [], tender: false, open: false, best: false };

export function workshopView({ workshop: w, catalog, list, answer, worth, setDeal, raise, rename, preparedBy, setScope, inventory, sizing, waves, gpu, dr, obj, edge, unit, today, newWorkshop, openWorkshop, removeWorkshop, presets = [], go, focus }) {
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
  // the lines in scope, in one line; the whole choice opens on demand (it is long, and set once)
  const inScope = w.scope.filter((p) => catalog.lines[p]).map((p) => catalog.lines[p].label);
  const scopeBox = h("details", { class: "wsscopebox", open: inScope.length ? null : "" },
    h("summary", {}, h("span", { class: "wsfamname", text: "Lines in scope" }), h("span", { class: "wsscopenow", text: inScope.length ? inScope.join(", ") : "none yet" }),
      h("span", { class: "linkbtn wsscopechange", text: "Change them" })),
    scopeRow);
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
    scopeBox, h("p", { class: "note", text: "In the meeting: the keys 1 to 4 answer the selected question (Solved, Partly, A real gap, Nobody knows) and select the next one. Open a question for why it matters, how to ask it, and what they said." }), say),
  { sub: "Choose the product lines in scope, then record what the customer says to each question. Nothing leaves this browser; it is sealed when you set a passphrase." });

  // progress, kept current as answers come in
  const prog = h("div", { class: "wsprog" });
  const drawProg = () => {
    const res = WS.assess(catalog, cur);
    put(prog, h("span", { text: `${res.answered} of ${res.total} questions answered` }), h("span", { class: "ebar wsbar" }, h("i", { class: "er", style: `width:${(res.coverage * 100).toFixed(1)}%` })),
      h("button", { class: "btn", type: "button", text: "See the journey", onclick: () => go("journey") }));
  };
  drawProg();

  // the tender's requirements that touch each question: the demand to bring to it, and the answers the bid rests on
  const asks = RFP.tenderAsks(catalog, cur);
  // one question open at a time, for what goes with it: why it matters, how to ask it, what they said
  const TONE = { solved: "good", partly: "mid", gap: "bad", unknown: "unknown" };
  const uiq = { open: "" };
  const drawers = new Map();
  const heads = [];
  const toggle = (key) => {
    const prev = uiq.open;
    uiq.open = prev === key ? "" : key;
    if (prev && drawers.has(prev)) drawers.get(prev)();
    if (uiq.open) drawers.get(uiq.open)();
    const b = document.querySelector(`.wsq[data-key="${CSS.escape(key)}"] .wsqhead`);
    if (b) b.focus();
  };
  const lines = cur.scope.filter((p) => catalog.lines[p]).map((p, li) => {
    const line = catalog.lines[p];
    const head = h("span", { class: "wshead" });
    const drawHead = () => {
      const st = WS.lineState(catalog, p, cur.answers);
      put(head, h("b", { text: line.label }), h("span", { class: "muted", text: `${st.answered} of ${st.total}` }),
        st.answered ? h("span", { class: "wspain " + (st.pain >= 0.6 ? "hi" : st.pain >= 0.35 ? "mid" : "lo"), text: `${painPct(st.pain)} missing` }) : null);
    };
    drawHead();
    heads.push(drawHead);
    const items = WS.displayOrder(line).map(({ q, index: i }) => {
      const key = `${p}#${i}`;
      const asked = asks.get(key) || [];
      const li = h("li", { class: "wsq", "data-key": key, "data-role": q.role || "", "data-core": q.core ? "1" : "", "data-tender": asked.length ? "1" : "" });
      li.hidden = !WS.inMeeting(q, wsFilter) || (wsFilter.tender && !asked.length) || (wsFilter.open && !!cur.answers[key]);
      const tenderNote = asked.length ? h("small", { class: "wsfact", text: `The tender asks${asked.length > 1 ? ` (${asked.length} requirements)` : ""}: ${asked[0].ref ? `${asked[0].ref}: ` : ""}${asked[0].text.length > 160 ? asked[0].text.slice(0, 159) + "…" : asked[0].text}` }) : null;
      // how to ask it: what a strong or a worrying answer sounds like, and the question that goes one level deeper
      const howTo = () => (q.listen || q.probe ? h("details", { class: "wshow" }, h("summary", { text: "How to ask it" }),
        h("dl", { class: "objdl" }, q.listen ? [h("dt", { text: "Listen for" }), h("dd", { text: q.listen })] : null, q.probe ? [h("dt", { text: "Then ask" }), h("dd", { text: q.probe })] : null)) : null);
      const draw = () => {
        const ans = cur.answers[key];
        const open = uiq.open === key;
        li.classList.toggle("open", open);
        li.dataset.answered = ans ? "1" : "";
        const note = h("input", { type: "text", class: "wsnote", maxlength: 300, value: ans ? ans.note : "", placeholder: "What they said, in a few words", "aria-label": `Note for: ${q.q}` });
        note.addEventListener("change", act(async () => { if (!cur.answers[key]) return; cur = await answer(p, i, cur.answers[key].a, note.value); }));
        const fact = WS.factFor(cur, p, i);
        put(li,
          h("div", { class: "wsqline" },
            h("button", { type: "button", class: "wsqhead", "aria-expanded": String(open), onclick: () => toggle(key) },
              h("i", { class: `qldot t-${ans ? TONE[ans.a] : "open"}`, "aria-hidden": "true" }),
              h("span", { class: "wsqq", text: q.q }),
              q.core ? h("span", { class: "wscore", text: "Essential" }) : null,
              asked.length ? h("span", { class: "wsasks rfpasks", text: "in the tender" }) : null),
            h("div", { class: "wsans", role: "group", "aria-label": `Answer to: ${q.q}` }, Object.entries(WS.ANSWERS).map(([k, v]) =>
              h("button", { type: "button", class: "wsopt o-" + k, "aria-pressed": String(!!ans && ans.a === k), text: v.label,
                onclick: act(async () => {
                  const again = ans && ans.a === k; cur = await answer(p, i, again ? "" : k, again ? "" : note.value); draw(); drawHead(); drawProg(); drawStrip(); syncDeck();
                  // opened, the answer leaves room for what they said; closed, the next question is the next thing to ask
                  if (uiq.open === key && !again) { const n = li.querySelector("input.wsnote"); if (n) { n.focus(); return; } }
                  let next = again ? null : li.nextElementSibling;
                  while (next && next.hidden) next = next.nextElementSibling;
                  (next ? next.querySelector(".wsopt") : li.querySelector(`.o-${k}`)).focus();
                }) })))),
          // closed: what they said, or what their inventory already tells
          !open && ans && (ans.note || ans.amount != null) ? h("p", { class: "wsqsaid", text: [ans.note ? `“${ans.note}”` : "", ans.amount != null ? `${num(ans.amount)} per ${ans.per || "day"}` : ""].filter(Boolean).join(", ") })
            : !open && fact ? h("p", { class: "wsqsaid wsfact", text: "From their inventory: " + fact }) : null,
          open ? h("div", { class: "wsqmore" },
            h("div", { class: "wstags" }, h("span", { class: "wsstage s-" + q.stage, text: STAGE_TAG[q.stage] || q.stage }), q.role ? h("span", { class: "wsrole", text: "Ask: " + WS.ROLE_WORDS[q.role].toLowerCase() }) : null),
            q.why ? h("small", { class: "muted", text: q.why }) : null,
            fact ? h("small", { class: "wsfact", text: "From their inventory: " + fact }) : null, tenderNote, howTo(),
            ans ? note : h("small", { class: "muted", text: "Answer it to note what they said." }),
            ans && q.stage === "value" ? worthRow(ans) : null) : null);
      };
      drawers.set(key, draw);
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
      // keys 1 to 4 answer the question that has the focus (and do not switch views, as digits do elsewhere); Escape closes it
      li.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && uiq.open === key) { e.preventDefault(); toggle(key); return; }
        if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === "INPUT" || !/^[1-4]$/.test(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        li.querySelectorAll(".wsopt")[Number(e.key) - 1].click();
      });
      return li;
    });
    const st = WS.lineState(catalog, p, cur.answers);
    return h("details", { class: "card wsline", id: "ws-" + p, open: focus === p || (!focus && (li === 0 || (st.answered > 0 && st.answered < st.total))) ? "" : null }, h("summary", {}, head), h("ol", { class: "wslist" }, items));
  });
  // every line at a glance: a dot per question, coloured by its answer; a tile opens its line
  const strip = h("div", { class: "qlstrip wsstrip", role: "group", "aria-label": "Lines in scope" });
  const drawStrip = () => {
    put(strip, cur.scope.filter((p) => catalog.lines[p]).map((p) => {
      const line = catalog.lines[p];
      const order = WS.displayOrder(line);
      const done = order.filter(({ index: i }) => cur.answers[`${p}#${i}`]).length;
      return h("button", { type: "button", class: "qlgroup", "aria-label": `${line.label}: ${done} of ${order.length} answered. Open it`,
        onclick: () => { const d = document.getElementById("ws-" + p); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } } },
      h("span", { class: "qlglabel", text: line.label }),
      h("span", { class: "qldots", "aria-hidden": "true" }, order.map(({ index: i }) => { const a = cur.answers[`${p}#${i}`]; return h("i", { class: `qldot t-${a ? TONE[a.a] : "open"}` }); })),
      h("small", { class: "muted", text: `${done} of ${order.length}` }));
    }));
  };
  drawStrip();
  if (focus) requestAnimationFrame(() => { const el = document.getElementById("ws-" + focus); if (el) el.scrollIntoView({ block: "start" }); });
  // narrow the questions to this meeting: the essential ones for a first call, or those for the people in the room
  const shown = h("span", { class: "muted", role: "status" });
  const apply = () => {
    let n = 0, all = 0;
    for (const li of document.querySelectorAll(".wslist .wsq")) {
      const on = (!wsFilter.core || li.dataset.core === "1") && (!wsFilter.roles.length || wsFilter.roles.includes(li.dataset.role)) && (!wsFilter.tender || li.dataset.tender === "1")
        && (!wsFilter.open || li.dataset.answered !== "1");
      li.hidden = !on; all++; if (on) n++;
    }
    shown.textContent = n === all ? `All ${all} questions shown.` : `${n} of ${all} questions shown.`;
  };
  const essential = h("button", { type: "button", class: "kindchip", "aria-pressed": String(wsFilter.core), text: "Essential questions only",
    "data-tip": "The few questions not to leave a first meeting without, on each line.",
    onclick: () => { wsFilter.core = !wsFilter.core; essential.setAttribute("aria-pressed", String(wsFilter.core)); apply(); rebuildDeck(); } });
  const notYet = h("button", { type: "button", class: "kindchip", "aria-pressed": String(wsFilter.open), text: "Not answered yet",
    "data-tip": "Only the questions with no answer yet: what is left to ask.",
    onclick: () => { wsFilter.open = !wsFilter.open; notYet.setAttribute("aria-pressed", String(wsFilter.open)); apply(); rebuildDeck(); } });
  const fromTender = h("button", { type: "button", class: "kindchip", "aria-pressed": String(wsFilter.tender), text: "Asked by the tender",
    "data-tip": "Only the questions a requirement of the tender touches: what to understand before answering it.",
    onclick: () => { wsFilter.tender = !wsFilter.tender; fromTender.setAttribute("aria-pressed", String(wsFilter.tender)); apply(); rebuildDeck(); } });
  const bestFirst = h("button", { type: "button", class: "kindchip", "aria-pressed": String(wsFilter.best), text: "Most useful first",
    "data-tip": "The card asks the essential questions first, on the lines you know least or have not touched yet, and says why. The list keeps its order.",
    onclick: () => { wsFilter.best = !wsFilter.best; bestFirst.setAttribute("aria-pressed", String(wsFilter.best)); rebuildDeck(); } });
  const used = Object.keys(WS.ROLE_WORDS).filter((r) => cur.scope.some((p) => catalog.lines[p] && catalog.lines[p].questions.some((q) => q.role === r)));
  const roleChips = used.map((r) => {
    const b = h("button", { type: "button", class: "kindchip", "aria-pressed": String(wsFilter.roles.includes(r)), text: WS.ROLE_WORDS[r],
      onclick: () => { wsFilter.roles = wsFilter.roles.includes(r) ? wsFilter.roles.filter((x) => x !== r) : [...wsFilter.roles, r]; b.setAttribute("aria-pressed", String(wsFilter.roles.includes(r))); apply(); rebuildDeck(); } });
    return b;
  });
  const slug = (cur.customer || "customer").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  const narrow = used.length ? h("div", { class: "card wsnarrow" }, h("h2", { class: "sr-only", text: "Narrow the questions" }),
    h("div", { class: "wsfam", role: "group", "aria-label": "Which questions to show" }, h("span", { class: "wsfamname", text: "This meeting" }), essential, notYet, asks.size ? fromTender : null, inScope.length ? bestFirst : null),
    h("div", { class: "wsfam", role: "group", "aria-label": "Who is in the room" }, h("span", { class: "wsfamname", text: "Who is in the room" }), roleChips),
    h("div", { class: "btnrow" }, shown,
      h("button", { class: "btn small", type: "button", text: "Copy the question guide", onclick: (ev) => copyText(WS.questionGuide(catalog, cur, wsFilter)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Question guide (.md)", onclick: () => saveBlob(WS.questionGuide(catalog, cur, wsFilter), `${slug}-questions.md`, "text/markdown") }))) : null;
  requestAnimationFrame(apply);
  // the meeting's clock: kept in this tab, not in the workshop; the pace is on the essential questions in scope
  const clockKey = `beyond90.clock.${cur.id}`;
  const keepClock = (c) => { try { if (c) sessionStorage.setItem(clockKey, JSON.stringify(c)); else sessionStorage.removeItem(clockKey); } catch { /* the clock just does not outlive the page */ } };
  let meetingClock = clockOf(cur.id);
  const essentialCards = inScope.length ? DECK.deckFrom(catalog, cur.scope, (key, q) => !!q.core) : [];
  const miniClocks = new Set();
  const makeMini = () => { const m = h("span", { class: "deckmini" }); miniClocks.add(m); return m; };
  const clockBox = h("div", { class: "meetclock" });
  const clockTime = h("span", { class: "clocktime" });
  const paceFill = h("i", { class: "pacefill" }), paceTick = h("i", { class: "pacetick" });
  const paceLine = h("p", { class: "paceline" });
  const paceAct = h("div", { class: "paceact" });
  let paceShown = "";
  const paceNow = () => {
    if (!meetingClock) return;
    const r = PACE.reading(meetingClock, Date.now());
    const t = `${PACE.mmss(r.left)} ${r.left >= 0 ? "left" : "over"}`;
    clockTime.textContent = t;
    for (const m of miniClocks) { if (m.isConnected) m.textContent = t; else miniClocks.delete(m); }
    const p = PACE.pace(meetingClock, r.elapsed, essentialCards.length, essentialCards.filter((c) => cur.answers[c.key]).length);
    paceFill.style.setProperty("--w", `${(p.share * 100).toFixed(1)}%`);
    paceTick.style.setProperty("--at", `${(p.timeShare * 100).toFixed(1)}%`);
    const shown = `${p.line}|${wsFilter.core}`;
    if (shown === paceShown) return;
    paceShown = shown;
    paceLine.textContent = p.line;
    paceLine.className = `paceline t-${p.state}`;
    put(paceAct, p.state === "behind" && !wsFilter.core
      ? h("button", { class: "btn", type: "button", text: "Ask only the essentials", onclick: () => { essential.click(); paceNow(); } }) : null);
  };
  const drawClock = () => {
    paceShown = "";
    if (!meetingClock) {
      for (const m of miniClocks) m.textContent = "";
      put(clockBox, h("span", { class: "decklabel", text: "Meeting clock" }),
        h("div", { class: "clockstart", role: "group", "aria-label": "Start the meeting clock" }, PACE.LENGTHS.map((m) => h("button", { type: "button", class: "btn", text: `${m} min`,
          "aria-label": `Start a ${m} minute meeting`, onclick: () => { meetingClock = { start: Date.now(), minutes: m }; keepClock(meetingClock); drawClock(); } }))),
        h("p", { class: "note", text: "Keeps the time and says whether the essential questions still fit. It stays in this browser tab, not in the workshop." }));
      return;
    }
    put(clockBox, h("div", { class: "clockhead" }, h("span", { class: "decklabel", text: `Meeting clock, ${meetingClock.minutes} minutes` }),
      h("button", { type: "button", class: "linkbtn", text: "Stop", onclick: () => { meetingClock = null; keepClock(null); drawClock(); } })),
    clockTime, h("span", { class: "pacebar", "aria-hidden": "true" }, paceFill, paceTick), paceLine, paceAct);
    paceNow();
  };
  const clockTimer = setInterval(() => { if (!clockBox.isConnected) { clearInterval(clockTimer); return; } paceNow(); }, 1000);
  drawClock();
  // one question at a time, at the top: the questions shown, as a deck; Full screen opens the same deck on the whole screen
  const deckState = { at: 0, drafts: new Map() };
  const deckBox = h("div", { class: "deckslot" });
  let deckInline = null, fullDeck = null;
  const afterDeck = (key) => { if (drawers.has(key)) drawers.get(key)(); for (const f of heads) f(); drawProg(); drawStrip(); paceNow(); };
  const deckAnswer = async (c, a, note) => { cur = await answer(c.line, c.index, a, note); return cur; };
  function rebuildDeck() {
    const keep = (key, q) => WS.inMeeting(q, wsFilter) && (!wsFilter.tender || (asks.get(key) || []).length > 0) && (!wsFilter.open || !cur.answers[key]);
    let cards = DECK.deckFrom(catalog, cur.scope, keep);
    if (wsFilter.best && cards.length) { const b = DECK.bestFirst(cards, cur.answers); cards = b.cards.map((c) => ({ ...c, why: b.why[c.key] || [] })); }
    if (!cards.length) { deckInline = null; put(deckBox, h("p", { class: "note decknone", text: "No question is shown with these filters: clear one to ask them here, one at a time." })); return; }
    deckState.at = DECK.firstOpen(cards, cur.answers);       // most useful first puts the open ones first: the same rule
    const recapSet = { ...DISCOVERY_DECK, recapSubject: `Discovery recap: ${cur.customer}`,
      recap: (all, answerOf) => DECK.recapText(cur.customer, all, Object.fromEntries(all.filter((c) => answerOf(c)).map((c) => [c.key, answerOf(c)]))) };
    const same = { cards, state: deckState, set: recapSet, answerOf: (c) => cur.answers[c.key], answer: deckAnswer, go, clock: makeMini, onAnswered: afterDeck };
    const pane = deckPane({ ...same, pfx: "wsdeck", inline: true, onFull: () => {
      fullDeck = openDeck({ ...same, aside: heardBox, asideTitle: "Heard something else?", onClose: () => { fullDeck = null; pane.draw(false); } });
    } });
    deckInline = pane;
    put(deckBox, pane.el);
    pane.draw(false);
  }
  function syncDeck() { if (deckInline) deckInline.sync(); paceNow(); }
  if (inScope.length) rebuildDeck();
  const heardBox = heardPanel({ catalog, get: () => cur, set: (x) => { cur = x; }, answer, worth, setDeal, raise,
    onFiled: (key) => { if (key) afterDeck(key); syncDeck(); if (fullDeck) fullDeck.sync(); } }).el;
  // the conversation first: where it stands on every line, what to show, the questions; then the sketches from their numbers
  const sketches = [inventory ? inventoryCard(w, inventory) : null, w.inventory && sizing ? sizingCard(w, sizing) : null,
    w.inventory && waves ? wavesCard(w, waves, today) : null, w.scope.includes("private-ai") && gpu ? gpuCard(w, gpu) : null,
    w.scope.includes("dr-backup") && dr ? drCard(w, dr) : null, w.scope.includes("object-storage") && obj ? objCard(w, obj) : null,
    w.scope.includes("edge-sites") && edge ? edgeCard(w, edge) : null, w.scope.some((p) => WS.UNIT_LINES.includes(p)) && unit ? unitCard(w, unit) : null].filter(Boolean);
  // with lines chosen, the next question comes first, beside where every line stands; the meeting's settings follow
  const top = inScope.length
    ? [h("div", { class: "card deckpanel" }, deckBox, h("div", { class: "deckside" }, clockBox, heardBox, prog, strip,
      h("p", { class: "note", text: "Swipe the card or tap an answer, and write what they said on it: it is kept with the answer. Something said out of turn goes in Heard something: it finds the question it answers, and Ctrl+Enter files it under the first one as suggested. Every question is also in the list below, with the same answers; the filters there shape the deck." }))), meeting]
    : [meeting, h("div", { class: "card wsprogcard" }, prog, strip)];
  return h("div", {}, top, narrow, lines,
    sketches.length ? h("h2", { class: "wssketchhead", text: "Sketches from their numbers" }) : null, sketches);
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

/** A first design for edge and branch sites: servers per kind of site, the witness, copies over each link, upgrade waves. */
function edgeCard(w, edge) {
  const a = EDGE.cleanEdge(w.edge || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const top = [["vms_per_server", "Machines one server carries"], ["link_use_pct", "Share of each link the copies may use (%)"], ["window_h", "Hours a night for the copies"],
    ["wave_size", "Sites upgraded together after the pilot"], ["waves_per_week", "Upgrade waves a week"], ["visits_year", "Trips to sites a year today (0: not counted)"], ["visit_cost", "Cost of one trip"]];
  const cols = [["sites", "sites"], ["vms", "machines a site"], ["data_tib", "data a site (TiB)"], ["change_pct", "written a day (%)"], ["link_mbps", "link (Mbit/s)"]];
  const inputs = {}, kindIn = [];
  const current = () => {
    const v = { kinds: kindIn.map((r) => ({ name: r.name.value, servers_min: Number(r.servers_min.value), ...Object.fromEntries(cols.map(([k]) => [k, Number(r[k].value)])) })) };
    for (const [k] of top) v[k] = Number(inputs[k].value);
    return EDGE.cleanEdge(v);
  };
  const draw = (settings) => {
    const sk = EDGE.edgeSketch(settings);
    if (!sk.ok) { put(out, h("p", { class: "note", text: sk.error })); return; }
    put(out,
      h("div", { class: "szhead" }, h("b", { text: INV.fmt(sk.servers) }), h("span", {}, h("strong", { text: "servers" }),
        h("small", { text: `at ${INV.fmt(sk.sites)} sites in ${sk.kinds.length} standard design${sk.kinds.length === 1 ? "" : "s"}${sk.witness_sites ? `, a witness for ${INV.fmt(sk.witness_sites)} two-server sites` : ""}; every site upgraded in about ${INV.fmt(sk.weeks)} week${sk.weeks === 1 ? "" : "s"}` }))),
      h("div", { class: "tablewrap" }, h("table", { class: "drtable edgetable" },
        h("thead", {}, h("tr", {}, ["Kind", "Sites", "Servers a site", "Servers in all", "If a server fails", "Daily copy to the core", "Whole site over the link"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, sk.kinds.map((k) => h("tr", {}, h("td", { text: k.name }), h("td", { text: INV.fmt(k.sites) }), h("td", { text: String(k.servers_each) }), h("td", { text: INV.fmt(k.servers) }),
          h("td", { text: k.tolerance }), h("td", {}, h("span", { text: EDGE.edgeHours(k.copy_h) }), k.copy_fits ? null : h("small", { class: "neg drwhy", text: "Does not fit the night." })),
          h("td", { text: EDGE.edgeHours(k.restore_h) })))))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Whatever the product" }), h("ul", {}, EDGE.edgeNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); try { await edge(v); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  const field = (el, label) => { el.addEventListener("change", save); return h("label", { class: "szf" }, h("span", { text: label }), el); };
  const grid = h("div", { class: "szgrid" }, top.map(([k, label]) => field(inputs[k] = h("input", { type: "number", step: "any", min: "0", value: String(a[k]), "aria-label": label }), label)));
  const kinds = a.kinds.map((t, i) => {
    const row = { name: h("input", { type: "text", maxlength: EDGE.NAME_MAX, value: t.name, "aria-label": `Kind ${i + 1}: name` }),
      servers_min: h("select", { "aria-label": `Kind ${i + 1}: if a server fails` }, Object.entries(EDGE.TOLERANCE).map(([v, label]) => h("option", { value: v, text: `${v === "1" ? "One server" : `${v} servers`} at least: ${label}` }))) };
    row.servers_min.value = String(t.servers_min);
    for (const [k, label] of cols) row[k] = h("input", { type: "number", step: "any", min: "0", value: String(t[k]), "aria-label": `Kind ${i + 1}: ${label}` });
    kindIn.push(row);
    return h("fieldset", { class: "vcgroup edgekind" }, h("legend", { text: `Kind ${i + 1}` }),
      h("div", { class: "szgrid" }, field(row.name, "Name"), ...cols.map(([k, label]) => field(row[k], cap(label))), field(row.servers_min, "If a server fails")));
  });
  draw(a);
  return card("A first edge design", h("div", { class: "sz" }, out, h("details", { class: "szassume" }, h("summary", { text: "The kinds of site, the links and the upgrade pace, to agree with the customer" }), h("div", { class: "vcgroups" }, kinds), grid,
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Back to the defaults", onclick: async () => {
      for (const [k] of top) inputs[k].value = String(EDGE.EDGE_DEFAULTS[k]);
      kindIn.forEach((row, i) => { const d = EDGE.EDGE_DEFAULTS.kinds[i]; row.name.value = d.name; row.servers_min.value = String(d.servers_min); for (const [k] of cols) row[k].value = String(d[k]); });
      draw(EDGE.EDGE_DEFAULTS);
      try { await edge(null); } catch (e) { say.textContent = e.message; }
    } }))), say),
  { sub: "Three or four standard kinds of site: the servers each needs for its load and the failure it must ride through, the witness, whether the nightly copy fits over each link, a restore over the link against a local one, and the upgrade waves. The product's own sizing tool has the last word." });
}

/** What one machine costs a month, all in, in the customer's figures; idle machines, a public cloud and a tenant beside it. */
function unitCard(w, unit) {
  const a = UNIT.cleanUnit(w.unit || {});
  const say = h("p", { class: "note", role: "status" });
  const out = h("div", { class: "szout" });
  const inputs = {};
  const current = () => { const v = {}; for (const [k, el] of Object.entries(inputs)) if (el.value !== "") v[k] = Number(el.value); return UNIT.cleanUnit(v); };
  const draw = (figures) => {
    const sk = UNIT.unitSketch(figures, w.inventory);
    if (!sk.ok) { put(out, h("p", { class: "note first", text: `${sk.error} Every figure stays in this browser.` })); copy.hidden = true; return; }
    copy.hidden = false;
    put(out,
      h("div", { class: "szhead" }, h("b", { text: UNIT.money(sk.month) }), h("span", {}, h("strong", { text: "a machine a month, all in" }),
        h("small", { text: `across ${UNIT.money(sk.machines)} machines${sk.used_month ? `; ${UNIT.money(sk.used_month)} for each one that really works` : ""}` }))),
      h("div", { class: "tablewrap" }, h("table", { class: "wvtable vctable" },
        h("thead", {}, h("tr", {}, ["Part", "A year", "A machine a month", "Share"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, sk.parts.map((p) => h("tr", {}, h("th", { scope: "row", text: p.label }), h("td", { class: "n", text: UNIT.money(p.year) }), h("td", { class: "n", text: UNIT.money(p.month) }), h("td", { class: "n", text: `${Math.round(p.share)}%` }))),
          h("tr", { class: "vctotal" }, h("th", { scope: "row", text: "Total" }), h("td", { class: "n", text: UNIT.money(sk.total) }), h("td", { class: "n", text: UNIT.money(sk.month) }), h("td", { class: "n", text: "100%" }))))),
      h("ol", { class: "szsteps" }, sk.steps.map((t) => h("li", { text: t }))),
      h("div", { class: "growproof" }, h("small", { text: "Before showing it" }), h("ul", {}, UNIT.unitNotes(sk).map((t) => h("li", { text: t })))));
  };
  const save = async () => { const v = current(); draw(v); const any = Object.keys(v).some((k) => k !== "hardware_years" || v[k] !== UNIT.UNIT_DEFAULTS.hardware_years); try { await unit(any ? v : null); say.textContent = ""; } catch (e) { say.textContent = e.message; } };
  // outside what is redrawn, so a change made by leaving a field never takes it away mid-click
  const copy = h("button", { class: "btn small", type: "button", text: "Copy for finance", hidden: true,
    onclick: (ev) => copyText(UNIT.unitMarkdown(UNIT.unitSketch(current(), w.inventory))).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) });
  const groups = UNIT.FIELDS.map((g) => h("fieldset", { class: "vcgroup" }, h("legend", { text: g.group }),
    g.fields.map(([k, label, u]) => {
      inputs[k] = h("input", { type: "number", step: "any", min: "0", value: a[k] == null ? "" : String(a[k]), "aria-label": label, placeholder: "—" });
      inputs[k].addEventListener("change", save);
      return h("label", { class: "szf" }, h("span", { text: `${label} (${u})` }), inputs[k]);
    })));
  draw(a);
  return card("What one machine costs", h("div", { class: "sz" }, out, h("div", { class: "btnrow" }, copy),
    h("details", { class: "szassume" }, h("summary", { text: "The figures, as the customer and finance gave them" }), h("div", { class: "vcgroups" }, groups)), say),
  { sub: "Hardware written off, licences, support, power, space and people, divided among the machines they run: the number behind \"the cloud is cheaper\", showback per team and a provider's price per tenant. In the customer's own figures; not a quote." });
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
// ------------------------------------------------------------------ partners on the deal: who brings it, who does what
export function partnersView({ workshop: w, catalog, today, setChannel }) {
  let cur = w;
  const lines = cur.scope.filter((p) => catalog.lines[p]);
  const fromStored = (c) => ({ partners: (c ? c.partners : []).map((p) => ({ name: p.name, kind: p.kind, lead: !!p.lead, reg: p.reg ? { ...p.reg } : null, skills: [...(p.skills || [])] })),
    route: c && c.route ? c.route : "", split: { ...(c && c.split ? c.split : {}) } });
  const state = fromStored(cur.channel);
  const say = h("p", { class: "note", role: "status" });
  const editor = h("div", { class: "ptlist" });
  const derived = h("div", {});
  const save = async () => {
    const draft = { partners: state.partners.map((p) => ({ name: p.name, kind: p.kind, ...(p.lead ? { lead: true } : {}), ...(p.reg && p.reg.on && p.reg.until ? { reg: p.reg } : {}), skills: p.skills })),
      route: state.route, split: state.split };
    try { cur = await setChannel(PT.cleanChannel(draft)); say.textContent = ""; } catch (e) { say.textContent = e.message; }
    drawDerived();
  };
  const drawEditor = () => {
    put(editor, state.partners.length ? state.partners.map((p, i) => {
      const name = h("input", { type: "text", maxlength: 80, value: p.name, placeholder: "Partner's company name", "aria-label": `Partner ${i + 1}: name` });
      name.addEventListener("change", () => { p.name = name.value; save(); });
      const kind = h("select", { "aria-label": `Partner ${i + 1}: kind` }, Object.entries(PT.KINDS).map(([k, v]) => h("option", { value: k, text: v, selected: k === p.kind })));
      kind.addEventListener("change", () => { p.kind = kind.value; save(); });
      const on = h("input", { type: "date", value: p.reg ? p.reg.on : "", "aria-label": `Partner ${i + 1}: registered on` });
      const until = h("input", { type: "date", value: p.reg ? p.reg.until : "", "aria-label": `Partner ${i + 1}: registration until` });
      const reg = () => { p.reg = on.value && until.value ? { on: on.value, until: until.value } : null; if (on.value && until.value && until.value < on.value) say.textContent = "The registration cannot end before it starts."; save(); };
      on.addEventListener("change", reg); until.addEventListener("change", reg);
      const lead = h("button", { type: "button", class: "kindchip", "aria-pressed": String(p.lead), text: p.lead ? "Leads the deal" : "Make lead",
        onclick: () => { state.partners.forEach((x, j) => { x.lead = j === i; }); drawEditor(); save(); } });
      const skills = h("div", { class: "wsfam", role: "group", "aria-label": `Partner ${i + 1}: lines it has skills on` }, h("span", { class: "wsfamname", text: "Skills on" }),
        lines.map((l) => h("button", { type: "button", class: "kindchip", "aria-pressed": String(p.skills.includes(l)), text: catalog.lines[l].label,
          onclick: (ev) => { p.skills = p.skills.includes(l) ? p.skills.filter((x) => x !== l) : [...p.skills, l]; ev.currentTarget.setAttribute("aria-pressed", String(p.skills.includes(l))); save(); } })));
      const remove = h("button", { type: "button", class: "btn small quiet", text: "Remove", "aria-label": `Remove partner ${i + 1}`,
        onclick: () => {
          state.partners.splice(i, 1);
          // who-does-what points at partners by position: drop the removed one, shift the ones after it
          for (const [k, v] of Object.entries(state.split)) {
            if (v === `p${i}`) delete state.split[k];
            else if (/^p[0-3]$/.test(v) && Number(v.slice(1)) > i) state.split[k] = `p${Number(v.slice(1)) - 1}`;
          }
          if (state.partners.length && !state.partners.some((x) => x.lead)) state.partners[0].lead = true;
          drawEditor(); save();
        } });
      return h("div", { class: "card ptcard" }, h("div", { class: "ptrow" }, h("label", {}, h("span", { text: "Name" }), name), h("label", {}, h("span", { text: "Kind" }), kind), lead),
        h("div", { class: "ptrow" }, h("label", {}, h("span", { text: "Deal registered on" }), on), h("label", {}, h("span", { text: "Until" }), until), remove), skills);
    }) : h("p", { class: "note first", text: "No partner yet. Most deals in the territory come through one: add the reseller, integrator, service provider or distributor working it." }));
  };
  const add = h("button", { type: "button", class: "btn small", text: "Add a partner", onclick: () => {
    if (state.partners.length >= PT.MAX_PARTNERS) { say.textContent = `At most ${PT.MAX_PARTNERS} partners on one deal.`; return; }
    state.partners.push({ name: "", kind: state.partners.length ? "distributor" : "reseller", lead: !state.partners.length, reg: null, skills: [] });
    drawEditor();
    const inputs = editor.querySelectorAll("input[type=text]");
    if (inputs.length) inputs[inputs.length - 1].focus();
  } });
  const route = h("select", { "aria-label": "Route to purchase" }, h("option", { value: "", text: "Not set yet" }), Object.entries(PT.ROUTES).map(([k, v]) => h("option", { value: k, text: v, selected: k === state.route })));
  route.addEventListener("change", () => { state.route = route.value; save(); });
  const words = h("input", { type: "checkbox", id: "ptwords" });
  const slug = cur.customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  const brief = () => PT.partnerBrief(catalog, cur, WS.assess(catalog, cur), { today, words: words.checked });
  function drawDerived() {
    const st = PT.channelState(catalog, cur, today);
    if (!st) { put(derived, h("p", { class: "note", text: "Name a partner to see who does what, the registration and what to settle." })); return; }
    const named = state.partners.map((p, i) => ({ v: `p${i}`, name: p.name.trim() })).filter((x) => x.name);
    const table = h("table", { class: "pttable" }, h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Step" }), h("th", { scope: "col", text: "Who does it" }))),
      h("tbody", {}, PT.ACTIVITIES.map((a) => {
        const sel = h("select", { "aria-label": `Who does: ${a.label}` }, h("option", { value: "", text: "Not agreed" }), h("option", { value: "us", text: "Us" }), h("option", { value: "both", text: "Together" }),
          named.map((x) => h("option", { value: x.v, text: x.name })));
        sel.value = state.split[a.id] || "";
        sel.addEventListener("change", () => { if (sel.value) state.split[a.id] = sel.value; else delete state.split[a.id]; save(); });
        return h("tr", {}, h("th", { scope: "row", text: a.label }), h("td", {}, sel));
      })));
    const regText = st.reg.status === "none" ? "No deal registration yet." : `Registered ${st.reg.on} to ${st.reg.until}: ${st.reg.status === "expired" ? "ran out" : `${st.reg.days} day${st.reg.days === 1 ? "" : "s"} left`}.`;
    put(derived,
      card("Who does what", h("div", {}, table, h("p", { class: "muted", text: `${st.lead.name} leads. ${regText}` })),
        { sub: "Agree it with the partner early: the steps nobody owns are the ones that slip." }),
      card("What to settle with the partners", st.warnings.length ? h("ul", { class: "growwhy ptwarn" }, st.warnings.map((x) => h("li", { class: x.level === "high" ? "high" : "" },
        x.level === "high" ? h("b", { text: "Now: " }) : null, x.text))) : h("p", { class: "note first", text: "Nothing to settle: registered, every key step owned, and the partners have the skills they are asked for." })));
  }
  drawEditor();
  drawDerived();
  return h("div", {},
    card("Partners on this deal", h("div", {}, editor, h("div", { class: "btnrow" }, add, h("label", { class: "ptroute" }, h("span", { text: "Route to purchase" }), route)), say),
      { sub: "Who brings the deal, who sells it with you, who will deliver it, and through which route the customer buys. Kept in this browser, with the workshop." }),
    derived,
    card("Share with the partners", h("div", {},
      h("p", { class: "note first", text: "The brief tells the partner on this deal who does what, where the customer stands, what would convince them and what is still open. The kit lets any partner's engineers run the same discovery: it holds no customer's data." }),
      h("label", { class: "ptcheck", for: "ptwords" }, words, " Include what the customer said, in their words"),
      h("div", { class: "btnrow" },
        h("button", { class: "btn small", type: "button", text: "Copy the brief", onclick: (ev) => copyText(brief()).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { class: "btn small", type: "button", text: "Brief for the partner (.md)", onclick: () => { const t = brief(); if (t) saveBlob(t, `${slug}-partner-brief.md`, "text/markdown"); else say.textContent = "Name a partner first."; } }),
        h("button", { class: "btn small", type: "button", text: "Discovery kit for partners (.md)", onclick: () => saveBlob(PT.enablementKit(catalog, lines), "discovery-kit-for-partners.md", "text/markdown") })))));
}

// ------------------------------------------------------------------ the way forward: from discovery to handover
const FW_STATE = { done: "Done", open: "Passed, with something left open", now: "Now", later: "Later" };
const DEMO_LENGTH = new Map();     // per workshop, the length of the demo meeting chosen on the way forward, while the page is open

export function forwardView({ workshop: w, catalog, povs, today, go, setDemo, setDemoSeen }) {
  const pov = DL.povFor(povs, w.customer);
  const f = FW.forward(catalog, w, pov, today);
  const say = h("p", { class: "note", role: "status" });
  const checkList = (ph) => h("ul", { class: "fwchecks" }, ph.checks.map((c) => h("li", { class: c.ok ? "ok" : "" },
    h("span", { class: "fwmark", "aria-hidden": "true", text: c.ok ? "✓" : "○" }), h("span", { class: "sr-only", text: c.ok ? "Done: " : "To do: " }),
    h("span", {}, h("span", { text: c.text }), !c.ok && c.fix ? h("small", { class: "muted", text: c.fix }) : null),
    !c.ok && c.go ? h("button", { class: "btn small quiet", type: "button", text: "Open", "aria-label": `Open: ${c.text}`, onclick: () => go(c.go) }) : null)));
  const playbook = (ph) => h("div", { class: "col2 fwplay" },
    h("div", {}, h("h3", { text: "How to run it" }), h("ul", { class: "growwhy" }, ph.do.map((t) => h("li", { text: t })))),
    h("div", {}, h("h3", { text: "Avoid" }), h("ul", { class: "growwhy" }, ph.avoid.map((t) => h("li", { text: t })))));
  const nowPh = f.phases.find((ph) => ph.id === f.now);
  const hero = h("section", { class: "card fwhero" }, h("h2", { text: "Where this prospect is" }),
    h("ol", { class: "fwtrack", "aria-label": "The phases of presales" }, f.phases.map((ph) => h("li", { class: "fw-" + ph.state, "aria-current": ph.id === f.now ? "step" : null },
      h("b", { text: ph.label }), h("small", { text: FW_STATE[ph.state] })))),
    f.closed ? h("p", { class: "note first", text: `Closed: ${f.outcome === "lost" ? "lost" : "no decision"}. What it teaches is on the presales desk, under What the deals teach.` }) : null,
    h("p", { class: "fwgoal" }, h("b", { text: nowPh.label + ": " }), nowPh.goal),
    h("h3", { text: nowPh.state === "done" ? "Everything here is done" : "Ready to move on when" }), checkList(nowPh), playbook(nowPh),
    h("p", { class: "muted", text: `The deal: ${f.deal.toLowerCase()}.` }));
  const others = f.phases.filter((ph) => ph.id !== f.now).map((ph) => h("details", { class: "card fwphase fw-" + ph.state },
    h("summary", {}, h("b", { text: ph.label }), h("span", { class: "muted", text: ` ${FW_STATE[ph.state].toLowerCase()}: ${ph.goal.charAt(0).toLowerCase() + ph.goal.slice(1)}` })),
    h("div", {}, h("h3", { text: "Ready to move on when" }), checkList(ph), playbook(ph))));
  // the demo, planned from what they said
  const dp = f.demo;
  const slug = w.customer.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  // how long the demo meeting is: the meeting clock's length when it runs, else the one chosen here, else 45 minutes
  const clockNow = clockOf(w.id);
  const demoLength = DEMO_LENGTH.get(w.id) || (clockNow && FW.DEMO_LENGTHS.includes(clockNow.minutes) ? clockNow.minutes : 45);
  const dt = FW.demoTime(dp, demoLength);
  const md = FW.demoMarkdown(dp, w, demoLength);
  const lengthPick = h("select", { "aria-label": "Length of the demo meeting", onchange: (e) => { DEMO_LENGTH.set(w.id, Number(e.target.value)); go("wsforward"); } },
    FW.DEMO_LENGTHS.map((m) => h("option", { value: String(m), text: `${m} minutes` })));
  lengthPick.value = String(demoLength);
  const day = h("input", { type: "date", value: (w.demo && w.demo.on) || today, min: w.created_on, "aria-label": "Day the demo was given" });
  const given = w.demo && w.demo.on
    ? h("div", { class: "btnrow" }, h("span", { text: `Given on ${w.demo.on}.` }), h("button", { class: "btn small quiet", type: "button", text: "Not given yet", onclick: async () => { try { await setDemo(""); } catch (e) { say.textContent = e.message; } } }))
    : h("div", { class: "btnrow" }, day, h("button", { class: "btn small", type: "button", text: "Mark the demo as given", onclick: async () => { try { await setDemo(day.value); } catch (e) { say.textContent = e.message; } } }));
  const sec = (title, kids) => h("div", { class: "fwsec" }, h("h3", { text: title }), kids);
  // running it: one card per part, swiped as it landed, with what they said; the meeting clock follows
  let cur = w;
  const dcards = DEMO.demoCards(dp, dt);
  const seenOf = (c) => (cur.demo && cur.demo.seen && cur.demo.seen[c.key]) || null;
  const demoSet = {
    ...DEMO.DEMO,
    label: (k) => DEMO.REACTIONS[k].label,
    tone: (k) => DEMO.REACTIONS[k].tone,
    suggest: (q, said) => DEMO.demoSuggest(said),
    tag: (c) => c.tag,
    hint: "Swipe it as it landed, or tap",
    how: "What to watch for",
    openText: "Back to what is not noted",
    doneWord: "noted",
    summary: (cards, answerOf) => DEMO.demoSummary(cards, answerOf),
    recap: (cards, answerOf) => DEMO.demoRecapText(cur.customer, cards, answerOf),
    recapSubject: `Demo recap: ${w.customer}`,
    share: { text: "Copy the note for the customer", tip: "What we showed against what they told us, their questions with a line for each answer, and the proof we propose. No reaction is named in it.",
      make: (cards, answerOf) => DEMO.customerNote(cur.customer, cards, answerOf) },
    get end() { return cur.demo && cur.demo.on ? { text: "See the way forward", view: "wsforward" } : { text: "Mark the demo as given today", view: "wsforward", act: () => setDemo(today) }; },
    // with the meeting clock running, each card says whether the demo is on time
    note: (c, i) => { const ck = clockOf(w.id); return ck ? DEMO.demoPace(dt, dcards, i, PACE.reading(ck, Date.now()).elapsed) : null; },
  };
  const runDemo = () => openDeck({ cards: dcards, state: { at: Math.max(0, dcards.findIndex((c) => !seenOf(c))), drafts: new Map() }, set: demoSet, go,
    answerOf: seenOf, answer: async (c, a, note) => { cur = await setDemoSeen(c.key, a, note); return cur; }, clock: () => miniClock(w.id), onClose: () => go("wsforward") });
  const landed = dcards.some(seenOf) ? DEMO.demoSummary(dcards, seenOf) : null;
  const landedSec = landed ? sec("How it landed", h("div", { class: "fwlanded" }, h("p", { text: landed.head }),
    landed.lists.filter(([, rows]) => rows.length).map(([heading, rows]) => h("div", { class: "growproof" }, h("small", { text: heading }),
      h("ul", {}, rows.map((r) => h("li", {}, h("span", { text: r.q }), r.note ? h("span", { class: "muted", text: ` “${r.note}”` }) : null))))),
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Copy the note for the customer",
      "data-tip": "What we showed against what they told us, their questions with a line for each answer, and the proof we propose. No reaction is named in it.",
      onclick: (ev) => copyText(DEMO.customerNote(cur.customer, dcards, seenOf)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) })))) : null;
  const run = dcards.length ? h("button", { class: "btn small primary", type: "button", text: landed ? "Run the demo again" : "Run the demo",
    "data-tip": "One card per part of the plan, full screen: swipe each as it landed, with what they said. On a phone beside you while the screen is shared.", onclick: runDemo }) : null;
  const timing = h("div", { class: "fwtime" }, h("label", { class: "fwlen" }, h("span", { text: "The meeting" }), lengthPick),
    h("p", { class: "note", text: dt.fit < dp.segments.length
      ? `${dt.fit ? `${nOf(dt.fit, "gap")} fit${dt.fit === 1 ? "s" : ""}, about ${dt.each} minutes each` : "No gap fits"} after the situation, the result, the concerns and the close; ${dt.later.length} ${dt.later.length === 1 ? "waits" : "wait"} for the next meeting.`
      : `About ${dt.each} minutes for each gap${dt.spare ? `, and ${dt.spare} left for their questions` : ""}.` }));
  const demo = card("The demo, built from what they said", dp.ready ? h("div", {},
    timing,
    sec("1. Their situation, in their words (2 minutes)", dp.situation.length ? h("ul", { class: "growwhy" }, dp.situation.map((t) => h("li", { text: t }))) : h("p", { class: "note", text: "Nothing in their words yet: note what they say to the value questions." })),
    sec("2. The result first (3 minutes)", h("p", { text: dp.result })),
    dp.segments.length ? sec(dt.fit ? `3. Only what closes their gaps (about ${dt.each} minutes each)` : "3. Only what closes their gaps", h("ol", { class: "fwsegs" }, dp.segments.map((x, i) => h("li", { class: i < dt.fit ? "" : "fwlater" }, h("span", { text: x.show }),
      i < dt.fit ? null : h("small", { class: "muted", text: "Next meeting: no time for it in this one" }),
      x.role ? h("small", { class: "wsrole", text: "for " + WS.ROLE_WORDS[x.role].toLowerCase() }) : null, x.heard ? h("small", { class: "muted", text: `They said: "${x.heard}"` }) : null)))) : null,
    dp.concerns.length ? sec(`4. The concerns they raised (${dt.concern} minutes each)`, h("ul", { class: "growwhy" }, dp.concerns.map((c) => h("li", {}, h("q", { text: c.says }), " ", c.prove)))) : null,
    dp.skip.length ? sec("Leave out: they have it already", h("ul", { class: "growwhy" }, dp.skip.map((t) => h("li", { text: t })))) : null,
    sec("Close: agree what a proof would have to show (5 minutes)", h("ul", { class: "growwhy" }, (dp.close.length ? dp.close : ["The criteria they would sign off, and who signs."]).map((t) => h("li", { text: t })))),
    h("p", { class: "note", text: "For the executive, keep to the situation, the result, the first two gaps and the proof: fifteen minutes." }),
    landedSec,
    h("div", { class: "btnrow" }, run,
      h("button", { class: "btn small", type: "button", text: "Copy the demo plan", onclick: (ev) => copyText(md).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
      h("button", { class: "btn small", type: "button", text: "Demo plan (.md)", onclick: () => saveBlob(md, `${slug}-demo-plan.md`, "text/markdown") })),
    given, say)
    : h("div", {}, h("p", { class: "note first", text: "The plan appears once there is a line to start with: answer at least three questions on a line." }), given, say),
  { sub: "The last thing first: their situation, the result they want, then only what closes their gaps. Nothing they already have." });
  return h("div", {}, hero, demo, ...others);
}

// ------------------------------------------------------------------ qualify the deal: the same ten questions on every line
export function qualifyView({ workshop: w, catalog, setDeal, setAlt, answer, worth, raise, go }) {
  let cur = w;
  const say = h("p", { class: "note", role: "status" });
  const hero = h("section", { class: "card qdhero" });
  const drawHero = () => {
    const st = QD.dealState(cur.deal);
    const at = st.passed ? QD.GATES.findIndex((g) => g.id === st.passed) : -1;
    put(hero, h("h2", { text: "Where the deal stands" }),
      h("div", { class: "qdverdict" }, h("b", { text: st.verdict }), h("span", { class: "muted", text: `${st.answered} of ${QD.DEAL.length} answered, ${st.score} out of 100` })),
      h("ol", { class: "qdgates", "aria-label": "How far the deal is qualified" }, QD.GATES.map((g, i) => h("li", { class: i <= at ? "on" : i === at + 1 ? "next" : "" },
        h("span", { class: "sr-only", text: i <= at ? "Passed: " : i === at + 1 ? "Next: " : "Later: " }), g.label))),
      h("p", { class: "qdnow" }, h("b", { text: "Now: " }), st.then),
      st.missing.length ? h("div", { class: "growproof" }, h("small", { text: `To be ${st.next.label.charAt(0).toLowerCase() + st.next.label.slice(1)}, find out` }),
        h("ul", {}, st.missing.map((m) => h("li", {}, h("b", { text: m.tag + ": " }), m.probe, m.min === "known" && m.a === "partly" ? h("span", { class: "muted", text: " (partly known: needs to be known)" }) : null)))) : null);
  };
  drawHero();
  // the ten questions, compact: grouped as a deal is won (why buy, how they decide, how we win), one opened at a time
  const QGROUP = { why_change: "why", why_now: "why", outcome: "why", decider: "decide", criteria: "decide", process: "decide", paper: "decide", proof: "win", champion: "win", alternatives: "win" };
  const qdList = QL.questionList({
    label: "The ten qualification questions",
    groups: [{ key: "why", label: "Why they would buy" }, { key: "decide", label: "How they decide" }, { key: "win", label: "How we win it" }],
    answers: [{ key: "known", label: "Known", tone: "good" }, { key: "partly", label: "Partly", tone: "mid" }, { key: "unknown", label: "Not yet", tone: "unknown" }],
    filters: [{ key: "all", label: "All" }, { key: "open", label: "Not answered", test: (x) => !x.a }, { key: "gaps", label: "Partly or not yet", test: (x) => x.a === "partly" || x.a === "unknown" }],
    items: () => QD.DEAL.map((x) => {
      const ans = cur.deal && cur.deal[x.id];
      return { id: x.id, group: QGROUP[x.id] || "win", label: x.tag, text: x.q, a: ans ? ans.a : "", aside: ans && ans.note ? `“${ans.note}”` : x.q };
    }),
    answer: async (id, a) => { const have = cur.deal && cur.deal[id]; cur = await setDeal(id, a, a && have ? have.note : ""); },
    onAnswered: () => { drawHero(); qdDeck.sync(); },
    detail: (item) => {
      const x = QD.DEAL.find((d) => d.id === item.id);
      const ans = cur.deal && cur.deal[x.id];
      const note = h("input", { type: "text", class: "wsnote", maxlength: 300, value: ans ? ans.note : "", placeholder: "What we heard, in a few words", "aria-label": `Note for: ${x.q}` });
      note.addEventListener("change", async () => {
        const have = cur.deal && cur.deal[x.id];
        if (!have) return;
        try { cur = await setDeal(x.id, have.a, note.value); say.textContent = ""; } catch (e) { say.textContent = e.message; }
        qdList.draw();
      });
      return h("div", { class: "bidmore" }, h("small", { class: "muted", text: x.why }),
        h("details", { class: "wshow" }, h("summary", { text: "How to ask it" }), h("dl", { class: "objdl" }, h("dt", { text: "Listen for" }), h("dd", { text: x.listen }), h("dt", { text: "Then ask" }), h("dd", { text: x.probe }))),
        ans ? note : h("small", { class: "muted", text: "Answer it to note what you heard." }));
    },
  });
  qdList.el.classList.add("qdlist");
  const copy = h("button", { class: "btn small", type: "button", text: "Copy for the seller", onclick: (ev) => {
    const t = QD.dealMarkdown(cur.deal);
    copyText(t || "Nothing answered yet.").then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; });
  } });
  // what else they weigh: marked from the conversation, each with what to ask and when the other choice wins
  const altBox = h("div", { class: "altlist" });
  const altSay = h("p", { class: "note", role: "status" });
  const drawAlts = () => {
    const alts = WS.alternativesFor(catalog, cur);
    const chip = (a) => h("button", { type: "button", class: "kindchip", "aria-pressed": String(a.on), text: a.name, "data-alt": a.id,
      "data-tip": a.why,
      onclick: async () => {
        try { cur = await setAlt(a.id, !a.on); altSay.textContent = ""; } catch (e) { altSay.textContent = e.message; return; }
        drawAlts(); drawHero();
        const b = altBox.querySelector(`[data-alt="${a.id}"]`);
        if (b) b.focus();
      } });
    // the alternatives for every line first, then those particular to a line in scope, under its name
    const groups = [["", alts.filter((a) => !a.line)], ...[...new Set(alts.filter((a) => a.line).map((a) => a.line))].map((p) => [p, alts.filter((a) => a.line === p)])];
    put(altBox,
      groups.filter(([, list]) => list.length).map(([p, list]) => h("div", { class: "wsfam", role: "group", "aria-label": p ? `On the table for ${list[0].line_label}` : "On the table" },
        h("span", { class: "wsfamname", text: p ? list[0].line_label : "Whatever the line" }), list.map(chip))),
      alts.filter((a) => a.on).map((a) => h("div", { class: "card altcard" }, h("h3", { text: a.name }), h("p", { class: "muted", text: a.line_label ? `${a.line_label}. ${a.why}` : a.why }),
        h("dl", { class: "objdl" },
          h("dt", { text: "Ask" }), h("dd", {}, h("ul", {}, a.ask.map((q) => h("li", { text: q })))),
          h("dt", { text: "We fit when" }), h("dd", { text: a.fits_us }),
          h("dt", { text: "It is the better choice when" }), h("dd", { text: a.fits_them }),
          h("dt", { text: "To prove it" }), h("dd", { text: a.prove })))),
      alts.some((a) => a.on) ? null : h("p", { class: "note", text: "Mark what the customer has mentioned or is likely to weigh. Each one opens with what to ask, when the proposal fits, when the other choice is the better one, and how to prove it." }));
  };
  drawAlts();
  const altCard = WS.alternativesFor(catalog, w).length ? card("What else they weigh", h("div", {}, altBox, altSay),
    { sub: "Renewing, a public cloud, another platform, building it, or waiting: the alternatives every deal is measured against, written to be fair. Knowing when the other choice wins is what makes the rest believable." }) : null;
  // one question at a time: the ten questions as a deck, the list beside it; answered in one, it shows in the other
  const QD_TONE = { known: "good", partly: "mid", unknown: "unknown" };
  const QD_GROUP_LABEL = { why: "Why they would buy", decide: "How they decide", win: "How we win it" };
  const qdCards = QD.DEAL.map((x) => ({ key: x.id, label: QD_GROUP_LABEL[QGROUP[x.id] || "win"], tag: x.tag, q: x }));
  const qdSet = {
    ...DECK.QUALIFY,
    label: (k) => QD.STATES[k].label,
    tone: (k) => QD_TONE[k],
    suggest: (q, said) => { const a = DECK.suggest(q, said); return a === "unknown" || a === "partly" ? a : null; },
    tag: (c) => c.tag,
    hint: "Right if known, up if partly, left if not yet",
    summary: (cards, answerOf) => {
      const t = DECK.tally(cards, answerOf, ["known", "partly", "unknown"]);
      const st = QD.dealState(cur.deal);
      return { head: `${st.verdict}: ${st.score} out of 100.`, total: t.total, open: t.counts.open, counts: t.counts,
        tallies: [["unknown", "not yet"], ["partly", "partly"], ["known", "known"]], lists: [["Not yet known", t.under.unknown], ["Only partly known", t.under.partly]] };
    },
    end: { text: "See the way forward", view: "wsforward" },
  };
  const qdShared = { cards: qdCards, state: { at: Math.max(0, qdCards.findIndex((c) => !(cur.deal && cur.deal[c.key]))), drafts: new Map() }, set: qdSet, go,
    kicker: "Find out next", answerOf: (c) => cur.deal && cur.deal[c.key],
    answer: async (c, a, note) => { cur = await setDeal(c.key, a, note); return cur; },
    onAnswered: () => { qdList.draw(); drawHero(); } };
  qdShared.clock = () => miniClock(cur.id);           // the meeting clock follows the meeting here too
  const qdDeck = deckPane({ ...qdShared, pfx: "qddeck", inline: true, onFull: () => openDeck({ ...qdShared, onClose: () => qdDeck.draw(false) }) });
  qdDeck.draw(false);
  return h("div", {}, hero,
    h("div", { class: "card deckpanel" }, h("div", { class: "deckslot" }, qdDeck.el),
      h("div", { class: "deckside" }, heardPanel({ catalog, get: () => cur, set: (x) => { cur = x; }, answer, worth, setDeal, raise, id: "qdheard",
        onFiled: () => { qdList.draw(); drawHero(); qdDeck.sync(); } }).el,
        h("h2", { class: "decksidehead", text: "The ten questions" }),
        h("p", { class: "note", text: "The same on every line, asked alongside the technical ones: known, partly or not yet, with what you heard. Named as most sales methods name them, so the seller reads the same list; never in the customer readout." }),
        qdList.el, say,
        h("div", { class: "btnrow" }, copy, h("button", { class: "btn small", type: "button", text: "Back to the questions", onclick: () => go("workshop") })))),
    altCard);
}

/** A tender or a request for proposal, requirement by requirement: whether to bid, what to ask, the points, the matrix. */
export function rfpView({ workshop: w, catalog, today, addReqs, setReq, removeReq, setRfpMeta, clearRfp, setAward, setBidAnswer, setBidCall, setScope, readRows, fillNotes, setSection, others, go }) {
  let cur = w;
  // what the list shows: a narrowing, a line, words searched, grouped by line or not, and the requirement open for editing
  const ui = { only: "all", line: "", q: "", group: false, open: "" };
  const say = h("p", { class: "note", role: "status" });
  const reqs = () => (cur.rfp ? cur.rfp.reqs : []);
  const lineName = (p) => (p ? SHORT[p] || (catalog.lines[p] ? catalog.lines[p].label : p) : "No line");
  const STATUS = { yes: "Met", partly: "Partly", no: "Not met", check: "To check", "": "Open" };
  const shortText = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
  const slug = (cur.customer || "customer").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  const copyQuestions = (btn) => {
    const qs = RFP.clarificationQuestions(cur);
    return copyText(qs.length ? qs.map((q, i) => `${i + 1}. ${q.text}`).join("\n") : "No question to ask: no mandatory requirement is partly met, not met or to check.")
      .then((ok) => { if (btn) btn.textContent = ok ? "Copied" : "Not copied"; });
  };
  const exportCsv = () => saveBlob(RFP.rfpCsv(catalog, cur), `${slug}-compliance-matrix.csv`, "text/csv");

  // ---------------------------------------------------------------- where the bid stands, at a glance
  const hero = h("section", { class: "card rfphero" });
  // a small bar: one segment per answer that has any, its width the share of the whole
  const miniBar = (c, total, label) => h("span", { class: "rfpbartrack rfpmini", role: "img", "aria-label": label },
    ["yes", "partly", "no", "check"].filter((k) => c[k]).map((k) => h("i", { class: `seg s-${k}`, style: `width:${((c[k] / (total || 1)) * 100).toFixed(2)}%` })));
  // one bar per population: each answer a segment, its width the share; the legend carries the numbers
  const bar = (list, label) => {
    const n = list.length || 1;
    const parts = ["yes", "partly", "no", "check", ""].map((k) => [k, list.filter((r) => r.a === k).length]).filter(([, c]) => c);
    return h("div", { class: "rfpbar" }, h("span", { class: "rfpbarlabel", text: `${label} (${list.length})` }),
      h("span", { class: "rfpbartrack", role: "img", "aria-label": `${label}: ${parts.map(([k, c]) => `${c} ${STATUS[k].toLowerCase()}`).join(", ")}` },
        parts.map(([k, c]) => h("i", { class: `seg s-${k || "open"}`, style: `width:${((c / n) * 100).toFixed(2)}%` }))));
  };
  const drawHero = () => {
    const st = RFP.rfpState(catalog, cur, today);
    const dl = st.deadlines;
    const when = (d, days, what) => (d ? h("span", { class: "chip" + (days != null && days >= 0 && days <= 7 ? " warn" : "") }, `${what} ${d}${days == null ? "" : days < 0 ? `, ${-days} days ago` : days === 0 ? ", today" : `, in ${days} days`}`) : null);
    const steps = RFP.nextSteps(catalog, cur, today, others);
    put(hero, h("h2", { text: st.title ? `Where the bid stands: ${st.title}` : "Where the bid stands" }),
      h("p", { class: `rfpverdict ${st.verdict.level}`, text: st.verdict.text }),
      st.total && st.review.call !== "no_bid" ? h("p", { class: "rfpcall" }, h("span", { text: st.review.call ? `Decided on ${st.review.on}: ${BID.CALLS[st.review.call].toLowerCase()}.`
        : `Bid or no bid: ${{ bid: "the review says bid", no_bid: "the review says do not bid", doubt: "the review has doubts", check: `${st.review.unknown.length} of ${st.review.questions.length} questions not known yet` }[st.review.level]}.` }),
      h("button", { type: "button", class: "btn small quiet", text: st.review.call ? "See the review" : "Review it", onclick: () => act("review") })) : null,
      st.total ? h("div", { class: "rfpbars" }, bar(reqs().filter((r) => r.must), "Mandatory"), bar(reqs().filter((r) => !r.must), "Scored or optional"),
        h("p", { class: "rfplegend" }, ["yes", "partly", "no", "check", ""].map((k) => h("span", {}, h("i", { class: `dot s-${k || "open"}` }), `${STATUS[k]} ${reqs().filter((r) => r.a === k).length}`)))) : null,
      st.total && (st.points || dl.questions_due || dl.due) ? h("p", { class: "rfpdates" }, st.points ? h("span", { class: "chip" }, `${Math.round(st.points.likely)} of ${Math.round(st.points.total)} points likely`) : null,
        when(dl.questions_due, dl.questions_in, "Questions due"), when(dl.due, dl.due_in, "Bid due")) : null,
      h("div", { class: "rfpnext" }, h("h3", { text: "Do next" }), h("ul", {}, steps.map((x) => h("li", { class: `rfpstep k-${x.id}` }, h("span", { text: x.text }),
        h("button", { type: "button", class: "btn small", text: x.label, onclick: (ev) => act(x.act, ev.currentTarget) }))))),
      st.owed.length || (st.total && st.unassigned) ? h("div", { class: "rfpowed" }, h("span", { class: "note", text: `Still to answer: ${[...st.owed.map((x) => `${x.count} with ${x.label.toLowerCase()}`), ...(st.unassigned ? [`${st.unassigned} with nobody named yet (pick who answers in each requirement)`] : [])].join(", ")}.` }),
        st.owed.map((x) => h("button", { type: "button", class: "btn small", text: `Copy for ${x.label.toLowerCase()} (${x.count})`, "data-tip": "Their requirements, what we have so far, and the date we need the answers by.",
          onclick: (ev) => copyText(RFP.ownerBrief(catalog, cur, x.who, today)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }))) : null,
      st.outside.length ? h("div", { class: "growproof" }, h("small", { text: "The tender also asks about" }),
        h("p", { text: st.outside.map((l) => `${l.label} (${l.count})`).join(", ") + ": lines not in this conversation yet." }),
        setScope ? h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Add them to the conversation", onclick: async () => {
          try { await setScope([...cur.scope, ...st.outside.map((l) => l.profile)].slice(0, 20)); } catch (e) { say.textContent = e.message; }
        } })) : null) : null);
  };
  // the actions a next step names
  const act = (what, btn) => {
    if (what === "load") { loader.open = true; paste.focus(); return; }
    if (what === "copy-questions") { copyQuestions(btn); return; }
    if (what === "export") { exportCsv(); return; }
    if (what === "next-open") {
      const first = reqs().find((r) => r.must && !r.a);
      setOnly("all"); ui.line = ""; byLine.value = ""; ui.q = ""; search.value = "";
      if (first) openRow(first.id, true);
      return;
    }
    if (what === "award") { awardCard.scrollIntoView({ block: "start" }); return; }
    if (what === "review") { bidCard.scrollIntoView({ block: "start" }); return; }
    if (what === "copy-letter") { copyText(BID.declineLetter(cur)).then((ok) => { if (btn) btn.textContent = ok ? "Copied" : "Not copied"; }); return; }
    if (what.startsWith("filter:")) { setOnly(what.slice(7)); listCard.scrollIntoView({ block: "start" }); return; }
    if (what.startsWith("open:")) { setOnly("all"); ui.line = ""; byLine.value = ""; ui.q = ""; search.value = ""; openRow(what.slice(5), false); }
  };

  // ---------------------------------------------------------------- load the tender: its name, who issued it, its dates, its requirements
  const t = cur.rfp || RFP.emptyRfp();
  const title = h("input", { type: "text", maxlength: RFP.TITLE_MAX, value: t.title, placeholder: "e.g. Data centre modernisation, lot 2", "aria-label": "Tender name" });
  const qdue = h("input", { type: "date", value: t.questions_due, "aria-label": "Questions to the contracting authority due" });
  const due = h("input", { type: "date", value: t.due, "aria-label": "Bid due" });
  const issuer = h("select", { "aria-label": "Who issued it" }, [["", "Not said yet"], ...Object.entries(RFP.ISSUERS)].map(([v, l]) => h("option", { value: v, text: l, selected: v === (t.issuer || "") })));
  const channel = h("p", { class: "note" });
  const drawChannel = () => {
    channel.textContent = issuer.value === "company" ? "A company can be asked in a meeting: the requirements to check go on the next meeting's agenda, and the questions can go by email."
      : issuer.value === "public" ? "A public body takes questions only through the tender's formal channel, by its deadline: the questions are drafts for it, and nothing of the tender goes on a meeting agenda."
        : "Say who issued it: a public body takes questions only through the formal channel; a company can be asked in a meeting.";
  };
  drawChannel();
  const pages = h("input", { type: "number", min: "1", max: String(RFP.MAX_PAGES), step: "1", value: t.pages ? String(t.pages) : "", placeholder: "no limit", class: "rfppts", "aria-label": "Page limit of the technical response" });
  const saveMeta = async () => {
    try { cur = await setRfpMeta({ title: title.value, due: due.value, questions_due: qdue.value, issuer: issuer.value, pages: pages.value }); say.textContent = ""; } catch (e) { say.textContent = e.message; }
    drawHero(); drawChannel(); drawDeliver(); drawBid();
  };
  for (const el of [title, qdue, due, issuer, pages]) el.addEventListener("change", saveMeta);
  const paste = h("textarea", { rows: 6, class: "rfppaste", placeholder: "Paste the requirements: one per line (3.2.1 The solution must...), or rows copied from a spreadsheet.", "aria-label": "Requirements to add" });
  const addSay = h("p", { class: "note", role: "status" });
  const loadedLine = h("span");
  const drawLoaded = () => {
    const st = RFP.rfpState(catalog, cur, today);
    loadedLine.textContent = st.total ? `${st.total} requirements loaded, ${st.must} mandatory${st.points ? `, ${Math.round(st.points.total)} points` : ""}. Add more` : "Add the requirements";
  };
  const add = async (text, from = "") => {
    const parsed = RFP.parseRequirements(text);
    try {
      cur = await addReqs(parsed);
      const must = parsed.filter((r) => r.must).length;
      addSay.textContent = `${from ? `${from}: added` : "Added"} ${parsed.length} requirement${parsed.length === 1 ? "" : "s"}: ${must} mandatory, ${parsed.length - must} scored or optional. Check what each was matched to.`;
      paste.value = "";
    } catch (e) { addSay.textContent = e.message; return; }
    loader.open = false;                                // loaded: the next thing is answering them
    redraw();
  };
  const file = h("input", { type: "file", accept: ".xlsx,.csv,.txt", "aria-label": "Read the requirements from a file: a workbook, a CSV or plain text" });
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { addSay.textContent = `${f.name} is larger than 20 MB.`; return; }
    try {
      if (/\.xlsx$/i.test(f.name)) {
        if (!readRows) { addSay.textContent = "Workbooks are read once the engine has started: try again in a moment."; return; }
        const r = await readRows(f);
        if (!r.ok) { addSay.textContent = r.error; return; }
        const got = RFP.sheetsToText(r.sheets);
        if (!got.text) { addSay.textContent = `${f.name}: no sheet holds rows long enough to be requirements.`; return; }
        await add(got.text, `${f.name}, sheet "${got.sheet}"`);
      } else {
        const text = await f.text();
        await add(/\.csv$/i.test(f.name) ? RFP.csvToText(text) : text, f.name);
      }
    } catch (e) { addSay.textContent = `${f.name}: ${e.message}`; }
  });
  const loader = h("details", { class: "rfploader", open: reqs().length ? null : "" }, h("summary", {}, loadedLine),
    h("div", { class: "rfploadbody" }, paste, h("div", { class: "btnrow" },
      h("button", { class: "btn", type: "button", text: "Add the requirements", onclick: () => add(paste.value) }),
      h("label", { class: "btn small filebtn" }, "Read from a file (.xlsx, .csv, .txt)", file),
      h("button", { class: "btn small quiet", type: "button", text: "Try it with an invented tender", onclick: () => add(RFP.EXAMPLE_TENDER) }))));

  // ---------------------------------------------------------------- answer the requirements: a compact list, one open at a time
  const counts = {};
  const chips = h("div", { class: "wsfam rfpchips", role: "group", "aria-label": "Which requirements to show" });
  const drawChips = () => {
    const c = RFP.filterCounts(cur);
    put(chips, Object.entries(RFP.FILTERS).map(([k, l]) => {
      counts[k] = c[k];
      return h("button", { type: "button", class: "kindchip", "aria-pressed": String(ui.only === k), "data-only": k, "aria-label": `${l}: ${c[k]}`,
        onclick: () => setOnly(k) }, l, h("span", { class: "chipn", text: String(c[k]) }));
    }));
  };
  const setOnly = (k) => { ui.only = k; drawChips(); drawList(); };
  const search = h("input", { type: "search", class: "rfpsearch", placeholder: "Find: words or a reference", "aria-label": "Find a requirement by its words or its reference" });
  search.addEventListener("input", () => { ui.q = search.value; drawList(); });
  const byLine = h("select", { "aria-label": "Show the requirements of one line" });
  const drawLineOptions = () => {
    const used = [...new Set(reqs().map((r) => r.line))];
    put(byLine, [["", "Every line"], ...used.filter(Boolean).map((p) => [p, lineName(p)]), ...(used.includes("") ? [["-", "No line"]] : [])].map(([v, l]) => h("option", { value: v, text: l, selected: v === ui.line })));
  };
  byLine.addEventListener("change", () => { ui.line = byLine.value; drawList(); });
  const grouped = h("button", { type: "button", class: "kindchip", "aria-pressed": "false", text: "Group by line", onclick: () => { ui.group = !ui.group; grouped.setAttribute("aria-pressed", String(ui.group)); drawList(); } });
  const shown = h("span", { class: "muted", role: "status" });
  const list = h("div", { class: "rfplist" });
  const visible = () => reqs().filter((r) => RFP.keepReq(r, ui.only) && (!ui.line || r.line === ui.line || (ui.line === "-" && !r.line)) && RFP.matchesSearch(r, ui.q));
  const rows = new Map();
  let busy = false;                                     // an answer is being kept: keys wait for it

  // the editor of one requirement: everything about it, the answer kit, and keys 1 to 4 to answer
  const editor = (x, li) => {
    const save = async (patch, then) => {
      busy = true;
      try { cur = await setReq(x.id, patch); say.textContent = ""; } catch (e) { say.textContent = e.message; busy = false; return; }
      busy = false;
      afterChange(x.id, then);
    };
    const line = h("select", { "aria-label": `Product line for ${x.ref || "requirement"}` }, [["", "No line"], ...RFP.lineOrder(catalog, cur.scope).map((p) => [p, catalog.lines[p].label + (cur.scope.includes(p) ? "" : " (not in scope)")])].map(([v, l]) => h("option", { value: v, text: l, selected: v === x.line })));
    line.addEventListener("change", () => save({ line: line.value }, "keep"));
    const note = h("input", { type: "text", class: "wsnote", maxlength: RFP.NOTE_MAX, value: x.note, placeholder: "How it is met, or what is offered instead", "aria-label": `How it is met: ${x.ref || x.text.slice(0, 40)}` });
    note.addEventListener("change", () => save({ note: note.value }, "keep"));
    const who = h("select", { "aria-label": `Who answers: ${x.ref || x.text.slice(0, 40)}` }, [["", "Who answers"], ...Object.entries(RFP.WHO)].map(([v, l]) => h("option", { value: v, text: l, selected: v === x.who })));
    who.addEventListener("change", () => save({ who: who.value }, "keep"));
    const pts = h("input", { type: "number", min: "0", step: "any", value: x.points == null ? "" : String(x.points), placeholder: "points", class: "rfppts", "aria-label": `Points: ${x.ref || x.text.slice(0, 40)}` });
    pts.addEventListener("change", () => save({ points: pts.value }, "keep"));
    const words = x.line ? RFP.matchedWords(x.text, x.line) : [];
    const dq = RFP.questionFor(catalog, x);
    const kit = RFP.suggestAnswer(catalog, x);
    const before = x.note ? null : RFP.pastAnswer(others, x);
    const offer = (head, body, extra, use) => h("div", { class: "rfpsuggest" }, h("small", { class: "muted", text: head }), h("p", { text: body }), extra,
      h("button", { type: "button", class: "btn small", text: "Use it", "aria-label": `${head}: use it for ${x.ref || "this requirement"}`, onclick: () => save({ note: use }, "note") }));
    const ed = h("div", { class: "rfpedit" },
      words.length || dq ? h("p", { class: "rfpwhy" }, words.length ? h("small", { class: "muted", text: `Matched on: ${words.join(", ")}` }) : null,
        dq && cur.scope.includes(dq.profile) ? h("button", { type: "button", class: "link rfpdq", text: `Discovery question: ${dq.q}`, onclick: () => go("workshop", { open: dq.profile }) }) : null) : null,
      h("div", { class: "rfptags" },
        h("button", { type: "button", class: "kindchip", "aria-pressed": String(x.must), text: x.must ? "Mandatory" : "Scored or optional", "aria-label": `Mandatory: ${x.ref || x.text.slice(0, 40)}`, onclick: () => save({ must: !x.must }, "keep") }),
        pts, line),
      h("div", { class: "wsans", role: "group", "aria-label": `Answer to ${x.ref || "this requirement"}` }, Object.entries(RFP.ANSWERS).map(([k, v], i) =>
        h("button", { type: "button", class: `wsopt rfp-${k}`, "aria-pressed": String(x.a === k), "aria-label": v, onclick: () => save({ a: x.a === k ? "" : k }, x.a === k ? "keep" : "next") }, h("kbd", { "aria-hidden": "true", text: String(i + 1) }), v))),
      x.note ? (kit && (x.a === "yes" || x.a === "partly") ? h("small", { class: "muted rfpev", text: `Attach: ${kit.evidence.join("; ")}.` }) : null)
        : h("div", { class: "rfphelp" }, before ? offer(`Answered before for ${before.customer}${before.on ? `, ${before.on}` : ""}`, before.note, null, before.note) : null,
          kit ? offer(`From the answer kit: ${kit.topic}`, kit.answer, h("small", { class: "muted", text: `Attach: ${kit.evidence.join("; ")}. ${kit.check}` }), kit.answer) : null),
      h("div", { class: "rfpmore" }, note, who,
        h("button", { type: "button", class: "btn small quiet", text: "Remove", "aria-label": `Remove ${x.ref || "this requirement"}`, onclick: async () => {
          try { cur = await removeReq(x.id); } catch (e) { say.textContent = e.message; return; }
          ui.open = ""; redraw();
        } })));
    // keys 1 to 4 answer it, Escape closes it; typing in a field is left alone. A key never takes an answer back (a
    // click does), and a key pressed while the last answer is being kept waits for nothing: fast typing cannot undo
    li.onkeydown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); const id = x.id; ui.open = ""; drawRow(id); const head = rows.get(id) && rows.get(id).querySelector(".rfphead"); if (head) head.focus(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || !/^[1-4]$/.test(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (busy) return;
      save({ a: Object.keys(RFP.ANSWERS)[Number(e.key) - 1] }, "next");
    };
    return ed;
  };
  // one row: what it is at a glance; opened, its editor
  const drawRow = (id) => {
    const li = rows.get(id);
    const x = reqs().find((r) => r.id === id);
    if (!li || !x) return;
    const open = ui.open === id;
    const unexplained = RFP.keepReq(x, "nonote");
    put(li, h("button", { type: "button", class: "rfphead", "aria-expanded": String(open), "aria-controls": `rfp-ed-${id}`, onclick: () => openRow(open ? "" : id, !open) },
      h("span", { class: "rfpref", text: x.ref || "–" }),
      open ? h("span", { class: "rfptext" }, h("b", { text: x.text })) : h("span", { class: "rfptext", text: shortText(x.text, 220) }),
      h("span", { class: "rfpmeta" },
        x.must ? h("span", { class: "rfpbadge must", text: "Mandatory" }) : h("span", { class: "rfpbadge", text: x.points != null ? `${x.points} pts` : "Optional" }),
        h("span", { class: "rfpline", text: lineName(x.line) }),
        unexplained ? h("span", { class: "rfpnonote", text: "no note" }) : null,
        h("span", { class: `rfpstatus s-${x.a || "open"}`, text: STATUS[x.a] }))),
    open ? h("div", { id: `rfp-ed-${id}` }, editor(x, li)) : null);
    li.classList.toggle("open", open);
  };
  const openRow = (id, focusAnswer) => {
    const before = ui.open;
    ui.open = id;
    if (before && rows.has(before)) drawRow(before);
    if (id && !rows.has(id)) drawList();
    else if (id) drawRow(id);
    if (id && rows.get(id)) {
      const li = rows.get(id);
      li.scrollIntoView({ block: "nearest" });
      const b = focusAnswer ? li.querySelector(".wsopt[aria-pressed=true]") || li.querySelector(".wsopt") : li.querySelector(".rfphead");
      if (b) b.focus();
    }
  };
  // after a change: the row, the counts and the picture; an answer moves on to the next requirement still open, as in a meeting
  const afterChange = (id, then) => {
    drawHero(); drawChips(); drawDeliver(); drawLoaded(); drawAward(); drawBid();
    if (then === "next") {
      const vis = visible();
      const i = vis.findIndex((r) => r.id === id);
      const next = vis.slice(i + 1).find((r) => !r.a) || vis.find((r) => !r.a && r.id !== id);
      if (rows.has(id) && !visible().some((r) => r.id === id)) { ui.open = ""; drawList(); }
      else drawRow(id);
      if (next) openRow(next.id, true);
      else { ui.open = ""; drawRow(id); say.textContent = "Every requirement in this list is answered."; }
      return;
    }
    drawRow(id);
    if (then === "note") { const n = rows.get(id) && rows.get(id).querySelector("input.wsnote"); if (n) n.focus(); }
  };
  const row = (x) => {
    const li = h("li", { class: "rfprow", "data-id": x.id });
    rows.set(x.id, li);
    drawRow(x.id);
    return li;
  };
  const drawList = () => {
    rows.clear();
    const vis = visible();
    const all = reqs().length;
    shown.textContent = all ? (vis.length === all ? `All ${all} shown.` : `${vis.length} of ${all} shown.`) : "";
    if (!all) { put(list, h("p", { class: "note first", text: "No requirement yet: load them above." })); return; }
    if (!vis.length) { put(list, h("p", { class: "note first", text: "Nothing in this list." })); return; }
    if (!ui.group) { put(list, h("ol", { class: "rfprows" }, vis.map(row))); return; }
    const byL = new Map();
    for (const r of vis) byL.set(r.line, [...(byL.get(r.line) || []), r]);
    // lines in the conversation first, then the most asked about; requirements with no line last
    put(list, [...byL.entries()].sort(([a, ra], [b, rb]) => (a === "") - (b === "") || (!cur.scope.includes(a)) - (!cur.scope.includes(b)) || rb.length - ra.length).map(([p, rs]) => {
      const done = rs.filter((r) => r.a).length;
      const c = Object.fromEntries(["yes", "partly", "no", "check"].map((k) => [k, rs.filter((r) => r.a === k).length]));
      return h("section", { class: "rfpgroup" }, h("h3", {}, h("span", { text: p ? catalog.lines[p] ? catalog.lines[p].label : p : "No line" }), h("small", { class: "muted", text: `${done} of ${rs.length} answered` }),
        miniBar(c, rs.length, `${done} of ${rs.length} answered`)),
      h("ol", { class: "rfprows" }, rs.map(row)));
    }));
  };
  const fill = fillNotes ? h("button", { class: "btn small", type: "button", text: "Use the kit's answers where there is no note yet", onclick: async (ev) => {
    const empty = reqs().filter((r) => !r.note && RFP.suggestAnswer(catalog, r)).length;
    if (!empty) { ev.target.textContent = "Every requirement the kit knows has a note"; return; }
    try { cur = await fillNotes(); } catch (e) { say.textContent = e.message; return; }
    say.textContent = `${empty} note${empty === 1 ? "" : "s"} filled from the answer kit: adapt each, and fill in what is in square brackets.`;
    redraw();
  } }) : null;

  // ---------------------------------------------------------------- deliver the bid: coverage, the questions, the evidence, the files
  const deliver = h("div", { class: "rfpdeliver" });
  // is the response ready to leave: each check, passed or not, with the way to fix it
  const checks = h("div", { class: "rfpchecks" });
  const drawChecks = () => {
    const c = RFP.responseChecks(catalog, cur, others);
    if (!reqs().length) { put(checks); return; }
    const item = (ok, text, fix) => h("li", { class: ok ? "ok" : "todo" }, h("span", { class: "rfpcheckmark", "aria-hidden": "true", text: ok ? "✓" : "!" }),
      h("span", { text }), !ok && fix ? h("button", { type: "button", class: "btn small", text: fix[0], onclick: () => act(fix[1]) }) : null);
    const pg = c.pages;
    put(checks, h("h3", { text: c.ready ? "Ready to leave" : "Before it leaves" }), h("ul", {},
      item(!c.unanswered.length, c.unanswered.length ? `${c.unanswered.length} requirement${c.unanswered.length === 1 ? "" : "s"} not answered yet` : "Every requirement is answered", ["See them", "filter:open"]),
      item(!c.unexplained.length, c.unexplained.length ? `${c.unexplained.length} met or partly without saying how` : "Every answer says how", ["See them", "filter:nonote"]),
      item(!c.blanks.length, c.blanks.length ? `${c.blanks.length} answer${c.blanks.length === 1 ? "" : "s"} with square brackets to fill in` : "Nothing left in square brackets", ["See them", "filter:fill"]),
      item(!c.named.length, c.named.length ? `Another customer is named in ${c.named.map((m) => m.ref || m.id).join(", ")} (${[...new Set(c.named.map((m) => m.name))].join(", ")})` : "No other customer is named", c.named.length ? ["Open it", `open:${c.named[0].id}`] : null),
      item(!pg.over, pg.limit ? `About ${pg.estimate} page${pg.estimate === 1 ? "" : "s"} of the ${pg.limit} allowed${pg.over ? ": shorten the answers" : ""}` : `About ${pg.estimate} page${pg.estimate === 1 ? "" : "s"}; give the page limit if the tender sets one`, null)));
  };
  // the sections of the response, named as the tender names them: drawn when requirements come or go, not while typing
  const sectionsBox = h("div", { class: "rfpsections" });
  const drawSections = () => {
    const all = RFP.sections(catalog, cur);
    if (!all.length) { put(sectionsBox); return; }
    put(sectionsBox, h("details", {}, h("summary", { text: `Sections of the technical response (${all.length})` }),
      h("p", { class: "note", text: "Named after the line most of their requirements ask about. Type the title the tender uses; leave it blank to go back." }),
      h("ol", { class: "rfpsectionlist" }, all.map((sec) => {
        const input = h("input", { type: "text", maxlength: RFP.SECTION_MAX, value: sec.typed ? sec.title : "", placeholder: sec.guess, "aria-label": `Title of section ${sec.key || "without a reference"}` });
        input.addEventListener("change", async () => {
          try { cur = await setSection(sec.key, input.value); say.textContent = ""; } catch (e) { say.textContent = e.message; }
        });
        return h("li", {}, h("span", { class: "rfpref", text: sec.key || "–" }), input, h("small", { class: "muted", text: `${sec.reqs.length} requirement${sec.reqs.length === 1 ? "" : "s"}${sec.points ? `, ${sec.points} points` : ""}` }));
      }))));
  };
  const drawDeliver = () => {
    drawChecks();
    const st = RFP.rfpState(catalog, cur, today);
    const qs = RFP.clarificationQuestions(cur);
    const ev = RFP.evidenceFor(catalog, cur);
    put(deliver, !st.total ? h("p", { class: "note first", text: "Once requirements are answered, the coverage by line, the questions to send and the evidence to gather appear here." }) : [
      h("div", { class: "rfpcol" }, h("h3", { text: "Coverage by product line" }),
        h("ul", { class: "rfpcover" }, st.lines.map((l) => h("li", {}, h("span", { class: "rfpcovername", text: l.label + (l.in_scope ? "" : " (not in scope)") }),
          miniBar(l, l.count, `${l.yes} met, ${l.partly} partly, ${l.no} not met, ${l.check} to check, ${l.open} open`),
          h("small", { class: "muted", text: `${l.count - l.open} of ${l.count}${l.no ? `, ${l.no} not met` : ""}` }))))),
      h("div", { class: "rfpcol" }, h("h3", { text: `Questions for the contracting authority (${qs.length})` }),
        qs.length ? h("ol", { class: "rfpqs" }, qs.map((q) => h("li", { text: q.text }))) : h("p", { class: "note", text: "None: no mandatory requirement is partly met, not met or to check." })),
      h("div", { class: "rfpcol" }, h("h3", { text: `Evidence to gather (${ev.length})` }),
        ev.length ? (() => {
          const li = (e) => h("li", { text: `${e.item} (for ${e.refs.slice(0, 4).join(", ")}${e.refs.length > 4 ? `, and ${e.refs.length - 4} more` : ""})` });
          return [h("ul", { class: "rfpqs" }, ev.slice(0, 8).map(li)),
            ev.length > 8 ? h("details", { class: "rfpmoreev" }, h("summary", { text: `${ev.length - 8} more` }), h("ul", { class: "rfpqs" }, ev.slice(8).map(li))) : null];
        })() : h("p", { class: "note", text: "Answer requirements as met or partly to see what to attach." }))]);
  };
  let armed = null;
  const restart = h("button", { class: "btn small quiet", type: "button", text: "Start again", onclick: async () => {
    if (!armed) { restart.textContent = "Remove every requirement?"; armed = setTimeout(() => { armed = null; restart.textContent = "Start again"; }, 5000); return; }
    clearTimeout(armed); armed = null; restart.textContent = "Start again";
    try { cur = await clearRfp(); } catch (e) { say.textContent = e.message; return; }
    title.value = ""; due.value = ""; qdue.value = ""; issuer.value = ""; ui.open = "";
    drawChannel(); redraw();
  } });

  const redraw = () => { drawHero(); drawChips(); drawLineOptions(); drawList(); drawDeliver(); drawSections(); drawLoaded(); drawAward(); drawBid(); loader.open = !reqs().length || loader.open; };
  drawHero(); drawChips(); drawLineOptions(); drawList(); drawDeliver(); drawSections(); drawLoaded();
  const listCard = card("Answer the requirements", h("div", {},
    h("div", { class: "rfptools" }, search, byLine, grouped, fill), chips, shown, list, say),
  { sub: "Open a requirement to answer it: the keys 1 to 4 answer (met, partly, not met, to check) and the next one still open opens. Escape closes it. A mandatory requirement not met can exclude the bid." });
  // ---------------------------------------------------------------- bid or no bid: the review, and the team's call
  const bidRec = h("div", { class: "bidrec" });
  const bidCallBox = h("div", { class: "bidcall" });
  const bidMsg = h("p", { class: "note", role: "status" });
  const why = h("input", { type: "text", maxlength: String(BID.WHY_MAX), placeholder: "why, in a sentence (optional)", "aria-label": "Why the team decided", class: "bidwhy" });
  const review = () => RFP.rfpState(catalog, cur, today).review;
  const bidList = QL.questionList({
    label: "Bid or no bid questions",
    groups: Object.entries(BID.GROUPS).map(([key, label]) => ({ key, label })),
    answers: [{ key: "yes", label: "Yes", tone: "good" }, { key: "partly", label: "Partly", tone: "mid" }, { key: "no", label: "No", tone: "bad" }],
    filters: [{ key: "all", label: "All" }, { key: "open", label: "Not answered", test: (x) => !x.a }, { key: "against", label: "Partly or no", test: (x) => x.a === "partly" || x.a === "no" }],
    items: () => review().questions.map((q) => ({ id: q.id, group: q.group, label: q.label, text: q.text, a: q.a, stop: q.stop,
      aside: q.from === "read" ? `read from the tender: ${q.why}` : q.from === "typed" && q.read ? "answered by hand" : "" })),
    answer: async (id, a) => { cur = await setBidAnswer(id, a); },
    onAnswered: () => { drawBidRest(); drawHero(); },
    detail: (x) => {
      const q = review().questions.find((y) => y.id === x.id);
      return h("div", { class: "bidmore" }, h("small", { class: "muted", text: q.hint }),
        q.read && q.from === "typed" ? h("small", { class: "bidread" }, q.why ? `The tender says: ${q.why}. ` : "",
          h("button", { type: "button", class: "linkbtn", text: "Use what the tender says", onclick: async () => {
            try { cur = await setBidAnswer(q.id, ""); } catch (e) { bidMsg.textContent = e.message; } drawBid(); drawHero();
          } })) : null);
    },
  });
  // the recommendation and the team's call, around the list
  const drawBidRest = () => {
    const rv = review();
    if (rv.why && !why.value) why.value = rv.why;
    bidRec.className = `bidrec l-${rv.level}`;
    put(bidRec, h("b", { text: rv.head }), h("span", { text: rv.detail }));
    const decide = (call) => async () => {
      try { cur = await setBidCall(call, why.value); bidMsg.textContent = ""; } catch (e) { bidMsg.textContent = e.message; }
      drawBid(); drawHero(); drawDeliver();
    };
    put(bidCallBox,
      rv.call ? h("p", { class: `bidcalled c-${rv.call}`, text: `Decided on ${rv.on}: ${BID.CALLS[rv.call].toLowerCase()}.${rv.why ? ` ${rv.why}` : ""}` })
        : h("span", { class: "bidcalllabel", text: "The team's call" }),
      rv.call ? null : why,
      rv.call ? h("button", { type: "button", class: "btn small quiet", text: "Take the call back", onclick: decide("") })
        : [h("button", { type: "button", class: "btn small", text: "We bid", onclick: decide("bid") }), h("button", { type: "button", class: "btn small", text: "We do not bid", onclick: decide("no_bid") })],
      rv.call === "no_bid" ? h("button", { type: "button", class: "btn small", text: "Copy the letter declining it", onclick: (ev) => act("copy-letter", ev.currentTarget) }) : null,
      h("button", { type: "button", class: "btn small quiet", text: "Copy for the bid review", onclick: (ev) => copyText(BID.reviewMarkdown(cur, rv)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }));
  };
  const drawBid = () => { bidList.draw(); drawBidRest(); };
  const bidCard = card("Bid or no bid", h("div", { class: "bidbody" }, bidRec, bidList.el, bidCallBox, bidMsg),
    { sub: "Whether the tender is worth answering, reviewed as it goes. Four answers are read from the tender unless you give them; a no on a question that can exclude the bid stops it. The review advises, the team decides." });
  bidCard.id = "rfpbid";
  drawBidRest();

  // ---------------------------------------------------------------- what wins it: quality and price, ours against the rivals' guessed bids
  const a0 = AWD.cleanAward((cur.rfp && cur.rfp.award) || {});
  const numIn = (value, label, step = "any", extra = {}) => h("input", { type: "number", min: "0", step, value: value == null ? "" : String(value), "aria-label": label, class: "awardnum", ...extra });
  const aq = numIn(a0.quality, "Points for quality", "1", { max: String(AWD.POINTS_MAX) });
  const ap = numIn(a0.price, "Points for price", "1", { max: String(AWD.POINTS_MAX) });
  const af = h("select", { "aria-label": "How price is scored" }, Object.entries(AWD.FORMULAS).map(([k, f]) => h("option", { value: k, text: f.label, selected: k === a0.formula })));
  const ax = h("select", { "aria-label": "Share of the price points up to the average discount" }, ["0.8", "0.85", "0.9"].map((v) => h("option", { value: v, text: v, selected: Number(v) === a0.x })));
  const aalpha = numIn(a0.alpha, "Power the discount is raised to", "0.05", { max: "1" });
  const abase = numIn(a0.base, "Base amount", "1000", { placeholder: "the tender's starting amount" });
  const aresc = h("input", { type: "checkbox", checked: a0.rescale });
  const oq = numIn(a0.ours.quality, "Our quality points");
  const op = numIn(a0.ours.price, "Our price", "1000", { placeholder: "what we will offer" });
  const ahint = h("p", { class: "note awardhint" });
  const xWrap = h("label", { class: "szf" }, h("span", { text: "Share up to the average (X)" }), ax);
  const alphaWrap = h("label", { class: "szf" }, h("span", { text: "Power, below 1" }), aalpha);
  const awardMsg = h("p", { class: "note", role: "status" });
  const awardOut = h("div", { class: "awardout" });
  const rivalsBox = h("div", { class: "awardrivals" });
  let rivalRows = a0.rivals.map((r) => ({ name: r.name, quality: String(r.quality), price: String(r.price) }));
  const given = () => ({ quality: aq.value, price: ap.value, formula: af.value, x: ax.value, alpha: aalpha.value, base: abase.value, rescale: aresc.checked,
    ours: { quality: oq.value, price: op.value }, rivals: rivalRows });
  const saveAward = async () => {
    try { cur = await setAward(given()); awardMsg.textContent = ""; } catch (e) { awardMsg.textContent = e.message; }
    drawAward(); drawHero(); drawBid();
  };
  const drawRivals = () => {
    put(rivalsBox, rivalRows.length ? h("div", { class: "awardrival awardhead", "aria-hidden": "true" }, h("small", { text: "Name" }), h("small", { text: "Quality points" }), h("small", { text: "Price" }), h("span")) : null,
      rivalRows.map((r, i) => {
      const field = (k, label, attrs) => { const el = h("input", { value: r[k], "aria-label": `${label}, rival ${i + 1}`, ...attrs }); el.addEventListener("change", () => { rivalRows[i] = { ...rivalRows[i], [k]: el.value }; saveAward(); }); return el; };
      return h("div", { class: "awardrival" },
        field("name", "Name", { type: "text", maxlength: String(AWD.NAME_MAX), placeholder: `Rival ${String.fromCharCode(65 + i)}`, class: "awardname" }),
        field("quality", "Quality points", { type: "number", min: "0", step: "any", placeholder: "quality", class: "awardnum" }),
        field("price", "Price", { type: "number", min: "0", step: "1000", placeholder: "price", class: "awardnum" }),
        h("button", { type: "button", class: "btn small quiet", text: "Remove", "aria-label": `Remove rival ${i + 1}`, onclick: () => { rivalRows = rivalRows.filter((_, j) => j !== i); drawRivals(); saveAward(); } }));
    }), rivalRows.length < AWD.MAX_RIVALS ? h("button", { type: "button", class: "btn small", text: rivalRows.length ? "Add a rival" : "Add a rival's guessed bid",
      onclick: () => { rivalRows = [...rivalRows, { name: "", quality: "", price: "" }]; drawRivals(); rivalsBox.querySelector(".awardrival:last-of-type input").focus(); } }) : null);
  };
  const drawAward = () => {
    const st = RFP.rfpState(catalog, cur, today);
    const a = AWD.cleanAward(given());
    const fromReqs = AWD.ourQuality({ ...a, ours: { ...a.ours, quality: null } }, st.points).value;
    oq.placeholder = fromReqs != null ? `${AWD.pts(fromReqs)} from the requirements` : "e.g. 52";
    ahint.textContent = AWD.FORMULAS[a.formula].hint;
    xWrap.hidden = a.formula !== "bilinear";
    alphaWrap.hidden = a.formula !== "concave";
    const s = AWD.standings(a, st.points);
    const said = AWD.awardSay(a, s);
    if (!s.ready) { put(awardOut, h("p", { class: "awardlead", text: said.lead })); return; }
    const max = a.quality + a.price || 1;
    const name = (b) => (b.us ? "Us" : b.name);
    put(awardOut,
      h("p", { class: `awardlead ${s.rank === 1 ? "first" : "behind"}`, role: "status", text: said.lead }),
      h("ol", { class: "awardbars" }, s.bids.map((b) => h("li", { class: b.us ? "us" : "" },
        h("span", { class: "awardwho", text: name(b) }),
        h("span", { class: "awardtrack", role: "img", "aria-label": `${name(b)}: quality ${AWD.pts(b.quality)}, price ${AWD.pts(b.price_points)}, total ${AWD.pts(b.total)}` },
          h("i", { class: "aq", style: `width:${((b.quality / max) * 100).toFixed(2)}%` }), h("i", { class: "ap", style: `width:${((b.price_points / max) * 100).toFixed(2)}%` })),
        h("b", { class: "awardtotal", text: AWD.pts(b.total) }),
        h("small", { class: "awardprice", text: `${AWD.money(b.price)}${b.discount != null ? `, ${AWD.pct(b.discount)} off` : ""}` })))),
      h("p", { class: "rfplegend" }, h("span", {}, h("i", { class: "dot aq" }), "Quality"), h("span", {}, h("i", { class: "dot ap" }), "Price")),
      h("p", { class: "awardturn", text: said.turn }),
      said.worth ? h("p", { class: "note", text: said.worth }) : null,
      s.over_base ? h("p", { class: "awardwarn", text: "Our price is above the base amount: most tenders exclude such a bid." }) : null,
      s.low ? h("p", { class: "awardwarn", text: "Our price is far below the rivals': the contracting authority may ask us to justify it as abnormally low." }) : null,
      h("p", { class: "note", text: `${s.quality_from === "requirements" ? "Our quality points are read from the scored requirements, as answered. " : ""}The rivals' figures are guesses: the result is only as good as they are.` }),
      h("div", { class: "btnrow" },
        h("button", { type: "button", class: "btn small", text: "Copy for the bid review", onclick: (ev) => copyText(AWD.awardMarkdown(a, s)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }),
        h("button", { type: "button", class: "btn small quiet", text: "Clear the comparison", onclick: async () => {
          try { cur = await setAward(null); } catch (e) { awardMsg.textContent = e.message; return; }
          const d = AWD.cleanAward({});
          aq.value = String(d.quality); ap.value = String(d.price); af.value = d.formula; ax.value = String(d.x); aalpha.value = String(d.alpha);
          abase.value = ""; aresc.checked = false; oq.value = ""; op.value = ""; rivalRows = []; drawRivals(); drawAward(); drawHero();
        } })));
  };
  for (const el of [aq, ap, af, ax, aalpha, abase, aresc, oq, op]) el.addEventListener("change", saveAward);
  drawRivals(); drawAward();
  const awardCard = card("What wins it: price and quality", h("div", { class: "awardgrid" },
    h("div", { class: "awardin" },
      h("h3", { text: "How the tender scores" }),
      h("div", { class: "szgrid" }, h("label", { class: "szf" }, h("span", { text: "Points for quality" }), aq), h("label", { class: "szf" }, h("span", { text: "Points for price" }), ap),
        h("label", { class: "szf awardformula" }, h("span", { text: "Price scored as" }), af), h("label", { class: "szf" }, h("span", { text: "Base amount" }), abase), xWrap, alphaWrap),
      ahint, h("label", { class: "awardcheck" }, aresc, " Quality rescaled so the best bid gets every quality point"),
      h("h3", { text: "Our bid" }),
      h("div", { class: "szgrid" }, h("label", { class: "szf" }, h("span", { text: "Quality points" }), oq), h("label", { class: "szf" }, h("span", { text: "Price" }), op)),
      h("h3", { text: "The rivals, guessed" }), rivalsBox, awardMsg),
    awardOut),
  { sub: "When the tender goes to the best ratio of quality to price: who comes first at the price planned, the price at which that changes, and what a point of quality is worth. Use the tender's own scoring; the rivals' bids are your best guesses. Nothing leaves this browser." });
  awardCard.id = "rfpaward";

  return h("div", {}, hero,
    card("Load the tender", h("div", {}, h("div", { class: "szgrid" }, h("label", { class: "szf" }, h("span", { text: "Name" }), title),
      h("label", { class: "szf" }, h("span", { text: "Who issued it" }), issuer),
      h("label", { class: "szf" }, h("span", { text: "Questions to the contracting authority due" }), qdue), h("label", { class: "szf" }, h("span", { text: "Bid due" }), due)), channel, loader, addSay),
    { sub: "Paste the requirements or read the tender's file: each is read as mandatory or scored, with its points, and matched to the product line it asks about. English and Italian wording are recognised; nothing leaves this browser." }),
    listCard,
    bidCard,
    awardCard,
    card("Deliver the bid", h("div", {}, checks, deliver, sectionsBox,
      h("label", { class: "szf rfppages" }, h("span", { text: "Page limit of the technical response" }), pages),
      h("div", { class: "btnrow" },
      h("button", { class: "btn small", type: "button", text: "Technical response (.html, to print)", onclick: () => saveBlob(RFP.responseHtml(catalog, cur, new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })), `${slug}-technical-response.html`, "text/html") }),
      h("button", { class: "btn small", type: "button", text: "Technical response (.md)", onclick: () => saveBlob(RFP.responseMarkdown(catalog, cur, today), `${slug}-technical-response.md`, "text/markdown") }),
      h("button", { class: "btn small", type: "button", text: "Compliance matrix (.csv)", onclick: exportCsv }),
      h("button", { class: "btn small", type: "button", text: "Bid summary (.md)", onclick: () => saveBlob(RFP.rfpMarkdown(catalog, cur, today), `${slug}-bid-summary.md`, "text/markdown") }),
      h("button", { class: "btn small", type: "button", text: "Copy the questions for the contracting authority", onclick: (ev) => copyQuestions(ev.target) }),
      restart, h("button", { class: "btn small quiet", type: "button", text: "Back to the questions", onclick: () => go("workshop") }))),
    { sub: "The technical response, section by section as the tender numbers it, with every answer and its attachments; the matrix for the bid team; the summary for the seller; the questions, drafted to put in the tender's language. Unfinished text is highlighted in the response. The requirements stay in this browser." }));
}

const REHEARSED = new Map();          // per workshop, while the page is open: how a rehearsal went; never kept

export function wsPrepView({ workshop: w, catalog, raise, go }) {
  const res = WS.assess(catalog, w);
  const told = WS.stories(catalog, w, res);
  if (!told.length) return card("Prepare", h("p", { class: "note first", text: "The product lines in scope do not come with messages or objections yet. Add a story.json to their profiles to see them here." }));
  const count = h("b", { text: String((w.raised || []).length) });
  const summary = h("p", { class: "tline" }, count, " raised so far. Each one raised goes to the customer readout as something to prove, and into the proof of value when it starts.");
  const say = h("p", { class: "note", role: "status" });
  // rehearsing: each objection as a card, said aloud and swiped by whether the answer was there
  if (!REHEARSED.has(w.id)) REHEARSED.set(w.id, new Map());
  const rehearsal = REHEARSED.get(w.id);
  let cur = w;                       // what is marked raised here changes the order: the cards are dealt when the deck opens
  const rCards = DECK.rehearseCards(told);
  const rSet = { ...DECK.REHEARSE, label: (k) => (k === "ready" ? "I had it" : "Practise again"), tone: (k) => (k === "ready" ? "good" : "bad"),
    tag: (c) => c.tag, hint: "Say your answer aloud, then swipe", how: "What to say", backLabels: { why: "Ask first", listen: "Answer", probe: "Prove it" },
    saidLabel: "Your answer, in a few words", saidHint: "What you would say", doneWord: "rehearsed", openText: "Back to what is not rehearsed",
    summary: (cs, answerOf) => DECK.rehearseSummary(cs, answerOf), end: { text: "Back to Prepare", view: "" } };
  const rDone = [...rehearsal.values()];
  const rLine = rDone.length ? h("p", { class: "note", text: `Rehearsed on this visit: ${rDone.filter((x) => x.a === "ready").length} ready, ${rDone.filter((x) => x.a === "again").length} to practise again. Nothing of it is kept.` }) : null;
  const rehearse = rCards.length ? h("div", { class: "btnrow" }, h("button", { class: "btn small primary", type: "button", text: "Rehearse the objections",
    "data-tip": "Before the meeting, full screen: what the customer would say, one card each; say your answer aloud, turn the card to check it, and swipe right if you had it, left to practise it again. Nothing is kept.",
    onclick: () => {
      const cards = DECK.rehearseCards(WS.stories(catalog, cur, WS.assess(catalog, cur)));
      openDeck({ cards, state: { at: Math.max(0, cards.findIndex((c) => !rehearsal.has(c.key))), drafts: new Map() }, set: rSet, go: (v) => { if (v) go(v); },
        answerOf: (c) => rehearsal.get(c.key) || null, answer: async (c, a, note) => { rehearsal.set(c.key, { a, note }); }, onClose: () => go("wsprep") });
    } })) : null;
  const hero = h("section", { class: "card" }, h("h2", { text: "Prepare the conversation" }),
    h("p", { class: "note first", text: res.land ? `Starting with ${res.land.label.toLowerCase()}, from what the customer said. Mark an objection when the customer raises it: ask the question first, then answer.` : "For every line in scope. Mark an objection when the customer raises it: ask the question first, then answer." }),
    summary, rehearse, rLine, say);
  const block = (t) => {
    const text = [...Object.entries(t.audiences).map(([k, v]) => `${WS.AUDIENCE_WORDS[k]}: ${v}`), t.people.length ? `Who to involve: ${t.people.join("; ")}.` : ""].filter(Boolean).join("\n");
    const objs = h("ol", { class: "objs" }, t.objections.map((o) => {
      const btn = h("button", { class: "btn small objraise", type: "button", "aria-pressed": String(o.raised), text: o.raised ? "Raised" : "They raised it",
        "aria-label": `${o.raised ? "Raised" : "Mark as raised"}: ${o.says}`,
        onclick: async () => {
          const on = btn.getAttribute("aria-pressed") !== "true";
          try {
            const next = await raise(t.profile, o.index, on);
            if (next) cur = next;
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
      list("What did not land in the demos", (ls.missed || []).map((m) => h("li", {}, h("span", { text: m.part }), h("small", { class: "muted", text: ` ${m.line.toLowerCase()}: ${m.count} demo${m.count === 1 ? "" : "s"}${m.won + m.lost ? `, ${m.won} won and ${m.lost} not` : ""}` })))),
      list("The gaps heard most", ls.gaps.map((g) => h("li", {}, h("span", { text: g.q }), h("small", { class: "muted", text: ` ${g.line.toLowerCase()}: ${g.count}${g.unknown ? `, ${g.unknown} where nobody knew` : ""}` })))),
      list("When not won", ls.reasons.map((r) => h("li", { text: `${r.label}: ${r.count}` }))),
      list("What the deals not won had not established", ((ls.not_established || {}).tags || []).map((t) => h("li", { text: `${t.tag}: ${t.count} of ${ls.not_established.of}` }))),
      list("By route to purchase", (ls.routes || []).map((r) => h("li", { text: `${r.label}: ${r.won} won of ${r.count}` }))),
      list("What else they weighed", (ls.alternatives || []).map((a) => h("li", { text: `${a.label}: ${a.count} prospect${a.count === 1 ? "" : "s"}${a.decided ? `, ${a.won} won of ${a.decided} decided` : ""}` }))),
      list("Tests not met", ls.not_met.map((t) => h("li", { text: `${t.text} (${t.count})` }))),
      list("Where deals start", ls.lands.map((x) => h("li", { text: `${x.label}: ${x.count}` })))),
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Copy for enablement and leadership", onclick: (ev) => copyText(md).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
  { sub: "Across every prospect: how deals ended and why, what customers push back on, the gaps heard most, the tests not met, and how long each stage takes. Record the outcome of each proof of value to complete it." });
}

export function deskView({ workshops, povs, catalog, today, openOpp, openTender, newWorkshop, example, fillExamples, removeExamples }) {
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
  // the partners across every deal: what to bring to the review with each of them
  const partners = DESK.partnerReview(workshops, povs, catalog, today);
  const partnerCard = partners.length ? card("Partners across your deals", h("div", {},
    h("div", { class: "tablewrap", tabindex: "0", role: "region", "aria-label": "Partners across your deals" }, h("table", { class: "pttable ptdesk" },
      h("thead", {}, h("tr", {}, ["Partner", "Live deals", "They lead", "Registrations to act on", "Won and lost", "Skills to line up"].map((t) => h("th", { scope: "col", text: t })))),
      h("tbody", {}, partners.map((x) => h("tr", {},
        h("th", { scope: "row" }, h("b", { text: x.name }), h("small", { class: "muted", text: ` ${x.kinds.join(", ").toLowerCase()}${x.example ? " (example)" : ""}` })),
        h("td", { text: String(x.deals.length) }), h("td", { text: String(x.deals.filter((d) => d.lead).length) }),
        h("td", {}, x.expiring.length ? h("ul", { class: "ptmini" }, x.expiring.map((e) => h("li", { class: e.status === "none" ? "" : "late",
          text: `${e.customer}: ${e.status === "none" ? "not registered" : e.status === "expired" ? `ran out ${e.until}` : `${e.days} day${e.days === 1 ? "" : "s"} left`}` }))) : h("span", { class: "muted", text: "None" })),
        h("td", { text: `${x.won} won, ${x.lost} lost` }),
        h("td", { text: x.lines.length ? x.lines.join(", ") : "None" })))))),
    h("div", { class: "btnrow" }, h("button", { class: "btn small", type: "button", text: "Copy the partner review", onclick: (ev) => copyText(DESK.partnerReviewMarkdown(partners, today)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Not copied"; }) }))),
  { sub: "Each partner's live deals, the registrations to renew or file, what was won and lost with them, and the lines they are asked to deliver without the skills: the agenda for the review with the partner or the channel manager." }) : null;
  const agendaCard = card("This week and next", items.length
    ? h("ul", { class: "jdated deskagenda" }, items.map((i) => h("li", { class: i.late ? "late" : "" },
      h("span", { class: "jdate", text: i.late ? "late" : i.on.slice(8) }),
      h("span", {}, h("b", { text: `${i.customer}: ${i.what}` }), h("small", { class: "muted", text: `${i.on}${i.who ? `, owner: ${i.who}` : ""}${i.kind === "pov" ? ", proof of value" : ""}` })))))
    : h("p", { class: "note first", text: "Nothing dated in the next two weeks. Give the conditions in a journey an owner and a date, or set the dates of a proof of value." }),
  { sub: "Dated conditions from every journey and the start and end of every proof of value; what is late comes first." });
  const cols = [
    { key: "customer", label: "Prospect", render: (o) => h("span", {}, h("b", { text: o.customer }), o.example ? h("small", { class: "muted", text: " (example)" }) : null,
      o.partner || o.phase ? h("small", { class: "block muted", text: [o.partner ? `with ${o.partner}` : "", o.phase && !o.stopped ? `now: ${o.phase.toLowerCase()}` : ""].filter(Boolean).join("; ") }) : null) },
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
  // what could stop a deal: one block per prospect, the risks that can lose it on their own first, each with what to do;
  // the prospects with the most of those first, and the way back to each once
  const highs = (o) => o.risks.filter((r) => r.level === "high").length;
  const flagged = opps.filter((o) => !o.stopped && o.risks.length).sort((a, b) => highs(b) - highs(a) || b.risks.length - a.risks.length);
  const riskCard = flagged.length ? card("What could stop a deal", h("div", { class: "deskstops" }, flagged.map((o) => {
    const high = highs(o), watch = o.risks.length - high;
    const list = [...o.risks].sort((x, y) => (x.level === y.level ? 0 : x.level === "high" ? -1 : 1));
    return h("section", { class: "deskstop", "aria-label": o.customer },
      h("div", { class: "deskstophead" }, h("b", { text: o.customer }),
        h("span", { class: "deskstopcount", text: [high ? `${high} can lose it` : "", watch ? `${watch} to watch` : ""].filter(Boolean).join(", ") }),
        o.workshop ? h("button", { class: "btn small", type: "button", text: "Open", "aria-label": `Open ${o.customer}`, onclick: () => openOpp(o) }) : null),
      h("ul", { class: "deskstoplist" }, list.map((r) => h("li", { class: r.level },
        h("span", { class: "sr-only", text: r.level === "high" ? "Can lose it: " : "Watch: " }), r.text))));
  })),
  { sub: "Read from what is recorded: late conditions, a proof without a sponsor or ending with tests not tried, concerns left out of the proof, no figures for finance. Each says what to do; a red dot can lose the deal on its own." }) : null;
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
  // tenders in progress, the nearest deadline first: where each bid stands and what is due next
  const tenders = RFP.tendersOverview(workshops, catalog, today);
  const tenderCard = tenders.length ? card("Tenders in progress", h("ul", { class: "desktenders" }, tenders.map((t) => h("li", {},
    h("div", { class: "dtname" }, h("b", { text: t.customer }), h("small", { class: "muted", text: [t.title, t.issuer].filter(Boolean).join(", ") || "Tender" })),
    h("span", { class: `rfpverdictpill ${t.verdict.level}`, text: { risk: "At risk", clarify: "To clarify", go: "Can bid", empty: "Empty", nobid: "Not bidding" }[t.verdict.level] }),
    h("span", { class: "dtbar" }, h("span", { class: "rfpbartrack rfpmini", role: "img", "aria-label": `${t.answered} of ${t.total} answered` },
      ["yes", "partly", "no", "check"].filter((k) => t[k]).map((k) => h("i", { class: `seg s-${k}`, style: `width:${((t[k] / t.total) * 100).toFixed(2)}%` }))),
      h("small", { class: "muted", text: `${t.answered} of ${t.total}${t.must_no ? `, ${t.must_no} mandatory not met` : ""}${t.award ? `; ${t.award.rank === 1 ? "first" : ["", "", "second", "third", "fourth", "fifth"][t.award.rank]} of ${t.award.of} on price and quality` : ""}` })),
    t.next ? h("span", { class: "chip" + (t.next.in <= 7 ? " warn" : ""), text: `${t.next.what} ${t.next.on}${t.next.in < 0 ? `, ${-t.next.in} days ago` : t.next.in === 0 ? ", today" : `, in ${t.next.in} days`}` }) : h("span", { class: "muted", text: "No date yet" }),
    openTender ? h("button", { type: "button", class: "btn small", text: "Open the tender", "aria-label": `Open the tender of ${t.customer}`, onclick: () => openTender(t.workshop) }) : null))),
  { sub: "Every tender kept in this browser, the nearest deadline first: whether it can bid, how far it is answered, and what is due next." }) : null;
  return h("div", {}, hero, h("div", { class: "card deskfunnelcard" }, funnelRow), riskCard, tenderCard, lessonsCard, partnerCard, h("div", { class: "col2" }, agendaCard, docs), card("Opportunities", table.el, { sub: "Furthest along first. Open one to carry on: its questions, its journey, its proof of value." }),
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
        h("thead", {}, h("tr", {}, ["Engineer", "Open", "Discovery", "Journey", "Proof", "Decision", "Won", "Lost or no decision", "At risk", "Evidence (median)", "Qualified for a proof", "Snapshot of"].map((x) => h("th", { scope: "col", text: x })))),
        h("tbody", {}, t.engineers.map((e) => h("tr", {}, h("th", { scope: "row", text: e.name }), h("td", { text: String(e.live) }),
          ...["discovery", "journey", "proof", "decision"].map((id) => h("td", { text: String(e.stages[id]) })),
          h("td", { text: String(e.won) }), h("td", { text: String(e.lost) }), h("td", { class: e.at_risk ? "neg" : "", text: String(e.at_risk) }), h("td", { text: e.evidence == null ? "—" : `${e.evidence}/100` }), h("td", { text: String(e.qualified) }), h("td", { text: e.as_of })))))),
      (t.partners || []).length ? h("div", { class: "growproof" }, h("small", { text: "Partners across the team" }),
        h("ul", {}, t.partners.slice(0, 10).map((x) => h("li", {}, h("b", { text: x.name }),
          h("span", { class: "muted", text: `: ${x.live} live deal${x.live === 1 ? "" : "s"} with ${x.engineers.join(", ")}; won ${x.won}, lost ${x.lost}` }),
          x.expiring.length ? h("span", { class: "neg", text: `; registration ${x.expiring.map((e) => `${e.customer} ${e.ran_out ? "ran out" : "runs out"} ${e.until}`).join(", ")}` }) : null)))) : null,
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
