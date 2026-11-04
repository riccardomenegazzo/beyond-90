"""A success plan the customer can sign.

The working artefact of customer success is a short document both sides agree to: the outcomes that matter,
how progress will be measured, what happens by when, who does what, and what could get in the way. This builds
a first draft from the data (the weakest use cases, the next maturity checks, the ranked actions and the
roadmap), so the conversation starts from evidence. It contains nothing private: no relationship ratings, no
renewal signals; those stay in the QBR's "for you only" section.
"""

from __future__ import annotations

from typing import Any, Optional

from .planner import Plan
from .playbooks import Action
from .report import pct
from .scoring import Score

TARGET_USE_CASE = 0.9


def _weeks_for(plan: Optional[Plan], day: int) -> Optional[Any]:
    if not plan or not plan.weeks:
        return None
    wk = min(day // 7, len(plan.weeks) - 1)
    return plan.weeks[wk]


def render_success_plan(score: Score, actions: list[Action], plan: Optional[Plan] = None, owner: str = "", review: str = "every month") -> str:
    units = score.terms.get("units", "accounts")
    L = [f"# Success plan: {score.customer}", "",
         (f"_Draft prepared {score.as_of}, ceiling {score.ceiling_version}. Owner on our side: {owner or '[name]'}. Review: {review}. "
         "Everything below comes from the data we share; change anything that does not match your priorities before you sign._"), ""]

    # Outcomes: the thinnest use cases first, then the weakest stage.
    L += ["## Outcomes we are working toward", ""]
    outcomes = []
    if score.views:
        for u in [u for u in score.views["use_cases"] if u["state"] != "deep"][:3]:
            outcomes.append((f"Bring **{u['label']}** from {u['rate']:.0%} to {TARGET_USE_CASE:.0%} of the capability that applies",
                             f"{u['active']} of {u['relevant']} in use today" + (f"; biggest gap: {u['biggest_gap']}" if u["biggest_gap"] else "")))
    measured = [(sid, st) for sid, st in score.stages.items() if st.has_data and st.value < 0.95]
    if measured:
        sid, st = min(measured, key=lambda kv: kv[1].value)
        label = {"L1": f"Connect every {score.terms.get('unit', 'account')} we know about", "L2": "See every expected asset type",
                 "L3": "Switch on the capabilities that apply", "L4": "Give every finding an owner and a decision"}[sid]
        outcomes.append((f"{label} (now {st.value:.0%}, target 95%)", f"{st.numerator:g} of {st.denominator:g}"))
    if not outcomes:
        outcomes.append(("Keep the current level as the estate grows and the product ships", "No open gaps at this ceiling"))
    L += [f"{i}. {t} ({d})." for i, (t, d) in enumerate(outcomes, 1)] + [""]

    # Measures.
    L += ["## How we will measure progress", "", "| Measure | Now | Target |", "|---|---|---|"]
    L.append(f"| Yield (real adoption, all four stages) | {pct(score.yield_)} | {pct(plan.end_yield) if plan else pct(score.target['value'])}"
             + (f" after {len(plan.weeks) - 1} weeks" if plan else "") + " |")
    if score.rubric and score.rubric.get("checks"):
        r = score.rubric
        L.append(f"| Maturity level | {r['level'].capitalize()} | " + (f"{r['next_level'].capitalize()} ({len(r['blocking'])} check(s) to pass)" if r["next_level"] else "hold") + " |")
        for c in r["blocking"][:4]:
            from .sections import _fmt_metric, _fmt_target
            L.append(f"| {c['title']} | {_fmt_metric(c['metric'], c['value'])} | {_fmt_target(c)} |")
    for sid, st in score.stages.items():
        if st.has_data:
            L.append(f"| {sid} {st.name} | {pct(st.value)} | {pct(min(1.0, max(st.value, 0.95)))} |")
    L += ["", f"The score is measured against {units} and asset types from independent lists, not from the platform's own inventory, and it records the hash of the files it came from.", ""]

    # Milestones.
    if plan and plan.weeks:
        L += ["## Milestones", "", "| By | Expected Yield | What moves |", "|---|---|---|"]
        for day in (30, 60, 90):
            w = _weeks_for(plan, day)
            if w is not None:
                done = "; ".join(w.completed[:2]) or "-"
                L.append(f"| Day {day} | {pct(w.yield_)} | {done} |")
        L += ["", "A model, not a promise: it rests on the hours available and on each action succeeding as assumed.", ""]

    # Actions.
    yield_actions = [a for a in actions if a.leak in ("L1", "L2", "L3", "L4")][:8]
    L += ["## Who does what", "", "| Action | Owner | Due | Effort | Done when |", "|---|---|---|---|---|"]
    for a in yield_actions:
        L.append(f"| {a.title} | {a.owner} | {a.due} | {a.effort_hours:g} h | {a.success} |")
    L.append("")

    # Decisions and commitments.
    L += ["## What we need from you", ""]
    L += [f"- A named owner and a date for: {a.title}." for a in yield_actions[:4]] or ["- Nothing today."]
    L += ["", "## What we commit to", ""]
    L += [f"- We will {a.we_commit}." for a in [x for x in yield_actions if x.we_commit][:3]]
    L += ["- We will send a written recap within two working days of every review, and tell you early if a date is going to move.", ""]

    # Risks.
    L += ["## What could get in the way", ""]
    risks = []
    if plan and plan.dips:
        d = plan.dips[0]
        risks.append(f"The score will dip around week {d['week']} (about {d['drop_points']:.1f} points) because newly connected {units} enter it with nothing covered yet. That is the cost of seeing them.")
    if plan and plan.residual:
        risks.append("Some work is assumed to stay blocked and needs escalation rather than more effort: " + "; ".join(f"{n} {k}" for k, n in plan.residual.items()) + ".")
    u = score.universe
    if u and u.get("estimable") and u["unseen_estimate"] >= 1:
        risks.append(f"About {u['unseen_estimate']:.0f} {score.terms.get('unit', 'account')}(s) may be known to none of our lists; finding them may lower the starting point.")
    if score.quality and score.quality.get("weak"):
        risks.append("Some of the input files are weak (see the report), so some figures are provisional.")
    L += [f"- {r}" for r in risks] or ["- None identified."]
    L += ["", "## Agreed", "", "| | Name | Date |", "|---|---|---|", "| Customer sponsor | | |", "| Customer owner | | |", f"| {owner or 'Our owner'} | | |", ""]
    return "\n".join(L)
