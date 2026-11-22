/**
 * How discovery questions are put to the customer: who each is for, and the order of a conversation. Shared by the
 * workshop, the question guide and the partners' enablement kit.
 */
const STAGE_ORDER = { value: 0, L1: 1, L2: 2, L3: 3, L4: 4 };

/** Who in the customer's organisation a question is for: the meeting can be narrowed to the people in the room. */
export const ROLE_WORDS = { executive: "Executive sponsor", architect: "Architect", operations: "Operations", security: "Security", application: "Application owner", data: "Data team", finance: "Finance" };

/** A line's questions in the order of a conversation: value first, then the stages from connected to decided. Indexes are kept. */
export function displayOrder(line) {
  return line.questions.map((q, index) => ({ q, index })).sort((a, b) => STAGE_ORDER[a.q.stage] - STAGE_ORDER[b.q.stage] || a.index - b.index);
}

// who a question sent ahead is addressed to, in a sentence to the customer
const FOR_WHOM = { executive: "the executive sponsor", architect: "the architects", operations: "operations", security: "the security team",
  application: "the application owners", data: "the data team", finance: "finance" };
export const AHEAD_MAX = 12;

/**
 * The questions to send ahead of a meeting: the factual ones the customer's team can answer in writing (how many, how
 * old, how large, where), not yet answered, on the lines in scope, grouped by who would answer them. The meeting is
 * then spent on what hurts and what it is worth. No answer or note is in it. Empty when there is nothing left to ask.
 * @returns {{text:string, count:number}}
 */
export function aheadText(catalog, w, when = "") {
  const picked = [];
  for (const p of w.scope || []) {
    const line = catalog.lines[p];
    if (!line) continue;
    for (const { q, index } of displayOrder(line)) if (q.ahead && !(w.answers || {})[`${p}#${index}`]) picked.push(q);
  }
  const ask = picked.slice(0, AHEAD_MAX);
  if (!ask.length) return { text: "", count: 0 };
  const roles = Object.keys(ROLE_WORDS);
  const by = [...roles, ""].map((r) => [r, ask.filter((q) => (q.role || "") === r)]).filter(([, qs]) => qs.length);
  const out = [`Before our meeting${when ? ` on ${when}` : ""}: a few facts your team could send us in advance, so the time together goes to what matters most to you.`,
    "A rough figure is enough, and anything you would rather discuss in person can wait for the meeting.", ""];
  for (const [r, qs] of by) {
    out.push(r ? `For ${FOR_WHOM[r]}:` : "For whoever knows best:");
    for (const q of qs) out.push(`- ${q.q}`);
    out.push("");
  }
  return { text: out.join("\n").trimEnd(), count: ask.length };
}

/** Does a question belong in this meeting: only the essential ones, or only those for the people in the room? */
export const inMeeting = (q, { core = false, roles = [] } = {}) => (!core || !!q.core) && (!roles.length || roles.includes(q.role));
