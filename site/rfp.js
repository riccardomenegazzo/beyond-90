/**
 * A tender or a request for proposal, requirement by requirement. The requirements are pasted from the document
 * (numbered lines, or rows copied from a spreadsheet); each is read as mandatory or scored, with its points when the
 * text gives them, and matched to the product line it asks about. Each is then answered: met, partly, not met or to
 * check, with how it is met and who answers it. From the answers come whether to bid, the questions to send the
 * contracting authority before their deadline, the points likely won, the coverage by line, and the compliance matrix
 * for the bid. Plain functions, no DOM, so Node can test them; nothing here names a product.
 */
import { csvCell } from "./ui.js";

export const ANSWERS = { yes: "Met", partly: "Partly", no: "Not met", check: "To check" };
export const WHO = { presales: "Presales", specialist: "A specialist", partner: "The partner", product: "The product team", commercial: "Commercial or legal" };
export const MAX_REQS = 400;
export const TEXT_MAX = 500;
export const REF_MAX = 24;
export const NOTE_MAX = 300;
export const TITLE_MAX = 120;
export const POINTS_MAX = 1000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROFILE = /^[a-z0-9-]{1,40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const flat = (t) => String(t == null ? "" : t).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const short = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ reading what was pasted

// Words that make a requirement mandatory, or merely scored, in the languages European tenders are often written in.
const MUST = /(?:^|[^\p{L}])(must|shall|mandatory|required|minimum requirement|deve|devono|obbligatori[oa]?|a pena di esclusione|requisit[oi] minim[oi]|doit|doivent|obligatoire|muss|müssen|erforderlich|debe|deben|obligatori[oa])(?![\p{L}])/iu;
const SHOULD = /(?:^|[^\p{L}])(should|may|desirable|optional|preferred|nice to have|preferibil\p{L}*|migliorativ\p{L}*|facoltativ\p{L}*|opzional\p{L}*|souhaitable|optionnel\p{L}*|wünschenswert|deseable|opcional)(?![\p{L}])/iu;
const POINTS = [/(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:points?|pts?\.?|punti|punto|pt\.?)(?![\p{L}])/iu, /(?:points?|punti|punteggio(?: massimo)?)\s*[:=]?\s*(?:max\.?\s*)?(\d{1,4}(?:[.,]\d{1,2})?)/iu];
// a reference at the start of a line: 3.2.1, R12, RT.05, Req 4, Item 7, A.1)
const REF = /^\s*((?:(?:req(?:uirement)?|item|rt|rf)\s*[.\-_#:]?\s*|[A-Za-z]{1,5}[.\-_]?)?\d{1,4}(?:[.\-]\d{1,4}){0,5}[a-z]?)(\s*[).:\]–]\s*|\s+-\s+|\s+)(\S.*)$/i;
const BULLET = /^\s*(?:[-•*·▪]\s+)+/;
const HEADER = /^(?:ref(?:erence)?|id|n\.?|no\.?|#|requirement|requirements|requisito|requisiti|description|descrizione|text|testo|mandatory|obbligatorio|points|punti|weight|peso)$/i;

function pointsIn(text) {
  for (const re of POINTS) {
    const m = re.exec(text);
    if (m) {
      const v = Number(m[1].replace(",", "."));
      if (Number.isFinite(v) && v > 0 && v <= POINTS_MAX) return v;
    }
  }
  return null;
}

/** Mandatory unless the wording says it is scored or optional: better to treat a requirement too strictly than miss it. */
function mustOf(text, points) {
  if (MUST.test(text)) return true;
  if (SHOULD.test(text) || points != null) return false;
  return true;
}

function refOf(line) {
  const m = REF.exec(line);
  if (!m) return null;
  const [, ref, sep, rest] = m;
  // "3 nodes at least" is a sentence, not requirement 3: a bare number counts only before punctuation or a capital
  const bare = /^\d+$/.test(ref);
  if (bare && !/[).:\]–-]/.test(sep) && !/^[\p{Lu}"“(]/u.test(rest)) return null;
  return { ref: ref.replace(/\s+/g, " ").trim(), text: rest };
}

function fromRow(cells) {
  const c = cells.map((x) => flat(x));
  if (c.every((x) => !x || HEADER.test(x))) return null;
  let ti = 0;
  c.forEach((x, i) => { if (x.length > c[ti].length) ti = i; });
  const text = c[ti];
  // the reference is the first cell when it is short and has digits; otherwise a short cell mixing letters and digits
  const ref = ti !== 0 && c[0] && c[0].length <= REF_MAX && /\d/.test(c[0]) ? c[0]
    : (c.find((x, i) => i !== ti && x && x.length <= REF_MAX && /\d/.test(x) && /[A-Za-z]/.test(x)) || "");
  const numeric = c.filter((x, i) => i !== ti && x !== ref && /^\d{1,4}(?:[.,]\d{1,2})?$/.test(x)).map((x) => Number(x.replace(",", ".")));
  let must = null;
  for (const [i, x] of c.entries()) {
    if (i === ti || x === ref) continue;
    if (/^(yes|y|m|must|mandatory|required|si|sì|s|obbligatorio|x)$/i.test(x)) must = true;
    else if (/^(no|n|optional|scored|should|facoltativo|migliorativo|desirable)$/i.test(x)) must = false;
  }
  const pts = numeric.find((v) => v > 0 && v <= POINTS_MAX) ?? pointsIn(text);
  return { ref, text, must: must ?? mustOf(text, pts ?? null), points: pts ?? null };
}

/**
 * The requirements in what was pasted: numbered lines (continuation lines joined to the one before when most lines
 * are numbered), bullets, or rows copied from a spreadsheet (tab-separated: the longest cell is the requirement, a
 * short cell with digits its reference, a number its points, a yes/no cell whether it is mandatory).
 */
export function parseRequirements(pasted) {
  const raw = String(pasted == null ? "" : pasted).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(BULLET, "")).filter((l) => l.trim());
  if (!raw.length) return [];
  if (raw.filter((l) => l.includes("\t")).length >= Math.ceil(raw.length / 2)) {
    return raw.map((l) => fromRow(l.split("\t"))).filter((r) => r && r.text.length >= 8).map((r) => ({ ...r, ref: r.ref.slice(0, REF_MAX), text: r.text.slice(0, TEXT_MAX) }));
  }
  const numbered = raw.map(refOf);
  const mostly = numbered.filter(Boolean).length >= Math.ceil(raw.length / 2);
  const out = [];
  raw.forEach((l, i) => {
    const r = numbered[i];
    if (r) out.push({ ref: r.ref, text: flat(r.text) });
    else if (mostly && out.length) out[out.length - 1].text = `${out[out.length - 1].text} ${flat(l)}`;
    else out.push({ ref: "", text: flat(l) });
  });
  return out.filter((r) => r.text.length >= 8).map((r) => {
    const text = r.text.slice(0, TEXT_MAX);
    const points = pointsIn(text);
    return { ref: r.ref.slice(0, REF_MAX), text, must: mustOf(text, points), points };
  });
}

// ------------------------------------------------------------------ which line a requirement asks about

/**
 * Words that point at each product line, in English and in the wording common in Italian tenders. A requirement goes
 * to the line with the most of them; the platform line counts half, since nearly everything touches it.
 */
export const KEYWORDS = {
  "dr-backup": ["backup", "disaster recovery", "dr", "rpo", "rto", "replica", "replication", "failover", "immutable", "immutabil", "ransomware", "retention", "ripristino", "restore", "recovery plan", "piano di ripristino", "continuità operativa", "business continuity"],
  "object-storage": ["object storage", "s3", "bucket", "object lock", "worm", "archiviazione a oggetti", "storage a oggetti"],
  "file-storage": ["file server", "nas", "smb", "cifs", "nfs", "file share", "condivisioni", "cartelle condivise", "home director"],
  "dbaas": ["database", "dbaas", "point-in-time", "basi di dati", "banche dati"],
  "kubernetes-platform": ["kubernetes", "k8s", "container", "microservic", "microserviz"],
  "private-ai": ["gpu", "llm", "artificial intelligence", "intelligenza artificiale", "inference", "inferenza", "machine learning", "generative", "generativa", "rag"],
  "euc": ["vdi", "virtual desktop", "desktop virtual", "published app", "end user computing", "postazioni di lavoro"],
  "microsegmentation": ["microsegment", "east-west", "est-ovest", "segmentation", "segmentazione", "zero trust", "firewall distribuito", "distributed firewall"],
  "hybrid-cloud": ["public cloud", "cloud pubblico", "hybrid", "ibrid", "sovereign", "sovran", "cloud bursting"],
  "platform-migration": ["migration", "migrazione", "migrate", "migrare", "v2v", "p2v", "cutover", "rollback", "test wave", "waves", "ondate"],
  "cloud-operations": ["self-service", "self service", "catalog", "catalogo", "chargeback", "showback", "capacity planning", "pianificazione della capacità", "automation", "automazione", "runbook", "orchestrat", "monitoring", "monitoraggio"],
  "edge-sites": ["branch", "filial", "remote office", "remote site", "sedi periferiche", "sede remota", "sedi remote", "edge", "robo", "punti vendita", "stabiliment"],
  "service-provider-cloud": ["multi-tenant", "multitenant", "tenant", "service provider", "metering", "billing", "fatturazione"],
  "hci": ["hyperconverged", "iperconvergen", "hypervisor", "virtualization", "virtualizzazione", "cluster", "nodes", "nodi", "snapshot", "storage", "virtual machine", "macchine virtuali", "vm", "high availability", "alta affidabilità", "upgrade", "aggiornament"],
};
const LOW = new Set(["hci"]);
const kwRe = new Map();
const reFor = (kw) => {
  if (!kwRe.has(kw)) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // short words whole; longer ones as a word start, so stems match their endings
    kwRe.set(kw, new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}${kw.length <= 4 ? "(?![\\p{L}\\p{N}])" : ""}`, "iu"));
  }
  return kwRe.get(kw);
};

/** The line a requirement most likely asks about, among `lines` (in order of preference), or "" when none fits. */
export function suggestLine(text, lines) {
  let best = "", top = 0;
  for (const p of lines) {
    const words = KEYWORDS[p];
    if (!words) continue;
    let score = 0;
    for (const kw of words) if (reFor(kw).test(text)) score += kw.includes(" ") ? 2 : 1;
    if (LOW.has(p)) score /= 2;
    if (score > top) { top = score; best = p; }
  }
  return best;
}

/** Lines to match against: those in scope first, then the rest of the catalogue that has keywords. */
export function lineOrder(catalog, scope) {
  const all = Object.keys((catalog && catalog.lines) || {}).filter((p) => KEYWORDS[p]);
  return [...scope.filter((p) => all.includes(p)), ...all.filter((p) => !scope.includes(p))];
}

// ------------------------------------------------------------------ what is kept

export function validRequirement(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  if (!Object.keys(r).every((k) => ["id", "ref", "text", "must", "points", "line", "a", "note", "who"].includes(k))) return false;
  if (typeof r.id !== "string" || !/^r\d{1,4}$/.test(r.id)) return false;
  if (typeof r.ref !== "string" || r.ref.length > REF_MAX || CONTROL.test(r.ref)) return false;
  if (typeof r.text !== "string" || r.text.length < 1 || r.text.length > TEXT_MAX || CONTROL.test(r.text)) return false;
  if (typeof r.must !== "boolean") return false;
  if (!(r.points === null || (typeof r.points === "number" && Number.isFinite(r.points) && r.points > 0 && r.points <= POINTS_MAX))) return false;
  if (typeof r.line !== "string" || (r.line && !PROFILE.test(r.line))) return false;
  if (typeof r.a !== "string" || (r.a && !Object.hasOwn(ANSWERS, r.a))) return false;
  if (typeof r.note !== "string" || r.note.length > NOTE_MAX || CONTROL.test(r.note)) return false;
  if (typeof r.who !== "string" || (r.who && !Object.hasOwn(WHO, r.who))) return false;
  return true;
}

/** Stored with a workshop: the tender's name and dates, and its requirements, each checked. */
export function validRfp(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) return false;
  if (!Object.keys(t).every((k) => ["title", "due", "questions_due", "reqs"].includes(k))) return false;
  if (typeof t.title !== "string" || t.title.length > TITLE_MAX || CONTROL.test(t.title)) return false;
  for (const k of ["due", "questions_due"]) if (!(t[k] === "" || isDate(t[k]))) return false;
  if (t.due && t.questions_due && t.questions_due > t.due) return false;
  if (!Array.isArray(t.reqs) || t.reqs.length > MAX_REQS || !t.reqs.every(validRequirement)) return false;
  return new Set(t.reqs.map((r) => r.id)).size === t.reqs.length;
}

export const emptyRfp = () => ({ title: "", due: "", questions_due: "", reqs: [] });

/** The requirements read from a paste, added after those already there, each matched to a line. */
export function withRequirements(rfp, parsed, lines) {
  const t = rfp ? { ...rfp, reqs: [...rfp.reqs] } : emptyRfp();
  let n = t.reqs.reduce((m, r) => Math.max(m, Number(r.id.slice(1))), 0);
  const room = MAX_REQS - t.reqs.length;
  if (parsed.length > room) throw new Error(`A tender holds at most ${MAX_REQS} requirements: ${room} more fit.`);
  for (const p of parsed) {
    t.reqs.push({ id: `r${++n}`, ref: flat(p.ref).slice(0, REF_MAX), text: flat(p.text).slice(0, TEXT_MAX), must: !!p.must, points: p.points ?? null,
      line: suggestLine(p.text, lines), a: "", note: "", who: "" });
  }
  return t;
}

/** One requirement changed: its answer, how it is met, who answers, its line, whether it is mandatory, its points. */
export function withRequirement(rfp, id, patch) {
  const i = rfp.reqs.findIndex((r) => r.id === id);
  if (i < 0) throw new Error("That requirement is no longer in the list.");
  const r = { ...rfp.reqs[i] };
  if ("a" in patch) r.a = patch.a || "";
  if ("note" in patch) r.note = flat(patch.note).slice(0, NOTE_MAX);
  if ("who" in patch) r.who = patch.who || "";
  if ("line" in patch) r.line = patch.line || "";
  if ("must" in patch) r.must = !!patch.must;
  if ("points" in patch) { const v = Number(patch.points); r.points = patch.points === "" || patch.points == null || !Number.isFinite(v) || v <= 0 ? null : Math.min(POINTS_MAX, v); }
  if ("ref" in patch) r.ref = flat(patch.ref).slice(0, REF_MAX);
  if ("text" in patch) { const t = flat(patch.text).slice(0, TEXT_MAX); if (!t) throw new Error("A requirement needs its text."); r.text = t; }
  if (!validRequirement(r)) throw new Error("That change is not valid for a requirement.");
  return { ...rfp, reqs: rfp.reqs.map((x, j) => (j === i ? r : x)) };
}

// ------------------------------------------------------------------ what the answers say

const label = (catalog, p) => (catalog && catalog.lines && catalog.lines[p] ? catalog.lines[p].label : p || "No line");

/** Where the bid stands: counts, what fails, what to clarify, the points likely won, coverage by line, the deadlines. */
export function rfpState(catalog, w, today) {
  const t = w.rfp || emptyRfp();
  const reqs = t.reqs;
  const count = (list, a) => list.filter((r) => r.a === a).length;
  const must = reqs.filter((r) => r.must);
  const mustNo = must.filter((r) => r.a === "no");
  const clarify = must.filter((r) => r.a === "partly" || r.a === "check");
  const openMust = must.filter((r) => !r.a);
  const scored = reqs.filter((r) => r.points != null);
  const sum = (list) => list.reduce((s, r) => s + r.points, 0);
  const points = scored.length ? {
    total: sum(scored), sure: sum(scored.filter((r) => r.a === "yes")),
    likely: sum(scored.filter((r) => r.a === "yes")) + sum(scored.filter((r) => r.a === "partly")) / 2,
    best: sum(scored.filter((r) => r.a !== "no")),
  } : null;
  const byLine = new Map();
  for (const r of reqs) {
    const k = r.line || "";
    const x = byLine.get(k) || { profile: k, label: label(catalog, k), in_scope: !k || w.scope.includes(k), count: 0, must: 0, yes: 0, partly: 0, no: 0, check: 0, open: 0 };
    x.count++; if (r.must) x.must++;
    if (r.a) x[r.a]++; else x.open++;
    byLine.set(k, x);
  }
  const lines = [...byLine.values()].sort((a, b) => (a.profile === "") - (b.profile === "") || b.count - a.count || (a.label < b.label ? -1 : 1));
  const until = (d) => (d && isDate(today) ? days(today, d) : null);
  const deadlines = { due: t.due, due_in: until(t.due), questions_due: t.questions_due, questions_in: until(t.questions_due) };
  let verdict;
  if (!reqs.length) verdict = { level: "empty", text: "Paste the requirements of the tender to see whether to bid, what to ask and the points likely won." };
  else if (mustNo.length) verdict = { level: "risk", text: `${plural(mustNo.length, "mandatory requirement")} not met: ask whether an equivalent is accepted${t.questions_due ? ` before ${t.questions_due}` : ""}, or decide not to bid.` };
  else if (clarify.length || openMust.length) verdict = { level: "clarify", text: `No mandatory requirement fails so far: ${plural(clarify.length, "to clarify", "to clarify")}${openMust.length ? `, ${openMust.length} still to answer` : ""}.` };
  else verdict = { level: "go", text: "Every mandatory requirement is met: the bid rests on the scored ones." };
  // who still owes an answer: the requirements not answered or to check, by who was asked
  const owed = Object.entries(WHO).map(([k, v]) => ({ who: k, label: v, count: reqs.filter((r) => r.who === k && (!r.a || r.a === "check")).length })).filter((x) => x.count);
  const unassigned = reqs.filter((r) => !r.who && (!r.a || r.a === "check")).length;
  return {
    owed, unassigned,
    title: t.title, total: reqs.length, must: must.length, scored: scored.length,
    yes: count(reqs, "yes"), partly: count(reqs, "partly"), no: count(reqs, "no"), check: count(reqs, "check"), open: reqs.filter((r) => !r.a).length,
    must_no: mustNo, clarify, open_must: openMust, points, lines, outside: lines.filter((l) => l.profile && !l.in_scope), deadlines, verdict,
  };
}

/**
 * The questions for the contracting authority: whether an equivalent is accepted where a mandatory requirement is
 * not met or only partly, and what is expected where its meaning is unclear. Drafts, to put in the tender's language.
 */
export function clarificationQuestions(w) {
  const reqs = ((w.rfp && w.rfp.reqs) || []).filter((r) => r.must && (r.a === "no" || r.a === "partly" || r.a === "check"));
  return reqs.map((r) => {
    const where = `${r.ref ? `Requirement ${r.ref}` : "The requirement"} ("${short(r.text, 140)}")`;
    if (r.a === "check") return { id: r.id, ref: r.ref, text: `${where}: could you clarify what is expected, and how compliance will be verified?` };
    return { id: r.id, ref: r.ref, text: `${where}: is an equivalent solution that meets the purpose of the requirement accepted${r.note ? `, for example: ${short(r.note, 160)}` : ""}?` };
  });
}

/** The compliance matrix for the bid. Cells a spreadsheet would run as formulas are defused. */
export function rfpCsv(catalog, w) {
  const head = ["ref", "requirement", "mandatory", "points", "product_line", "answer", "how_it_is_met", "who_answers"];
  const rows = ((w.rfp && w.rfp.reqs) || []).map((r) => [r.ref, r.text, r.must ? "yes" : "no", r.points ?? "", r.line ? label(catalog, r.line) : "", r.a ? ANSWERS[r.a] : "", r.note, r.who ? WHO[r.who] : ""]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const n1 = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The bid summary, for the seller and the bid team: whether to bid, the deadlines, what fails, what to ask, coverage. */
export function rfpMarkdown(catalog, w, today) {
  const st = rfpState(catalog, w, today);
  const out = [`# Bid summary: ${flat(st.title) || w.customer}`, "", `**${st.verdict.text}**`, ""];
  if (!st.total) return out.join("\n");
  const dl = st.deadlines;
  if (dl.questions_due || dl.due) out.push(...[dl.questions_due ? `- Questions to the contracting authority by ${dl.questions_due}${dl.questions_in != null ? ` (${dl.questions_in < 0 ? `${-dl.questions_in} days ago` : `in ${dl.questions_in} days`})` : ""}.` : null,
    dl.due ? `- Bid due ${dl.due}${dl.due_in != null ? ` (${dl.due_in < 0 ? `${-dl.due_in} days ago` : `in ${dl.due_in} days`})` : ""}.` : null].filter(Boolean), "");
  out.push(`${plural(st.total, "requirement")}, ${st.must} mandatory: ${st.yes} met, ${st.partly} partly, ${st.no} not met, ${st.check} to check, ${st.open} not answered yet.`, "");
  if (st.points) out.push(`Points: about ${n1(st.points.likely)} of ${n1(st.points.total)} likely (${n1(st.points.sure)} sure, at best ${n1(st.points.best)}).`, "");
  if (st.must_no.length) out.push("## Mandatory requirements not met", "", ...st.must_no.map((r) => `- ${r.ref ? `${r.ref}: ` : ""}${r.text}${r.note ? ` (${r.note})` : ""}`), "");
  const qs = clarificationQuestions(w);
  if (qs.length) out.push("## Questions for the contracting authority", "", ...qs.map((q, i) => `${i + 1}. ${q.text}`), "");
  out.push("## Coverage by product line", "", "| Line | Requirements | Mandatory | Met | Partly | Not met | To check | Open |", "|---|---|---|---|---|---|---|---|",
    ...st.lines.map((l) => `| ${l.label.replace(/\|/g, "/")}${l.in_scope ? "" : " (not in scope)"} | ${l.count} | ${l.must} | ${l.yes} | ${l.partly} | ${l.no} | ${l.check} | ${l.open} |`), "");
  if (st.outside.length) out.push(`The tender also asks about ${st.outside.map((l) => `${l.label.toLowerCase()} (${plural(l.count, "requirement")})`).join(", ")}: lines not in this conversation yet.`, "");
  if (st.owed.length || st.unassigned) out.push("## Still to answer, by who", "", ...st.owed.map((x) => `- ${x.label}: ${x.count}`), ...(st.unassigned ? [`- Nobody asked yet: ${st.unassigned}`] : []), "");
  out.push("_Prepared with Beyond 90. The requirements stay in the browser they were pasted into._", "");
  return out.join("\n");
}

/** For the handover: what the bid committed to, so delivery keeps it. Mandatory requirements met or partly, with how. */
export function bidCommitments(w) {
  return ((w.rfp && w.rfp.reqs) || []).filter((r) => r.must && (r.a === "yes" || r.a === "partly")).map((r) => ({ ref: r.ref, text: r.text, how: r.note, partly: r.a === "partly" }));
}

/** An invented tender, to try the reading and the matching in one click. */
export const EXAMPLE_TENDER = [
  "1.1 The solution must provide a hyperconverged platform of at least 3 nodes per site, with no single point of failure.",
  "1.2 The hypervisor must be included, with live migration of virtual machines between nodes without downtime.",
  "1.3 Upgrades of the whole stack (firmware, hypervisor, storage software) shall be performed without stopping the virtual machines.",
  "1.4 The platform should support adding nodes of a different generation in the same cluster. (5 points)",
  "2.1 Backup and disaster recovery must protect 400 virtual machines with an RPO of 15 minutes for tier-1 applications.",
  "2.2 At least one copy of the backups must be immutable for 30 days, administrators included.",
  "2.3 A test failover must be possible on an isolated network without affecting production.",
  "2.4 Recovery plans with power-on order and network mapping are desirable. (8 points)",
  "3.1 The offer must include S3-compatible object storage with object lock, for at least 200 TiB usable.",
  "3.2 File shares over SMB and NFS must be provided for the departments, with snapshots users can restore themselves.",
  "4.1 The migration of the existing virtual machines must be included, with a test wave and a rollback plan.",
  "4.2 A self-service catalog with approvals and quotas for the development teams is preferred. (10 points)",
  "4.3 Cost per department shown monthly (showback) is desirable. (6 points)",
  "5.1 Twelve remote sites must run local services on 1 or 2 nodes, managed centrally, with upgrades without a visit.",
  "5.2 Virtual desktops for 300 users at peak are optional and will be evaluated. (12 points)",
  "6.1 All management and monitoring data must remain within the European Union.",
].join("\n");
