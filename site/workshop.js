// A discovery workshop: the first meetings with a prospect, before there is any data to load.
//
// The person picks the product lines in scope and, for each line, records what the customer said to the discovery
// questions the profile ships with: solved, partly, a real gap, or nobody knows. From those answers this module works
// out where it hurts, which line to start with, the path after it, and what to find out before the next meeting.
//
// Pure functions over plain records, so the page and the tests share them. A workshop is a customer fact: it is kept
// in the browser's store, sealed when a passphrase is set, and erased with the customer.

import { validSummary, notesFor, fmt } from "./inventory.js";
import { validAssumptions, sketch, sketchMarkdown } from "./sizing.js";
import { validWaves, planWaves, wavesMarkdown, wavesLine, RUNBOOK } from "./waves.js";
import { calendar } from "./ics.js";
import { validCase, buildCase, caseLine, caseMarkdown, money } from "./valuecase.js";
import { validGpu, gpuSketch, gpuMarkdown } from "./gpu.js";
import { validDr, drSketch, drMarkdown } from "./drsketch.js";
import { validObj, objSketch, objMarkdown } from "./objsketch.js";
import { validEdge, edgeSketch, edgeMarkdown } from "./edgesketch.js";
import { validUnit, unitSketch, unitMarkdown } from "./unitcost.js";
import { cleanAward } from "./award.js";
import { validRfp, withRequirements, withRequirement, lineOrder, emptyRfp, rfpState, suggestAnswer, TITLE_MAX, MAX_PAGES, SECTION_MAX } from "./rfp.js";
import { validDeal, withDealAnswer, dealMarkdown } from "./qualify.js";
import { ROLE_WORDS, displayOrder, inMeeting } from "./questions.js";
import { validChannel, cleanChannel, KINDS, ROUTES, ACTIVITIES, whoLabel } from "./partners.js";

export { ROLE_WORDS, displayOrder, inMeeting };

export const ANSWERS = {
  solved: { label: "Solved", weight: 0 },
  partly: { label: "Partly", weight: 0.5 },
  gap: { label: "A real gap", weight: 1 },
  unknown: { label: "Nobody knows", weight: 0.6 },     // not knowing is itself a finding
};
export const MAX_WORKSHOPS = 200;
export const PER = ["hour", "day", "week", "month", "year", "incident"];     // what a figure on a value question is counted per
const MAX_AMOUNT = 1e13;
export const WHO = { us: "Us", customer: "The customer", together: "Together" };    // who makes a condition true
const MAX_ANSWERS = 400, MAX_SCOPE = 12;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NONCE = /^[a-z0-9]{6,12}$/;
const KEY = /^[a-z0-9-]{1,40}#\d{1,2}$/;
const RAISED = /^[a-z0-9-]{1,40}#\d$/, MAX_RAISED = 40;
const ALT = /^[a-z][a-z_]{1,29}$/, MAX_ALTS = 8;          // an alternative the customer weighs, by its id in the family's list     // an objection the customer raised: its line and its place in the line's story
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
    if (v.amount != null && !(typeof v.amount === "number" && Number.isFinite(v.amount) && v.amount >= 0 && v.amount <= MAX_AMOUNT && PER.includes(v.per))) return false;
    if (v.amount == null && v.per != null) return false;
    if (v.who != null && !(v.who in WHO)) return false;
    if (v.by != null && !(isDate(v.by) && v.by >= w.created_on)) return false;
  }
  if (w.prepared_by != null && (typeof w.prepared_by !== "string" || w.prepared_by.length > 80)) return false;
  if (w.inventory != null && !validSummary(w.inventory)) return false;
  if (w.sizing != null && !validAssumptions(w.sizing)) return false;
  if (w.waves != null && !validWaves(w.waves)) return false;
  if (w.case != null && !validCase(w.case)) return false;
  if (w.gpu != null && !validGpu(w.gpu)) return false;
  if (w.dr != null && !validDr(w.dr)) return false;
  if (w.obj != null && !validObj(w.obj)) return false;
  if (w.edge != null && !validEdge(w.edge)) return false;
  if (w.unit != null && !validUnit(w.unit)) return false;
  if (w.rfp != null && !validRfp(w.rfp)) return false;
  if (w.deal != null && !validDeal(w.deal)) return false;
  if (w.channel != null && !validChannel(w.channel)) return false;
  if (w.demo != null && !(w.demo && typeof w.demo === "object" && !Array.isArray(w.demo) && Object.keys(w.demo).length === 1 && isDate(w.demo.on) && w.demo.on >= w.created_on)) return false;
  if (w.alts != null && !(Array.isArray(w.alts) && w.alts.length && w.alts.length <= MAX_ALTS && w.alts.every((k) => typeof k === "string" && ALT.test(k)) && new Set(w.alts).size === w.alts.length)) return false;
  if (w.raised != null && !(Array.isArray(w.raised) && w.raised.length && w.raised.length <= MAX_RAISED && w.raised.every((k) => typeof k === "string" && RAISED.test(k)) && new Set(w.raised).size === w.raised.length)) return false;
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
  else answers[k] = { ...answers[k], a: answer, note: text(note, 300) };     // a figure already given is kept
  return changed(w, { answers }, today);
}

/** Who makes a condition true, and by when: the journey becomes a plan both sides can hold each other to. Empty clears. */
export function setPlan(w, profile, index, who, by, today) {
  const k = `${profile}#${index}`;
  const have = w.answers[k];
  if (!have) throw new Error("Answer the question first, then plan it.");
  if (who && !(who in WHO)) throw new Error("Say who: us, the customer, or together.");
  if (by && (!isDate(by) || by < w.created_on)) throw new Error("Give a date on or after the day the workshop started.");
  const next = { ...have };
  delete next.who; delete next.by;
  if (who) next.who = who;
  if (by) next.by = by;
  return changed(w, { answers: { ...w.answers, [k]: next } }, today);
}

/** Put a figure on an answered value question ("2,000,000 per day"); an empty amount removes it. */
export function setWorth(w, profile, index, amount, per, today) {
  const k = `${profile}#${index}`;
  const have = w.answers[k];
  if (!have) throw new Error("Answer the question first, then put a figure on it.");
  const rest = { ...have };
  delete rest.amount; delete rest.per;
  if (amount === "" || amount == null) return changed(w, { answers: { ...w.answers, [k]: rest } }, today);
  const n = typeof amount === "number" ? amount : Number(String(amount).replace(/[\s,'_]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) throw new Error("Give the figure as a number, for example 250000.");
  if (!PER.includes(per)) throw new Error("Say what the figure is counted per: hour, day, week, month, year or incident.");
  return changed(w, { answers: { ...w.answers, [k]: { ...rest, amount: Math.round(n), per } } }, today);
}

const NUM = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
export const worthText = (x) => `${NUM.format(x.amount)} per ${x.per}`;

export function rename(w, customer, today) {
  const name = text(customer, 200);
  if (!name) throw new Error("Say who the workshop is with.");
  return changed(w, { customer: name }, today);
}

/** The customer's inventory, as totals: it brings the migration line into scope and answers part of its questions. */
export function setInventory(w, summary, today) {
  const next = { ...w };
  delete next.inventory;
  if (summary) {
    if (!validSummary(summary)) throw new Error("That inventory summary is not valid.");
    next.inventory = summary;
    if (!next.scope.includes("platform-migration") && next.scope.length < MAX_SCOPE) next.scope = [...next.scope, "platform-migration"];
  }
  return changed(next, {}, today);
}

/** The assumptions of the sizing sketch, as the presales engineer set them with the customer; null goes back to the defaults. */
export function setSizing(w, assumptions, today) {
  const next = { ...w };
  delete next.sizing;
  if (assumptions) {
    if (!validAssumptions(assumptions)) throw new Error("One of the sizing assumptions is out of range.");
    next.sizing = assumptions;
  }
  return changed(next, {}, today);
}

/** The settings of the plan in waves, or null to go back to the defaults. */
export function setWaves(w, settings, today) {
  const next = { ...w };
  delete next.waves;
  if (settings) {
    if (!validWaves(settings)) throw new Error("One of the wave settings is out of range.");
    next.waves = settings;
  }
  return changed(next, {}, today);
}

/** The settings of the backup capacity sketch, or null to go back to the defaults. */
export function setObj(w, settings, today) {
  const next = { ...w };
  delete next.obj;
  if (settings) {
    if (!validObj(settings)) throw new Error("One of the backup capacity settings is out of range.");
    next.obj = settings;
  }
  return changed(next, {}, today);
}

/** The settings of the first recovery design, or null to go back to the defaults. */
export function setDr(w, settings, today) {
  const next = { ...w };
  delete next.dr;
  if (settings) {
    if (!validDr(settings)) throw new Error("One of the recovery settings is out of range.");
    next.dr = settings;
  }
  return changed(next, {}, today);
}

/** The settings of the edge design, or null to go back to the defaults. */
export function setEdge(w, settings, today) {
  const next = { ...w };
  delete next.edge;
  if (settings) {
    if (!validEdge(settings)) throw new Error("One of the edge settings is out of range.");
    next.edge = settings;
  }
  return changed(next, {}, today);
}

// ------------------------------------------------------------------ a tender or a request for proposal

/** Requirements read from a paste, added after those already there, each matched to a product line. */
export function addRequirements(w, parsed, catalog, today) {
  if (!Array.isArray(parsed) || !parsed.length) throw new Error("No requirement was found in what was pasted: one per line, or rows copied from a spreadsheet.");
  return changed({ ...w, rfp: withRequirements(w.rfp, parsed, lineOrder(catalog, w.scope)) }, {}, today);
}

/** One requirement answered or corrected. */
export function setRequirement(w, id, patch, today) {
  if (!w.rfp) throw new Error("There is no tender on this workshop yet.");
  return changed({ ...w, rfp: withRequirement(w.rfp, id, patch) }, {}, today);
}

/** One requirement taken out; the last one out takes the tender with it unless it has a name or dates. */
export function removeRequirement(w, id, today) {
  if (!w.rfp) return w;
  const rfp = { ...w.rfp, reqs: w.rfp.reqs.filter((r) => r.id !== id) };
  const next = { ...w, rfp };
  if (!rfp.reqs.length && !rfp.title && !rfp.due && !rfp.questions_due) delete next.rfp;
  return changed(next, {}, today);
}

/** The tender's name, the deadline for questions to the contracting authority, and the bid's due date. */
export function setRfpMeta(w, { title = "", due = "", questions_due: q = "", issuer = "", pages = "" } = {}, today) {
  const t = text(title, TITLE_MAX);
  if (due && q && q > due) throw new Error("Questions are due before the bid, not after.");
  const rfp = { ...(w.rfp || emptyRfp()), title: t, due: due || "", questions_due: q || "" };
  delete rfp.issuer;
  if (issuer) rfp.issuer = issuer;
  delete rfp.pages;
  if (pages !== "" && pages != null) {
    const n = Number(pages);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGES) throw new Error(`The page limit is a whole number from 1 to ${MAX_PAGES}.`);
    rfp.pages = n;
  }
  const next = { ...w, rfp };
  if (!rfp.reqs.length && !t && !rfp.due && !rfp.questions_due && !issuer && !rfp.award) delete next.rfp;
  return changed(next, {}, today);
}

/** How the tender is awarded on price and quality, with our offer and the rivals' guessed ones; null takes it away. */
export function setAward(w, given, today) {
  const rfp = { ...(w.rfp || emptyRfp()) };
  if (given == null) delete rfp.award;
  else rfp.award = cleanAward(given);
  const next = { ...w, rfp };
  if (!rfp.reqs.length && !rfp.title && !rfp.due && !rfp.questions_due && !rfp.issuer && !rfp.award) delete next.rfp;
  return changed(next, {}, today);
}

/** The kit's answer put in every requirement that has none yet, to adapt: square brackets mark what to fill in. */
export function fillSuggestedNotes(w, catalog, today) {
  if (!w.rfp) return w;
  let rfp = w.rfp;
  for (const r of w.rfp.reqs) {
    if (r.note) continue;
    const a = suggestAnswer(catalog, r);
    if (a) rfp = withRequirement(rfp, r.id, { note: a.answer });
  }
  return rfp === w.rfp ? w : changed({ ...w, rfp }, {}, today);
}

/** A section's title in the technical response, as the tender names it; blank goes back to the title worked out. */
export function setSectionTitle(w, key, title, today) {
  if (!w.rfp) throw new Error("There is no tender on this workshop yet.");
  if (typeof key !== "string" || !/^[A-Za-z0-9]{0,12}$/.test(key)) throw new Error("Not a section of this tender.");
  const k = key || "0";
  const sections = { ...(w.rfp.sections || {}) };
  const t = text(title, SECTION_MAX);
  if (t) sections[k] = t; else delete sections[k];
  const rfp = { ...w.rfp };
  if (Object.keys(sections).length) rfp.sections = sections; else delete rfp.sections;
  return changed({ ...w, rfp }, {}, today);
}

/** Start again: the tender and its answers go. */
export function clearRfp(w, today) {
  const next = { ...w };
  delete next.rfp;
  return changed(next, {}, today);
}

/** The lines where a cost per machine is the conversation: running it like a cloud, a provider's tenants, placement. */
export const UNIT_LINES = ["cloud-operations", "service-provider-cloud", "hybrid-cloud"];

/** The figures of the cost per machine, or null to clear them. */
export function setUnit(w, figures, today) {
  const next = { ...w };
  delete next.unit;
  if (figures) {
    if (!validUnit(figures)) throw new Error("One of the cost figures is out of range.");
    next.unit = figures;
  }
  return changed(next, {}, today);
}

/** The assumptions of the GPU sketch, or null to go back to the defaults. */
export function setGpu(w, assumptions, today) {
  const next = { ...w };
  delete next.gpu;
  if (assumptions) {
    if (!validGpu(assumptions)) throw new Error("One of the GPU assumptions is out of range.");
    next.gpu = assumptions;
  }
  return changed(next, {}, today);
}

/** The figures of the case for change, or null to clear them. */
export function setCase(w, figures, today) {
  const next = { ...w };
  delete next.case;
  if (figures) {
    if (!validCase(figures)) throw new Error("One of the figures is out of range.");
    next.case = figures;
  }
  return changed(next, {}, today);
}

/** The figures the customer put on what is at stake, with the question each answered: for the case for change. */
export function figuresHeard(catalog, w) {
  return Object.entries(w.answers).filter(([, v]) => v.amount != null).map(([k, v]) => {
    const [p, i] = k.split("#");
    const q = catalog.lines[p] && catalog.lines[p].questions[Number(i)];
    return { amount: v.amount, per: v.per, what: q ? q.q : "", line: catalog.lines[p] ? catalog.lines[p].label : p };
  });
}

/** Mark an objection as raised by the customer, or not: it then has to be answered, and proven. */
/**
 * What else the customer weighs, for the families of the lines in scope: renewing, a public cloud, another platform,
 * doing nothing. Each says why they consider it, what to ask, when the proposal fits, when the other choice is the
 * better one, and how to prove it; `on` marks those the customer has put on the table.
 */
export function alternativesFor(catalog, w) {
  const fams = Object.entries((catalog && catalog.families) || {}).filter(([, members]) => w.scope.some((p) => members.includes(p))).map(([f]) => f);
  const seen = new Set(), on = new Set(w.alts || []);
  const out = [];
  const add = (a, extra) => { if (!seen.has(a.id)) { seen.add(a.id); out.push({ ...a, ...extra, on: on.has(a.id) }); } };
  for (const f of fams) for (const a of ((catalog.alternatives || {})[f] || [])) add(a, { family: f, line: "", line_label: "" });
  // then what is particular to each line in scope: keeping the backup product, desktops from a cloud, a server per site
  for (const p of w.scope) for (const a of ((catalog && catalog.alternatives) || {})[p] || []) add(a, { family: "", line: p, line_label: catalog.lines[p] ? catalog.lines[p].label : p });
  return out;
}

/** Mark an alternative as on the table, or take it off. */
export function setAlt(w, id, on, today) {
  if (typeof id !== "string" || !ALT.test(id)) throw new Error("Not an alternative of this workshop.");
  const now = (w.alts || []).filter((k) => k !== id);
  if (on) {
    if (now.length >= MAX_ALTS) throw new Error(`At most ${MAX_ALTS} alternatives can be on the table.`);
    now.push(id);
  }
  const next = { ...w };
  delete next.alts;
  if (now.length) next.alts = now;
  return changed(next, {}, today);
}

/** The alternatives on the table, as notes for the seller: why, what to ask, and how to prove it. */
export function alternativesMarkdown(catalog, w) {
  const on = alternativesFor(catalog, w).filter((a) => a.on);
  if (!on.length) return "";
  return ["## What else they weigh", "", ...on.flatMap((a) => [`- **${a.name}${a.line_label ? ` (${a.line_label.toLowerCase()})` : ""}.** ${a.why} Ask: ${a.ask.join(" ")} We fit when: ${a.fits_us} It is the better choice when: ${a.fits_them} To prove it: ${a.prove}`]), ""].join("\n");
}

export function setRaised(w, profile, index, on, today) {
  const key = `${profile}#${index}`;
  if (!RAISED.test(key) || !Number.isInteger(index) || index < 0) throw new Error("Not an objection of this workshop.");
  const now = (w.raised || []).filter((k) => k !== key);
  if (on) {
    if (now.length >= MAX_RAISED) throw new Error(`At most ${MAX_RAISED} objections can be marked as raised.`);
    now.push(key);
  }
  const next = { ...w };
  delete next.raised;
  if (now.length) next.raised = now;
  return changed(next, {}, today);
}

/** One qualification question answered (known, partly, not yet) with a note, or cleared: the same ten on every line. */
export function setDeal(w, id, a, note, today) {
  const deal = withDealAnswer(w.deal, id, a, note, today);
  const next = { ...w };
  delete next.deal;
  if (deal) next.deal = deal;
  return changed(next, {}, today);
}

/** The partners on this deal, the route to purchase and who does what; null removes them all. */
export function setChannel(w, given, today) {
  const channel = given ? cleanChannel(given) : null;
  const next = { ...w };
  delete next.channel;
  if (channel) next.channel = channel;
  return changed(next, {}, today);
}

/** The day the demo built for this customer was given, or "" to clear it: the way forward moves on from there. */
export function setDemo(w, on, today) {
  const next = { ...w };
  delete next.demo;
  if (on) {
    if (!isDate(on) || on < w.created_on) throw new Error("The demo cannot come before the workshop.");
    next.demo = { on };
  }
  return changed(next, {}, today);
}

/** How each line in scope is told and challenged: the line to start with first. Only lines whose profile ships a story. */
export function stories(catalog, w, res) {
  const land = res && res.land ? res.land.profile : "";
  const order = [...w.scope].sort((a, b) => (b === land) - (a === land));
  const raised = new Set(w.raised || []);
  return order.filter((p) => catalog.lines[p] && catalog.lines[p].story && (catalog.lines[p].story.objections || []).length + Object.keys(catalog.lines[p].story.audiences || {}).length)
    .map((p) => {
      const st = catalog.lines[p].story;
      return { profile: p, label: catalog.lines[p].label, land: p === land, audiences: st.audiences || {}, people: st.people || [],
        objections: (st.objections || []).map((o, i) => ({ ...o, index: i, key: `${p}#${i}`, raised: raised.has(`${p}#${i}`) })) };
    });
}

/** The objections the customer raised, with how each will be answered and proven; unknown ones (a profile changed) are skipped. */
export function raisedObjections(catalog, w) {
  return (w.raised || []).map((k) => {
    const [p, i] = k.split("#");
    const line = catalog.lines[p], o = line && line.story && (line.story.objections || [])[Number(i)];
    return o && w.scope.includes(p) ? { profile: p, label: line.label, index: Number(i), ...o } : null;
  }).filter(Boolean);
}

export const AUDIENCE_WORDS = { executive: "For the executive", technical: "For the technical team", financial: "For finance" };

/** What the inventory says about one question, if anything. */
export const factFor = (w, profile, index) => (w.inventory && profile === "platform-migration" ? notesFor(w.inventory)[index] || "" : "");

/** Who prepared the workshop, for the readout's footer; empty removes it. */
export function setPreparedBy(w, name, today) {
  const n = text(name, 80);
  const next = { ...w };
  delete next.prepared_by;
  if (n) next.prepared_by = n;
  return changed(next, {}, today);
}

export function setScope(w, scope, today) {
  const lines = [...new Set(scope.filter((p) => PROFILE.test(p)))].slice(0, MAX_SCOPE);
  if (!lines.length) throw new Error("Keep at least one product line.");
  return changed(w, { scope: lines }, today);
}

// ------------------------------------------------------------------ starting points

/** Conversations a workshop often starts from, each with the lines that usually come up in it. */
export const PRESETS = [
  { id: "resilience", label: "Resilience and ransomware", scope: ["hci", "dr-backup", "object-storage", "file-storage", "microsegmentation"] },
  { id: "migration", label: "Leaving a virtualisation platform", scope: ["platform-migration", "hci", "dr-backup", "dbaas"] },
  { id: "modernise", label: "Modernising applications", scope: ["kubernetes-platform", "dbaas", "hci", "object-storage"] },
  { id: "ai", label: "AI on our own infrastructure", scope: ["private-ai", "kubernetes-platform", "object-storage", "hci"] },
  { id: "hybrid", label: "Hybrid and sovereign cloud", scope: ["hybrid-cloud", "dr-backup", "hci", "platform-migration"] },
  { id: "workplace", label: "The digital workplace", scope: ["euc", "file-storage", "hci", "dr-backup"] },
  { id: "operate", label: "Running it like a cloud", scope: ["cloud-operations", "hci", "dbaas", "kubernetes-platform"] },
  { id: "edge", label: "Shops, plants and branches", scope: ["edge-sites", "hci", "dr-backup", "private-ai"] },
  { id: "provider", label: "A service provider's cloud", scope: ["service-provider-cloud", "platform-migration", "dr-backup", "kubernetes-platform"] },
  { id: "cloudsec", label: "Securing the cloud", scope: ["cnapp", "identity", "siem", "saas"] },
];

/**
 * A filled-in example, so the method can be shown in thirty seconds: an invented logistics company leaving its
 * virtualisation platform, worried about recovery. Answers are given by question position, per line.
 */
const EXAMPLE = {
  customer: "Kestrel Logistics (mock)", nonce: "example1",
  scope: ["platform-migration", "hci", "dr-backup", "dbaas", "object-storage"],
  answers: {
    "platform-migration": ["gap", "unknown", "partly", "gap", "gap", "gap", "unknown", "partly"],
    "hci": ["partly", "solved", "solved", "partly", "solved", "gap", "solved", "partly"],
    "dr-backup": ["gap", "gap", "gap", "partly", "gap", "unknown", "gap", "unknown"],
    "dbaas": ["partly", "gap", "solved", "partly", "gap", "unknown", "solved", "partly"],
  },
  notes: {
    "platform-migration#0": "Support on the current platform ends in September; renewal would triple the cost",
    "platform-migration#3": "Nobody is sure what the warehouse system talks to",
    "dr-backup#0": "A day without the main site stops every truck: about 2M in lost orders",
    "dr-backup#4": "The backup admin account is the same as the domain admin",
    "dbaas#1": "Last point-in-time restore took two days and needed the vendor",
  },
  worth: { "dr-backup#0": [2000000, "day"], "platform-migration#0": [1400000, "year"] },
  // who makes what true, and by when: days after the workshop
  plan: { "dr-backup#2": ["together", 21], "dr-backup#4": ["us", 10], "platform-migration#3": ["customer", 14] },
  raised: [["dr-backup", 3], ["platform-migration", 1], ["hci", 2]],
  sizing: { growth_pct: 15 },
  // sold with partners: an integrator that leads and will deliver, through a distributor; the integrator knows two of the four lines
  alts: ["renew", "public_cloud"],
  channel: {
    partners: [{ name: "Verdi Sistemi (mock)", kind: "integrator", lead: true, reg: [-9, 80], skills: ["hci", "dr-backup"] }, { name: "Nord Distribuzione (mock)", kind: "distributor" }],
    route: "distribution",
    split: { discovery: "both", demo: "us", sizing: "both", proof: "both", proposal: "p0", delivery: "p0", support: "p0" },
  },
  // the deal, as far as the first meetings got: ready for a demo built for them, not yet for a proof
  deal: {
    why_change: ["known", "The hosting renewal triples the cost; operations already works weekends on upgrades"],
    why_now: ["known", "Renewal in ten months; the board wants a decision before the budget in March"],
    outcome: ["partly", "Recovery of the order system in under four hours, tested; the cost target is not set yet"],
    decider: ["partly", "The CIO signs; we have not met her yet"],
    criteria: ["unknown", ""],
    proof: ["partly", "They want to see a recovery test on their own order system"],
    champion: ["known", "The infrastructure lead: she asked for this meeting and shares the board's timeline"],
    alternatives: ["partly", "Renewing as they are, and a public cloud option the finance team likes"],
  },
  case: { years: 3, in_readout: true, stay_run: 700000, stay_uplift_pct: 200, renewal_in_months: 10, stay_refresh: 900000, refresh_in_months: 18,
    move_run: 1100000, move_once: 650000, move_hardware: 0, ops_hours_now: 160, ops_hours_after: 60, hour_cost: 80,
    downtime_cost_hour: 83333, downtime_hours_now: 12, downtime_hours_after: 4 },
};

export function exampleWorkshop(createdOn) {
  let w = makeWorkshop({ customer: EXAMPLE.customer, scope: EXAMPLE.scope, createdOn, nonce: EXAMPLE.nonce });
  for (const [profile, list] of Object.entries(EXAMPLE.answers)) {
    list.forEach((a, i) => { w = setAnswer(w, profile, i, a, EXAMPLE.notes[`${profile}#${i}`] || "", createdOn); });
  }
  for (const [k, [amount, per]] of Object.entries(EXAMPLE.worth)) {
    const [profile, i] = k.split("#");
    w = setWorth(w, profile, Number(i), amount, per, createdOn);
  }
  const later = (n) => new Date(Date.parse(createdOn + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  for (const [k, [who, n]] of Object.entries(EXAMPLE.plan)) {
    const [profile, i] = k.split("#");
    w = setPlan(w, profile, Number(i), who, later(n), createdOn);
  }
  for (const [profile, i] of EXAMPLE.raised) w = setRaised(w, profile, i, true, createdOn);
  for (const id of EXAMPLE.alts) w = setAlt(w, id, true, createdOn);
  w = setCase(setSizing(w, EXAMPLE.sizing, createdOn), EXAMPLE.case, createdOn);
  for (const [id, [a, note]] of Object.entries(EXAMPLE.deal)) w = setDeal(w, id, a, note, createdOn);
  const shift = (n) => new Date(Date.parse(createdOn + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  w = setChannel(w, { ...EXAMPLE.channel, partners: EXAMPLE.channel.partners.map((p) => (p.reg ? { ...p, reg: { on: shift(p.reg[0]), until: shift(p.reg[1]) } } : p)) }, createdOn);
  return w;
}
export const isExample = (w) => /\|example\d$/.test(w.id);

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
    const item = { ...q, index: i, note: ans.note, ...(ans.amount != null ? { amount: ans.amount, per: ans.per } : {}), ...(ans.who ? { who: ans.who } : {}), ...(ans.by ? { by: ans.by } : {}) };
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
    readiness: land && catalog.lines[land.profile] ? catalog.lines[land.profile].readiness || [] : [],
    raised: raisedObjections(catalog, w),
  };
}

// ------------------------------------------------------------------ the journey: from "can we?" to "what would need to be true?"

const STAGE_ORDER = { value: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
const STATUS_ORDER = { gap: 0, unknown: 1, partly: 2 };

const ANSWER_SHORT = { solved: "solved", partly: "partly", gap: "a real gap", unknown: "nobody knew" };

/**
 * The questions to take into a meeting, with how to ask each one: who to ask, what to listen for, what to ask next.
 * Narrowed to the essential ones, or to the people who will be there; what was already answered says so.
 */
export function questionGuide(catalog, w, filter = {}) {
  const roles = (filter.roles || []).filter((r) => ROLE_WORDS[r]);
  const scope = w.scope.filter((p) => catalog.lines[p]);
  const out = [`# Questions for ${w.customer}`, ""];
  const narrow = [filter.core ? "the essential questions only" : "", roles.length ? `for ${roles.map((r) => ROLE_WORDS[r].toLowerCase()).join(", ")}` : ""].filter(Boolean).join(", ");
  out.push(narrow ? `Narrowed to ${narrow}.` : "Every question for the lines in scope.", "");
  let n = 0;
  for (const p of scope) {
    const line = catalog.lines[p];
    const qs = displayOrder(line).filter(({ q }) => inMeeting(q, { core: !!filter.core, roles }));
    if (!qs.length) continue;
    out.push(`## ${line.label}`, "");
    for (const { q, index } of qs) {
      const ans = w.answers[`${p}#${index}`];
      n++;
      out.push(`${n}. ${q.q}${q.core ? " (essential)" : ""}${ans ? ` [answered: ${ANSWER_SHORT[ans.a]}]` : ""}`);
      if (q.role) out.push(`   - Ask: ${ROLE_WORDS[q.role].toLowerCase()}`);
      if (q.why) out.push(`   - Why it matters: ${q.why}`);
      if (q.listen) out.push(`   - Listen for: ${q.listen}`);
      if (q.probe) out.push(`   - Then ask: ${q.probe}`);
    }
    out.push("");
  }
  if (!n) out.push("No question matches: widen the filter.", "");
  out.push("_Prepared with Beyond 90. The questions come from its product profiles; nothing left the browser it was written in._", "");
  return out.join("\n");
}

/** One line's answers turned into conditions: what would need to be true, where the customer is today, the first step. */
function conditions(l, w) {
  const of = (items, status) => items.map((q) => ({ fact: w ? factFor(w, l.profile, q.index) : "", need: q.need || q.q, how: q.how || "", q: q.q, note: q.note || "", status, stage: q.stage, profile: l.profile, index: q.index, who: q.who || "", by: q.by || "" }));
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
  const land = res.land, all = conditions(land, w);
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
      conditions: l ? conditions(l, w) : [], already: l ? already(l.solved) : [], discussed: !!(l && l.answered),
      validate: proof.slice(0, 1).map((c) => c.text) });
  }
  const need = steps.reduce((n, s) => n + s.conditions.length, 0);
  const done = steps.reduce((n, s) => n + s.already.length, 0);
  const unknown = steps.reduce((n, s) => n + s.conditions.filter((c) => c.status === "unknown").length, 0);
  const values = [...land.gaps, ...land.partly, ...land.unknowns, ...land.solved].filter((q) => q.stage === "value");
  const impact = values.filter((q) => q.note).map((q) => q.note);
  // the figures the customer put on what is at stake, each with what it measures
  const stakes = values.filter((q) => q.amount != null).map((q) => ({ amount: q.amount, per: q.per, what: q.q, text: worthText(q) }));
  const destination = steps.map((s) => s.label);
  return {
    customer: w.customer, steps, need, done, unknown, impact, stakes, destination,
    headline: `Yes, this is possible. For ${w.customer}, ${need} thing${need === 1 ? "" : "s"} need${need === 1 ? "s" : ""} to be true; ${done} already ${done === 1 ? "is" : "are"}.`,
  };
}

/** The note to send after the meeting: what we heard, where it hurts, the proposal, and what is still open. */
export function summaryMarkdown(catalog, w, res) {
  const out = [`# Discovery: ${w.customer}`, "", `Workshop started ${w.created_on}, last updated ${w.updated_on}. ${res.answered} of ${res.total} questions answered across ${res.lines.length} product line${res.lines.length === 1 ? "" : "s"}.`, ""];
  if (w.inventory) {
    out.push("## Where they start from", "", inventoryLine(w.inventory), "");
    const sk = sketch(w.inventory, w.sizing || {});
    if (sk.ok) out.push(sketchMarkdown(sk), "");
    const pw = planWaves(w.inventory, w.waves || {}, w.updated_on);
    if (pw.ok) out.push(wavesMarkdown(pw), "");
  }
  out.push("## What we heard", "");
  for (const l of res.lines) {
    if (!l.answered) continue;
    out.push(`### ${l.label} (${Math.round(l.pain * 100)}% still missing, ${l.answered} of ${l.total} answered)`, "");
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
    if (j.stakes.length) out.push(...j.stakes.map((x) => `**At stake: ${x.text}**, in answer to "${x.what}"`), "");
    if (j.impact.length) out.push(`What is at stake, in their words: ${j.impact.map((x) => `"${x}"`).join("; ")}.`, "");
    j.steps.forEach((st, i) => {
      out.push(`### ${i + 1}. ${st.title}`, "");
      if (st.why) out.push(`Why next: ${st.why}.`, "");
      for (const c of st.conditions) out.push(`- [ ] ${c.need}. First step: ${c.how}. Today: ${({ gap: "a real gap", partly: "partly", unknown: "nobody knows yet" })[c.status]}${c.note ? ` ("${c.note}")` : ""}.${c.who ? ` Owner: ${WHO[c.who].toLowerCase()}.` : ""}${c.by ? ` By ${c.by}.` : ""}`);
      for (const a of st.already) out.push(`- [x] ${a}.`);
      if (st.validate.length) out.push("", `Validated by: ${st.validate.join("; ")}.`);
      out.push("");
    });
  }
  if (!j) out.push("## Where to start", "", res.waiting, "");
  const raised = res.raised || [];
  if (raised.length) {
    out.push("## Concerns they raised", "");
    for (const o of raised) out.push(`- **"${o.says}"** (${o.label}). Our answer: ${o.answer} To prove it: ${o.prove}`);
    out.push("");
  }
  const cs = w.case ? buildCase(w.case) : null;
  if (cs && cs.ok) out.push("## The case for change", "", caseMarkdown(cs).split("\n").slice(2).join("\n"), "");
  if (w.gpu && w.scope.includes("private-ai")) out.push(gpuMarkdown(gpuSketch(w.gpu)), "");
  if (w.dr && w.scope.includes("dr-backup")) out.push(drMarkdown(drSketch(w.dr, w.inventory)), "");
  if (w.obj && w.scope.includes("object-storage")) out.push(objMarkdown(objSketch(w.obj, w.inventory)), "");
  if (w.edge && w.scope.includes("edge-sites")) out.push(edgeMarkdown(edgeSketch(w.edge)), "");
  if (w.unit && w.scope.some((p) => UNIT_LINES.includes(p))) { const u = unitSketch(w.unit, w.inventory); if (u.ok) out.push(unitMarkdown(u), ""); }
  const told = res.land ? stories(catalog, w, res).find((x) => x.land) : null;
  if (told && Object.keys(told.audiences).length) {
    out.push(`## How to tell it: ${told.label.toLowerCase()}`, "");
    for (const [k, v] of Object.entries(told.audiences)) out.push(`- **${AUDIENCE_WORDS[k]}:** ${v}`);
    if (told.people.length) out.push(`- **Who to involve next:** ${told.people.join("; ")}.`);
    out.push("");
  }
  if (res.unknowns.length) {
    out.push("## To find out before the next meeting", "");
    for (const u of res.unknowns) out.push(`- ${u.label}: ${u.q}`);
    out.push("");
  }
  if (w.channel) {
    const c = w.channel;
    out.push("## Partners", "", ...c.partners.map((p) => `- ${p.name}: ${KINDS[p.kind].toLowerCase()}${p.lead ? ", leads the deal" : ""}${p.reg ? `, registered ${p.reg.on} to ${p.reg.until}` : ""}`), "");
    out.push(`Route to purchase: ${c.route ? ROUTES[c.route].toLowerCase() : "not set"}.`, "", ...ACTIVITIES.map((a) => `- ${a.label}: ${whoLabel(c, (c.split || {})[a.id] || "")}`), "");
  }
  if (w.rfp && w.rfp.reqs.length) {
    const st = rfpState(catalog, w, w.updated_on);
    out.push(`## The tender${st.title ? `: ${st.title}` : ""}`, "", `${st.verdict.text} ${st.total} requirements, ${st.must} mandatory: ${st.yes} met, ${st.partly} partly, ${st.no} not met, ${st.check} to check, ${st.open} not answered yet.${st.deadlines.questions_due ? ` Questions due ${st.deadlines.questions_due}.` : ""}${st.deadlines.due ? ` Bid due ${st.deadlines.due}.` : ""}`, "");
  }
  const alts = alternativesMarkdown(catalog, w);
  if (alts) out.push(alts);
  const deal = dealMarkdown(w.deal);
  if (deal) out.push(deal);
  out.push("_Prepared with Beyond 90. The questions come from its product profiles; nothing in this note left the browser it was written in._", "");
  return out.join("\n");
}

/** The inventory in one sentence. */
export function inventoryLine(s) {
  return `${fmt(s.vms)} virtual machines (${fmt(s.on)} running) on ${fmt(s.clusters.length)} cluster${s.clusters.length === 1 ? "" : "s"} and ${fmt(s.hosts)} host${s.hosts === 1 ? "" : "s"}: `
    + `${fmt(s.vcpu_on)} vCPU and ${fmt(s.mem_on_gib)} GiB of memory in use, ${fmt(s.used_tib != null ? s.used_tib : s.prov_tib)} TiB of storage ${s.used_tib != null ? "used" : "provisioned"}`
    + `${s.past_total ? `; ${fmt(s.past_total)} machines on operating systems past general support` : ""}. From the inventory export of ${s.imported_on}.`;
}

// ------------------------------------------------------------------ the readout: a page for the customer

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TODAY_WORDS = { gap: "Not yet in place", partly: "Partly in place", unknown: "To find out together" };

/**
 * The discovery readout: one page to send to the customer, or to show on the screen at the next meeting. It speaks the
 * customer's language (no pain scores, no internal stage codes) and keeps the same rigour: what we heard, what would need
 * to be true, the first steps, how each step is proven, and what is still open. Every piece of text is escaped; the page
 * has no scripts and loads nothing.
 */
export function readoutHtml(catalog, w, res, { preparedBy = "", today = "" } = {}) {
  const j = journey(catalog, w, res);
  const heard = res.lines.filter((l) => l.answered);
  const css = `
    @page{size:A4;margin:16mm}
    *{box-sizing:border-box}
    body{margin:0;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#142029;background:#fff}
    main{max-width:820px;margin:0 auto;padding:40px 32px 56px}
    header.top{border-bottom:3px solid #0f766e;padding-bottom:18px;margin-bottom:26px}
    header.top p{margin:0;color:#43515b}
    h1{font-size:30px;line-height:1.15;margin:6px 0 10px;letter-spacing:-.01em}
    h2{font-size:20px;margin:34px 0 10px;color:#0b5f59}
    h3{font-size:16px;margin:20px 0 6px}
    .lead{font-size:19px;font-weight:600;color:#0b5f59;margin:0 0 6px}
    .stake{border-left:4px solid #0f766e;background:#f1f6f5;padding:10px 14px;margin:14px 0;border-radius:0 8px 8px 0}
    .stake small{display:block;color:#43515b;font-size:12.5px;font-weight:700}
    .stake .fig{font-size:20px;color:#0b5f59}
    .stake .q{font-size:12.5px;color:#43515b}
    .stats{display:flex;gap:28px;margin:14px 0 4px}
    .stats div b{display:block;font-size:26px;line-height:1.1}
    .stats div span{font-size:12.5px;color:#43515b}
    ol.steps{list-style:none;padding:0;margin:0;counter-reset:s}
    ol.steps>li{counter-increment:s;position:relative;padding:0 0 18px 48px;break-inside:avoid}
    ol.steps>li::before{content:counter(s);position:absolute;left:0;top:0;width:32px;height:32px;border-radius:50%;background:#0f766e;color:#fff;display:grid;place-items:center;font-weight:800}
    ol.steps>li>h3{margin:4px 0 6px}
    .why{color:#43515b;margin:0 0 8px}
    table{width:100%;border-collapse:collapse;margin:6px 0}
    th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid #dfe5e8;font-size:14px}
    th{font-size:12px;color:#43515b;font-weight:700}
    td.st{white-space:nowrap;font-size:12.5px;color:#43515b}
    .done{color:#1b7a4c;font-size:14px;margin:6px 0}
    .proof{background:#f4f6f8;border-radius:8px;padding:8px 12px;margin:8px 0 0;font-size:14px}
    .proof b{font-size:12.5px;color:#43515b}
    ul{margin:6px 0;padding-left:20px}
    .heard li{margin:3px 0}
    .heard q{color:#43515b}
    footer{margin-top:40px;padding-top:12px;border-top:1px solid #dfe5e8;color:#5f6c76;font-size:12.5px}
    @media print{main{padding:0}h2{break-after:avoid}}`;
  const out = [`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${esc(w.customer)}: discovery readout</title><style>${css}</style></head><body><main>`,
    `<header class="top"><p>Discovery readout${today ? `, ${esc(today)}` : ""}</p><h1>${esc(w.customer)}: where we could go together</h1>`,
    `<p>From our conversation${heard.length ? ` on ${esc(heard.map((l) => l.label.toLowerCase()).join(", "))}` : ""}. It is meant to be corrected: tell us what we misheard.</p></header>`];
  if (w.inventory) out.push(`<div class="stake"><small>Where you start from</small>${esc(inventoryLine(w.inventory))}</div>`);
  if (j) {
    out.push(`<p class="lead">Yes, this is possible.</p><p>Here is what would need to be true, how we would get there, and how each step would be proven before the next one starts.</p>`);
    out.push(`<div class="stats"><div><b>${j.need}</b><span>things to make true</span></div><div><b>${j.done}</b><span>already true today</span></div><div><b>${j.unknown}</b><span>to find out together</span></div></div>`);
    if (j.stakes.length || j.impact.length) {
      out.push(`<div class="stake"><small>What is at stake, in your words</small>`);
      for (const x of j.stakes) out.push(`<b class="fig">${esc(x.text)}</b> <span class="q">in answer to &ldquo;${esc(x.what)}&rdquo;</span><br>`);
      out.push(`${j.impact.map((x) => `&ldquo;${esc(x)}&rdquo;`).join("<br>")}</div>`);
    }
    out.push(`<h2>The journey</h2><ol class="steps">`);
    for (const st of j.steps) {
      out.push(`<li><h3>${esc(st.title)}</h3>`);
      if (st.why) out.push(`<p class="why">${esc(st.why.charAt(0).toUpperCase() + st.why.slice(1))}.</p>`);
      if (st.conditions.length) {
        const planned = st.conditions.some((c) => c.who || c.by);
        out.push(`<table><thead><tr><th>What would need to be true</th><th>Today</th><th>First step</th>${planned ? "<th>Who, by when</th>" : ""}</tr></thead><tbody>`);
        for (const c of st.conditions) {
          out.push(`<tr><td>${esc(c.need)}${c.note ? `<br><q>${esc(c.note)}</q>` : ""}${c.fact ? `<br><small>${esc(c.fact)}</small>` : ""}</td><td class="st">${TODAY_WORDS[c.status]}</td><td>${esc(c.how)}</td>`
            + (planned ? `<td class="st">${c.who ? esc(WHO[c.who]) : ""}${c.who && c.by ? "<br>" : ""}${c.by ? esc(c.by) : ""}</td>` : "") + `</tr>`);
        }
        out.push(`</tbody></table>`);
      }
      if (st.already.length) out.push(`<p class="done"><b>Already true:</b> ${esc(st.already.join(". "))}.</p>`);
      if (st.validate.length) out.push(`<div class="proof"><b>How we would prove it</b><ul>${st.validate.map((v) => `<li>${esc(v)}.</li>`).join("")}</ul></div>`);
      out.push(`</li>`);
    }
    out.push(`</ol>`);
  } else {
    out.push(`<p class="lead">We are still listening.</p><p>${esc(res.waiting)}</p>`);
  }
  if (heard.length) {
    out.push(`<h2>What we heard</h2>`);
    for (const l of heard) {
      const said = [...l.gaps, ...l.partly, ...l.unknowns, ...l.solved].filter((q) => q.note);
      const working = l.solved.map((q) => q.need || q.q);
      out.push(`<h3>${esc(l.label)}</h3><ul class="heard">`);
      for (const q of said) out.push(`<li>${esc(q.q)} <q>${esc(q.note)}</q></li>`);
      if (working.length) out.push(`<li>Working well: ${esc(working.join("; "))}.</li>`);
      if (!said.length && !working.length) out.push(`<li>${l.answered} question${l.answered === 1 ? "" : "s"} discussed.</li>`);
      out.push(`</ul>`);
    }
  }
  const pw = w.inventory ? planWaves(w.inventory, w.waves || {}, w.updated_on) : null;
  if (pw && pw.ok) {
    out.push(`<h2>How the move would run</h2><p>${esc(wavesLine(pw))} A first plan from the inventory, to adjust with the application owners.</p>`);
    out.push(`<table><thead><tr><th>Date</th><th>Wave</th><th>Cluster</th><th>Machines</th></tr></thead><tbody>`);
    for (const wv of pw.waves) out.push(`<tr><td class="st">${esc(wv.date)}</td><td>${wv.test ? "Test wave" : `Wave ${wv.n}`}</td><td>${esc(wv.cluster)}</td><td>${wv.machines}</td></tr>`);
    out.push(`</tbody></table><div class="proof"><b>Every wave, the same steps</b><ul>${RUNBOOK.map((r) => `<li><b>${esc(r.when)}:</b> ${esc(r.steps.join("; "))}.</li>`).join("")}</ul></div>`);
  }
  const cs = w.case && w.case.in_readout ? buildCase(w.case) : null;
  if (cs && cs.ok) {
    out.push(`<h2>The case for change, in your figures</h2><p>${esc(caseLine(cs))}</p><table><thead><tr><th>Cost</th><th>Staying</th><th>Moving</th><th>Difference</th></tr></thead><tbody>`);
    for (const r of cs.rows) out.push(`<tr><td>${esc(r.label)}</td><td>${money(r.stay)}</td><td>${money(r.move)}</td><td>${money(r.diff)}</td></tr>`);
    out.push(`<tr><td><b>Total over ${cs.years} year${cs.years === 1 ? "" : "s"}</b></td><td><b>${money(cs.stay)}</b></td><td><b>${money(cs.move)}</b></td><td><b>${money(cs.saving)}</b></td></tr></tbody></table>`);
    out.push(`<p class="why">Every figure came from you, and the arithmetic is shown; it is not a quote. Tell us which figure is wrong and we will redo it.</p>`);
  }
  const raised = res.raised || [];
  if (raised.length) {
    out.push(`<h2>What you asked us to prove</h2><table><thead><tr><th>Your concern</th><th>How we would prove it</th></tr></thead><tbody>`);
    for (const o of raised) out.push(`<tr><td>&ldquo;${esc(o.says)}&rdquo;</td><td>${esc(o.prove)}</td></tr>`);
    out.push(`</tbody></table>`);
  }
  const told = res.land ? stories(catalog, w, res).find((x) => x.land) : null;
  const people = told ? told.people : [];
  if (res.unknowns.length || people.length) {
    out.push(`<h2>For our next meeting</h2>`);
    if (res.unknowns.length) out.push(`<ul>${res.unknowns.map((u) => `<li>${esc(u.q)} <span style="color:#5f6c76">(${esc(u.label.toLowerCase())})</span></li>`).join("")}</ul>`);
    if (people.length) out.push(`<p>It helps to have in the room:</p><ul>${people.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  }
  const by = preparedBy || w.prepared_by || "";
  out.push(`<footer>${by ? `Prepared by ${esc(by)}. ` : ""}Written from our conversation in the browser where it was recorded; nothing was sent anywhere to produce it.</footer></main></body></html>`);
  return out.join("");
}

// ------------------------------------------------------------------ the plan in a calendar

/** The dated conditions, earliest first: what each side said it would make true, and by when. */
export function datedPlan(j) {
  if (!j) return [];
  return j.steps.flatMap((st) => st.conditions.filter((c) => c.by).map((c) => ({ ...c, step: st.title })))
    .sort((a, b) => cmp(a.by, b.by) || cmp(a.need, b.need));
}

/** One all-day event per dated condition, for any calendar. Nothing in it but what the plan says. */
export function planIcs(w, j, stamp) {
  return calendar("Discovery plan", datedPlan(j).map((c) => ({
    uid: `${w.id.replace(/\|/g, "-")}-${c.profile}-${c.index}`, date: c.by, summary: `${w.customer}: ${c.need}`,
    description: `${c.step}. First step: ${c.how}.${c.who ? ` Owner: ${WHO[c.who].toLowerCase()}.` : ""}`,
  })), stamp);
}
