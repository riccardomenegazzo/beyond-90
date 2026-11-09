// Pseudonymous sharing: swap the names and ids in a text for stable aliases before it leaves the page, and swap them back.
// The alias table lives only on this device (sealed with the passphrase when there is one). Pure functions, no DOM, no storage.
//
// A pseudonym is not anonymity. Sizes, dates, counts and the way a customer is set up can still point to them,
// and a name this page was never told about (one typed in a free-text note) is not replaced. `leftovers` says what it can still see.

export const LEVELS = ["full", "people", "pseudonym"];
export const LEVEL_TEXT = {
  full: "Full: names stay as they are",
  people: "People hidden: owners and contacts become Person 1, Person 2…",
  pseudonym: "Pseudonym: customer, people, teams and accounts all become aliases",
};
export const KINDS = ["customer", "person", "team", "account"];
const LABEL = { customer: "Customer", person: "Person", team: "Team", account: "Account" };
const MAX_ENTRIES = 20000;

/** Which kinds of identifier a level replaces. */
export const kindsFor = (level) => (level === "pseudonym" ? KINDS : level === "people" ? ["person"] : []);

export const emptyTable = () => ({ v: 1, entries: [], n: { customer: 0, person: 0, team: 0, account: 0 } });

export function validTable(t) {
  if (!t || t.v !== 1 || !Array.isArray(t.entries) || t.entries.length > MAX_ENTRIES || !t.n) return false;
  return t.entries.every((e) => e && typeof e.o === "string" && typeof e.a === "string" && KINDS.includes(e.k) && typeof e.c === "string")
    && KINDS.every((k) => Number.isInteger(t.n[k]) && t.n[k] >= 0);
}

const letters = (n) => { let s = ""; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const aliasFor = (kind, n) => (kind === "customer" ? `${LABEL[kind]} ${letters(n)}` : `${LABEL[kind]} ${n + 1}`);
const norm = (t) => String(t).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A table that knows an alias for every identifier of the kinds this level replaces. An identifier that already
 * has an alias keeps it, so a text shared today and one shared next month use the same names.
 * `ids` is { customer: [...], person: [...], ... } as the engine lists it.
 */
export function assign(table, ids, level, customer) {
  const t = { v: 1, entries: table.entries.map((e) => ({ ...e })), n: { ...table.n } };
  const have = new Set(t.entries.map((e) => norm(e.o)));
  for (const kind of kindsFor(level)) {
    for (const o of (ids && ids[kind]) || []) {
      if (typeof o !== "string" || !o.trim() || have.has(norm(o)) || t.entries.length >= MAX_ENTRIES) continue;
      t.entries.push({ o, a: aliasFor(kind, t.n[kind]++), k: kind, c: customer || "" });
      have.add(norm(o));
    }
  }
  return t;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A name matches as a whole word: not inside a longer word or number. Spaces in a name match any run of spaces.
const edge = (core) => `(?<![\\p{L}\\p{N}])${core}(?![\\p{L}\\p{N}])`;
const wordy = (o) => esc(o.trim()).replace(/\s+/g, "\\s+");
// In a file name a name is written as a slug: its words joined by - or _ with the punctuation dropped.
const slugy = (o) => {
  const words = o.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(esc);
  return words.length ? words.join("[^\\p{L}\\p{N}]+") : esc(o.trim());
};

function swap(text, pairs, mk) {
  const live = pairs.filter((p) => p.from.trim()).sort((a, b) => b.from.length - a.from.length);
  if (!live.length) return { text, n: 0 };
  const re = new RegExp(edge("(?:" + live.map((p) => "(" + mk(p.from) + ")").join("|") + ")"), "giu");
  let n = 0;
  const out = String(text).replace(re, (...m) => {
    const i = m.slice(1, live.length + 1).findIndex((g) => g !== undefined);
    n++;
    return i >= 0 ? live[i].to : m[0];
  });
  return { text: out, n };
}

/** The text with every identifier of the level's kinds replaced. Returns { text, replaced }. */
export function redact(text, table, level) {
  const kinds = new Set(kindsFor(level));
  const r = swap(text, table.entries.filter((e) => kinds.has(e.k)).map((e) => ({ from: e.o, to: e.a })), wordy);
  return { text: r.text, replaced: r.n };
}

/** The same for a file name, where a name reads as customer-name or customer_name. */
export function redactName(name, table, level) {
  const kinds = new Set(kindsFor(level));
  const r = swap(name, table.entries.filter((e) => kinds.has(e.k)).map((e) => ({ from: e.o, to: e.a.toLowerCase().replace(/\s+/g, "-") })), slugy);
  return r.text;
}

/** Put the real names back into a text that came back with aliases in it (for example an answer from a model). */
export function restore(text, table) {
  const r = swap(text, table.entries.map((e) => ({ from: e.a, to: e.o })), wordy);
  return { text: r.text, restored: r.n };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * What would still identify someone in this text, as the page can see it: identifiers the chosen level does not cover,
 * and anything shaped like an email address. It cannot see a name it was never told about.
 */
export function leftovers(text, ids, level) {
  const covered = new Set(kindsFor(level));
  const found = [];
  const body = String(text);
  for (const kind of KINDS) {
    if (covered.has(kind)) continue;
    const hits = [];
    for (const o of (ids && ids[kind]) || []) {
      const n = (body.match(new RegExp(edge(wordy(o)), "giu")) || []).length;
      if (n) hits.push({ value: o, count: n });
    }
    if (hits.length) found.push({ kind, hits });
  }
  const mails = body.match(EMAIL) || [];
  if (mails.length) found.push({ kind: "email", hits: [...new Set(mails)].map((m) => ({ value: m, count: mails.filter((x) => x === m).length })) });
  return found;
}

/** Entries that belong to one customer removed (used when that customer is erased). */
export function dropCustomer(table, customer) {
  return { ...table, entries: table.entries.filter((e) => e.c !== customer) };
}
