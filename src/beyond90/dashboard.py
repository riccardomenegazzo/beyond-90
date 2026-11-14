"""Structured data for the browser dashboard: everything a chart or a table needs, as plain JSON.

The reports are text; a dashboard needs numbers it can sort, filter and draw. Nothing here is a new measure: every
figure comes from the stages, the plan and the other modules, reshaped. The lists are capped so a very large estate
cannot make the page unusable, and the cap is said in the data (``truncated``).
"""

from __future__ import annotations

import dataclasses
import json
from collections.abc import Iterable
from datetime import date
from typing import Any, Optional

from .catalogue import Catalogue
from .models import CustomerData
from .planner import Plan
from .scoring import Score, account_stops, classify_finding

ACCOUNT_CAP = 3000
FINDING_CAP = 3000
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _default(o: Any) -> Any:
    return dataclasses.asdict(o) if dataclasses.is_dataclass(o) and not isinstance(o, type) else str(o)


def _plain(x: Any) -> Any:
    """JSON-safe copy: dataclasses (at any depth) become dicts, dates become text."""
    return json.loads(json.dumps(x, default=_default))


def plan_data(plan: Plan) -> dict[str, Any]:
    return {
        "hours_per_week": plan.hours_per_week,
        "horizon_weeks": plan.horizon_weeks,
        "realization": plan.realization,
        "weeks": [{"week": w.week, "yield": w.yield_, "stages": w.stages, "hours": w.hours_used, "events": w.events[:3]} for w in plan.weeks],
        "jobs": [_plain(j) for j in plan.jobs[:40]],
        "milestones": plan.milestones,
        "dips": _plain(plan.dips),
        "residual": plan.residual,
        "notes": plan.notes,
    }


def accounts_table(data: CustomerData, score: Score, cat: Catalogue) -> dict[str, Any]:
    missing: dict[str, list[str]] = {}
    for leak in score.stages["L2"].leaks:
        for aid in leak["accounts"]:
            missing.setdefault(aid, []).append(leak["resource_type"])
    off: dict[str, list[str]] = {}
    for leak in score.stages["L3"].leaks:
        for aid in leak["accounts"]:
            off.setdefault(aid, []).append(leak["name"])
    open_by: dict[str, list[Any]] = {}
    for f in data.findings:
        if f.closed_at is None:
            open_by.setdefault(f.account_id, []).append(f)
    stops, _ = account_stops(data, cat, score.ceiling_version)
    rows: list[dict[str, Any]] = []
    for a in data.accounts:
        if a.status != "active":
            continue
        fs = open_by.get(a.id, [])
        rows.append({
            "id": a.id, "provider": a.provider, "owner": a.owner, "spend": a.last_spend, "connected": a.connected,
            "sources": list(a.sources), "in_plan": a.in_plan,
            "missing_types": sorted(missing.get(a.id, [])), "inactive_modules": sorted(off.get(a.id, [])),
            "open_findings": len(fs), "open_critical": sum(1 for f in fs if f.severity == "critical"),
            "issues": (0 if a.connected else 1) + len(missing.get(a.id, [])) + len(off.get(a.id, [])),
            "stop": stops.get(a.id) or "",
        })
    rows.sort(key=lambda r: (-r["issues"], -r["spend"], r["id"]))
    return {"rows": rows[:ACCOUNT_CAP], "total": len(rows), "truncated": len(rows) > ACCOUNT_CAP,
            "providers": sorted({r["provider"] for r in rows}), "owners": sorted({r["owner"] for r in rows if r["owner"]})}


def findings_table(data: CustomerData) -> dict[str, Any]:
    window = data.settings.triage_window_days
    rows: list[dict[str, Any]] = []
    for f in data.findings:
        if f.closed_at is not None:
            continue
        age = (data.as_of - f.opened_at).days
        triaged = age >= window
        rows.append({
            "id": f.id, "account": f.account_id, "severity": f.severity, "exposure": f.exposure, "age_days": age,
            "owner": f.owner, "decision": f.decision, "expiry": f.expiry.isoformat() if f.expiry else "",
            "state": classify_finding(f, data.as_of) if triaged else "in_window",
        })
    rows.sort(key=lambda r: (r["state"] in ("ok", "in_window"), SEVERITY_ORDER.get(r["severity"], 9), -r["age_days"], r["id"]))
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["state"]] = counts.get(r["state"], 0) + 1
    return {"rows": rows[:FINDING_CAP], "total": len(rows), "truncated": len(rows) > FINDING_CAP, "states": counts, "triage_window_days": window}


def attribution_data(a: Any) -> Optional[dict[str, Any]]:
    if a is None:
        return None
    d = _plain(a)
    return d if isinstance(d, dict) else None


def build(data: CustomerData, score: Score, cat: Catalogue, plan: Plan, extras: dict[str, Any], actions: Iterable[Any]) -> dict[str, Any]:
    from .unlocks import unlocks

    actions = list(actions)
    gain = unlocks(data, cat, score.ceiling_version, actions)
    acts = [{"id": a.id, "leak": a.leak, "title": a.title, "detail": a.detail, "effect": a.effect_points, "hours": a.effort_hours,
             "owner": a.owner, "due": str(a.due), "steps": list(a.steps), "success": a.success, "question": a.question,
             "commit": a.we_commit, "expansion": a.cross_sell, "unlocks": gain.get(a.id)} for a in actions]
    return {
        "plan": plan_data(plan),
        "accounts": accounts_table(data, score, cat),
        "findings": findings_table(data),
        "actions": acts,
        "attribution": attribution_data(extras.get("attribution")),
        "renewal": _plain(extras.get("renewal")),
        "ladder": _plain(extras.get("ladder")),
        "forecast": _plain(extras.get("forecast")),
        "drift": _plain(extras.get("drift")),
        "candor": _plain(extras.get("candor")),
        "rhythm": _plain(extras.get("rhythm")),
        "onboarding": _plain(extras.get("onboarding")),
        "outlook": _plain(extras.get("outlook")),
        "stake": _plain(extras.get("stake")),
        "impact": _plain(extras.get("impact")),
        "teams": _plain(extras.get("teams")),
        "burndown": _plain(extras.get("burndown")),
        "graph": _plain(extras.get("graph")),
        "health": _plain(extras.get("health")),
        "as_of": date.fromisoformat(str(score.as_of)).isoformat(),
    }
