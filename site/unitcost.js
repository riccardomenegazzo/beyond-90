/**
 * What one machine costs a month, all in, in the customer's own figures: the hardware written off over its life,
 * licences, support, power, space and the people who run it, divided by the machines it runs. Then what idle machines
 * do to that cost, how it compares with a machine in a public cloud, and, for a service provider, what a standard
 * tenant costs against its price. Every number is typed in from the conversation; nothing is a price or a quote.
 */

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const P = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
export const money = (v) => F.format(Math.round(v));
const pct = (v) => P.format(v);

/** The inputs, grouped as they are asked. Each: key, label, unit, [min, max]. Amounts are in the customer's currency. */
export const FIELDS = [
  { group: "What the estate costs", fields: [
    ["machines", "Machines running (0: those running in the inventory)", "machines", [0, 1e6]],
    ["hardware", "Hardware in use: servers, storage, network, at purchase price", "one-off", [0, 1e10]],
    ["hardware_years", "Written off over", "years", [1, 10]],
    ["licences_year", "Software licences and subscriptions", "per year", [0, 1e10]],
    ["support_year", "Hardware and software support", "per year", [0, 1e10]],
    ["power_year", "Power and cooling", "per year", [0, 1e10]],
    ["space_year", "Space: racks, rooms, data-centre rent", "per year", [0, 1e10]],
    ["people_fte", "People running the estate, as full-time equivalents", "people", [0, 10000]],
    ["fte_cost", "Cost of one full-time person", "per year", [0, 1e7]],
  ] },
  { group: "Idle machines", fields: [
    ["idle_pct", "Machines idle, oversized past use or forgotten", "%", [0, 90]],
  ] },
  { group: "To compare with", fields: [
    ["cloud_month", "A comparable machine in a public cloud, storage, backup and support included (0: not compared)", "per month", [0, 1e6]],
    ["tenant_vms", "Machines in a standard tenant, for a service provider (0: not counted)", "machines", [0, 10000]],
    ["tenant_price", "Price of that standard tenant", "per month", [0, 1e8]],
  ] },
];
const KEYS = Object.fromEntries(FIELDS.flatMap((g) => g.fields.map(([k, , , r]) => [k, r])));
export const UNIT_DEFAULTS = { hardware_years: 5 };
const WHOLE = new Set(["machines", "hardware_years", "tenant_vms"]);

/** Only what was typed, brought into range; blanks stay out (they count as nothing). Never throws. */
export function cleanUnit(given) {
  const a = given && typeof given === "object" ? given : {};
  const out = { ...UNIT_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(KEYS)) {
    if (a[k] === undefined || a[k] === "" || a[k] === null) continue;
    const v = Number(a[k]);
    if (Number.isFinite(v)) out[k] = WHOLE.has(k) ? Math.round(Math.min(hi, Math.max(lo, v))) : Math.min(hi, Math.max(lo, v));
  }
  return out;
}

/** Stored with a workshop: own keys only, numbers in range. */
export function validUnit(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  for (const [k, v] of Object.entries(a)) {
    if (!Object.hasOwn(KEYS, k) || typeof v !== "number" || !Number.isFinite(v) || v < KEYS[k][0] || v > KEYS[k][1]) return false;
    if (WHOLE.has(k) && !Number.isInteger(v)) return false;
  }
  return true;
}

const PARTS = [
  ["hardware", "Hardware, written off"], ["licences_year", "Licences and subscriptions"], ["support_year", "Support"],
  ["power_year", "Power and cooling"], ["space_year", "Space"], ["people", "People"],
];

/** The cost per machine, with every step shown. */
export function unitSketch(given, inventory) {
  const a = cleanUnit(given);
  const machines = a.machines || (inventory ? inventory.on || 0 : 0);
  if (!machines) return { ok: false, assumptions: a, error: "Give the number of machines running, or read an inventory: the cost is divided among them." };
  const year = {
    hardware: (a.hardware || 0) / a.hardware_years, licences_year: a.licences_year || 0, support_year: a.support_year || 0,
    power_year: a.power_year || 0, space_year: a.space_year || 0, people: (a.people_fte || 0) * (a.fte_cost || 0),
  };
  const total = Object.values(year).reduce((s, v) => s + v, 0);
  if (!total) return { ok: false, assumptions: a, machines, error: "Give at least one cost: hardware, licences, support, power, space or people." };
  const month = total / machines / 12;
  const parts = PARTS.map(([k, label]) => ({ key: k, label, year: year[k], month: year[k] / machines / 12, share: (year[k] / total) * 100 })).filter((p) => p.year > 0);
  const idle = a.idle_pct ? Math.round((machines * a.idle_pct) / 100) : 0;
  const usedMonth = idle && machines - idle > 0 ? total / (machines - idle) / 12 : null;
  const cloud = a.cloud_month ? { month: a.cloud_month, diff: a.cloud_month - month, year: (a.cloud_month - month) * machines * 12 } : null;
  let tenant = null;
  if (a.tenant_vms) {
    const cost = month * a.tenant_vms;
    tenant = { vms: a.tenant_vms, cost, price: a.tenant_price || 0, margin: a.tenant_price ? ((a.tenant_price - cost) / a.tenant_price) * 100 : null, breakeven: cost };
  }
  const steps = [
    `A year of the estate: ${parts.map((p) => `${p.label.toLowerCase()} ${money(p.year)}`).join(", ")}; ${money(total)} in all.`,
    ...(a.hardware ? [`Hardware: ${money(a.hardware)} written off over ${a.hardware_years} year${a.hardware_years === 1 ? "" : "s"} is ${money(year.hardware)} a year.`] : []),
    ...(year.people ? [`People: ${pct(a.people_fte)} full-time at ${money(a.fte_cost)} is ${money(year.people)} a year.`] : []),
    `Divided among ${money(machines)} machines${a.machines ? "" : " running in the inventory"} and twelve months: ${money(month)} a machine a month.`,
    ...(usedMonth ? [`${pct(a.idle_pct)}% idle is ${money(idle)} machines doing nothing: the ${money(machines - idle)} that work really cost ${money(usedMonth)} a month each. Reclaiming them makes room for as many new machines before buying hardware.`] : []),
    ...(cloud ? [`A comparable public-cloud machine at ${money(cloud.month)} a month is ${money(Math.abs(cloud.diff))} ${cloud.diff >= 0 ? "more" : "less"} a machine, ${money(Math.abs(cloud.year))} a year across the estate.`] : []),
    ...(tenant ? [`A standard tenant of ${money(tenant.vms)} machines costs ${money(tenant.cost)} a month to run${tenant.price ? `; at ${money(tenant.price)} it leaves a margin of ${pct(tenant.margin)}%` : "; that is the price below which it loses money"}.`] : []),
  ];
  return { ok: true, assumptions: a, machines, total, month, parts, idle, used_month: usedMonth, cloud, tenant, steps };
}

/** What makes the number trusted, whatever the product. */
export function unitNotes(sk) {
  const out = [
    "Agree every cost element with finance before showing the number to anyone: a unit cost nobody trusts settles nothing.",
    "Show each team its cost first, without charging it; charge back once the numbers are trusted.",
  ];
  if (!sk.ok) return out;
  if (!sk.parts.some((p) => p.key === "people")) out.push("People are missing: they are often the largest part of running an estate, and what automation gives back.");
  if (sk.cloud) out.push("Compare like for like: the public-cloud price should carry the storage, backup, network traffic out and support the machine uses here.");
  if (sk.idle) out.push("Ask who may switch off or shrink a machine that belongs to another team: reclaiming idle capacity needs an owner's decision.");
  if (sk.tenant && sk.tenant.margin !== null && sk.tenant.margin < 20) out.push("A thin margin per tenant: price the services beyond machines (recovery, backup, Kubernetes, GPUs) that raise what each tenant pays.");
  return out;
}

export function unitMarkdown(sk) {
  if (!sk.ok) return `### What one machine costs\n\n${sk.error}`;
  return ["### What one machine costs", "", `**${money(sk.month)} a machine a month**, all in, across ${money(sk.machines)} machines.`, "",
    "| Part | A year | A machine a month | Share |", "|---|---|---|---|",
    ...sk.parts.map((p) => `| ${p.label} | ${money(p.year)} | ${money(p.month)} | ${pct(p.share)}% |`),
    "", ...sk.steps.slice(-3).filter((s) => /idle|public-cloud|tenant/.test(s)).map((s) => `- ${s}`),
    "", ...unitNotes(sk).map((x) => `- ${x}`), "", "Every figure comes from the conversation; none is a price or a quote."].join("\n").replace(/\n{3,}/g, "\n\n");
}
