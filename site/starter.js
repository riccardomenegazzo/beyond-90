// Starting from nothing: a short form becomes the two files every analysis needs, customer.toml and accounts.csv.
// Pure functions, so the same input always gives the same files; the page adds the form around them.
import { toCsv } from "./ui.js";

export const PROVIDERS = ["aws", "azure", "gcp", "oci", "kubernetes"];
const COLUMNS = ["id", "provider", "sources", "connected", "owner", "last_spend", "status", "in_plan", "created_at"].map((k) => ({ key: k, label: k }));

const tomlString = (v) => '"' + String(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** What is missing or wrong, in words; an empty list means the files can be made. */
export function problems({ customer, accounts }) {
  const out = [];
  if (!String(customer.name || "").trim()) out.push("Give the customer a name.");
  if (!isDate(customer.as_of)) out.push("The date of the data must be a date.");
  if (customer.renewal_date && !isDate(customer.renewal_date)) out.push("The renewal date must be a date, or left empty.");
  if (customer.arr !== "" && customer.arr != null && !(Number(customer.arr) >= 0)) out.push("Annual revenue must be a number, or left empty.");
  const rows = accounts.filter((a) => String(a.id || "").trim());
  if (!rows.length) out.push("Add at least one cloud account or cluster.");
  const seen = new Set();
  for (const a of rows) {
    const id = a.id.trim();
    if (seen.has(id)) out.push(`The account ${id} is listed twice.`);
    seen.add(id);
    if (!PROVIDERS.includes(a.provider)) out.push(`Choose a provider for ${id}.`);
    if (a.spend !== "" && a.spend != null && !(Number(a.spend) >= 0)) out.push(`The spend of ${id} must be a number, or left empty.`);
  }
  return out;
}

/** The files, as {name: text}. */
export function starterFiles({ customer, accounts }) {
  const c = ["[customer]", `name = ${tomlString(customer.name.trim())}`, `tier = ${tomlString(customer.tier || "standard")}`,
    `arr = ${Number(customer.arr) >= 0 && customer.arr !== "" && customer.arr != null ? Math.round(Number(customer.arr)) : 0}`, `as_of = ${customer.as_of}`];
  if (customer.renewal_date) c.push(`renewal_date = ${customer.renewal_date}`);
  const rows = accounts.filter((a) => String(a.id || "").trim()).map((a) => ({
    id: a.id.trim(), provider: a.provider, sources: "manual", connected: a.connected ? "true" : "false", owner: String(a.owner || "").trim(),
    last_spend: a.spend === "" || a.spend == null ? "0" : String(Math.round(Number(a.spend))), status: "active", in_plan: "true", created_at: "",
  }));
  return { "customer.toml": c.join("\n") + "\n", "accounts.csv": toCsv(COLUMNS, rows) };
}
