// What each kind of person needs on the screen first. The page keeps every view; a role only decides which ones sit in the
// main list and which go under "More views". Pure functions, no DOM, no storage.

export const ROLES = {
  all: { label: "Show everything", short: "Everything", hint: "Every view, grouped by the question it answers." },
  tam: { label: "Technical account manager", short: "TAM", hint: "You look after customers after the sale: adoption, risk going down, promises, renewal." },
  sa: { label: "Solutions architect", short: "SA", hint: "You design how it gets connected and rolled out: coverage, order of work, what changes what." },
  se: { label: "Sales engineer", short: "SE", hint: "You run demos and proofs of value: a plan with success criteria, a clear picture, a result to hand over." },
};
export const ROLE_IDS = Object.keys(ROLES);

// In the order they should appear. An id that is not a view of the open screen (a book view, say) is simply skipped.
const ESSENTIALS = {
  tam: ["overview", "burndown", "accounts", "findings", "onboarding", "actions", "outlook", "teams", "prep", "call", "commitments", "asks", "renewal", "execqbr", "handoff", "value", "plan"],
  sa: ["overview", "connections", "accounts", "onboarding", "maturity", "planview", "whatif", "teams", "pov", "burndown", "roadmap", "report"],
  se: ["pov", "overview", "maturity", "whatif", "connections", "burndown", "news", "execqbr", "onepager", "value", "report", "call"],
};

export const isRole = (r) => ROLE_IDS.includes(r);

export const essentials = (role) => (ESSENTIALS[role] || []).slice();

/**
 * Split navigation groups into the views a role works in (main) and the rest (more). Groups keep their order and
 * their question; a group with no view left is dropped. Inside the main list, a role's own order wins.
 */
export function shape(groups, role) {
  if (!ESSENTIALS[role]) return { main: groups, more: [] };
  const order = ESSENTIALS[role];
  const wanted = new Set(order);
  const main = [], more = [];
  for (const g of groups) {
    const mine = g.views.filter((v) => wanted.has(v.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const rest = g.views.filter((v) => !wanted.has(v.id));
    if (mine.length) main.push({ ...g, views: mine });
    if (rest.length) more.push({ ...g, views: rest });
  }
  return { main, more };
}
