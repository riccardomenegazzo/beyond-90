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

/** Does a question belong in this meeting: only the essential ones, or only those for the people in the room? */
export const inMeeting = (q, { core = false, roles = [] } = {}) => (!core || !!q.core) && (!roles.length || roles.includes(q.role));
