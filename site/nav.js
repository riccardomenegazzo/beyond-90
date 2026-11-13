// The side menu's live signals: a count on the views that have something waiting, the four stages for the pulse card,
// and the views a person pinned. Pure functions: no DOM, no storage.

const STAGE_LABELS = { L1: "Connected", L2: "Seen", L3: "Switched on", L4: "Decided" };

/** One count per view that has work waiting. tone: "bad" needs someone now, "warn" needs attention, "info" is a total. */
export function navBadges({ score, dash }) {
  const out = {};
  const put = (id, n, tone, label) => { if (Number.isFinite(n) && n > 0) out[id] = { n, tone, label: `${n} ${label}` }; };
  if (!score || !dash) return out;
  put("actions", (dash.actions || []).length, "info", "open actions");
  const S = (dash.findings && dash.findings.states) || {};
  put("findings", (S.unowned || 0) + (S.no_decision || 0) + (S.expired_acceptance || 0) + (S.accepted_without_expiry || 0), "warn", "findings need a person");
  const crit = dash.burndown && dash.burndown.open ? dash.burndown.open.critical || 0 : 0;
  put("burndown", crit, "bad", "critical findings open");
  const l1 = score.stages && score.stages.L1;
  if (l1 && l1.denominator) put("accounts", l1.denominator - l1.numerator, "warn", `${(score.terms && score.terms.units) || "accounts"} not connected`);
  const stalled = dash.onboarding && dash.onboarding.stalled;
  put("onboarding", Array.isArray(stalled) ? stalled.length : Number(stalled) || 0, "warn", "connectors stuck");
  const late = (score.relationship && score.relationship.reliability && score.relationship.reliability.overdue_open) || [];
  put("commitments", late.length, "bad", "promises overdue");
  return out;
}

/** The four stages, in order, with the weakest marked: what the pulse card and Today's chart draw. */
export function stageBars(score) {
  const st = (score && score.stages) || {};
  const rows = ["L1", "L2", "L3", "L4"].filter((k) => st[k] && st[k].has_data !== false && typeof st[k].value === "number")
    .map((k) => ({ id: k, label: STAGE_LABELS[k], value: st[k].value, num: st[k].numerator, den: st[k].denominator }));
  const min = Math.min(...rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, weakest: rows.length > 1 && r.value === min }));
}

export const MAX_PINS = 6;

/** Pin or unpin a view. The newest pin goes last; past the limit the oldest one falls off. */
export function togglePin(pins, id) {
  const list = Array.isArray(pins) ? pins.filter((x) => typeof x === "string") : [];
  if (list.includes(id)) return list.filter((x) => x !== id);
  return [...list, id].slice(-MAX_PINS);
}

/** Keep only pins that are views of the open screen, in the pinned order. */
export function pinnedViews(pins, groups) {
  const all = new Map(groups.flatMap((g) => g.views).map((v) => [v.id, v]));
  return (pins || []).filter((id) => all.has(id)).map((id) => all.get(id));
}
