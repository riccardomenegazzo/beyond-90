// Heard something: what the customer said, written as it was said, matched to the question it answers.
//
// During a meeting nobody has time to find the right question in a list of eighty. The words are matched against
// every question in scope, its text counting twice and what to listen for, why it matters and the follow-up once each,
// with rare words weighing more than common ones and a few groups of words that mean the same thing in these
// conversations (a backup and a copy, a restore and a failover). The best few are offered; the person files it.
// No DOM, so Node can test it. Nothing leaves the browser.

export const NOTE_MAX = 300;      // as long as a note on an answer can be

const STOP = new Set(("a an the and or but nor of to in on at for with by from into onto about over under after before than then " +
  "is are was were be been being am do does did done has have had having it its it's this that these those there here " +
  "we our ours us they their them you your yours i my me he she his her who whom whose what which when where why how " +
  "can could would should will shall may might must just also very really quite so too if as all any some each every " +
  "more most less least only not no yes one two three new old other same such own still today now ever never always " +
  "get got make made say said tell told know think thing things way lot lots off out above below anything something everything").split(" "));

// a word without its common endings: copies and copy, tested and test, branches and branch
const bare = (word) => {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
};

// words that mean the same thing in these conversations: each folds into the first of its group
const SAME = [
  ["copy", "backup", "snapshot", "replica", "vault"],
  ["recover", "recovery", "restore", "failover", "failback"],
  ["admin", "administrator", "privileged", "superuser", "root"],
  ["delete", "wipe", "erase", "purge"],
  ["site", "datacentre", "datacenter", "dc"],
  ["latency", "millisecond", "ms", "roundtrip", "rtt"],
  ["cost", "money", "revenue", "euro", "dollar", "budget", "spend"],
  ["test", "drill", "exercise", "rehearsal"],
  ["branch", "office", "warehouse", "store", "shop", "depot", "plant"],
  ["network", "dns", "ip", "address", "firewall", "vlan", "subnet"],
  ["target", "rpo", "rto", "objective", "sla"],
  ["encrypt", "encryption", "encrypted"],
  ["upgrade", "patch", "update", "version"],
  ["ransomware", "attack", "attacker", "malware"],
  // the words of a deal: who signs, who else is in it, the date that forces a choice
  ["sign", "approve", "approval", "signoff", "authorise", "authorize"],
  ["decide", "decision", "decider", "choice", "choose", "cio", "cfo", "ceo", "cto", "coo"],
  ["supplier", "vendor", "competitor", "competition", "incumbent", "alternative"],
  ["champion", "advocate", "carry"],
  ["renewal", "renew", "expire", "expiry", "deadline"],
  ["procurement", "purchasing", "legal", "tender"],
];
const CANON = new Map(SAME.flatMap((group) => group.map((w) => [bare(w), bare(group[0])])));

/** A word as it is compared: lower case, without its common endings, folded into its group. */
export function stem(word) {
  const w = bare(word);
  return CANON.get(w) || w;
}

/** The words that carry meaning, compared as `stem` makes them. */
export function tokens(text) {
  const t = String(text == null ? "" : text).toLowerCase()
    .replace(/data\s+cent(re|er)s?/g, "datacentre")
    .replace(/round[\s-]+trips?/g, "roundtrip")
    .replace(/recovery[\s-]+points?(\s+objectives?)?/g, "rpo")
    .replace(/recovery[\s-]+times?(\s+objectives?)?/g, "rto")
    .replace(/(\d)\s*ms\b/g, "$1 ms");
  const out = [];
  for (const w of t.split(/[^a-z0-9]+/)) {
    if (!w || /^\d+$/.test(w) || (w.length < 3 && w !== "ms" && w !== "ip" && w !== "dc") || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

const weights = (q) => {
  const m = new Map();
  const add = (text, wt) => { for (const t of new Set(tokens(text))) m.set(t, (m.get(t) || 0) + wt); };
  add(q.listen, 1); add(q.why, 1); add(q.probe, 1); add(q.q, 2);
  return m;
};

/**
 * The questions these words most likely answer, best first: at most `n`, each with its score; none when no
 * question shares a word that carries meaning.
 * @param {{key:string, q:{q:string, listen?:string, why?:string, probe?:string}}[]} cards
 * @param {string} said
 */
export function match(cards, said, n = 3) {
  const heard = [...new Set(tokens(said))];
  if (!heard.length || !cards.length) return [];
  const each = cards.map((card) => ({ card, w: weights(card.q) }));
  const df = new Map();
  for (const { w } of each) for (const t of w.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + cards.length / (df.get(t) || 1));
  const scored = each.map(({ card, w }, i) => ({ card, i, score: heard.reduce((s, t) => s + (w.get(t) || 0) * idf(t), 0) }));
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, n).map(({ card, score }) => ({ card, score }));
}

/** A note with what was just heard added to it, kept within the length a note can have. */
export function joinNote(before, heard) {
  const add = String(heard || "").trim(), old = String(before || "").trim();
  if (!old) return add.slice(0, NOTE_MAX);
  if (!add || old.toLowerCase().includes(add.toLowerCase())) return old.slice(0, NOTE_MAX);
  return `${old}; ${add}`.slice(0, NOTE_MAX);
}

// a figure in what was said: "about 2 million a day", "€40,000 per hour", "500k each outage"
const MULT = { k: 1e3, thousand: 1e3, thousands: 1e3, m: 1e6, mn: 1e6, mio: 1e6, million: 1e6, millions: 1e6, bn: 1e9, billion: 1e9, billions: 1e9 };
const AMOUNT = /([€$£])?\s?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s?(k|thousands?|m|mn|mio|millions?|bn|billions?)?(?![a-z0-9])(?!\s?(?:ms|milliseconds?|km|%|percent|years?|months?|weeks?|days?|hours?|minutes?|tb|gb|vms?|servers?|sites?|hosts?|people|users?)\b)/g;
const PERIODS = [
  ["hour", /\b(?:per|an|a|each|every)\s+hour\b|\bhourly\b|\/\s?(?:h|hr|hour)\b/],
  ["day", /\b(?:per|a|each|every)\s+day\b|\bdaily\b|\/\s?day\b/],
  ["week", /\b(?:per|a|each|every)\s+week\b|\bweekly\b/],
  ["month", /\b(?:per|a|each|every)\s+month\b|\bmonthly\b/],
  ["year", /\b(?:per|a|each|every)\s+year\b|\byearly\b|\bannual(?:ly)?\b|\bper annum\b/],
  ["incident", /\b(?:per|an|each|every)\s+(?:incident|outage|breach|attack|event)\b/],
];

/**
 * The money in what was said, and what it is counted per: the period said, else the one the question asks about.
 * A bare small number ("three years ago", "2 ms") is not a figure: it needs a currency, a "thousand" or "million",
 * or to be a thousand or more. Null when there is no figure, or nothing says what it is counted per.
 * @returns {{amount:number, per:string}|null}
 */
export function figureIn(said, question) {
  const t = ` ${String(said == null ? "" : said).toLowerCase()} `;
  let best = 0;
  for (const m of t.matchAll(AMOUNT)) {
    const [, cur, raw, mult] = m;
    const n = /^\d{1,3}(?:[.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g, "")) : Number(raw.replace(",", "."));
    const amount = n * (mult ? MULT[mult] : 1);
    if (!Number.isFinite(amount) || !(cur || mult || amount >= 1000)) continue;
    if (!cur && !mult && /^(19|20)\d\d$/.test(raw)) continue;        // a year, not money
    best = Math.max(best, amount);
  }
  if (!best || best > 1e13) return null;
  const q = String((question && question.q) || "").toLowerCase();
  const said_ = PERIODS.find(([, re]) => re.test(t));
  const asked = PERIODS.find(([p]) => new RegExp(`\\b${p}s?\\b`).test(q));
  const per = said_ ? said_[0] : asked ? asked[0] : null;
  return per ? { amount: Math.round(best), per } : null;
}
