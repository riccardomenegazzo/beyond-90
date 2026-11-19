/**
 * Working with partners in the territory: most infrastructure deals reach the customer through a reseller, a systems
 * integrator, a service provider or a distributor, and the presales engineer sells with them, not around them.
 *
 * For one deal: the partners on it (one leads), the deal registration and when it runs out, the route to purchase,
 * who does what from discovery to support (us, the partner, or together), and what each partner can deliver on the
 * lines in scope. From that: what could go wrong (a registration about to lapse, a step nobody owns, a partner asked
 * to deliver what it has no skills for), a brief to hand the partner, and an enablement kit that lets a partner's
 * engineers run the same discovery without any customer's data in it.
 *
 * Plain data and functions; nothing names a vendor or a partner, and nothing leaves the browser unless it is exported.
 */
import { DEAL, dealState } from "./qualify.js";
import { displayOrder, ROLE_WORDS } from "./questions.js";

export const KINDS = { reseller: "Reseller", integrator: "Systems integrator", service_provider: "Service provider", distributor: "Distributor", consulting: "Consulting partner" };
export const ROUTES = { direct: "Direct from the vendor", reseller: "Through a reseller", distribution: "Through a distributor and a reseller", framework: "Through a public framework or marketplace", service: "As a service from a service provider" };
export const ACTIVITIES = [
  { id: "discovery", label: "Discovery", key: true },
  { id: "demo", label: "Demo" },
  { id: "sizing", label: "Sizing" },
  { id: "proof", label: "Proof of value", key: true, skill: true },
  { id: "proposal", label: "Proposal and price" },
  { id: "delivery", label: "Deployment and migration", key: true, skill: true },
  { id: "support", label: "Support after go-live", skill: true },
];
const ACT_IDS = ACTIVITIES.map((a) => a.id);
export const MAX_PARTNERS = 4;
const MAX_NAME = 80;
const EXPIRING_DAYS = 14;

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const text = (s, most) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, most);
const days = (from, to) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
const okWho = (v, n) => v === "us" || v === "both" || (/^p[0-3]$/.test(v) && Number(v.slice(1)) < n);

/** A channel record as stored: checked key by key, so a stray field refuses the whole record. */
export function validChannel(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (!Object.keys(c).every((k) => ["partners", "route", "split"].includes(k))) return false;
  const ps = c.partners;
  if (!Array.isArray(ps) || !ps.length || ps.length > MAX_PARTNERS) return false;
  let leads = 0;
  for (const p of ps) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return false;
    if (!Object.keys(p).every((k) => ["name", "kind", "lead", "reg", "skills"].includes(k))) return false;
    if (typeof p.name !== "string" || !p.name.trim() || p.name.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(p.name)) return false;
    if (!Object.hasOwn(KINDS, p.kind)) return false;
    if (p.lead != null && p.lead !== true) return false;
    if (p.lead) leads++;
    if (p.reg != null && !(p.reg && typeof p.reg === "object" && Object.keys(p.reg).length === 2 && isDate(p.reg.on) && isDate(p.reg.until) && p.reg.until >= p.reg.on)) return false;
    if (p.skills != null && !(Array.isArray(p.skills) && p.skills.length <= 20 && new Set(p.skills).size === p.skills.length && p.skills.every((s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s)))) return false;
  }
  if (leads > 1) return false;
  if (c.route != null && !Object.hasOwn(ROUTES, c.route)) return false;
  if (c.split != null) {
    if (!c.split || typeof c.split !== "object" || Array.isArray(c.split)) return false;
    if (!Object.entries(c.split).every(([k, v]) => ACT_IDS.includes(k) && okWho(v, ps.length))) return false;
  }
  return true;
}

/**
 * What the page gives, made safe to store: names trimmed, empty partners dropped, one lead at most, registration
 * dates kept only as a pair in order, and who-does-what pointing only at partners that are still there.
 * Returns null when no partner is left.
 */
export function cleanChannel(given) {
  const g = given && typeof given === "object" ? given : {};
  const kept = [];
  const index = new Map();
  (Array.isArray(g.partners) ? g.partners : []).forEach((p, i) => {
    if (!p || kept.length >= MAX_PARTNERS) return;
    const name = text(p.name, MAX_NAME);
    if (!name) return;
    const out = { name, kind: Object.hasOwn(KINDS, p.kind) ? p.kind : "reseller" };
    if (p.lead === true && !kept.some((x) => x.lead)) out.lead = true;
    if (p.reg && isDate(p.reg.on) && isDate(p.reg.until) && p.reg.until >= p.reg.on) out.reg = { on: p.reg.on, until: p.reg.until };
    const skills = Array.isArray(p.skills) ? [...new Set(p.skills.filter((s) => typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s)))].slice(0, 20) : [];
    if (skills.length) out.skills = skills;
    index.set(`p${i}`, `p${kept.length}`);
    kept.push(out);
  });
  if (!kept.length) return null;
  const out = { partners: kept };
  if (Object.hasOwn(ROUTES, g.route)) out.route = g.route;
  const split = {};
  for (const [k, v] of Object.entries(g.split && typeof g.split === "object" ? g.split : {})) {
    if (!ACT_IDS.includes(k)) continue;
    const to = v === "us" || v === "both" ? v : index.get(v);
    if (to) split[k] = to;
  }
  if (Object.keys(split).length) out.split = split;
  return out;
}

/** Who does an activity, in words: us, together, a partner's name, or not agreed yet. */
export function whoLabel(channel, v) {
  if (v === "us") return "Us";
  if (v === "both") return "Together";
  const p = channel && /^p[0-3]$/.test(v || "") ? channel.partners[Number(v.slice(1))] : null;
  return p ? p.name : "Not agreed";
}

/** The lead partner's deal registration on a day: none, active, expiring (two weeks or less) or expired, with the days left. */
export function registrationOf(channel, today) {
  if (!channel || !channel.partners.length) return null;
  const lead = channel.partners.find((p) => p.lead) || channel.partners[0];
  if (!lead.reg) return { lead, status: "none", days: null, on: "", until: "" };
  const left = days(today, lead.reg.until);
  return { lead, status: left < 0 ? "expired" : left <= EXPIRING_DAYS ? "expiring" : "active", days: left, on: lead.reg.on, until: lead.reg.until };
}

/**
 * Where the deal stands with its partners: the lead partner and its registration, who does what, what each partner
 * would be asked to deliver without the skills for it, and what to settle. Lines are the ones in scope.
 */
export function channelState(catalog, w, today) {
  const c = w.channel;
  if (!c) return null;
  const { lead, ...reg } = registrationOf(c, today);
  const leadIx = c.partners.indexOf(lead);
  const split = c.split || {};
  const rows = ACTIVITIES.map((a) => ({ ...a, who: split[a.id] || "", whoText: whoLabel(c, split[a.id] || "") }));
  const lines = w.scope.filter((p) => catalog.lines[p]);
  // a partner asked to run a proof, deploy or support a line it has no skills for: enablement, or bring a specialist
  const gaps = [];
  c.partners.forEach((p, i) => {
    const asked = ACTIVITIES.filter((a) => a.skill && (split[a.id] === `p${i}` || (split[a.id] === "both" && i === leadIx)));
    if (!asked.length) return;
    const missing = lines.filter((l) => !(p.skills || []).includes(l));
    if (missing.length) gaps.push({ partner: p.name, activities: asked.map((a) => a.label.toLowerCase()), lines: missing.map((l) => catalog.lines[l].label) });
  });
  const unowned = rows.filter((r) => r.key && !r.who).map((r) => r.label);
  const warnings = [];
  if (reg.status === "expired") warnings.push({ level: "high", text: `${lead.name}'s deal registration ran out on ${reg.until}: renew it before anything else, or the deal is unprotected.` });
  else if (reg.status === "expiring") warnings.push({ level: "high", text: `${lead.name}'s deal registration runs out in ${reg.days} day${reg.days === 1 ? "" : "s"} (${reg.until}): ask for an extension now.` });
  else if (reg.status === "none" && lead.kind !== "distributor") warnings.push({ level: "watch", text: `No deal registration for ${lead.name}: register it before the next meeting, so the partner that brought it keeps it.` });
  if (unowned.length) warnings.push({ level: "watch", text: `Nobody owns ${unowned.map((u) => u.toLowerCase()).join(", ")} yet: agree it with ${lead.name}.` });
  for (const g of gaps) warnings.push({ level: "watch", text: `${g.partner} is down for ${g.activities.join(" and ")} without skills on ${g.lines.join(", ")}: plan their enablement, or bring a specialist.` });
  if (!c.route) warnings.push({ level: "watch", text: "The route to purchase is not set: say whether it goes through a reseller, a distributor, a public framework or a service provider." });
  return { lead, leadIx, partners: c.partners, route: c.route || "", reg, rows, gaps, warnings };
}

const cell = (t) => String(t || "").replace(/\|/g, "/").replace(/\n/g, " ");

/**
 * The brief for the partner on this deal: who does what, where the customer stands, what would convince them, the
 * concerns raised, what the deal still needs, and the skills to line up. The customer's own words only when asked.
 */
export function partnerBrief(catalog, w, res, { today = "", words = false } = {}) {
  const st = channelState(catalog, w, today);
  if (!st) return "";
  const out = [`# Brief for ${st.lead.name}: ${text(w.customer, 120)}`, "",
    `Shared on ${today} by the vendor's presales engineer, for the people working this deal at ${st.lead.name}.${words ? " It contains what the customer said: keep it to the people on the deal." : ""}`, ""];
  out.push(`Route to purchase: ${st.route ? ROUTES[st.route].toLowerCase() : "not set yet"}.`);
  out.push(st.reg.status === "none" ? "Deal registration: none yet." : `Deal registration: ${st.reg.on} to ${st.reg.until}${st.reg.status === "expired" ? " (ran out)" : st.reg.status === "expiring" ? ` (${st.reg.days} days left)` : ""}.`, "");
  out.push("## Who does what", "", "| Step | Who |", "|---|---|", ...st.rows.map((r) => `| ${r.label} | ${cell(r.whoText)} |`), "");
  if (st.partners.length > 1) out.push("On the deal: " + st.partners.map((p) => `${p.name} (${KINDS[p.kind].toLowerCase()}${p.lead ? ", leads" : ""})`).join("; ") + ".", "");
  if (res.land) {
    out.push("## Where the customer stands", "", `Start with ${res.land.label.toLowerCase()}.`, "");
    const open = [...res.land.gaps, ...res.land.partly].filter((q) => q.stage !== "value").slice(0, 6);
    if (open.length) out.push("What would need to be true:", "", ...open.map((q) => `- ${cell(q.need || q.q)}${words && q.note ? ` (they said: "${cell(q.note)}")` : ""}`), "");
    if (words) {
      const said = res.lines.flatMap((l) => [...l.gaps, ...l.partly, ...l.unknowns, ...l.solved]).filter((q) => q.stage === "value" && q.note).slice(0, 3);
      if (said.length) out.push("What is at stake, in their words:", "", ...said.map((q) => `- "${cell(q.note)}"`), "");
    }
  }
  if ((res.proof || []).length) out.push("## What a proof would have to show", "", ...res.proof.slice(0, 4).map((c) => `- ${cell(c.text)}`), "");
  if ((res.raised || []).length) out.push("## Concerns they raised", "", ...res.raised.map((o) => `- "${cell(o.says)}": ${cell(o.answer)} Prove it: ${cell(o.prove)}`), "");
  const ds = dealState(w.deal);
  if (ds.answered) {
    out.push("## The deal", "", `${ds.verdict}.`);
    if (ds.missing.length) out.push("", `Still to find out, together:`, "", ...ds.missing.map((m) => `- ${m.tag}: ${m.probe}`));
    out.push("");
  }
  if (st.gaps.length) out.push("## Skills to line up", "", ...st.gaps.map((g) => `- ${g.partner}, for ${g.activities.join(" and ")}: ${g.lines.join(", ")}`), "");
  out.push("_Prepared with Beyond 90. Share it only with the people working this deal._", "");
  return out.join("\n");
}

/**
 * An enablement kit for a partner's engineers on some lines: the essential questions with how to ask them, the ten
 * qualification questions, the concerns customers raise with how to answer and prove them, what a proof would have
 * to show and what to have ready on its first day. No customer's data: it can go to any partner.
 */
export function enablementKit(catalog, profiles) {
  const lines = profiles.filter((p) => catalog.lines[p]);
  const out = ["# Discovery kit for partners", "", `For: ${lines.map((p) => catalog.lines[p].label).join(", ")}.`, "",
    "The same questions, in the same order, that the vendor's engineers ask: so a meeting run by a partner gives the same answers to work from. No customer's data is in it.", ""];
  for (const p of lines) {
    const line = catalog.lines[p];
    out.push(`## ${line.label}`, "");
    if (line.description) out.push(line.description, "");
    const core = displayOrder(line).filter(({ q }) => q.core);
    out.push("### The essential questions", "");
    core.forEach(({ q }, i) => {
      out.push(`${i + 1}. ${q.q}`);
      if (q.role && ROLE_WORDS[q.role]) out.push(`   - Ask: ${ROLE_WORDS[q.role].toLowerCase()}`);
      if (q.listen) out.push(`   - Listen for: ${q.listen}`);
      if (q.probe) out.push(`   - Then ask: ${q.probe}`);
    });
    out.push("");
    const story = line.story || {};
    if ((story.objections || []).length) {
      out.push("### What customers raise, and how to answer", "");
      for (const o of story.objections) out.push(`- "${cell(o.says)}" Ask first: ${cell(o.clarify)} Answer: ${cell(o.answer)} Prove it: ${cell(o.prove)}`);
      out.push("");
    }
    if ((line.proof || []).length) out.push("### What a proof would have to show", "", ...line.proof.slice(0, 5).map((c) => `- ${cell(c.text)}`), "");
    if ((line.readiness || []).length) out.push("### Ready on the proof's first day", "", ...line.readiness.map((r) => `- [ ] ${cell(r)}`), "");
  }
  out.push("## Qualify the deal, the same way on every line", "");
  DEAL.forEach((d, i) => { out.push(`${i + 1}. ${d.tag}: ${d.q}`, `   - Listen for: ${d.listen}`, `   - Then ask: ${d.probe}`); });
  out.push("", "_Prepared with Beyond 90. Free to share with any partner: it holds no customer's data._", "");
  return out.join("\n");
}
