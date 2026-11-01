"""A maturity ladder made of checks.

Percentages hide a failing important check behind a good average. A ladder does not: a customer is at a
level only when every check at that level and below passes, so passing every gold check but one still
leaves them at silver, and the one check left is the next thing to do. This is the model engineering
scorecards use (bronze, silver, gold), applied to adoption.

* Level names are fixed (basic, bronze, silver, gold), so customers and profiles compare like with like.
  The checks and thresholds are not: a profile may ship its own ``rubric.json``.
* A check's *risk weight* is the level it sits at. A check that must never fail goes at bronze.
* A check whose metric cannot be measured (no findings file, no contacts) is reported as not measured. It
  neither passes nor blocks, and the level is labelled provisional while any such check sits at or below the
  next level.
* Every check carries the value measured, so you can apply a policy of your own to the raw numbers.

The check language is data, not code: ``metric``, ``op`` and ``value`` over the metrics below.
"""

from __future__ import annotations

import operator
from collections.abc import Callable
from datetime import timedelta
from typing import Any, Optional

from .models import CustomerData

LEVELS = ("basic", "bronze", "silver", "gold")        # basic = below bronze
OPS: dict[str, Callable[[float, float], bool]] = {">=": operator.ge, ">": operator.gt, "<=": operator.le, "<": operator.lt, "==": operator.eq}
METRICS = (
    "independent_sources", "l1", "l2", "l3", "l4", "yield", "unseen_share", "critical_open", "critical_unowned", "critical_overdue",
    "mttr_p90_ratio", "downgrade_suspects", "min_utilization", "reach", "quality_weak", "sponsor", "reliability_rate", "overdue_commitments",
)


def validate(rubric: dict) -> None:
    levels = rubric.get("levels")
    if levels != ["bronze", "silver", "gold"]:
        raise ValueError("rubric: levels must be exactly bronze, silver, gold (names are fixed so results compare)")
    seen: set[str] = set()
    for c in rubric.get("checks", []):
        for key in ("id", "level", "title", "metric", "op", "value"):
            if key not in c:
                raise ValueError(f"rubric: a check is missing {key!r}: {c}")
        if c["id"] in seen:
            raise ValueError(f"rubric: duplicate check id {c['id']!r}")
        seen.add(c["id"])
        if c["level"] not in levels:
            raise ValueError(f"rubric: check {c['id']!r} has unknown level {c['level']!r}")
        if c["metric"] not in METRICS:
            raise ValueError(f"rubric: check {c['id']!r} uses unknown metric {c['metric']!r}; known: {', '.join(METRICS)}")
        if c["op"] not in OPS:
            raise ValueError(f"rubric: check {c['id']!r} uses unknown operator {c['op']!r}")
        if not isinstance(c["value"], (int, float)) or isinstance(c["value"], bool):
            raise ValueError(f"rubric: check {c['id']!r} needs a numeric value")


def metrics(score: Any, data: CustomerData) -> dict[str, Optional[float]]:
    """Every metric a check may use. None means not measured."""
    st = score.stages
    sla_critical = data.settings.sla_days["critical"]
    crit = [f for f in data.findings if f.closed_at is None and f.severity == "critical" and f.decision != "false_positive"]
    have_findings = bool(data.findings)
    mttr = score.outcomes.get("mttr", {}).get("critical")
    u = score.universe or {}
    rel = score.relationship
    out: dict[str, Optional[float]] = {
        "independent_sources": float(len(u.get("sources", []))),
        "l1": st["L1"].value if st["L1"].has_data else None,
        "l2": st["L2"].value if st["L2"].has_data else None,
        "l3": st["L3"].value if st["L3"].has_data else None,
        "l4": st["L4"].value if st["L4"].has_data else None,
        "yield": score.yield_ if all(s.has_data for s in st.values()) else None,
        "unseen_share": (1.0 - u["completeness"]) if u.get("estimable") else None,
        "critical_open": float(len(crit)) if have_findings else None,
        "critical_unowned": float(sum(1 for f in crit if not f.owner)) if have_findings else None,
        "critical_overdue": float(sum(1 for f in crit if f.opened_at < data.as_of - timedelta(days=sla_critical))) if have_findings else None,
        "mttr_p90_ratio": (mttr["p90_days"] / sla_critical) if mttr and sla_critical else None,
        "downgrade_suspects": float(len(score.outcomes.get("reclassification_suspects", []))) if have_findings else None,
        "min_utilization": min((e["utilization"] for e in score.entitlements), default=None),
        "reach": score.reach["value"] if score.reach else None,
        "quality_weak": float(score.quality.get("weak", 0)) if score.quality else None,
        "sponsor": (0.0 if rel["gaps"]["no_executive_sponsor"] else 1.0) if rel else None,
        "reliability_rate": rel["reliability"]["rate"] if rel else None,
        "overdue_commitments": float(len(rel["gaps"]["overdue_commitments"])) if rel else None,
    }
    return out


def evaluate(rubric: dict, m: dict[str, Optional[float]]) -> dict[str, Any]:
    levels = rubric["levels"]
    checks = []
    for c in rubric["checks"]:
        v = m.get(c["metric"])
        status = "not_measured" if v is None else ("pass" if OPS[c["op"]](v, c["value"]) else "fail")
        checks.append({"id": c["id"], "level": c["level"], "title": c["title"], "metric": c["metric"], "op": c["op"], "target": c["value"],
                       "value": v, "status": status, "playbooks": list(c.get("playbooks", []))})
    achieved = "basic"
    for lv in levels:
        if all(c["status"] != "fail" for c in checks if c["level"] == lv):
            achieved = lv
        else:
            break
    order = ["basic", *levels]
    next_level = order[order.index(achieved) + 1] if achieved != "gold" else None
    blocking = [c for c in checks if c["level"] == next_level and c["status"] == "fail"] if next_level else []
    unmeasured = [c for c in checks if c["status"] == "not_measured" and (next_level is None or order.index(c["level"]) <= order.index(next_level))]
    per_level = []
    for lv in levels:
        cs = [c for c in checks if c["level"] == lv]
        per_level.append({"level": lv, "passed": sum(c["status"] == "pass" for c in cs), "failed": sum(c["status"] == "fail" for c in cs),
                          "not_measured": sum(c["status"] == "not_measured" for c in cs), "total": len(cs)})
    return {"level": achieved, "next_level": next_level, "provisional": bool(unmeasured), "blocking": blocking, "unmeasured": unmeasured,
            "levels": per_level, "checks": checks}


def compute_rubric(score: Any, data: CustomerData, rubric: dict) -> dict[str, Any]:
    return evaluate(rubric, metrics(score, data))
