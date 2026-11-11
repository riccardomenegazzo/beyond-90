// A proof of value: what a prospect (or a customer trying a new part of the product) agreed would make it worth it, how
// each criterion turned out, and a result to hand over. No DOM and no storage, so Node can test it. A plan merges like any
// other fact: the copy updated later wins. "Today" is always passed in.
//
// It does not prove value by being written down. The report says what was shown, on what date, in whose environment, and
// what it does not show.

export const STATUSES = ["open", "met", "partly", "not_met", "dropped"];
export const STATUS_TEXT = { open: "Not yet tried", met: "Met", partly: "Partly met", not_met: "Not met", dropped: "Dropped" };
export const STAGES = ["planned", "running", "done", "stopped"];
export const MAX_POVS = 500;
const MAX_CRITERIA = 20, MAX_SESSIONS = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONCE = /^[a-z0-9]{6,12}$/;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const clean = text;
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

function randomNonce() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

/** Criteria to start from. They are edited, dropped or replaced: each should say what would be seen and how much. */
export const CRITERIA_TEMPLATES = [
  { text: "Every cloud account in scope is connected and visible", target: "All accounts in scope connected, with no manual inventory" },
  { text: "The first useful result arrives quickly", target: "A prioritised list of risks within one working day of connecting" },
  { text: "Risks are ranked so the team knows what to fix first", target: "The top risks have a reason, an exposure and a suggested owner" },
  { text: "A finding reaches its owner where the team already works", target: "One real finding becomes a ticket or a message to the right person" },
  { text: "Access and data exposure can be seen, not guessed", target: "At least one over-permissive identity or exposed data store found and explained" },
  { text: "A developer can see and fix a risk from their own tools", target: "One fix made from the code or pipeline side, end to end" },
  { text: "Reporting answers what leadership asks", target: "A view the sponsor accepts as their monthly report" },
];

export const READINESS_TEMPLATES = [
  "Read-only access agreed, and who approves it",
  "The accounts or subscriptions in scope are listed",
  "Success criteria signed off by the sponsor and the champion",
  "Security, legal and procurement steps are known",
  "Working sessions are in everyone's calendar",
  "An owner is named for each result",
];

export function makePov({ customer, sponsor = "", champion = "", start = "", end = "", createdOn, nonce = "", criteria = null, problem = "", outOfScope = "" }) {
  const name = text(customer, 200);
  if (!name) throw new Error("Say who the proof of value is for.");
  if (!isDate(createdOn)) throw new Error("A plan needs the date it was made.");
  if (start && !isDate(start)) throw new Error("Give the start as a date, or leave it empty.");
  if (end && !isDate(end)) throw new Error("Give the end as a date, or leave it empty.");
  if (start && end && end < start) throw new Error("The end cannot be before the start.");
  const n = nonce || randomNonce();
  if (!NONCE.test(n)) throw new Error("The identifier suffix must be 6 to 12 lowercase letters or digits.");
  const list = (criteria || CRITERIA_TEMPLATES.slice(0, 4)).slice(0, MAX_CRITERIA).map((c, i) => ({
    id: `c${i + 1}`, text: text(c.text, 200), target: text(c.target, 200), status: "open", evidence: "",
  })).filter((c) => c.text);
  return {
    id: `${name}|${createdOn}|${n}`, customer: name, sponsor: text(sponsor, 100), champion: text(champion, 100), start, end, stage: "planned",
    criteria: list, sessions: [], readiness: READINESS_TEMPLATES.map((t, i) => ({ id: `r${i + 1}`, text: t, done: false })),
    problem: text(problem, 300), out_of_scope: text(outOfScope, 300), signed_off_on: "", first_value_on: "",
    summary: "", created_on: createdOn, updated_on: createdOn,
  };
}

const okCriterion = (c) => !!c && typeof c === "object" && /^c\d{1,3}$/.test(c.id) && typeof c.text === "string" && c.text.length > 0 && c.text.length <= 200
  && typeof c.target === "string" && c.target.length <= 200 && STATUSES.includes(c.status) && typeof c.evidence === "string" && c.evidence.length <= 300;
const okSession = (s) => !!s && typeof s === "object" && isDate(s.on) && typeof s.topic === "string" && s.topic.length > 0 && s.topic.length <= 120 && typeof s.who === "string" && s.who.length <= 100;
const okReady = (r) => !!r && typeof r === "object" && /^r\d{1,3}$/.test(r.id) && typeof r.text === "string" && r.text.length > 0 && r.text.length <= 200 && typeof r.done === "boolean";

export function validPov(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  if (typeof p.customer !== "string" || !p.customer || p.customer.length > 200) return false;
  if (typeof p.sponsor !== "string" || p.sponsor.length > 100 || typeof p.champion !== "string" || p.champion.length > 100) return false;
  if (!(p.start === "" || isDate(p.start)) || !(p.end === "" || isDate(p.end)) || (p.start && p.end && p.end < p.start)) return false;
  // Optional, so plans kept before these existed stay valid.
  for (const k of ["problem", "out_of_scope"]) if (p[k] != null && (typeof p[k] !== "string" || p[k].length > 300)) return false;
  for (const k of ["signed_off_on", "first_value_on"]) if (p[k] != null && !(p[k] === "" || isDate(p[k]))) return false;
  if (!STAGES.includes(p.stage) || typeof p.summary !== "string" || p.summary.length > 1000) return false;
  if (!isDate(p.created_on) || !isDate(p.updated_on) || p.updated_on < p.created_on) return false;
  if (!Array.isArray(p.criteria) || p.criteria.length > MAX_CRITERIA || !p.criteria.every(okCriterion) || new Set(p.criteria.map((c) => c.id)).size !== p.criteria.length) return false;
  if (!Array.isArray(p.sessions) || p.sessions.length > MAX_SESSIONS || !p.sessions.every(okSession)) return false;
  if (!Array.isArray(p.readiness) || p.readiness.length > MAX_CRITERIA || !p.readiness.every(okReady) || new Set(p.readiness.map((r) => r.id)).size !== p.readiness.length) return false;
  const m = /^(.*)\|(\d{4}-\d{2}-\d{2})\|([a-z0-9]+)$/.exec(p.id || "");
  return !!m && m[1] === p.customer && m[2] === p.created_on && NONCE.test(m[3]);
}

export function acceptPovs(list) {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok = list.slice(0, MAX_POVS).filter(validPov);
  return { ok, rejected: list.length - ok.length };
}

export function mergePovs(a, b) {
  const byId = new Map();
  for (const p of [...a, ...b]) {
    const have = byId.get(p.id);
    if (!have || cmp(p.updated_on, have.updated_on) > 0 || (p.updated_on === have.updated_on && cmp(JSON.stringify(p), JSON.stringify(have)) < 0)) byId.set(p.id, p);
  }
  return [...byId.values()].sort((x, y) => cmp(x.customer, y.customer) || cmp(y.created_on, x.created_on) || cmp(x.id, y.id));
}

/** A copy with changes applied and the update date moved. `patch` may set: stage, summary, sponsor, champion, start, end. */
export function edit(p, patch, today) {
  if (!isDate(today) || today < p.created_on) throw new Error("Give today's date.");
  const next = { ...p, ...patch, updated_on: today };
  if (!validPov(next)) throw new Error("That change is not valid: check the dates and the lengths.");
  return next;
}

export function setCriterion(p, id, { status, evidence }, today) {
  if (!p.criteria.some((c) => c.id === id)) throw new Error("There is no such criterion.");
  return edit(p, { criteria: p.criteria.map((c) => (c.id === id ? { ...c, ...(status ? { status } : {}), ...(evidence != null ? { evidence: text(evidence, 300) } : {}) } : c)) }, today);
}

export function addCriterion(p, { text: t, target = "" }, today) {
  if (p.criteria.length >= MAX_CRITERIA) throw new Error("A proof of value with more than 20 criteria is not a proof of anything: drop some.");
  const n = Math.max(0, ...p.criteria.map((c) => Number(c.id.slice(1)))) + 1;
  return edit(p, { criteria: [...p.criteria, { id: `c${n}`, text: text(t, 200), target: text(target, 200), status: "open", evidence: "" }] }, today);
}

export function addSession(p, { on, topic, who = "" }, today) {
  if (p.sessions.length >= MAX_SESSIONS) throw new Error("That is already 20 sessions.");
  return edit(p, { sessions: [...p.sessions, { on, topic: text(topic, 120), who: text(who, 100) }].sort((a, b) => cmp(a.on, b.on) || cmp(a.topic, b.topic)) }, today);
}

export function setReady(p, id, done, today) {
  if (!p.readiness.some((r) => r.id === id)) throw new Error("There is no such item.");
  return edit(p, { readiness: p.readiness.map((r) => (r.id === id ? { ...r, done: !!done } : r)) }, today);
}

/** Where the criteria stand, and a verdict that does not flatter: it is "met" only when every counted criterion is. */
export function progress(p) {
  const counted = p.criteria.filter((c) => c.status !== "dropped");
  const n = (s) => counted.filter((c) => c.status === s).length;
  const total = counted.length, met = n("met"), partly = n("partly"), notMet = n("not_met"), open = n("open");
  let verdict = "no criteria";
  if (total) verdict = open ? "in progress" : notMet === 0 && partly === 0 ? "all criteria met" : notMet === 0 && met >= Math.ceil(total * 0.75) ? "mostly met" : "not met";
  const ready = p.readiness.filter((r) => r.done).length;
  return { total, met, partly, not_met: notMet, open, dropped: p.criteria.length - total, verdict, ready, ready_total: p.readiness.length };
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Is this worth starting? Five questions asked before the first session, each answered from what is written in the plan. */
export function qualify(p) {
  const counted = p.criteria.filter((c) => c.status !== "dropped");
  const days = p.start && p.end ? daysBetween(p.start, p.end) + 1 : null;
  const items = [
    { id: "problem", text: "The problem is stated in the customer's words", ok: !!(p.problem || "").trim(), fix: "Write the problem this proof must settle." },
    { id: "criteria", text: "Success criteria are signed off, each with how we will know", ok: !!p.signed_off_on && counted.length > 0 && counted.every((c) => c.target), fix: p.signed_off_on ? "Give every criterion a target." : "Record the date the sponsor signed off the criteria." },
    { id: "sponsor", text: "A sponsor and a champion are named", ok: !!(p.sponsor && p.champion), fix: "Name who decides and who does the work." },
    { id: "schedule", text: "The window is realistic for the number of criteria", ok: days != null && days >= 5 && days <= 60 && counted.length <= Math.max(1, Math.floor(days / 2)), fix: days == null ? "Set a start and an end." : days < 5 ? "Under five days is a demo, not a proof." : days > 60 ? "Past 60 days it drifts: shorten it." : "Too many criteria for the time: cut some or lengthen the window." },
    { id: "scope", text: "What is out of scope is written down", ok: !!(p.out_of_scope || "").trim(), fix: "List what this proof will not try to show." },
  ];
  const gaps = items.filter((i) => !i.ok);
  return { items, passed: items.length - gaps.length, total: items.length, ready: gaps.length === 0, verdict: gaps.length ? `not ready: ${gaps.length} to settle` : "ready to start" };
}

/** Days from the start of the window to the first value the customer saw, or null if either date is missing. */
export function timeToFirstValue(p) {
  if (!p.start || !p.first_value_on) return null;
  const d = daysBetween(p.start, p.first_value_on);
  return d < 0 ? null : d;
}

const cell = (t) => String(t || "").replace(/\|/g, "/").replace(/\n/g, " ");

/** The plan as text to agree on before starting: who, when, what success means, what must be ready. */
export function planMarkdown(p) {
  const pr = progress(p);
  const lines = [`# Proof of value: ${p.customer}`, "",
    `Sponsor: ${p.sponsor || "to be named"}. Champion: ${p.champion || "to be named"}.`,
    `Window: ${p.start || "to be set"} to ${p.end || "to be set"}.`, "",
    ...(p.problem ? ["## The problem", "", p.problem, ""] : []),
    "## What success means", "", "| # | Criterion | How we will know |", "|---|---|---|",
    ...p.criteria.filter((c) => c.status !== "dropped").map((c, i) => `| ${i + 1} | ${cell(c.text)} | ${cell(c.target)} |`), "",
    "## Before we start", "", ...p.readiness.map((r) => `- [${r.done ? "x" : " "}] ${r.text}`), ""];
  if (p.out_of_scope) lines.push("## Out of scope", "", p.out_of_scope, "");
  if (p.sessions.length) lines.push("## Working sessions", "", ...p.sessions.map((s) => `- ${s.on}: ${s.topic}${s.who ? ` (${s.who})` : ""}`), "");
  lines.push(`Ready: ${pr.ready} of ${pr.ready_total}. Qualification: ${qualify(p).verdict}.`, "");
  return lines.join("\n");
}

/** The result, and the line between what it showed and what it did not. */
export function valueReport(p, today) {
  const pr = progress(p);
  const counted = p.criteria.filter((c) => c.status !== "dropped");
  const lines = [`# Proof of value result: ${p.customer}`, "", `Date: ${today}. Window: ${p.start || "not set"} to ${p.end || "not set"}.`, "",
    `**Result: ${pr.verdict}.** ${pr.met} of ${pr.total} criteria met, ${pr.partly} partly, ${pr.not_met} not met, ${pr.open} not yet tried${pr.dropped ? `, ${pr.dropped} dropped` : ""}.`, "",
    "| Criterion | Result | What was seen |", "|---|---|---|",
    ...counted.map((c) => `| ${cell(c.text)} | ${STATUS_TEXT[c.status]} | ${cell(c.evidence) || "nothing recorded"} |`), ""];
  const t = timeToFirstValue(p);
  if (t != null) lines.push(`First value seen ${t === 0 ? "on the first day" : `${t} day${t === 1 ? "" : "s"} after the start`} (${p.first_value_on}).`, "");
  else lines.push("When the first value was seen was not recorded.", "");
  if (p.summary) lines.push("## In short", "", p.summary, "");
  const carry = counted.filter((c) => c.status === "met" || c.status === "partly");
  lines.push("## What to carry into the rollout", "",
    ...(carry.length ? carry.map((c) => `- ${c.text}${c.status === "partly" ? " (only partly shown: decide what is still needed)" : ""}`) : ["- Nothing was shown yet."]), "");
  const gaps = counted.filter((c) => c.status === "not_met" || c.status === "open");
  if (gaps.length) lines.push("## Still open", "", ...gaps.map((c) => `- ${c.text}: ${STATUS_TEXT[c.status].toLowerCase()}`), "");
  lines.push("## What this does not show", "",
    "- It shows what happened in this environment, in this window, with the people named above. It does not show what happens at full scale or after the first quarter.",
    "- A criterion marked met is the evaluator's judgement, recorded with what they saw. It is not an independent measurement.", "");
  return lines.join("\n");
}
