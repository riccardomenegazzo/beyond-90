"""How long to the next level, given the roadmap.

The maturity ladder says which checks stand between a customer and the next level. The roadmap says how Yield
moves week by week for the hours available, including the dip when new units enter the score. Put together they
answer the question a customer asks: "when are we Silver?".

Only the checks that depend on the four stages (L1 to L4 and Yield) can be followed through the roadmap, because
those are what the simulation moves. Checks about findings past their deadline, severity downgrades, licence use,
relationships and so on are listed as *outside the plan*: they need a decision or a conversation, not hours of
the same kind, and the answer says so instead of pretending the plan covers them.

A check must pass from some week to the end of the roadmap: passing for one week and then falling back during a
dip does not count.
"""

from __future__ import annotations

from typing import Any, Optional

from .rubric import OPS

STAGE_METRICS = {"l1", "l2", "l3", "l4", "yield"}


def _metric(w: Any, name: str) -> float:
    if name == "yield":
        return float(w.yield_)
    return float(w.stages[name.upper()])


def path_to_next_level(score: Any, plan: Optional[Any]) -> Optional[dict[str, Any]]:
    r = score.rubric
    if not r or not r.get("next_level") or plan is None or not plan.weeks:
        return None
    blocking = r["blocking"]
    in_plan = [c for c in blocking if c["metric"] in STAGE_METRICS]
    outside = [c for c in blocking if c["metric"] not in STAGE_METRICS]
    weeks = plan.weeks
    ok = [all(OPS[c["op"]](_metric(w, c["metric"]), c["target"]) for c in in_plan) for w in weeks]
    first: Optional[int] = None
    for i in range(len(weeks)):
        if all(ok[i:]):
            first = i
            break
    reached = first if in_plan else 0
    hours = round(sum(w.hours_used for w in weeks[: (first or 0) + 1]), 1) if first is not None else None
    dip_after = any(not ok[i] for i in range(first + 1, len(weeks))) if first is not None else False
    return {
        "level": r["next_level"],
        "checks_in_plan": [c["id"] for c in in_plan],
        "outside_plan": [{"id": c["id"], "title": c["title"]} for c in outside],
        "week": weeks[reached].week if first is not None else None,
        "hours": hours,
        "hours_per_week": plan.hours_per_week,
        "horizon_weeks": plan.horizon_weeks,
        "dip_after": dip_after,
        "no_plan_checks": not in_plan,
    }


def describe(p: Optional[dict[str, Any]]) -> list[str]:
    """Plain sentences for a report."""
    if not p:
        return []
    lv = p["level"].capitalize()
    out = []
    if p["no_plan_checks"]:
        out.append(f"None of the checks between you and {lv} can be moved by the roadmap; they need decisions or conversations.")
    elif p["week"] is None:
        out.append(f"At {p['hours_per_week']:g} hours a week the roadmap does not pass the stage checks for {lv} within {p['horizon_weeks']} weeks.")
    elif p["week"] == 0:
        out.append(f"The stage checks for {lv} already pass.")
    else:
        out.append(f"At {p['hours_per_week']:g} hours a week the roadmap passes the stage checks for {lv} in week {p['week']}, after about {p['hours']:g} hours of work.")
    if p["outside_plan"]:
        out.append("Outside the roadmap, needing a decision or a conversation: " + "; ".join(c["title"] for c in p["outside_plan"]) + ".")
    return out
