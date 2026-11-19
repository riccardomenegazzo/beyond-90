/**
 * A tender or a request for proposal, requirement by requirement. The requirements are pasted from the document
 * (numbered lines, or rows copied from a spreadsheet); each is read as mandatory or scored, with its points when the
 * text gives them, and matched to the product line it asks about. Each is then answered: met, partly, not met or to
 * check, with how it is met and who answers it. From the answers come whether to bid, the questions to send the
 * contracting authority before their deadline, the points likely won, the coverage by line, and the compliance matrix
 * for the bid. Plain functions, no DOM, so Node can test them; nothing here names a product.
 */
import { csvCell } from "./ui.js";
import { parseCsv } from "./inventory.js";

export const ANSWERS = { yes: "Met", partly: "Partly", no: "Not met", check: "To check" };
/** Who issued it: a public body takes questions only through the formal channel; a company can be asked in a meeting. */
export const ISSUERS = { public: "A public body", company: "A company" };
export const WHO = { presales: "Presales", specialist: "A specialist", partner: "The partner", product: "The product team", commercial: "Commercial or legal" };
export const MAX_REQS = 400;
export const TEXT_MAX = 500;
export const REF_MAX = 24;
export const NOTE_MAX = 300;
export const TITLE_MAX = 120;
export const POINTS_MAX = 1000;
export const MAX_PAGES = 500;
export const SECTION_MAX = 80;
const SECTION_KEY = /^[A-Za-z0-9]{1,12}$/;
const validSections = (o) => !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length <= 60 &&
  Object.entries(o).every(([k, v]) => SECTION_KEY.test(k) && typeof v === "string" && v.length >= 1 && v.length <= SECTION_MAX && !/[\u0000-\u001f\u007f]/.test(v));

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
// a header row: short cells, no digits, and at least one column title (a tender's sheet often repeats it by section)
const TITLE = /^(?:n\.?|no\.?|nr\.?|id|#|ref\p{L}*|req\p{L}*|descr\p{L}*|testo|text|tipolog\p{L}*|type|categor\p{L}*|punt\p{L}*|point\p{L}*|score|peso|weight|mandatory|obbligator\p{L}*|migliorativ\p{L}*|note|answer|risposta|compliance|conformit\p{L}*|section|sezione|lotto|lot)\b/iu;
const isHeader = (c) => c.some((x) => TITLE.test(x)) && c.every((x) => x.length <= 60 && !/\d/.test(x));
const MUST_CELL = /^(yes|y|must|mandatory|required|minimum|si|sì|s|obbligatori[oa]|requisito minimo|minimo|x)$/i;
const SHOULD_CELL = /^(no|n|optional|scored|should|desirable|facoltativ[oa]|migliorativ[oa]|premiante|preferenziale|valutabile|opzionale)$/i;

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
  if (c.every((x) => !x || HEADER.test(x)) || isHeader(c.filter(Boolean))) return null;
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
    if (MUST_CELL.test(x)) must = true;
    else if (SHOULD_CELL.test(x)) must = false;
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

/**
 * A workbook's sheets as text to read: the sheet that holds the requirements is the one with the most rows carrying a
 * long cell. Cells are joined with tabs, so the rows are read like rows copied from a spreadsheet.
 */
export function sheetsToText(sheets) {
  const score = (rows) => rows.filter((r) => r.some((c) => flat(c).length >= 30)).length;
  const best = [...(sheets || [])].sort((a, b) => score(b.rows) - score(a.rows))[0];
  if (!best || !score(best.rows)) return { text: "", sheet: "" };
  return { text: best.rows.map((r) => r.map((c) => flat(c).replace(/\t/g, " ")).join("\t")).join("\n"), sheet: best.name };
}

/** A CSV file as text to read: its rows joined with tabs, whatever its delimiter. */
export function csvToText(text) {
  return parseCsv(text).map((r) => r.map((c) => flat(c)).join("\t")).join("\n");
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

/** The words of a requirement that pointed it at a line: shown beside the line, so the match can be trusted or fixed. */
export function matchedWords(text, line) {
  return (KEYWORDS[line] || []).filter((kw) => reFor(kw).test(text));
}

// ------------------------------------------------------------------ which discovery question a requirement touches

// words that carry no meaning of their own in a requirement, in English and Italian
const STOP = new Set(("must shall should will would could which their there these those with without from into each every other also than then that this what when where while about after before under over more most least "
  + "solution system systems platform provide provided offer supplier vendor customer required requirement requirements including include included least minimum maximum "
  + "virtual virtuali machine machines macchine data dati "
  + "deve devono dovrà dovranno della delle degli dello nella nelle negli sono essere fornitore soluzione sistema requisito requisiti almeno ogni anche come dove quando").split(" "));
const stems = (t) => new Set((String(t).toLowerCase().match(/\p{L}{4,}/gu) || []).filter((x) => !STOP.has(x)).map((x) => x.slice(0, 6)));

/**
 * The discovery question of a requirement's line that it touches most, by the words they share (two at least), or
 * null. It says which question to bring the tender's demand to, and which answers the bid will rest on.
 */
const qStems = new WeakMap();
function lineStems(line) {
  if (!qStems.has(line)) {
    const each = line.questions.map((q) => stems(`${q.q} ${q.need || ""} ${q.how || ""}`));
    const df = new Map();
    for (const set of each) for (const x of set) df.set(x, (df.get(x) || 0) + 1);
    qStems.set(line, { each, df });
  }
  return qStems.get(line);
}

export function questionFor(catalog, r) {
  const line = r.line && catalog && catalog.lines ? catalog.lines[r.line] : null;
  if (!line || !line.questions.length) return null;
  const mine = stems(r.text);
  const { each, df } = lineStems(line);
  // a shared word counts more the fewer questions of the line use it: "immutable" says more than "machines"
  let best = null, top = 0;
  each.forEach((theirs, index) => {
    let score = 0, n = 0;
    for (const x of mine) if (theirs.has(x)) { score += 1 / df.get(x); n++; }
    if (n >= 2 && score >= 1 && score > top) { top = score; best = { profile: r.line, index, q: line.questions[index].q, shared: n }; }
  });
  return best;
}

/** For each discovery question, the tender's requirements that touch it: `profile#index` to the requirements. */
export function tenderAsks(catalog, w) {
  const out = new Map();
  for (const r of (w.rfp && w.rfp.reqs) || []) {
    const q = questionFor(catalog, r);
    if (!q) continue;
    const k = `${q.profile}#${q.index}`;
    out.set(k, [...(out.get(k) || []), r]);
  }
  return out;
}

// ------------------------------------------------------------------ the technical response, section by section

/** A requirement's section: the first part of its reference ("2" for 2.3.1, "RT" for RT-05), or "" when it has none. */
export function sectionOf(r) {
  const m = /^([A-Za-z]{1,6}|\d{1,4})/.exec(String(r.ref || "").trim());
  return m ? m[1].toUpperCase() : "";
}

/**
 * The tender's sections, in its order: the requirements of each, and its title. A title typed by the bid team wins;
 * otherwise it is named after the line most of its requirements ask about.
 */
export function sections(catalog, w) {
  const reqs = (w.rfp && w.rfp.reqs) || [];
  const typed = (w.rfp && w.rfp.sections) || {};
  const order = [];
  const by = new Map();
  for (const r of reqs) {
    const k = sectionOf(r);
    if (!by.has(k)) { by.set(k, []); order.push(k); }
    by.get(k).push(r);
  }
  return order.map((k) => {
    const rs = by.get(k);
    const lines = new Map();
    for (const r of rs) if (r.line) lines.set(r.line, (lines.get(r.line) || 0) + 1);
    const top = [...lines.entries()].sort((a, b) => b[1] - a[1])[0];
    const guess = top ? label(catalog, top[0]) : "General requirements";
    return { key: k, title: typed[k] || guess, typed: !!typed[k], guess, reqs: rs, points: rs.reduce((n, r) => n + (r.points || 0), 0) };
  });
}

/** Names of the customers of other tenders in this browser that an answer here still carries: a reused answer not rewritten. */
export function mentionsOfOthers(w, others) {
  const names = [...new Set((others || []).map((o) => String(o.customer || "").replace(/\s*\(mock\)\s*$/i, "").trim()).filter((n) => n.length >= 4 && n.toLowerCase() !== String(w.customer || "").replace(/\s*\(mock\)\s*$/i, "").trim().toLowerCase()))];
  const out = [];
  for (const r of (w.rfp && w.rfp.reqs) || []) {
    const note = r.note.toLowerCase();
    for (const n of names) if (note.includes(n.toLowerCase())) out.push({ id: r.id, ref: r.ref, name: n });
  }
  return out;
}

const WORDS_PER_PAGE = 450;
const words = (t) => (String(t || "").match(/\S+/g) || []).length;

/**
 * Whether the response is ready to leave: answers still to write, square brackets still to fill in, other customers
 * named, and the pages it would take against the tender's limit.
 */
export function responseChecks(catalog, w, others = []) {
  const reqs = (w.rfp && w.rfp.reqs) || [];
  const all = sections(catalog, w);
  const body = all.reduce((n, sec) => n + words(sec.title) + sec.reqs.reduce((m, r) => m + words(r.text) + words(r.note) + 12, 0), 0);
  const estimate = Math.max(1, Math.ceil(body / WORDS_PER_PAGE));
  const limit = (w.rfp && w.rfp.pages) || 0;
  return {
    unanswered: reqs.filter((r) => !r.a).map((r) => r.id),
    unexplained: reqs.filter((r) => keepReq(r, "nonote")).map((r) => r.id),
    blanks: reqs.filter((r) => keepReq(r, "fill")).map((r) => ({ id: r.id, ref: r.ref, blanks: blanks(r.note) })),
    named: mentionsOfOthers(w, others),
    pages: { estimate, limit, over: !!limit && estimate > limit },
    ready: !!reqs.length && reqs.every((r) => r.a) && !reqs.some((r) => keepReq(r, "nonote") || keepReq(r, "fill")) && !mentionsOfOthers(w, others).length && !(limit && estimate > limit),
  };
}

const RESP_WORDS = { yes: "Met", partly: "Partly met", no: "Not met", check: "To be confirmed", "": "Not answered yet" };

/** The technical response as Markdown: section by section, each requirement with the response and the evidence. */
export function responseMarkdown(catalog, w, today) {
  const t = w.rfp || emptyRfp();
  const out = [`# Technical response${t.title ? `: ${flat(t.title)}` : ""}`, "", `${flat(w.customer)}${today ? `, ${today}` : ""}.`, ""];
  const all = sections(catalog, w);
  // a section is numbered as the tender numbers it; one without a reference keeps its title alone
  const head = (sec) => (sec.key ? `${sec.key}. ${sec.title}` : sec.title);
  out.push("## Contents", "", ...all.map((sec) => `- ${head(sec)}`), "");
  all.forEach((sec) => {
    out.push(`## ${head(sec)}`, "");
    for (const r of sec.reqs) {
      const kit = r.a === "yes" || r.a === "partly" ? suggestAnswer(catalog, r) : null;
      out.push(`### ${r.ref ? `${r.ref} ` : ""}${r.must ? "(mandatory)" : r.points != null ? `(${r.points} points)` : "(optional)"}`, "",
        `> ${r.text}`, "", `**${RESP_WORDS[r.a]}.** ${r.note || (r.a ? "" : "_The response is still to be written._")}`.trim(), "");
      if (kit) out.push(`Attached: ${kit.evidence.join("; ")}.`, "");
    }
  });
  const ev = evidenceFor(catalog, w);
  if (ev.length) out.push("## Attachments", "", ...ev.map((e, i) => `${i + 1}. ${e.item} (for ${e.refs.join(", ")})`), "");
  return out.join("\n");
}

const escH = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The technical response as a page to print or save as PDF: a cover, the contents, the sections, the attachments.
 * Every piece of text is escaped; the page has no scripts, loads nothing, and says so in its own security policy.
 * What is still in square brackets is highlighted, so nothing unfinished leaves unseen.
 */
export function responseHtml(catalog, w, today) {
  const t = w.rfp || emptyRfp();
  const all = sections(catalog, w);
  const mark = (s) => escH(s).replace(/\[[^\]\n]{1,120}\]/g, (m) => `<mark>${m}</mark>`);
  const css = `@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;font:14px/1.55 Georgia,"Times New Roman",serif;color:#1b2329}
main{max-width:780px;margin:0 auto;padding:36px 28px}.cover{min-height:60vh;display:flex;flex-direction:column;justify-content:center;border-bottom:2px solid #1b2329;margin-bottom:28px;break-after:page}
.cover p{margin:4px 0;font:15px/1.4 system-ui,sans-serif;color:#45525b}.cover h1{font-size:34px;line-height:1.15;margin:8px 0 14px}
h2{font-size:21px;margin:30px 0 10px;break-after:avoid}h3{font:600 13px/1.4 system-ui,sans-serif;margin:18px 0 4px;color:#45525b;text-transform:none}
blockquote{margin:0 0 8px;padding:8px 12px;border-left:3px solid #9aa5ad;background:#f4f6f7;font-style:italic}
.req{break-inside:avoid;margin-bottom:12px}.status{font:700 12px/1 system-ui,sans-serif;padding:3px 8px;border-radius:9px;margin-right:6px;display:inline-block}
.s-yes{background:#d8efe2;color:#0d5a33}.s-partly{background:#f7e8cc;color:#6b4705}.s-no{background:#f8d9d7;color:#7d1c15}.s-check{background:#e3e6e8;color:#2c363d}.s-{background:#fff;border:1px solid #9aa5ad;color:#45525b}
.att{font:12.5px/1.4 system-ui,sans-serif;color:#45525b}mark{background:#ffe58a;padding:0 2px}ul.toc{padding-left:20px}`;
  const out = [`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    `<title>${escH(t.title || w.customer)}: technical response</title><style>${css}</style></head><body><main>`,
    `<section class="cover"><p>Technical response</p><h1>${escH(t.title || "Technical response")}</h1><p>${escH(w.customer)}</p>${today ? `<p>${escH(today)}</p>` : ""}</section>`,
    `<h2>Contents</h2><ul class="toc">${all.map((sec) => `<li>${sec.key ? `${escH(sec.key)}. ` : ""}${escH(sec.title)}</li>`).join("")}</ul>`];
  all.forEach((sec) => {
    out.push(`<h2>${sec.key ? `${escH(sec.key)}. ` : ""}${escH(sec.title)}</h2>`);
    for (const r of sec.reqs) {
      const kit = r.a === "yes" || r.a === "partly" ? suggestAnswer(catalog, r) : null;
      out.push(`<div class="req"><h3>${escH(r.ref)} ${r.must ? "Mandatory" : r.points != null ? `${escH(r.points)} points` : "Optional"}</h3><blockquote>${escH(r.text)}</blockquote>`,
        `<p><span class="status s-${escH(r.a)}">${escH(RESP_WORDS[r.a])}</span>${r.note ? mark(r.note) : r.a ? "" : "<mark>The response is still to be written.</mark>"}</p>`,
        kit ? `<p class="att">Attached: ${escH(kit.evidence.join("; "))}.</p>` : "", `</div>`);
    }
  });
  const ev = evidenceFor(catalog, w);
  if (ev.length) out.push(`<h2>Attachments</h2><ol>${ev.map((e) => `<li>${escH(e.item)} <span class="att">(for ${escH(e.refs.join(", "))})</span></li>`).join("")}</ol>`);
  out.push("</main></body></html>");
  return out.join("\n");
}

// ------------------------------------------------------------------ across tenders, and the people who answer

/**
 * Every tender in this browser, the nearest deadline first: where each bid stands, how far it is answered, what is
 * due next. For the presales desk, where several tenders run at once.
 */
export function tendersOverview(workshops, catalog, today) {
  const out = [];
  for (const w of workshops || []) {
    if (!w.rfp || !w.rfp.reqs.length) continue;
    const st = rfpState(catalog, w, today);
    const dl = st.deadlines;
    // the next date that matters: the questions while they can still be sent, then the bid
    const next = dl.questions_in != null && dl.questions_in >= 0 ? { what: "Questions due", on: dl.questions_due, in: dl.questions_in }
      : dl.due_in != null ? { what: dl.due_in < 0 ? "Bid was due" : "Bid due", on: dl.due, in: dl.due_in } : null;
    out.push({ workshop: w.id, customer: w.customer, title: st.title, issuer: (w.rfp.issuer && ISSUERS[w.rfp.issuer]) || "", total: st.total, answered: st.total - st.open,
      must: st.must, must_no: st.must_no.length, yes: st.yes, partly: st.partly, no: st.no, check: st.check, verdict: st.verdict, next, ready: responseChecks(catalog, w).ready });
  }
  const key = (t) => (t.next ? (t.next.in < 0 ? 100000 + t.next.in : t.next.in) : 1e9);
  return out.sort((a, b) => key(a) - key(b) || a.customer.localeCompare(b.customer));
}

/**
 * A message for whoever answers part of a tender (a specialist, the partner, legal): their requirements, what we have
 * so far for each, and the date we need the answers by, a few days before the questions or the bid are due.
 */
export function ownerBrief(catalog, w, who, today) {
  const t = w.rfp || emptyRfp();
  const mine = t.reqs.filter((r) => r.who === who && (!r.a || r.a === "check"));
  if (!mine.length || !Object.hasOwn(WHO, who)) return "";
  const deadline = [t.questions_due, t.due].filter(Boolean).find((d) => !today || d >= today);
  const by = deadline ? new Date(Date.parse(deadline + "T00:00:00Z") - 3 * 86400000).toISOString().slice(0, 10) : "";
  const back = by && today && by < today ? today : by;
  return [`For ${WHO[who].toLowerCase()}: ${plural(mine.length, "requirement")} of ${t.title ? `"${flat(t.title)}"` : "the tender"} for ${flat(w.customer)} to answer${back ? ` by ${back}` : ""}.`,
    "For each: met, partly, not met or to check, how it is met, and what we can attach as evidence.", "",
    ...mine.map((r, i) => `${i + 1}. ${r.ref ? `${r.ref} ` : ""}(${r.must ? "mandatory" : r.points != null ? `${r.points} points` : "optional"}): ${r.text}${r.note ? `\n   So far: ${r.note}` : ""}`), ""].join("\n");
}

// ------------------------------------------------------------------ the answer kit, and answers given before

/**
 * The kit's answer for a requirement: among its line's answers and those for any line, the one whose words it uses
 * most. A neutral text to adapt (square brackets mark what to fill in), the evidence to attach, what to check first.
 */
export function suggestAnswer(catalog, r) {
  const kit = (catalog && catalog.answers) || {};
  const pool = [...(r.line ? (kit[r.line] || []).map((a) => ({ ...a, key: r.line })) : []), ...(kit.any || []).map((a) => ({ ...a, key: "any" }))];
  let best = null, top = 0;
  for (const a of pool) {
    let score = 0;
    for (const kw of a.match) if (reFor(kw).test(r.text)) score += kw.includes(" ") ? 2 : 1;
    if (a.key !== "any") score += score ? 0.5 : 0;                // the line's own answer wins a tie with a generic one
    if (score > top) { top = score; best = a; }
  }
  return best;
}

/**
 * The note written for the most similar requirement in another tender in this browser: what was answered before, so
 * nobody starts from zero. Similar means sharing most of their meaningful words (three at least).
 */
export function pastAnswer(others, r) {
  const mine = stems(r.text);
  if (mine.size < 3) return null;
  let best = null, top = 0;
  for (const o of others || []) {
    for (const x of (o.rfp && o.rfp.reqs) || []) {
      if (!x.note || (x.a !== "yes" && x.a !== "partly")) continue;
      const theirs = stems(x.text);
      let n = 0;
      for (const t of mine) if (theirs.has(t)) n++;
      const share = n / Math.min(mine.size, theirs.size);
      if (n >= 3 && share >= 0.5 && share > top) { top = share; best = { customer: o.customer, on: o.updated_on || "", text: x.text, note: x.note, ref: x.ref }; }
    }
  }
  return best;
}

/** The evidence to gather for the bid: from the kit, for the requirements answered met or partly, each with the requirements it backs. */
export function evidenceFor(catalog, w) {
  const out = new Map();
  for (const r of (w.rfp && w.rfp.reqs) || []) {
    if (r.a !== "yes" && r.a !== "partly") continue;
    const a = suggestAnswer(catalog, r);
    if (!a) continue;
    for (const e of a.evidence) out.set(e, [...(out.get(e) || []), r.ref || r.id]);
  }
  return [...out.entries()].map(([item, refs]) => ({ item, refs }));
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
  if (!Object.keys(t).every((k) => ["title", "due", "questions_due", "reqs", "issuer", "sections", "pages"].includes(k))) return false;
  if (t.pages !== undefined && !(Number.isInteger(t.pages) && t.pages >= 1 && t.pages <= MAX_PAGES)) return false;
  if (t.sections !== undefined && !validSections(t.sections)) return false;
  if (t.issuer !== undefined && !Object.hasOwn(ISSUERS, t.issuer)) return false;
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

// ------------------------------------------------------------------ finding your way through the list

/** The ways to narrow the list, each a question the bid team asks of it. */
export const FILTERS = { all: "All", must: "Mandatory", open: "Not answered", no: "Not met", clarify: "To clarify", nonote: "Not explained", fill: "To fill in" };

/** What is still in square brackets in a note: what the kit left for the bid team to fill in. */
export const blanks = (note) => String(note || "").match(/\[[^\]\n]{1,120}\]/g) || [];

/** Whether a requirement belongs to a narrowed list. "Not explained": answered met or partly, without saying how. */
export function keepReq(r, only) {
  switch (only) {
    case "must": return r.must;
    case "open": return !r.a;
    case "no": return r.a === "no";
    case "clarify": return r.must && (r.a === "partly" || r.a === "check" || r.a === "no");
    case "nonote": return (r.a === "yes" || r.a === "partly") && !r.note;
    case "fill": return blanks(r.note).length > 0;
    default: return true;
  }
}

/** How many requirements each narrowed list holds, for the counts on its chip. */
export function filterCounts(w) {
  const reqs = (w.rfp && w.rfp.reqs) || [];
  return Object.fromEntries(Object.keys(FILTERS).map((k) => [k, reqs.filter((r) => keepReq(r, k)).length]));
}

/** A search: every word typed is found in the reference, the text or the note. */
export function matchesSearch(r, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${r.ref} ${r.text} ${r.note}`.toLowerCase();
  return words.every((x) => hay.includes(x));
}

/**
 * What to do next, at most three things, most urgent first: what could exclude the bid, questions due soon, mandatory
 * requirements still open, answers that do not say how. Each names the action that does it.
 */
export function nextSteps(catalog, w, today, others = []) {
  const st = rfpState(catalog, w, today);
  if (!st.total) return [{ id: "load", text: "Load the tender's requirements: paste them, or read the tender's file.", act: "load", label: "Load them" }];
  const out = [];
  const dl = st.deadlines;
  if (st.must_no.length) out.push({ id: "no", text: `${plural(st.must_no.length, "mandatory requirement")} not met: ask whether an equivalent is accepted${dl.questions_due ? ` by ${dl.questions_due}` : ""}, or decide not to bid.`, act: "filter:no", label: "See them" });
  // an answer reused from another tender that still names that customer must never reach a bid
  const named = mentionsOfOthers(w, others);
  if (named.length) out.push({ id: "named", text: `${plural(named.length, "answer")} still name${named.length === 1 ? "s" : ""} another customer (${[...new Set(named.map((m) => m.name))].join(", ")}): rewrite before the bid leaves.`, act: `open:${named[0].id}`, label: "Open the first" });
  const qs = clarificationQuestions(w);
  if (qs.length && dl.questions_in != null && dl.questions_in >= 0 && dl.questions_in <= 7) {
    out.push({ id: "questions", text: `Questions to the contracting authority are due ${dl.questions_in === 0 ? "today" : `in ${plural(dl.questions_in, "day")}`}: ${plural(qs.length, "question")} drafted.`, act: "copy-questions", label: "Copy the questions" });
  }
  if (st.open_must.length) out.push({ id: "open", text: `${plural(st.open_must.length, "mandatory requirement")} still to answer.`, act: "next-open", label: "Answer them" });
  const unexplained = ((w.rfp && w.rfp.reqs) || []).filter((r) => keepReq(r, "nonote"));
  if (unexplained.length) {
    const kit = unexplained.filter((r) => suggestAnswer(catalog, r)).length;
    out.push({ id: "nonote", text: `${plural(unexplained.length, "requirement")} answered without saying how${kit ? `: the kit has an answer for ${kit === unexplained.length ? "each" : kit}` : ""}.`, act: "filter:nonote", label: "See them" });
  }
  const toFill = ((w.rfp && w.rfp.reqs) || []).filter((r) => keepReq(r, "fill"));
  if (toFill.length) out.push({ id: "fill", text: `${plural(toFill.length, "answer")} still ${toFill.length === 1 ? "has" : "have"} square brackets to fill in for this customer.`, act: "filter:fill", label: "See them" });
  if (!out.length) {
    out.push(st.open ? { id: "scored", text: `Every mandatory requirement is met and explained. ${plural(st.open, "scored requirement")} still open could add points.`, act: "filter:open", label: "See them" }
      : { id: "ready", text: "Every requirement is answered and explained: the compliance matrix is ready.", act: "export", label: "Download the matrix" });
  }
  return out.slice(0, 3);
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
  const head = ["ref", "requirement", "mandatory", "points", "product_line", "answer", "how_it_is_met", "who_answers", "evidence_to_attach"];
  const rows = ((w.rfp && w.rfp.reqs) || []).map((r) => {
    const kit = r.a === "yes" || r.a === "partly" ? suggestAnswer(catalog, r) : null;
    return [r.ref, r.text, r.must ? "yes" : "no", r.points ?? "", r.line ? label(catalog, r.line) : "", r.a ? ANSWERS[r.a] : "", r.note, r.who ? WHO[r.who] : "", kit ? kit.evidence.join("; ") : ""];
  });
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
  const ev = evidenceFor(catalog, w);
  if (ev.length) out.push("## Evidence to gather", "", ...ev.map((e) => `- ${e.item} (for ${e.refs.slice(0, 6).join(", ")}${e.refs.length > 6 ? `, and ${e.refs.length - 6} more` : ""})`), "");
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
