/**
 * A list of questions to answer, kept short: one line each with the answer in line, and one opened at a time for what
 * goes with it (the whole question, why it matters, how to ask it, notes). A strip on top counts the answers of each
 * group and narrows the list to one; filters narrow it to what is still open. In an opened row, the keys 1 to n answer
 * and move on to the next question still open, as in a meeting; Escape closes it. A key never takes an answer back (a
 * click on the chosen answer does), and keys pressed while an answer is being kept are ignored.
 *
 * The host gives the questions (items), the answers, how to keep one, and what an opened row shows; the list keeps
 * nothing itself but which group, filter and row are chosen.
 */
import { h } from "./ui.js";

const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

/** For each group: its questions, how many are answered, and the tone of each answer, in order. Pure, for tests. */
export function tally(items, groups, tones) {
  return groups.map((g) => {
    const xs = items.filter((x) => x.group === g.key);
    return { key: g.key, label: g.label, total: xs.length, done: xs.filter((x) => x.a).length, tones: xs.map((x) => (x.a ? tones[x.a] || "open" : "open")) };
  }).filter((g) => g.total);
}

/** The next question still open after `id` in `list`, else the first still open other than it, else null. Pure. */
export function nextOpen(list, id) {
  const i = list.findIndex((x) => x.id === id);
  return list.slice(i + 1).find((x) => !x.a) || list.find((x) => !x.a && x.id !== id) || null;
}

/**
 * label: what the list is, for screen readers. groups: [{ key, label }]. answers: [{ key, label, tone }], tone one of
 * good, mid, bad, unknown. items(): [{ id, group, label, text, a, aside?, stop? }]. answer(id, key): keeps it ("" takes
 * it back). detail(item): what an opened row shows under the question. filters: [{ key, label, test }], the first shows all.
 */
export function questionList({ label, groups, answers, items, answer, detail = () => null, filters = [], onAnswered = () => {} }) {
  const ui = { group: "", filter: filters.length ? filters[0].key : "", open: "" };
  const tones = Object.fromEntries(answers.map((a) => [a.key, a.tone]));
  const strip = h("div", { class: "qlstrip", role: "group", "aria-label": `${label}: by group` });
  const tools = h("div", { class: "qltools" });
  const list = h("ol", { class: "qlrows", "aria-label": label });
  const say = h("p", { class: "note qlsay", role: "status" });
  const el = h("div", { class: "ql" }, strip, tools, list, say);
  let busy = false;

  const passes = (x) => { const f = filters.find((y) => y.key === ui.filter); return !f || !f.test || f.test(x); };
  const visible = () => items().filter((x) => (!ui.group || x.group === ui.group) && passes(x));

  const keep = async (x, key, move) => {
    busy = true;
    try { await answer(x.id, key); say.textContent = ""; } catch (e) { say.textContent = e.message; busy = false; return; }
    busy = false;
    onAnswered(x.id, key);
    if (!move) { draw(); return; }
    const next = nextOpen(visible().length ? visible() : items(), x.id);
    ui.open = next ? next.id : "";
    draw();
    if (next) focusRow(next.id, true);
    else say.textContent = "Every question in this list is answered.";
  };

  const focusRow = (id, onAnswer) => {
    const li = list.querySelector(`li.qlrow[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.scrollIntoView({ block: "nearest" });
    const b = onAnswer ? li.querySelector(".qlopt[aria-pressed=true]") || li.querySelector(".qlopt") : li.querySelector(".qlhead");
    if (b) b.focus();
  };

  const row = (x) => {
    const open = ui.open === x.id;
    const li = h("li", { class: `qlrow t-${x.a ? tones[x.a] || "open" : "open"}${open ? " open" : ""}`, "data-id": x.id });
    const opts = h("div", { class: "qlans", role: "group", "aria-label": `Answer: ${x.text}` }, answers.map((a, i) =>
      h("button", { type: "button", class: `qlopt t-${a.tone}`, "aria-pressed": String(x.a === a.key), "aria-label": a.label,
        onclick: () => (x.a === a.key ? keep(x, "", false) : keep(x, a.key, open)) },
      open ? h("kbd", { "aria-hidden": "true", text: String(i + 1) }) : null, a.label)));
    const head = h("button", { type: "button", class: "qlhead", "aria-expanded": String(open), "aria-controls": `ql-${x.id}`,
      onclick: () => { ui.open = open ? "" : x.id; draw(); focusRow(x.id, false); } },
    h("i", { class: `qldot t-${x.a ? tones[x.a] || "open" : "open"}`, "aria-hidden": "true" }),
    h("span", { class: "qllabel", text: x.label }),
    x.stop ? h("span", { class: "qlstop", text: "can exclude" }) : null,
    x.aside ? h("span", { class: "qlaside", text: x.aside }) : null);
    put(li, h("div", { class: "qlline" }, head, opts),
      open ? h("div", { class: "qldetail", id: `ql-${x.id}` }, x.text && x.text !== x.label ? h("p", { class: "qltext", text: x.text }) : null, detail(x)) : null);
    li.onkeydown = (e) => {
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); ui.open = ""; draw(); focusRow(x.id, false); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > answers.length) return;
      e.preventDefault(); e.stopPropagation();
      if (busy) return;
      keep(x, answers[n - 1].key, true);
    };
    return li;
  };

  const draw = () => {
    const all = items();
    put(strip, tally(all, groups, tones).map((g) => h("button", { type: "button", class: "qlgroup", "aria-pressed": String(ui.group === g.key),
      "aria-label": `${g.label}: ${g.done} of ${g.total} answered${ui.group === g.key ? ", shown alone" : ""}`,
      onclick: () => { ui.group = ui.group === g.key ? "" : g.key; ui.open = ""; draw(); } },
    h("span", { class: "qlglabel", text: g.label }),
    h("span", { class: "qldots", "aria-hidden": "true" }, g.tones.map((t) => h("i", { class: `qldot t-${t}` }))),
    h("small", { class: "muted", text: `${g.done} of ${g.total}` }))));
    const inGroup = all.filter((x) => !ui.group || x.group === ui.group);
    put(tools, filters.length > 1 ? filters.map((f) => h("button", { type: "button", class: "kindchip", "aria-pressed": String(ui.filter === f.key),
      text: `${f.label} ${inGroup.filter((x) => !f.test || f.test(x)).length}`, onclick: () => { ui.filter = f.key; ui.open = ""; draw(); } })) : null,
    ui.group ? h("button", { type: "button", class: "linkbtn", text: "Show every group", onclick: () => { ui.group = ""; draw(); } }) : null);
    const vis = visible();
    if (!vis.length) { put(list, h("li", { class: "qlempty note", text: all.length ? "Nothing in this list: every question here is answered." : "No question yet." })); return; }
    // a heading per group when more than one is shown
    const many = new Set(vis.map((x) => x.group)).size > 1;
    put(list, groups.map((g) => {
      const xs = vis.filter((x) => x.group === g.key);
      if (!xs.length) return null;
      return [many ? h("li", { class: "qlsect", "aria-hidden": "true", text: g.label }) : null, xs.map(row)];
    }));
  };

  draw();
  return { el, draw, open: (id) => { ui.open = id; ui.group = ""; draw(); focusRow(id, true); } };
}
