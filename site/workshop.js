// A discovery workshop: the first meetings with a prospect, before there is any data to load.
//
// The person picks the product lines in scope and, for each line, records what the customer said to the discovery
// questions the profile ships with: solved, partly, a real gap, or nobody knows. From those answers this module works
// out where it hurts, which line to start with, the path after it, and what to find out before the next meeting.
//
// Pure functions over plain records, so the page and the tests share them. A workshop is a customer fact: it is kept
// in the browser's store, sealed when a passphrase is set, and erased with the customer.

export const ANSWERS = {
  solved: { label: "Solved", weight: 0 },
  partly: { label: "Partly", weight: 0.5 },
  gap: { label: "A real gap", weight: 1 },
  unknown: { label: "Nobody knows", weight: 0.6 },     // not knowing is itself a finding
};
export const MAX_WORKSHOPS = 200;
const MAX_ANSWERS = 400, MAX_SCOPE = 12;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONCE = /^[a-z0-9]{6,12}$/;
const KEY = /^[a-z0-9-]{1,40}#\d{1,2}$/;
const PROFILE = /^[a-z0-9-]{1,40}$/;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));

function randomNonce() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

export function makeWorkshop({ customer, scope, createdOn, nonce = "" }) {
  const name = text(customer, 200);
  if (!name) throw new Error("Say who the workshop is with.");
  if (!isDate(createdOn)) throw new Error("A workshop needs the date it started.");
  const n = nonce || randomNonce();
  if (!NONCE.test(n)) throw new Error("The identifier suffix must be 6 to 12 lowercase letters or digits.");
  const lines = [...new Set((scope || []).filter((p) => PROFILE.test(p)))].slice(0, MAX_SCOPE);
  if (!lines.length) throw new Error("Choose at least one product line.");
  return { id: `ws|${createdOn}|${n}`, customer: name, scope: lines, answers: {}, created_on: createdOn, updated_on: createdOn };
}

export function validWorkshop(w) {
  if (!w || typeof w !== "object" || Array.isArray(w)) return false;
  if (typeof w.customer !== "string" || !w.customer || w.customer.length > 200) return false;
  if (!isDate(w.created_on) || !isDate(w.updated_on) || w.updated_on < w.created_on) return false;
  if (!Array.isArray(w.scope) || !w.scope.length || w.scope.length > MAX_SCOPE || !w.scope.every((p) => typeof p === "string" && PROFILE.test(p)) || new Set(w.scope).size !== w.scope.length) return false;
  if (!w.answers || typeof w.answers !== "object" || Array.isArray(w.answers)) return false;
  const entries = Object.entries(w.answers);
  if (entries.length > MAX_ANSWERS) return false;
  for (const [k, v] of entries) {
    if (!KEY.test(k) || !v || typeof v !== "object" || !(v.a in ANSWERS) || typeof v.note !== "string" || v.note.length > 300) return false;
  }
  const m = /^ws\|(\d{4}-\d{2}-\d{2})\|([a-z0-9]+)$/.exec(w.id || "");
  return !!m && m[1] === w.created_on && NONCE.test(m[2]);
}

export function acceptWorkshops(list) {
  if (!Array.isArray(list)) return { ok: [], rejected: 0 };
  const ok = list.slice(0, MAX_WORKSHOPS).filter(validWorkshop);
  return { ok, rejected: list.length - ok.length };
}

export function mergeWorkshops(a, b) {
  const byId = new Map();
  for (const w of [...a, ...b]) {
    const have = byId.get(w.id);
    if (!have || cmp(w.updated_on, have.updated_on) > 0 || (w.updated_on === have.updated_on && cmp(JSON.stringify(w), JSON.stringify(have)) < 0)) byId.set(w.id, w);
  }
  return [...byId.values()].sort((x, y) => cmp(y.updated_on, x.updated_on) || cmp(x.customer, y.customer) || cmp(x.id, y.id));
}

function changed(w, patch, today) {
  if (!isDate(today) || today < w.created_on) throw new Error("Give today's date.");
  const next = { ...w, ...patch, updated_on: today };
  if (!validWorkshop(next)) throw new Error("That change is not valid: check the lengths.");
  return next;
}

/** Record what was said to one question, with an optional note; no answer clears it, note included. */
export function setAnswer(w, profile, index, answer, note, today) {
  if (!PROFILE.test(profile) || !Number.isInteger(index) || index < 0 || index > 99) throw new Error("Unknown question.");
  const k = `${profile}#${index}`;
  const answers = { ...w.answers };
  if (!answer) delete answers[k];
  else if (!(answer in ANSWERS)) throw new Error("Unknown answer.");
  else answers[k] = { a: answer, note: text(note, 300) };
  return changed(w, { answers }, today);
}

export function rename(w, customer, today) {
  const name = text(customer, 200);
  if (!name) throw new Error("Say who the workshop is with.");
  return changed(w, { customer: name }, today);
}

export function setScope(w, scope, today) {
  const lines = [...new Set(scope.filter((p) => PROFILE.test(p)))].slice(0, MAX_SCOPE);
  if (!lines.length) throw new Error("Keep at least one product line.");
  return changed(w, { scope: lines }, today);
}

// ------------------------------------------------------------------ reading the answers

/** What one line's answers say. `pain` runs from 0 (all solved) to 1 (all real gaps); value questions count double. */
export function lineState(catalog, profile, answers) {
  const line = catalog.lines[profile] || { label: profile, questions: [], proof: [] };
  const out = { profile, label: line.label, units: line.units || "", total: line.questions.length, answered: 0, pain: 0, gaps: [], partly: [], unknowns: [], solved: [] };
  let sum = 0, max = 0;
  line.questions.forEach((q, i) => {
    const ans = answers[`${profile}#${i}`];
    if (!ans) return;
    out.answered++;
    const m = q.stage === "value" ? 2 : 1;
    sum += ANSWERS[ans.a].weight * m;
    max += m;
    const item = { ...q, index: i, note: ans.note };
    ({ gap: out.gaps, partly: out.partly, unknown: out.unknowns, solved: out.solved })[ans.a].push(item);
  });
  out.pain = max ? sum / max : 0;
  out.coverage = out.total ? out.answered / out.total : 0;
  return out;
}

const MIN_ANSWERED = 3;

/** Where it hurts, where to start, the path after it and what is still unknown. */
export function assess(catalog, w) {
  const lines = w.scope.filter((p) => catalog.lines[p]).map((p) => lineState(catalog, p, w.answers));
  const ready = lines.filter((l) => l.answered >= MIN_ANSWERED);
  // Pain counts most, but a line heard about in two questions should not beat one explored in eight.
  const rank = (l) => l.pain * (0.6 + 0.4 * l.coverage);
  const land = ready.length ? [...ready].sort((a, b) => rank(b) - rank(a) || b.gaps.length - a.gaps.length || cmp(a.label, b.label))[0] : null;
  const expand = [];
  if (land) {
    const seen = new Set([land.profile]);
    for (const [a, b, why] of catalog.links) {
      if (a !== land.profile || seen.has(b) || !w.scope.includes(b)) continue;
      const l = lines.find((x) => x.profile === b);
      expand.push({ profile: b, label: l ? l.label : b, why, pain: l ? l.pain : 0, answered: l ? l.answered : 0 });
      seen.add(b);
    }
    for (const l of lines) if (!seen.has(l.profile) && l.answered && l.pain > 0) { expand.push({ profile: l.profile, label: l.label, why: "", pain: l.pain, answered: l.answered }); seen.add(l.profile); }
    expand.sort((x, y) => (y.why ? 1 : 0) - (x.why ? 1 : 0) || y.pain - x.pain);
  }
  const answered = lines.reduce((n, l) => n + l.answered, 0), total = lines.reduce((n, l) => n + l.total, 0);
  return {
    lines, land, expand, answered, total, coverage: total ? answered / total : 0,
    unknowns: lines.flatMap((l) => l.unknowns.map((q) => ({ ...q, profile: l.profile, label: l.label }))),
    waiting: land ? "" : `Answer at least ${MIN_ANSWERED} questions on a line to see where to start.`,
    proof: land && catalog.lines[land.profile] ? catalog.lines[land.profile].proof : [],
  };
}

// ------------------------------------------------------------------ the journey: from "can we?" to "what would need to be true?"

const STAGE_ORDER = { value: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
const STATUS_ORDER = { gap: 0, unknown: 1, partly: 2 };

/** One line's answers turned into conditions: what would need to be true, where the customer is today, the first step. */
function conditions(l) {
  const of = (items, status) => items.map((q) => ({ need: q.need || q.q, how: q.how || "", q: q.q, note: q.note || "", status, stage: q.stage }));
  return [...of(l.gaps, "gap"), ...of(l.unknowns, "unknown"), ...of(l.partly, "partly")]
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
const already = (items) => items.map((q) => q.need || q.q);

/**
 * The path from where the customer is today to where it could be: first agree what success means, then prove it on the
 * line that hurts most, then the lines it leads to. Every gap is a condition to make true, with a first step and a way to
 * validate it; every "nobody knows" is a rock in the road still to be seen; every "solved" is already true.
 */
export function journey(catalog, w, res) {
  if (!res.land) return null;
  const land = res.land, all = conditions(land);
  const steps = [];
  const agree = all.filter((c) => c.stage === "value"), agreeDone = already(land.solved.filter((q) => q.stage === "value"));
  if (agree.length || agreeDone.length) {
    steps.push({ kind: "agree", title: "Agree what success looks like", profile: land.profile, label: land.label, conditions: agree, already: agreeDone,
      validate: ["Success criteria written with the sponsor and signed before the proof starts"] });
  }
  steps.push({ kind: "prove", title: `Prove it on ${land.label.toLowerCase()}`, profile: land.profile, label: land.label,
    conditions: all.filter((c) => c.stage !== "value"), already: already(land.solved.filter((q) => q.stage !== "value")),
    validate: res.proof.slice(0, 4).map((c) => c.text) });
  for (const e of res.expand) {
    const l = res.lines.find((x) => x.profile === e.profile);
    const proof = (catalog.lines[e.profile] || { proof: [] }).proof;
    steps.push({ kind: "then", title: `Then ${e.label.toLowerCase()}`, profile: e.profile, label: e.label, why: e.why,
      conditions: l ? conditions(l) : [], already: l ? already(l.solved) : [], discussed: !!(l && l.answered),
      validate: proof.slice(0, 1).map((c) => c.text) });
  }
  const need = steps.reduce((n, s) => n + s.conditions.length, 0);
  const done = steps.reduce((n, s) => n + s.already.length, 0);
  const unknown = steps.reduce((n, s) => n + s.conditions.filter((c) => c.status === "unknown").length, 0);
  const impact = [...land.gaps, ...land.partly, ...land.unknowns, ...land.solved].filter((q) => q.stage === "value" && q.note).map((q) => q.note);
  const destination = steps.map((s) => s.label);
  return {
    customer: w.customer, steps, need, done, unknown, impact, destination,
    headline: `Yes, this is possible. For ${w.customer}, ${need} thing${need === 1 ? "" : "s"} need${need === 1 ? "s" : ""} to be true; ${done} already ${done === 1 ? "is" : "are"}.`,
  };
}

/** The note to send after the meeting: what we heard, where it hurts, the proposal, and what is still open. */
export function summaryMarkdown(catalog, w, res) {
  const out = [`# Discovery: ${w.customer}`, "", `Workshop started ${w.created_on}, last updated ${w.updated_on}. ${res.answered} of ${res.total} questions answered across ${res.lines.length} product line${res.lines.length === 1 ? "" : "s"}.`, ""];
  out.push("## What we heard", "");
  for (const l of res.lines) {
    if (!l.answered) continue;
    out.push(`### ${l.label} (${Math.round(l.pain * 100)}% pain, ${l.answered} of ${l.total} answered)`, "");
    const say = (q, tag) => `- **${tag}:** ${q.q}${q.note ? ` — ${q.note}` : ""}`;
    for (const q of l.gaps) out.push(say(q, "Gap"));
    for (const q of l.partly) out.push(say(q, "Partly"));
    for (const q of l.unknowns) out.push(say(q, "Not known"));
    for (const q of l.solved) out.push(say(q, "Solved"));
    out.push("");
  }
  const j = journey(catalog, w, res);
  if (j) {
    out.push("## The journey", "", j.headline, "");
    if (j.impact.length) out.push(`What is at stake, in their words: ${j.impact.map((x) => `"${x}"`).join("; ")}.`, "");
    j.steps.forEach((st, i) => {
      out.push(`### ${i + 1}. ${st.title}`, "");
      if (st.why) out.push(`Why next: ${st.why}.`, "");
      for (const c of st.conditions) out.push(`- [ ] ${c.need}. First step: ${c.how}. Today: ${({ gap: "a real gap", partly: "partly", unknown: "nobody knows yet" })[c.status]}${c.note ? ` ("${c.note}")` : ""}.`);
      for (const a of st.already) out.push(`- [x] ${a}.`);
      if (st.validate.length) out.push("", `Validated by: ${st.validate.join("; ")}.`);
      out.push("");
    });
  }
  if (!j) out.push("## Where to start", "", res.waiting, "");
  if (res.unknowns.length) {
    out.push("## To find out before the next meeting", "");
    for (const u of res.unknowns) out.push(`- ${u.label}: ${u.q}`);
    out.push("");
  }
  out.push("_Prepared with Beyond 90. The questions come from its product profiles; nothing in this note left the browser it was written in._", "");
  return out.join("\n");
}
