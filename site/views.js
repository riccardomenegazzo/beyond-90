// The dashboard views. Each takes a context {result, dash, score, engine, files, options, go} and returns a Node.
import { h, chip, pct, pts, num, cap, dataTable, chipFilter, searchBox, toCsv, saveBlob, copyText } from "./ui.js";
import { gauge, waterfall, lineChart, contributions, timeline, shareBar, STAGE, STAGE_NAME } from "./charts.js";

const card = (title, body, { sub = "", cls = "", actions = null } = {}) =>
  h("section", { class: "card " + cls }, h("header", { class: "cardhead" }, h("h2", { text: title }), actions), sub ? h("p", { class: "note first", text: sub }) : null, body);
const stat = (value, label, kind = "") => h("div", { class: "stat " + kind }, h("b", { text: value }), h("span", { text: label }));
const SEV = { critical: "bad", high: "warn", medium: "", low: "" };
const STATUS_KIND = { ok: "good", pass: "good", watch: "warn", risk: "bad", fail: "bad", note: "", warn: "warn", unknown: "" };

function csvButton(name, columns, getRows) {
  return h("button", { class: "btn small", type: "button", text: "Export CSV", onclick: () => saveBlob(toCsv(columns, getRows()), name, "text/csv") });
}

// ------------------------------------------------------------------ overview
export function overview({ result, dash, score, go }) {
  const st = score.stages, unit = score.terms.units;
  const rub = score.rubric, lv = rub.levels.find((l) => l.level === rub.level), next = rub.next_level;
  const heroRight = h("div", { class: "hero-right" },
    h("div", { class: "levelrow" },
      h("span", { class: "levelbadge lv-" + rub.level, text: cap(rub.level) + (rub.provisional ? " (provisional)" : "") }),
      next ? h("span", { class: "note", text: `${rub.blocking.length} check${rub.blocking.length === 1 ? "" : "s"} to ${cap(next)}` }) : h("span", { class: "note", text: "Top level" })),
    h("p", { class: "legacy" }, "Legacy metric ", h("b", { text: pct(score.naive) }), score.naive != null ? h("span", { class: "gap", text: ` · gap ${((score.naive - score.yield) * 100).toFixed(1)} pts` }) : null),
    h("div", { class: "mini" }, stat(pct(score.target.value, 0), `target (${score.target.mode})`), stat(pct(result.reach), "reach"), stat(String(result.actions), "open actions"), stat(result.confidence, "input confidence")),
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

  return h("div", { class: "grid" },
    hero,
    h("div", { class: "col2" },
      card("Where Yield is lost", waterfall(st), { sub: `Yield = ${Object.keys(st).join(" × ")}. Each stage is measured against its own denominator of ${unit}.` }),
      card("Needs attention", flags.length ? h("ul", { class: "flags" }, flags.map((f) => h("li", { class: f.kind }, h("b", { text: f.title }), h("span", { text: f.text }), f.go ? h("button", { class: "link", type: "button", text: f.cta || "Open", onclick: () => go(f.go) }) : null))) : h("p", { class: "note", text: "Nothing stands out." }))),
    h("div", { class: "col2" },
      card("Biggest opportunities", opp, { sub: "Ranked by points of Yield per hour of work. Effects interact; the plan accounts for that.", actions: h("button", { class: "btn small", type: "button", text: "All actions", onclick: () => go("actions") }) }),
      card("If you follow the plan", planChart, { sub: `${p.hours_per_week} h a week for ${p.horizon_weeks} weeks at ${Math.round(p.realization * 100)}% realization: ` + (p.milestones["90%"] != null ? `90% in week ${p.milestones["90%"]}.` : "90% is not reached in this horizon."), actions: h("button", { class: "btn small", type: "button", text: "What-if", onclick: () => go("planview") }) })));
}

function attention({ result, dash, score }) {
  const out = [], o = score.outcomes, u = score.universe;
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
      h("button", { class: "btn small", type: "button", text: "Copy as ticket", onclick: (e) => copyText(ticket(r, score)).then((ok) => { e.target.textContent = ok ? "Copied" : "Copy not available"; }) })) });
  const apply = () => t.setFilter((r) => (!leaks.size || leaks.has(r.leak)) && (!q || (r.title + " " + r.detail + " " + r.owner).toLowerCase().includes(q)));
  const total = rows.reduce((a, r) => a + r.effect, 0), hrs = rows.reduce((a, r) => a + r.hours, 0);
  return h("div", {},
    h("div", { class: "toolbar" }, searchBox("Search actions", (v) => { q = v; apply(); }),
      chipFilter("Stage", ["L1", "L2", "L3", "L4"], (s) => { leaks = s; apply(); }),
      csvButton("beyond90-actions.csv", [{ key: "rank", label: "rank" }, { key: "leak", label: "stage" }, { key: "title", label: "action" }, { key: "detail", label: "detail" }, { key: "effect", label: "effect_points" }, { key: "hours", label: "hours" }, { key: "owner", label: "owner" }, { key: "due", label: "due" }], () => t.rows())),
    h("p", { class: "note", text: `${rows.length} actions, ${hrs.toFixed(0)} hours in all. Effects are estimates that treat each stage on its own; use them to rank, not to add up (the sum here would be ${total.toFixed(0)} points).` }),
    t.el);
}
const ticket = (a, score) => [`[${score.customer}] ${a.title}`, "", a.detail, "", `Stage: ${a.leak}  ·  Effect: +${a.effect.toFixed(1)} pts  ·  Effort: ${a.hours.toFixed(1)} h  ·  Owner: ${a.owner}  ·  Due: ${a.due}`, "", ...(a.steps.length ? ["Steps:", ...a.steps.map((s, i) => `${i + 1}. ${s}`), ""] : []), a.success ? `Done when: ${a.success}` : ""].join("\n").trim();

// ------------------------------------------------------------------ accounts
export function accountsView({ dash, score }) {
  const A = dash.accounts, unit = cap(score.terms.unit), rows = A.rows;
  let q = "", prov = new Set(), flt = new Set();
  const cols = [
    { key: "id", label: unit, render: (r) => h("b", { text: r.id }) },
    { key: "provider", label: "Provider" },
    { key: "owner", label: "Owner", render: (r) => r.owner || h("span", { class: "dim", text: "—" }) },
    { key: "spend", label: "Spend", num: true, render: (r) => num(r.spend) },
    { key: "connected", label: "State", sort: (r) => (r.connected ? 1 : 0), render: (r) => chip(r.connected ? "connected" : "not connected", r.connected ? "good" : "bad") },
    { key: "issues", label: "Gaps", num: true, render: (r) => (r.issues ? chip(String(r.issues), r.issues > 3 ? "bad" : "warn") : chip("0", "good")) },
    { key: "open_findings", label: "Open findings", num: true, render: (r) => (r.open_critical ? `${r.open_findings} (${r.open_critical} critical)` : String(r.open_findings)) },
  ];
  const t = dataTable({ columns: cols, rows, pageSize: 40, label: "Accounts", empty: `No ${score.terms.unit} matches.`,
    expand: (r) => h("div", { class: "expand" },
      h("p", {}, h("b", { text: "Seen by: " }), r.sources.join(", ") || "none"),
      r.connected ? null : h("p", { class: "bad-text", text: "Not connected: it counts against L1." }),
      r.missing_types.length ? h("p", {}, h("b", { text: "Not inventoried: " }), r.missing_types.join(", ")) : null,
      r.inactive_modules.length ? h("p", {}, h("b", { text: "Capabilities off: " }), r.inactive_modules.join(", ")) : null,
      !r.issues ? h("p", { class: "dim", text: "Nothing missing." }) : null) });
  const apply = () => t.setFilter((r) => (!prov.size || prov.has(r.provider)) && (!flt.size || [...flt].every((f) => (f === "gaps" ? r.issues > 0 : f === "unconnected" ? !r.connected : f === "critical" ? r.open_critical > 0 : f === "unowned" ? !r.owner : true))) &&
    (!q || (r.id + " " + r.owner + " " + r.provider).toLowerCase().includes(q)));
  const conn = rows.filter((r) => r.connected).length;
  return h("div", {},
    h("div", { class: "kpiline" }, stat(String(A.total), `${score.terms.units} in scope`), stat(String(conn), "connected", "good"), stat(String(A.total - conn), "not connected", A.total - conn ? "bad" : ""), stat(String(rows.filter((r) => r.issues).length), "with at least one gap")),
    h("div", { class: "toolbar" }, searchBox(`Search ${score.terms.units} or owner`, (v) => { q = v; apply(); }),
      chipFilter("Provider", A.providers, (s) => { prov = s; apply(); }),
      chipFilter("Show", [{ label: "with gaps", value: "gaps" }, { label: "not connected", value: "unconnected" }, { label: "critical findings", value: "critical" }, { label: "no owner", value: "unowned" }], (s) => { flt = s; apply(); }),
      csvButton("beyond90-accounts.csv", [{ key: "id", label: "id" }, { key: "provider", label: "provider" }, { key: "owner", label: "owner" }, { key: "spend", label: "last_spend" }, { key: "connected", label: "connected" }, { key: "issues", label: "gaps" }, { key: "missing_types", label: "not_inventoried", csv: (r) => r.missing_types.join(";") }, { key: "inactive_modules", label: "capabilities_off", csv: (r) => r.inactive_modules.join(";") }, { key: "open_findings", label: "open_findings" }], () => t.rows())),
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
  return h("div", {},
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
    out.replaceChildren(
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
    lad && lad.week != null ? h("p", { class: "note", text: `At ${lad.hours_per_week} hours a week, the roadmap passes the stage checks for ${cap(lad.level)} in week ${lad.week}, after about ${lad.hours.toFixed(0)} hours.` + (lad.outside_plan.length ? ` ${lad.outside_plan.length} check(s) need a decision or a conversation, not hours.` : "") }) : null,
    h("div", { class: "col2" }, card("Adoption by use case", rateBars(uc.map((u) => ({ label: u.label, rate: u.rate, note: `${u.active} of ${u.relevant}` })))),
      card("NIST CSF 2.0 functions", rateBars(fn.map(([k, v]) => ({ label: cap(k), rate: v.rate, note: v.rate == null ? "no capability serves it" : `${v.active} of ${v.relevant}` }))), { sub: "Capability adoption, not a compliance statement." })),
    h("div", { class: "col3" }, groups));
}
const fmtVal = (v) => (v == null ? "n/a" : Math.abs(v) <= 1 && v !== 0 && !Number.isInteger(v) ? pct(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));
function rateBars(items) {
  return h("ul", { class: "rates" }, items.map((i) => h("li", {}, h("span", { class: "rl", text: i.label }), h("span", { class: "rb", role: "img", "aria-label": `${i.label} ${i.rate == null ? "n/a" : pct(i.rate, 0)}` }, i.rate == null ? null : h("i", { style: `width:${i.rate * 100}%` })), h("span", { class: "rn", text: i.rate == null ? "n/a" : pct(i.rate, 0) }), h("small", { text: i.note }))));
}

// ------------------------------------------------------------------ renewal and relationship
export function renewalView({ score, dash }) {
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
  return h("div", {}, head, h("div", { class: "col2" }, sig, h("div", {}, licences, universe)), contacts);
}

// ------------------------------------------------------------------ portfolio
export function bookView({ book, openCustomer }) {
  const cs = book.customers, totalArr = cs.reduce((a, c) => a + c.arr, 0);
  const heat = (v) => `background:color-mix(in srgb,var(--accent) ${Math.round(Math.max(0, Math.min(1, (v - 0.5) / 0.5)) * 55)}%,transparent)`;
  const cols = [
    { key: "name", label: "Customer", render: (c) => h("b", { text: c.name }) },
    { key: "arr", label: "ARR", num: true, render: (c) => h("span", {}, num(c.arr), h("i", { class: "arrbar", style: `width:${(c.arr / Math.max(...cs.map((x) => x.arr))) * 60}px` })) },
    ...["L1", "L2", "L3", "L4"].map((k) => ({ key: k, label: k + " " + STAGE_NAME[k], num: true, sort: (c) => c.stages[k], render: (c) => h("span", { class: "heatcell", style: heat(c.stages[k]), text: pct(c.stages[k]) }) })),
    { key: "yield", label: "Yield", num: true, render: (c) => h("b", { text: pct(c.yield) }) },
    { key: "planned_yield", label: "After the plan", num: true, render: (c) => pct(c.planned_yield) },
    { key: "hours", label: "Hours", num: true, render: (c) => c.hours.toFixed(0) },
    { key: "level", label: "Level", render: (c) => h("span", { class: "levelbadge small lv-" + c.level, text: cap(c.level) }) },
    { key: "critical_open", label: "Critical open", num: true },
    { key: "open", label: "", render: (c) => h("button", { class: "btn small", type: "button", text: "Open", onclick: () => openCustomer(c.key) }) },
  ];
  const worst = [...cs].sort((a, b) => a.yield - b.yield)[0], gain = [...cs].sort((a, b) => (b.planned_yield - b.yield) * b.arr - (a.planned_yield - a.yield) * a.arr)[0];
  return h("div", {},
    h("div", { class: "kpiline" }, stat(pct(book.arr_weighted_yield), "ARR-weighted Yield"), stat(pct(book.weighted_end), "after the plan", "good"), stat(String(cs.length), "customers"), stat(num(totalArr), "ARR in the book"), stat(String(book.patterns), "shared patterns")),
    h("div", { class: "col2" },
      card("Where to look first", h("ul", { class: "flags" }, [
        h("li", { class: "bad" }, h("b", { text: `${worst.name} has the lowest Yield (${pct(worst.yield)})` }), h("span", { text: `${worst.critical_open} critical finding(s) open.` }), h("button", { class: "link", type: "button", text: "Open", onclick: () => openCustomer(worst.key) })),
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
    h("button", { class: "btn small", type: "button", text: "Copy", onclick: (e) => copyText(markdown).then((ok) => { e.target.textContent = ok ? "Copied" : "Copy not available"; }) }),
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
    expCard);
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

/** The security news that touches this customer, in plain words, with a note to send. */
export function newsView({ dash, score, advisories }) {
  const list = dash.rhythm.exposures;
  if (!list.length) return card("News and advisories", h("p", { class: "note", text: advisories ? "None of the loaded advisories touch this customer's inventoried resources." : "No advisories are loaded. In step 1, add a feed (a JSON file) or try the demo feed, and each one is matched to this customer's inventory." }));
  const units = score.terms.units;
  return h("div", {}, h("p", { class: "note", text: "Matched against what is inventoried here. An advisory can also touch resources that were never inventoried; those are counted as unknown, not as safe." }),
    list.map((e) => card(`${e.id}: ${e.title}`, h("div", {},
      h("div", { class: "kpiline" }, stat(String(e.exposed), `exposed ${units}`), stat(String(e.covered), "covered", e.covered ? "good" : ""), stat(String(e.uncovered), "not covered", e.uncovered ? "bad" : "good"), stat(String(e.unknown), "cannot be assessed", e.unknown ? "warn" : ""), e.yield_gain_points ? stat("+" + e.yield_gain_points.toFixed(1) + " pts", "Yield if covered") : null),
      e.summary ? h("p", { text: e.summary }) : null,
      h("p", { class: "note" }, chip(e.severity, SEV[e.severity] || ""), ` published ${e.published || "n/a"}${e.age_days != null ? ` (${e.age_days} days ago)` : ""}${e.source ? ` · ${e.source}` : ""} · mitigated by ${e.mitigated_by.join(", ")}`, e.url && e.url.startsWith("https://") ? [" · ", h("a", { href: e.url, target: "_blank", rel: "noopener noreferrer", text: "source" })] : null),
      e.uncovered_ids.length ? h("p", { class: "note", text: `Not covered: ${e.uncovered_ids.join(", ")}${e.uncovered > e.uncovered_ids.length ? ` and ${e.uncovered - e.uncovered_ids.length} more` : ""}` }) : null,
      h("div", { class: "row left" }, h("button", { class: "btn small", type: "button", text: "Copy a note for the customer", onclick: (ev) => copyText(customerNote(e, score)).then((ok) => { ev.target.textContent = ok ? "Copied" : "Copy not available"; }) }))),
      { cls: "news" })));
}

function customerNote(e, score) {
  const units = score.terms.units;
  const lines = [`${e.id}: ${e.title}`, ""];
  if (e.summary) lines.push(e.summary, "");
  if (!e.exposed) lines.push(`We could not find the affected resources in your inventoried ${units}.${e.unknown ? ` ${e.unknown} ${units} have not been inventoried, so we cannot rule them out.` : ""}`);
  else if (!e.uncovered) lines.push(`${e.exposed} of your ${units} are in scope, and all of them already have the protection that addresses this switched on. No action is needed from you.`);
  else lines.push(`${e.exposed} of your ${units} are in scope. ${e.uncovered} do not yet have ${e.mitigated_by.join(" or ")} switched on, which is what addresses this.`, "", `Suggested next step: enable it on ${e.uncovered_ids.slice(0, 5).join(", ")}${e.uncovered > 5 ? " and the rest" : ""}. We can do it with you this week.`);
  if (e.unknown) lines.push("", `${e.unknown} more ${units} are not inventoried yet, so we cannot say whether they are affected.`);
  return lines.join("\n");
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
