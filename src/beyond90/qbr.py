"""Quarterly business review draft, structured with the Pyramid Principle.

Answer first, then three supporting arguments, then the evidence under each,
then the decisions asked of the customer. The draft is written from the score
only; the TAM adds the customer's own goals and wins before presenting it.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

from .attribution import Attribution
from .planner import Plan
from .playbooks import Action
from .report import pct, pts
from .scoring import STAGE_NAMES, Score
from .sections import md_plan

LEAK_LABEL = {
    "L1": "Accounts outside the platform",
    "L2": "Resource types we cannot see",
    "L3": "Controls that are not switched on",
    "L4": "Findings with no owner or decision",
    "Reach": "Teams that do not use it yet",
    "Entitlement": "Licensed capacity that is not in use",
}


def render_qbr(score: Score, actions: list[Action], previous: Optional[dict] = None, quarter: str = "", *,
               attribution: Optional[Attribution] = None, forecast: Optional[dict] = None, plan: Optional[Plan] = None) -> str:
    title = f"Quarterly business review: {score.customer}" + (f", {quarter}" if quarter else "")
    by_leak: dict[str, list[Action]] = defaultdict(list)
    for a in actions:
        by_leak[a.leak].append(a)
    ranked = sorted(by_leak.items(), key=lambda kv: (-sum(a.effect_points for a in kv[1]), -len(kv[1]), kv[0]))
    ranked = [(k, v) for k, v in ranked if v][:3]
    top_gain = sum(sum(a.effect_points for a in v) for k, v in ranked)
    projected = min(1.0, score.yield_ + top_gain / 100.0)

    L = [f"# {title}", "", f"_As of {score.as_of}, ceiling {score.ceiling_version}. Draft generated from the score; add the customer's goals and wins before presenting._", ""]

    # 1. The answer.
    L += ["## The answer", ""]
    real = f"Real adoption is **{pct(score.yield_)}**"
    if score.naive is not None and score.naive > score.yield_ + 1e-9:
        real += f", not the {pct(score.naive)} the legacy metric shows"
    real += "."
    L.append(real)
    if attribution:
        L.append(f"It moved {attribution.delta_points:+.1f} points since {attribution.from_as_of}: the customer moved {attribution.customer_points:+.1f}, "
                 f"the bar moved {attribution.bar_points:+.1f}" + (" (new capabilities raised the denominator)." if attribution.bar_points < -0.05 else "."))
    elif previous:
        L.append(f"It moved {pts(score.yield_ - previous['yield'])} since {previous['as_of']}.")
    if plan and plan.jobs:
        ms = plan.milestones
        first = next(((k, v) for k, v in ms.items() if v is not None), None)
        L.append(f"At {plan.hours_per_week:g} hours a week the plan reaches **{pct(plan.end_yield)}** in {len(plan.weeks) - 1} weeks"
                 + (f", with the {first[0]} checkpoint in week {first[1]}." if first else "."))
        if plan.dips:
            d = plan.dips[0]
            L.append(f"**Expect a dip first:** in week {d['week']} Yield falls {d['drop_points']:.1f} points because newly connected accounts enter the score with nothing covered yet. "
                     "That is the cost of seeing them, not a regression.")
    elif ranked:
        L.append(
            f"Acting on the three biggest gaps below is worth an estimated {top_gain:.1f} points and would take it to about **{pct(projected)}**."
        )
        if score.target["next_checkpoint"]:
            L.append(f"The next checkpoint is {pct(score.target['next_checkpoint'], 0)}.")
    else:
        L.append("No open gaps were found at this ceiling. The job now is to keep the level as the estate grows and the product ships.")
    u = score.universe
    if u and u.get("estimable") and u["unseen_estimate"] >= 1:
        L.append(f"One caveat: about {u['unseen_estimate']:.0f} account(s) are probably known to no source at all; if they are unconnected, L1 is {pct(u['pessimistic_l1'])}.")
    L.append("")

    # 2. Three arguments.
    if ranked:
        L += ["## Three reasons", ""]
        for i, (leak, items) in enumerate(ranked, 1):
            gain = sum(a.effect_points for a in items)
            label = LEAK_LABEL.get(leak, leak)
            L.append(f"{i}. **{label}.** {len(items)} open action(s)" + (f", worth about {gain:.1f} points" if gain else "") + ".")
            for a in items[:3]:
                L.append(f"   - {a.title}: {a.detail}")
        L.append("")

    # 3. Evidence.
    L += ["## Evidence", "", "| Stage | Pass rate | Count |", "|---|---|---|"]
    for sid in ("L1", "L2", "L3", "L4"):
        st = score.stages[sid]
        L.append(f"| {sid} {STAGE_NAMES[sid]} | {pct(st.value)} | {st.numerator:g} / {st.denominator:g} |")
    L.append(f"| **Yield** | **{pct(score.yield_)}** | |")
    L.append("")
    if score.baseline["ceiling"] != score.ceiling_version:
        L.append(
            f"Against the baseline ceiling ({score.baseline['ceiling']}) Yield is {pct(score.baseline['yield'])}. "
            "The gap is new capability released since then: more headroom, not a step back."
        )
        L.append("")
    o = score.outcomes
    if o["findings_total"]:
        line = f"Critical findings open: {o['critical_open']}."
        if o["zero_critical"]:
            line += " Zero critical status."
        line += f" Consecutive critical fixes within SLA: {o['mttr_streak']}."
        if "critical" in o["mttr"]:
            line += f" Mean time to remediate critical: {o['mttr']['critical']['mean_days']:.1f} days."
        L += [line, ""]
    if score.reach:
        L += [f"Reach: {pct(score.reach['value'])} across {score.reach['teams']} teams with cloud assets.", ""]
    low = [e for e in score.entitlements if e["below_target"]]
    if low:
        L.append("Licensed capacity below target: " + "; ".join(f"{e['unit']} {e['used']:g}/{e['licensed']:g} ({e['utilization']:.0%})" for e in low) + ".")
        L.append("")

    # 4. Plan and asks.
    L += ["## Plan for next quarter", "", "| Action | Owner | Due | Done when |", "|---|---|---|---|"]
    for a in actions[:5]:
        L.append(f"| {a.title} | {a.owner} | {a.due} | {a.success} |")
    L.append("")
    if plan and plan.jobs:
        L += md_plan(plan, top=8)
    if forecast and forecast.get("available"):
        if forecast["state"] == "open":
            z = forecast["p_zero_within"]
            L += ["## Zero critical", "", f"{forecast['open_critical']} critical finding(s) are open and {forecast['arrivals_per_week']} new ones arrive per week. "
                  f"Probability of reaching zero within 30 / 60 / 90 days: {z['30']:.0%} / {z['60']:.0%} / {z['90']:.0%} on the current pace.", ""]
        else:
            L += ["## Zero critical", "", f"Zero critical today. A new critical appears within 30 days with probability {forecast['p_new_critical_30d']:.0%}; "
                  f"staying at zero means closing each one within about {forecast['median_days_to_recover']} days.", ""]
    if o["reclassification_suspects"]:
        L += ["## Risks", "", f"- {len(o['reclassification_suspects'])} severity downgrade(s) landed close to an SLA deadline. Until reviewed, remediation times may look better than they are.", ""]
    L += ["## Decisions we need today", ""]
    if ranked:
        for a in [items[0] for _, items in ranked]:
            L.append(f"- Name an owner and a date for: {a.title}.")
    else:
        L.append("- None. Confirm the next review date.")
    L.append("")
    return "\n".join(L)
