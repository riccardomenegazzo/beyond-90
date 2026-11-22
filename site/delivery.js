/**
 * The handover from presales to the team that delivers and runs it: what was proven, what the customer asked us to prove,
 * what each side agreed to do by when, how it was sized and how the move would run, what is still open, and the promises
 * to keep after go-live. Built from the workshop and its proof of value; no DOM, so Node can test it.
 */
import { progress, STATUS_TEXT } from "./pov.js";
import { assess, journey, inventoryLine, stories, WHO, worthText, figuresHeard } from "./workshop.js";
import { sketch } from "./sizing.js";
import { planWaves, wavesLine, copyLine } from "./waves.js";
import { buildCase, caseLine } from "./valuecase.js";
import { gpuSketch } from "./gpu.js";
import { drSketch } from "./drsketch.js";
import { bidCommitments } from "./rfp.js";
import { edgeSketch } from "./edgesketch.js";
import { vdiSketch } from "./vdisketch.js";
import { k8sSketch } from "./k8ssketch.js";
import { dbSketch } from "./dbsketch.js";
import { fileSketch } from "./filesketch.js";
import { unitSketch, money as unitMoney } from "./unitcost.js";
import { objSketch } from "./objsketch.js";
import { channelState, KINDS } from "./partners.js";

const clean = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const cell = (t) => clean(t).replace(/\|/g, "/");
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const lower = (t) => { const x = clean(t); return x.charAt(0).toLowerCase() + x.slice(1); };

/** The proof of value kept for this prospect: the most recently changed one under the same name. */
export function povFor(povs, customer) {
  return (povs || []).filter((p) => same(p.customer, customer)).sort((a, b) => (b.updated_on || b.created_on || "").localeCompare(a.updated_on || a.created_on || ""))[0] || null;
}

/**
 * What the delivery team inherits as promises: tests passed that must stay true in production, conditions we (or we and
 * the customer together) agreed to make true, and what the customer asked us to prove that is not proven yet.
 */
export function promisesFrom(catalog, w, pov) {
  const res = assess(catalog, w), j = journey(catalog, w, res);
  const out = [];
  if (pov) for (const c of pov.criteria) if (c.status === "met") out.push({ what: `Keep true in production: ${lower(c.text)}`, who: "", due: "", from: "proven" });
  if (j) {
    for (const st of j.steps) for (const c of st.conditions) {
      if (c.who === "us" || c.who === "together") out.push({ what: clean(c.need), who: WHO[c.who], due: c.by || "", from: "agreed" });
    }
  }
  const met = new Set(pov ? pov.criteria.filter((c) => c.status === "met").map((c) => clean(c.text).toLowerCase()) : []);
  for (const o of res.raised || []) if (!met.has(clean(o.prove).toLowerCase())) out.push({ what: `Prove: ${lower(o.prove)}`, who: "", due: "", from: "asked" });
  const seen = new Set();
  return out.filter((x) => { const k = x.what.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).map((x) => ({ ...x, what: x.what.slice(0, 300) }));
}

/** The handover note, in Markdown. */
export function handoverMarkdown(catalog, w, pov, today) {
  const res = assess(catalog, w), j = journey(catalog, w, res);
  const L = [`# Handover to delivery: ${clean(w.customer)}`, "",
    `Prepared on ${today} from the discovery workshop started ${w.created_on}${pov ? ` and the proof of value started ${pov.created_on}` : ""}. For the team that will deliver and run it.`, ""];
  // in short
  const short = [];
  const lines = res.lines.filter((l) => l.answered).map((l) => l.label.toLowerCase());
  short.push(`Discussed: ${lines.length ? lines.join(", ") : "nothing recorded yet"}${res.land ? `; started with ${res.land.label.toLowerCase()}` : ""}.`);
  if (pov) {
    const pr = progress(pov);
    short.push(`Proof of value: ${pr.verdict} (${pr.met} of ${pr.total} criteria met${pr.partly ? `, ${pr.partly} partly` : ""}${pr.not_met ? `, ${pr.not_met} not met` : ""}${pr.open ? `, ${pr.open} not yet tried` : ""}); first-day checklist ${pr.ready} of ${pr.ready_total} done.`);
    if (pov.start || pov.end) short.push(`Test window ${pov.start || "?"} to ${pov.end || "?"}.`);
    if (pov.sponsor || pov.champion) short.push(`Sponsor ${clean(pov.sponsor) || "not named"}; champion ${clean(pov.champion) || "not named"}.`);
  } else short.push("No proof of value is kept for this prospect yet.");
  const figures = figuresHeard(catalog, w);
  if (figures.length) short.push(`At stake, in the customer's words: ${figures.map((f) => `${worthText(f)}${f.what ? ` ("${clean(f.what)}")` : ""}`).join("; ")}.`);
  L.push("## In short", "", ...short.map((x) => `- ${x}`), "");
  // what was proven
  if (pov && pov.criteria.length) {
    L.push("## What the proof of value showed", "", "| Criterion | Result | Evidence |", "|---|---|---|");
    for (const c of pov.criteria.filter((x) => x.status !== "dropped")) L.push(`| ${cell(c.text)} | ${STATUS_TEXT[c.status]} | ${cell(c.evidence) || "—"} |`);
    L.push("");
  }
  // what the customer asked us to prove
  if ((res.raised || []).length) {
    L.push("## What the customer asked us to prove", "");
    for (const o of res.raised) {
      const c = pov && pov.criteria.find((x) => same(x.text, o.prove));
      L.push(`- "${clean(o.says)}" (${o.label.toLowerCase()}): ${clean(o.prove)} **${c ? STATUS_TEXT[c.status] : "Not in the proof of value"}.**`);
    }
    L.push("");
  }
  // what was agreed
  if (j) {
    const owned = j.steps.flatMap((st) => st.conditions.map((c) => ({ ...c, step: st.title })));
    if (owned.length) {
      L.push("## What still has to be made true", "", "| Condition | Today | First step | Who | By |", "|---|---|---|---|---|");
      for (const c of owned) L.push(`| ${cell(c.need)} | ${({ gap: "a real gap", partly: "partly", unknown: "not known" })[c.status]} | ${cell(c.how)} | ${c.who ? WHO[c.who] : "—"} | ${c.by || "—"} |`);
      L.push("");
    }
  }
  // the numbers it rests on
  const facts = [];
  if (w.inventory) {
    facts.push(inventoryLine(w.inventory));
    const sk = sketch(w.inventory, w.sizing || {});
    if (sk.ok) facts.push(`Sizing sketch: ${sk.nodes} servers, decided by ${sk.decided}; assumptions ${w.sizing ? "agreed with the customer" : "left at the defaults"}. Confirm with the sizing tool before ordering.`);
    const pw = planWaves(w.inventory, w.waves || {}, w.updated_on);
    if (pw.ok) facts.push(`Plan in waves: ${wavesLine(pw)}${pw.has_data ? ` ${copyLine(pw)}` : ""}`);
  }
  const cs = w.case ? buildCase(w.case) : null;
  if (cs && cs.ok) facts.push(`Case for change: ${caseLine(cs)}`);
  const gs = w.gpu && w.scope.includes("private-ai") ? gpuSketch(w.gpu) : null;
  const ds = w.dr && w.scope.includes("dr-backup") ? drSketch(w.dr, w.inventory) : null;
  if (ds && ds.ok) facts.push(`Recovery design: ${ds.tiers.map((t) => `tier ${t.n} ${t.mode.toLowerCase()}`).join("; ")}; about ${Math.round(ds.mbps)} Mbit/s between the sites before compression.`);
  const os = w.obj && w.scope.includes("object-storage") ? objSketch(w.obj, w.inventory) : null;
  if (os && os.ok) facts.push(`Backup capacity: ${os.usable} TiB usable, ${os.raw} TiB raw, about ${os.gbps} Gbit/s in the nightly window; to confirm with the backup product's own calculator.`);
  const es = w.edge && w.scope.includes("edge-sites") ? edgeSketch(w.edge) : null;
  if (es && es.ok) facts.push(`Edge design: ${es.servers} servers at ${es.sites} sites in ${es.kinds.length} standard design${es.kinds.length === 1 ? "" : "s"} (${es.kinds.map((k) => `${clean(k.name).toLowerCase()}: ${k.servers_each} a site`).join("; ")})${es.witness_sites ? `, a witness for ${es.witness_sites} two-server sites` : ""}; upgrades in about ${es.weeks} weeks after a pilot of ${es.pilot}${es.kinds.some((k) => !k.copy_fits) ? "; some daily copies do not fit the night over their link" : ""}.`);
  const vs = w.vdi && w.scope.includes("euc") ? vdiSketch(w.vdi) : null;
  if (vs && vs.ok) facts.push(`Desktop sizing: ${vs.hosts} hosts for ${vs.concurrent} desktops at once (the ${vs.binding} decides, one or more kept free), ${vs.usable_tib} TiB of usable storage${vs.graphics ? `; ${vs.graphics} graphics desktops need hosts with GPUs` : ""}; to confirm with a week of real use on a pilot group.`);
  const ks = w.k8s && w.scope.includes("kubernetes-platform") ? k8sSketch(w.k8s) : null;
  if (ks && ks.ok) facts.push(`Container platform sizing: ${ks.workers} workers in ${ks.clusters.length} cluster${ks.clusters.length === 1 ? "" : "s"} (${ks.nodes} nodes with the control plane), ${ks.vcpu} virtual processors and ${ks.ram} GiB of memory, ${ks.pv_tib} TiB of persistent volumes; to confirm with the requests read from a running cluster.`);
  const dbs = w.db && w.scope.includes("dbaas") ? dbSketch(w.db) : null;
  if (dbs && dbs.ok) facts.push(`Database licences: ${dbs.licensed} cores to license on ${dbs.hosts} hosts kept for the databases${dbs.freed == null ? "" : dbs.freed >= 0 ? `, ${dbs.freed} fewer than today` : `, ${-dbs.freed} more than today`}; what must be licensed is for the customer's licensing specialist to confirm against the agreement.`);
  const fs = w.files && w.scope.includes("file-storage") ? fileSketch(w.files) : null;
  if (fs && fs.ok) facts.push(`File storage: ${fs.usable} TiB usable, ${fs.raw} TiB raw, ${fs.cold_tib} TiB on a cheaper tier; the share nobody opens to confirm with a scan of last-access times.`);
  const us = w.unit && w.scope.some((p) => ["cloud-operations", "service-provider-cloud", "hybrid-cloud"].includes(p)) ? unitSketch(w.unit, w.inventory) : null;
  if (us && us.ok) facts.push(`Cost per machine: ${unitMoney(us.month)} a month all in, across ${unitMoney(us.machines)} machines${us.tenant ? `; a standard tenant costs ${unitMoney(us.tenant.cost)} a month` : ""}. Agreed with finance? Check before it is used for showback or prices.`);
  if (gs && gs.ok) facts.push(`GPU sketch: ${gs.gpus} GPUs in ${gs.servers} server${gs.servers === 1 ? "" : "s"}, ${gs.copies} copies of the model, decided by ${gs.decided}; to confirm with a benchmark on the customer's own prompts.`);
  if (facts.length) L.push("## The numbers it rests on", "", ...facts.map((x) => `- ${x}`), "");
  // who delivers: the partners on the deal and who owns deployment and support, with the skills still to line up
  if (w.channel) {
    const st = channelState(catalog, w, today);
    const own = (id) => st.rows.find((r) => r.id === id);
    L.push("## Who delivers", "", `- Deployment and migration: ${own("delivery").whoText}.`, `- Support after go-live: ${own("support").whoText}.`,
      ...st.partners.map((p) => `- ${p.name}: ${KINDS[p.kind].toLowerCase()}${p.lead ? ", led the deal" : ""}${(p.skills || []).length ? `; skills on ${p.skills.map((x) => (catalog.lines[x] ? catalog.lines[x].label.toLowerCase() : x)).join(", ")}` : ""}.`),
      ...st.gaps.filter((g) => g.activities.some((a) => a !== "proof of value")).map((g) => `- To line up before go-live: ${g.partner} has no skills yet on ${g.lines.join(", ").toLowerCase()}.`), "");
  }
  // what the bid committed to: the mandatory requirements answered met or partly, and how; delivery has to keep them
  const bid = bidCommitments(w);
  if (bid.length) {
    L.push(`## What the bid committed to${w.rfp.title ? `: ${clean(w.rfp.title)}` : ""}`, "", ...bid.slice(0, 60).map((b) => `- ${b.ref ? `${clean(b.ref)}: ` : ""}${clean(b.text)}${b.how ? ` How: ${clean(b.how)}` : ""}${b.partly ? " (partly met: check what was offered)" : ""}`),
      ...(bid.length > 60 ? [`- And ${bid.length - 60} more in the compliance matrix.`] : []), "");
  }
  // who
  const told = res.land ? stories(catalog, w, res).find((x) => x.land) : null;
  if (told && told.people.length) L.push("## Who to keep involved", "", ...told.people.map((x) => `- ${x}`), "");
  // still open
  const open = [...(pov ? pov.criteria.filter((c) => c.status === "open" || c.status === "partly").map((c) => `Proof of value: ${clean(c.text)} (${STATUS_TEXT[c.status].toLowerCase()})`) : []),
    ...(pov ? pov.readiness.filter((r) => !r.done).map((r) => `First-day checklist: ${clean(r.text)}`) : []),
    ...res.unknowns.map((u) => `${u.label}: ${clean(u.q)}`)];
  if (open.length) L.push("## Still open", "", ...open.map((x) => `- ${x}`), "");
  const promises = promisesFrom(catalog, w, pov);
  if (promises.length) L.push("## Promises to keep after go-live", "", ...promises.map((p) => `- [ ] ${p.what}${p.who ? `. Owner: ${p.who.toLowerCase()}` : ""}${p.due ? `. By ${p.due}` : ""}.`), "");
  L.push("_Prepared with Beyond 90 from what was recorded in the browser where it was written; nothing was sent anywhere to produce it._", "");
  return L.join("\n");
}
