// Sharing with pseudonyms, keeping data only as long as it should be kept, and erasing one customer.
// The pure rules are in aliases.js and erasure.js; this file connects them to the page.
import { h } from "./ui.js";
import { LEVELS, LEVEL_TEXT, assign, redact, redactName, restore, leftovers, KINDS } from "./aliases.js";
import { makeExport, due, soon, outside, receipt } from "./erasure.js";

const LEVEL_KEY = "beyond90.share";
const KIND_TEXT = { customer: "customer name", person: "people", team: "team names", account: "account ids", email: "email addresses" };

export function createPrivacy({ state, store, $, say, unlockVaultUi, today, saveBlob, copyText }) {
  state.share = "full";
  try { const v = localStorage.getItem(LEVEL_KEY); if (LEVELS.includes(v)) state.share = v; } catch { /* no storage: the level is for this visit only */ }
  state.idsBy = {};

  const allIds = () => {
    const out = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const ids of Object.values(state.idsBy)) for (const k of KINDS) out[k].push(...(ids[k] || []));
    return out;
  };

  /** Remember the identifiers the engine found, so they can be replaced in whatever is shared next. */
  function learn(result) {
    state.idsBy = {};
    if (result && result.identifiers) state.idsBy[result.customer] = result.identifiers;
    if (result && result.identifiers_by_customer) Object.assign(state.idsBy, result.identifiers_by_customer);
  }

  function setLevel(level) {
    if (!LEVELS.includes(level)) return;
    state.share = level;
    try { localStorage.setItem(LEVEL_KEY, level); } catch { /* ignore */ }
    $("share-level").value = level;
    $("share-level").dataset.level = level;
    render();
  }

  const customerNow = () => (state.result ? state.result.customer : "");

  async function logExit(how, name, level) {
    const customer = customerNow();
    if (!customer) return;
    try { await store.exportsPut([makeExport({ customer, on: today(), how, what: how === "file" ? name : "", level })]); } catch { /* the log is a convenience; sharing is not blocked by it */ }
  }

  // The gate: every text that leaves the page passes here.
  async function gate({ text, name, how }) {
    const level = state.share;
    if (typeof text !== "string") {                       // a binary file (a presentation) cannot be searched for names
      if (level === "full") { await logExit(how, name, level); return { text, name }; }
      say("Not shared: a PowerPoint file cannot have its names replaced. Download the Markdown or HTML version, or set sharing to full names.");
      return null;
    }
    if (level === "full") { await logExit(how, name, level); return { text, name }; }
    if ((await store.getVault()) && !store.unlocked() && !(await unlockVaultUi())) return null;
    let table;
    try {
      table = await store.aliasTable();
      const before = table.entries.length;
      for (const [c, ids] of Object.entries(state.idsBy)) table = assign(table, ids, level, c);
      if (table.entries.length !== before) await store.saveAliasTable(table);
    } catch (e) { say("Not shared: " + e.message); return null; }
    const red = redact(text, table, level);
    const outName = name ? redactName(name, table, level) : name;
    const left = leftovers(red.text, allIds(), level);
    const go = await preview({ text: red.text, replaced: red.replaced, left, level, how });
    if (!go) return null;
    await logExit(how, outName, level);
    return { text: red.text, name: outName };
  }

  function preview({ text, replaced, left, level, how }) {
    const d = $("exit-dialog");
    $("exit-title").textContent = how === "copy" ? "Copy with pseudonyms" : "Download with pseudonyms";
    $("exit-sum").textContent = `${replaced} name${replaced === 1 ? "" : "s"} replaced. Level: ${LEVEL_TEXT[level].split(":")[0]}.`;
    $("exit-text").textContent = text.length > 6000 ? text.slice(0, 6000) + `\n… ${text.length - 6000} more characters` : text;
    const items = left.map((f) => h("li", { text: `${KIND_TEXT[f.kind] || f.kind} still visible: ${f.hits.slice(0, 4).map((x) => `${x.value} ×${x.count}`).join(", ")}${f.hits.length > 4 ? ` and ${f.hits.length - 4} more` : ""}` }));
    $("exit-left").replaceChildren(...(items.length ? items : [h("li", { text: "Nothing the page knows about is left. It cannot see a name it was never told: check the text for names typed in free notes." })]));
    $("exit-go").textContent = how === "copy" ? "Copy as shown" : "Download as shown";
    d.showModal();
    return new Promise((resolve) => {
      const go = $("exit-go"), no = $("exit-cancel");
      const end = (v) => { go.removeEventListener("click", yes); no.removeEventListener("click", cancel); d.removeEventListener("close", cancel); if (d.open) d.close(); resolve(v); };
      const yes = () => end(true), cancel = () => end(false);
      go.addEventListener("click", yes); no.addEventListener("click", cancel); d.addEventListener("close", cancel);
    });
  }

  // ---- the Saved page: level, restore, retention, erase
  async function render() {
    const body = $("privacy-body");
    if (!body) return;
    let held = [], table = null, retention = [], logs = [], locked = 0;
    try {
      held = await store.customersHeld(); retention = await store.retentionAll(); logs = await store.exportsAll(); locked = await store.lockedCount();
      try { table = await store.aliasTable(); } catch { table = null; }
    } catch { /* storage is not available: the panel then shows only the level */ }
    const now = today();
    const kids = [];
    kids.push(h("p", { class: "fine", text: `${LEVEL_TEXT[state.share]}. A pseudonym is not anonymity: sizes, dates and the way a customer is set up can still point to them.` }));
    if (locked) kids.push(h("p", { class: "fine", text: `${locked} sealed record(s) are locked. Unlock to see and manage them.` }));
    const pastDue = due(retention, now);
    if (pastDue.length) kids.push(h("p", { class: "bad-text", role: "status", text: `Past the keep-until date: ${pastDue.map((r) => r.customer).join(", ")}. Erase them below, or move the date.` }));
    const nearly = soon(retention, now);
    if (nearly.length) kids.push(h("p", { class: "fine", text: `Coming up within 30 days: ${nearly.map((r) => `${r.customer} (${r.keep_until})`).join(", ")}.` }));

    if (table && table.entries.length) {
      const box = h("textarea", { id: "restore-in", rows: "4", "aria-label": "Text with aliases", placeholder: "Paste an answer that uses the aliases, for example from a model" });
      const out = h("pre", { class: "mono", id: "restore-out", hidden: true });
      const note = h("p", { class: "fine", id: "restore-note" });
      kids.push(h("details", {}, h("summary", { text: `Aliases on this device (${table.entries.length})` }),
        h("p", { class: "fine", text: "Put the real names back into a text that came back with aliases in it. Nothing is sent anywhere." }),
        box, h("p", { class: "row left" },
          h("button", { class: "btn small", type: "button", id: "restore-go", text: "Put the real names back", onclick: () => {
            const r = restore(box.value, table);
            out.textContent = r.text; out.hidden = false; note.textContent = `${r.restored} alias${r.restored === 1 ? "" : "es"} restored.`;
          } }),
          h("button", { class: "btn small", type: "button", text: "Copy restored text", onclick: (e) => copyText(out.textContent, { raw: true }).then((ok) => { e.target.textContent = ok ? "Copied" : "Not copied"; }) })),
        out, note));
    }

    if (held.length) {
      const rows = [];
      for (const c of held) {
        const r = retention.find((x) => x.customer === c);
        const date = h("input", { type: "date", "aria-label": `Keep ${c} until`, value: r ? r.keep_until : "" });
        rows.push(h("tr", {},
          h("td", { text: c }),
          h("td", {}, date, " ", h("button", { class: "btn small", type: "button", text: "Set", onclick: async () => {
            try { if (date.value) await store.retentionPut([{ customer: c, keep_until: date.value }]); else await store.retentionRemove(c); await render(); }
            catch (e) { say("Could not save the date: " + e.message); }
          } })),
          h("td", {}, h("button", { class: "btn small danger", type: "button", text: "Erase all", onclick: () => erase(c, logs) }))));
      }
      kids.push(h("div", { class: "tablewrap" }, h("table", { class: "hist", "aria-label": "Customers held on this device" },
        h("thead", {}, h("tr", {}, h("th", { text: "Customer" }), h("th", { text: "Keep until" }), h("th", {}, h("span", { class: "sr", text: "Erase" })))), h("tbody", {}, rows))));
    } else {
      kids.push(h("p", { class: "fine", text: "Nothing is saved for any customer yet, so there is nothing to keep or erase." }));
    }
    kids.push(h("div", { id: "erase-result" }));
    body.replaceChildren(...kids);
  }

  async function erase(customer, logs) {
    if ((await store.getVault()) && !store.unlocked() && !(await unlockVaultUi())) return;
    const n = await store.countFor(customer);
    const sentence = `Erase everything this browser holds for ${customer}?\n\n${n.snapshots} snapshot(s), ${n.outcomes} outcome(s), ${n.commitments} promise(s), ${n.povs || 0} proof(s) of value, ${n.asks || 0} ask(s), ${n.aliases} alias(es), ${n.exports} export log entr${n.exports === 1 ? "y" : "ies"}.\n\nThis cannot be undone. Copies you already downloaded or copied are not touched.`;
    if (!confirm(sentence)) return;
    const copies = outside(logs.length ? logs : await store.exportsAll(), customer);   // read before the log entries go
    try {
      const r = await store.eraseCustomer(customer);
      const text = receipt({ customer, on: today(), removed: r.before, remaining: r.remaining, outsideCopies: copies, locked: r.locked });
      say(`Erased ${customer} from this browser.`);
      await refreshAll();
      const slot = $("erase-result");
      if (slot) slot.replaceChildren(h("div", { class: "note" },
        h("p", { text: `${customer} was erased from this browser. A second look found ${r.remaining} record(s) left.` }),
        h("p", { class: "fine", text: `${copies.items.length} earlier export(s) of this customer are outside this page's reach.` }),
        h("p", { class: "row left" }, h("button", { class: "btn small primary", type: "button", text: "Download the erasure record", onclick: () => saveBlob(text, `beyond90-erasure-record-${today()}.md`, "text/markdown", { raw: true }) }))));
    } catch (e) { say("Could not erase: " + e.message); }
  }

  let refreshAll = async () => {};
  const onRefresh = (fn) => { refreshAll = fn; };

  $("share-level").value = state.share;
  $("share-level").dataset.level = state.share;
  $("share-level").addEventListener("change", (e) => setLevel(e.target.value));
  return { gate, learn, render, setLevel, onRefresh };
}
