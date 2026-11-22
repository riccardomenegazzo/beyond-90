// A virtual-machine inventory export, read in the page: the numbers a presales engineer needs before any sizing or
// migration plan, and the facts that turn discovery questions into answers.
//
// It reads the CSV a hypervisor console or an inventory tool exports (for example the vInfo sheet saved as CSV), maps its
// columns by name, and keeps only totals: no machine names leave this module. Pure functions, shared by the page and tests.

const MIB = 1 / 1024;
const MAX_ROWS = 200000;

/** RFC 4180 CSV with the delimiter guessed from the header line: comma, semicolon or tab. */
export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] || "";
  const count = (ch) => first.split(ch).length - 1;
  const delim = [",", ";", "\t"].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ",");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS) break;
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  return rows;
}

/** A number as exports write it: "1,024", "1.024", "1 024,5", "2048". */
export function num(v) {
  let t = String(v == null ? "" : v).replace(/[\s ']/g, "");
  if (!t) return NaN;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// column names, as the common exports and a hand-made sheet write them; the unit is read from the name
const COLUMNS = {
  name: ["vm", "name", "vm name", "virtual machine"],
  power: ["powerstate", "power state", "power", "state", "status"],
  template: ["template", "is template"],
  vcpu: ["cpus", "vcpu", "vcpus", "num cpu", "cpu", "cpu count"],
  memory: ["memory", "memory mib", "memory mb", "memory gib", "memory gb", "ram", "ram gb", "ram mb", "memory size mib"],
  provisioned: ["provisioned mib", "provisioned mb", "provisioned gib", "provisioned gb", "provisioned", "disk gb", "disk", "storage gb", "total disk capacity mib"],
  used: ["in use mib", "in use mb", "in use gib", "in use gb", "used gb", "used", "used mib", "consumed mib", "consumed gb"],
  os: ["os according to the configuration file", "os according to the vmware tools", "os", "guest os", "operating system"],
  cluster: ["cluster", "cluster name"],
  host: ["host", "host name", "esx host"],
  datacenter: ["datacenter", "data center", "site", "datacentre"],
};

function mapColumns(header) {
  const h = header.map(norm);
  const out = {};
  for (const [key, names] of Object.entries(COLUMNS)) {
    const i = names.map((n) => h.indexOf(n)).find((x) => x >= 0);
    if (i != null && i >= 0) out[key] = { index: i, unit: /\bgi?b\b/.test(h[i]) ? "gb" : /\bmi?b\b/.test(h[i]) ? "mb" : "" };
  }
  return out;
}

const POWER_ON = /^(poweredon|on|running|powered on|up)$/i, POWER_OFF = /^(poweredoff|off|stopped|powered off|down)$/i;

/** Read an export into machines. Only what the totals need is kept, and names are not returned. */
export function readInventory(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: "The file has no rows under its header." };
  const cols = mapColumns(rows[0]);
  if (!cols.vcpu && !cols.memory) return { ok: false, error: "No column for CPUs or memory was found. Save the sheet that lists one virtual machine per row (vInfo, for example) as CSV." };
  const cell = (r, key) => (cols[key] ? r[cols[key].index] : undefined);
  // memory written without a unit is in MiB in the common exports; a column of small numbers is in GiB
  const toGiB = (key, values) => {
    const unit = cols[key] && cols[key].unit;
    if (unit === "gb") return 1;
    if (unit === "mb") return MIB;
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    return median > 512 ? MIB : 1;
  };
  const body = rows.slice(1);
  const raw = (key) => body.map((r) => num(cell(r, key)));
  const mem = raw("memory"), prov = raw("provisioned"), used = raw("used");
  const fm = toGiB("memory", mem), fp = toGiB("provisioned", prov), fu = toGiB("used", used);
  const vms = [];
  let templates = 0;
  body.forEach((r, i) => {
    if (cols.template && /^(true|yes|1)$/i.test(String(cell(r, "template")).trim())) { templates++; return; }
    const p = String(cell(r, "power") || "").trim();
    vms.push({
      power: POWER_ON.test(p) ? "on" : POWER_OFF.test(p) ? "off" : p ? "other" : "on",
      vcpu: Number.isFinite(num(cell(r, "vcpu"))) ? num(cell(r, "vcpu")) : 0,
      mem: Number.isFinite(mem[i]) ? mem[i] * fm : 0,
      prov: Number.isFinite(prov[i]) ? prov[i] * fp : 0,
      used: Number.isFinite(used[i]) ? used[i] * fu : NaN,
      os: String(cell(r, "os") || "").trim(),
      cluster: String(cell(r, "cluster") || "").trim(),
      host: String(cell(r, "host") || "").trim(),
      datacenter: String(cell(r, "datacenter") || "").trim(),
    });
  });
  if (!vms.length) return { ok: false, error: "Every row is a template: there are no virtual machines to count." };
  return { ok: true, vms, templates, columns: Object.keys(cols) };
}

// Operating systems past their maker's general support by 2026; paid extended support may still exist.
const PAST_SUPPORT = [
  [/windows\s*server\s*(2003|2008|2012)/i, "Windows Server 2012 R2 or older"],
  [/windows\s*(xp|vista|7|8(\.1)?)\b/i, "Windows 8.1 or older"],
  [/windows\s*10\b/i, "Windows 10"],
  [/centos/i, "CentOS"],
  [/red\s*hat.*\b[4-7]\b|rhel\s*[4-7]\b/i, "Red Hat Enterprise Linux 7 or older"],
  [/suse.*\b(10|11|12)\b|sles\s*(10|11|12)\b/i, "SUSE Linux Enterprise 12 or older"],
  [/ubuntu.*\b(1[0-8])\.04\b/i, "Ubuntu 18.04 or older"],
  [/debian.*\b([4-9]|10)\b/i, "Debian 10 or older"],
];
const FAMILY = [[/windows\s*server/i, "Windows Server"], [/windows/i, "Windows desktop"], [/red\s*hat|rhel|centos|rocky|alma|oracle\s*linux/i, "Red Hat family"],
  [/ubuntu|debian/i, "Debian family"], [/suse|sles/i, "SUSE"], [/linux/i, "Other Linux"]];

const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const MAX_CLUSTERS = 200;

/** Totals only: what the estate is, what it runs, what is past support, and where a first wave could start. */
export function summarise(read) {
  const vms = read.vms;
  const on = vms.filter((v) => v.power === "on");
  const sum = (list, k) => list.reduce((n, v) => n + (Number.isFinite(v[k]) ? v[k] : 0), 0);
  const hasUsed = vms.some((v) => Number.isFinite(v.used));
  const disk = hasUsed ? "used" : "prov";      // what a move copies: the space used when the export has it, else what is provisioned
  const byCluster = new Map();
  for (const v of vms) {
    const k = v.cluster || "(no cluster)";
    const c = byCluster.get(k) || { name: k, vms: 0, on: 0, vcpu: 0, mem: 0, past: 0, data: 0, data_on: 0, hosts: new Set() };
    const d = Number.isFinite(v[disk]) ? v[disk] : 0;
    c.vms++; c.data += d; if (v.power === "on") { c.on++; c.vcpu += v.vcpu; c.mem += v.mem; c.data_on += d; }
    if (v.host) c.hosts.add(v.host);
    byCluster.set(k, c);
  }
  const families = {}, past = {};
  for (const v of vms) {
    const fam = (FAMILY.find(([re]) => re.test(v.os)) || [null, v.os ? "Other" : "Unknown"])[1];
    families[fam] = (families[fam] || 0) + 1;
    const p = PAST_SUPPORT.find(([re]) => re.test(v.os));
    if (p) { past[p[1]] = (past[p[1]] || 0) + 1; byCluster.get(v.cluster || "(no cluster)").past++; }
  }
  const clusters = [...byCluster.values()].map((c) => ({ name: c.name.slice(0, 120), vms: c.vms, on: c.on, vcpu: round(c.vcpu), mem_gib: round(c.mem), hosts: c.hosts.size, past: c.past,
    tib: round(c.data / 1024, 1), tib_on: round(c.data_on / 1024, 1) }))
    .sort((a, b) => b.vms - a.vms || (a.name < b.name ? -1 : 1)).slice(0, MAX_CLUSTERS);
  // a first wave: a small cluster, mostly running, with the least past support; it teaches the most for the least risk
  const candidates = clusters.filter((c) => c.on > 0 && c.name !== "(no cluster)");
  const biggest = Math.max(1, ...candidates.map((c) => c.vms));
  const risk = (c) => c.past / c.vms + 0.5 * (c.vms / biggest);          // past support counts most, size next
  const first = candidates.length > 1 ? [...candidates].sort((a, b) => risk(a) - risk(b) || a.vms - b.vms)[0] : null;
  const hosts = new Set(vms.map((v) => v.host).filter(Boolean)).size;
  const dcs = new Set(vms.map((v) => v.datacenter).filter(Boolean)).size;
  const pastTotal = Object.values(past).reduce((a, b) => a + b, 0);
  return {
    vms: vms.length, on: on.length, off: vms.filter((v) => v.power === "off").length, templates: read.templates || 0,
    vcpu_on: round(sum(on, "vcpu")), mem_on_gib: round(sum(on, "mem")),
    prov_tib: round(sum(vms, "prov") / 1024, 1), used_tib: hasUsed ? round(sum(vms, "used") / 1024, 1) : null,
    hosts, datacenters: dcs, clusters, families, past, past_total: pastTotal,
    vcpu_per_vm: on.length ? round(sum(on, "vcpu") / on.length, 1) : 0, mem_per_vm_gib: on.length ? round(sum(on, "mem") / on.length, 1) : 0,
    first_wave: first ? { name: first.name, vms: first.vms, past: first.past } : null,
  };
}

/** A summary is stored with a workshop: numbers and cluster names only, checked like everything else on the way in. */
export function validSummary(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const n = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
  for (const k of ["vms", "on", "off", "templates", "vcpu_on", "mem_on_gib", "prov_tib", "hosts", "datacenters", "past_total", "vcpu_per_vm", "mem_per_vm_gib"]) if (!n(s[k])) return false;
  if (s.used_tib !== null && !n(s.used_tib)) return false;
  if (!Array.isArray(s.clusters) || s.clusters.length > MAX_CLUSTERS) return false;
  for (const c of s.clusters) {
    if (!c || typeof c.name !== "string" || c.name.length > 120 || !["vms", "on", "vcpu", "mem_gib", "hosts", "past"].every((k) => n(c[k]))) return false;
    if (["tib", "tib_on"].some((k) => c[k] !== undefined && !n(c[k]))) return false;      // a summary read before the data per cluster was kept has none
  }
  for (const m of [s.families, s.past]) {
    if (!m || typeof m !== "object" || Array.isArray(m) || Object.keys(m).length > 50) return false;
    for (const [k, v] of Object.entries(m)) if (k.length > 60 || !n(v)) return false;
  }
  if (s.first_wave !== null && !(s.first_wave && typeof s.first_wave.name === "string" && s.first_wave.name.length <= 120 && n(s.first_wave.vms) && n(s.first_wave.past))) return false;
  if (typeof s.imported_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.imported_on)) return false;
  return true;
}

const F = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
export const fmt = (v) => F.format(v);

/** What the inventory says, as notes for the migration questions it answers (by position in that profile's list). */
export function notesFor(s) {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const notes = {
    2: `${fmt(s.vms)} virtual machines on ${fmt(s.clusters.length)} cluster${s.clusters.length === 1 ? "" : "s"}${s.datacenters ? ` at ${fmt(s.datacenters)} site${s.datacenters === 1 ? "" : "s"}` : ""}; ${fmt(s.off)} powered off (${pct(s.off, s.vms)}%), owners not in the export`,
    8: `${fmt(s.hosts)} host${s.hosts === 1 ? "" : "s"} in the inventory; support dates to check`,
  };
  if (s.first_wave) notes[4] = `A first test could be ${s.first_wave.name}: ${fmt(s.first_wave.vms)} machines, ${fmt(s.first_wave.past)} past support`;
  if (s.past_total) notes[6] = `${fmt(s.past_total)} machines run operating systems past general support: tools and agents must be checked for them`;
  return notes;
}
