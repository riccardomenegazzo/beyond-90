// Keeping customer data only as long as it should be kept, and proving to yourself that it is gone.
// Pure functions: dates in, dates out, text out. The browser storage work lives in store.js.
//
// What a receipt is: a record this page made of what it removed from this browser. It is not independent proof.
// What it cannot do: reach a file you already downloaded, a text you already copied, or anything another device holds.

export const MAX_EXPORTS = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (d) => typeof d === "string" && DATE.test(d) && !Number.isNaN(Date.parse(d));

export function validRetention(r) { return !!r && typeof r.customer === "string" && r.customer !== "" && isDate(r.keep_until); }

export const retentionId = (r) => r.customer;

/** Later date wins when the same customer is set twice. */
export function mergeRetention(a, b) {
  const by = new Map();
  for (const r of [...a, ...b]) if (validRetention(r)) by.set(r.customer, r);
  return [...by.values()].sort((x, y) => x.customer.localeCompare(y.customer));
}

/** Customers whose keep-until date has passed, oldest first. */
export function due(list, today) {
  return list.filter((r) => validRetention(r) && r.keep_until < today).sort((a, b) => a.keep_until.localeCompare(b.keep_until) || a.customer.localeCompare(b.customer));
}

/** Customers with a date in the next `days` days (not yet due). */
export function soon(list, today, days = 30) {
  const end = new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10);
  return list.filter((r) => validRetention(r) && r.keep_until >= today && r.keep_until <= end).sort((a, b) => a.keep_until.localeCompare(b.keep_until));
}

// ---- the log of what left the page

export const HOW = ["file", "copy"];

export function makeExport({ customer, on, how, what = "", level = "full", nonce = "" }) {
  const n = nonce || Math.random().toString(36).slice(2, 10);
  return { id: `${on}|${n}`, customer, on, how, what: String(what).slice(0, 200), level };
}

export function validExport(e) {
  return !!e && typeof e.id === "string" && typeof e.customer === "string" && isDate(e.on) && HOW.includes(e.how) && typeof e.what === "string" && typeof e.level === "string";
}

/** Merge by id, newest kept when the log is over its cap. */
export function mergeExports(a, b) {
  const by = new Map();
  for (const e of [...a, ...b]) if (validExport(e)) by.set(e.id, e);
  return [...by.values()].sort((x, y) => y.on.localeCompare(x.on) || x.id.localeCompare(y.id)).slice(0, MAX_EXPORTS);
}

/** What left the page for one customer, newest first, and how many of them still had real names in. */
export function outside(exports, customer) {
  const mine = exports.filter((e) => e.customer === customer).sort((x, y) => y.on.localeCompare(x.on) || x.id.localeCompare(y.id));
  return { items: mine, withNames: mine.filter((e) => e.level === "full").length };
}

// ---- the receipt

/**
 * A plain-text record of an erasure. `removed` has the counts, `outsideCopies` is outside(...) taken BEFORE the
 * log entries were removed, `remaining` is what a second look found afterwards (it should be zero).
 */
export function receipt({ customer, on, removed, remaining, outsideCopies, locked = 0 }) {
  const n = (x) => Number(x) || 0;
  const lines = [
    `# Erasure record: ${customer}`,
    "",
    `Date: ${on}`,
    "",
    "Removed from this browser's storage:",
    `- saved snapshots: ${n(removed.snapshots)}`,
    `- recorded outcomes: ${n(removed.outcomes)}`,
    `- promises: ${n(removed.commitments)}`,
    `- retention dates: ${n(removed.retention)}`,
    `- proofs of value: ${n(removed.povs)}`,
    `- customer asks: ${n(removed.asks)}`,
    `- alias entries: ${n(removed.aliases)}`,
    `- export log entries: ${n(removed.exports)}`,
    "",
    `A second look afterwards found ${n(remaining)} record(s) for this customer that could be read.` + (locked ? ` ${n(locked)} sealed record(s) could not be read without the passphrase and were not checked.` : ""),
    "",
    "What this page cannot reach:",
  ];
  if (outsideCopies.items.length) {
    lines.push(`- ${outsideCopies.items.length} time(s) something left this page for this customer (${outsideCopies.withNames} with real names). Those copies are wherever you put them:`);
    for (const e of outsideCopies.items.slice(0, 50)) lines.push(`  - ${e.on}: ${e.how === "file" ? "file" : "copied text"}${e.what ? ` (${e.what})` : ""}, level ${e.level}`);
    if (outsideCopies.items.length > 50) lines.push(`  - and ${outsideCopies.items.length - 50} more`);
  } else {
    lines.push("- This page has no record of anything leaving it for this customer. That is only what it saw: copies made another way are not counted.");
  }
  lines.push(
    "- Files you downloaded and text you copied before today, wherever they went (email, chat, a model, a ticket).",
    "- Other devices, browser profiles and synced workspace files.",
    "- Traces the browser may keep until it compacts its own database. The page cannot force that.",
    "",
    "This is a record the page wrote about itself. It is not independent proof.",
  );
  return lines.join("\n") + "\n";
}
