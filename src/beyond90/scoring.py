"""The score.

Yield = L1 x L2 x L3 x L4, one stage per leak in the adoption pipeline
(procurement, processing, tooling, findings). Each stage is a pass rate
whose denominator comes from an independent source. See SPEC.md.

Every function here is pure: it reads :class:`CustomerData` and returns plain
values, so the same input always gives the same score.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any, Optional

from .catalogue import Catalogue, parse_version
from .models import Account, CustomerData, Finding
from .provenance import build as build_provenance
from .quality import assess
from .relationship import compute_relationship
from .rubric import compute_rubric
from .universe import estimate_universe
from .views import adoption_views

SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
CHECKPOINTS = (0.90, 0.95, 0.98)
STAGE_NAMES = {
    "L1": "Procurement",
    "L2": "Processing",
    "L3": "Tooling",
    "L4": "Findings",
}


@dataclass
class StageResult:
    id: str
    name: str
    numerator: float
    denominator: float
    value: float
    has_data: bool
    leaks: list[dict[str, Any]] = field(default_factory=list[Any])
    notes: list[str] = field(default_factory=list)
    detail: dict[str, Any] = field(default_factory=dict[str, Any])       # extra figures a stage can offer (L3: relevant and active pairs per module)


@dataclass
class Score:
    customer: str
    as_of: str
    ceiling_version: str
    baseline_ceiling: str
    stages: dict[str, StageResult]
    yield_: float
    baseline: dict[str, Any]
    naive: Optional[float]
    reach: Optional[dict[str, Any]]
    entitlements: list[dict[str, Any]]
    outcomes: dict[str, Any]
    target: dict[str, Any]
    universe: dict[str, Any] = field(default_factory=dict[str, Any])
    relationship: Optional[dict[str, Any]] = None
    warnings: list[str] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict[str, Any])
    quality: dict[str, Any] = field(default_factory=dict[str, Any])
    terms: dict[str, Any] = field(default_factory=dict[str, Any])
    rubric: dict[str, Any] = field(default_factory=dict[str, Any])
    views: dict[str, Any] = field(default_factory=dict[str, Any])
    end_to_end: dict[str, Any] = field(default_factory=dict[str, Any])

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["yield"] = d.pop("yield_")
        return d


def _ratio(num: float, den: float) -> tuple[float, bool]:
    return (1.0, False) if den <= 0 else (num / den, True)


def _active_accounts(data: CustomerData) -> list[Account]:
    return [a for a in data.accounts if a.status == "active"]


def stage_l1(data: CustomerData) -> StageResult:
    universe = _active_accounts(data)
    connected = [a for a in universe if a.connected]
    value, has = _ratio(len(connected), len(universe))
    leaks = [
        {
            "account_id": a.id,
            "provider": a.provider,
            "owner": a.owner,
            "last_spend": a.last_spend,
            "sources": list(a.sources),
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "in_plan": a.in_plan,
        }
        for a in sorted((a for a in universe if not a.connected), key=lambda a: (-a.last_spend, a.id))
    ]
    notes = [] if has else ["No active accounts in accounts.csv; L1 is not measurable."]
    return StageResult("L1", STAGE_NAMES["L1"], len(connected), len(universe), value, has, leaks, notes)


def stage_l2(data: CustomerData, cat: Catalogue) -> StageResult:
    if not data.inventory:
        return StageResult("L2", STAGE_NAMES["L2"], 0, 0, 1.0, False, [],
                           ["No inventory rows were provided: L2 is not measured. Once inventory exists, a type with no row counts as a leak."])
    covered: set[tuple[str, str]] = {(r.account_id, r.resource_type) for r in data.inventory if r.inventoried}
    num = den = 0
    missing: dict[tuple[str, str], list[str]] = {}
    notes: list[str] = []
    unknown_providers: set[str] = set()
    for a in _active_accounts(data):
        if not a.connected:
            continue
        expected = cat.expected_types(a.provider)
        if not expected:
            unknown_providers.add(a.provider)
            continue
        for rtype in expected:
            den += 1
            if (a.id, rtype) in covered:
                num += 1
            else:
                missing.setdefault((a.provider, rtype), []).append(a.id)
    for p in sorted(unknown_providers):
        notes.append(f"Provider {p!r} has no expected resource types in the catalogue; its accounts are skipped in L2.")
    value, has = _ratio(num, den)
    if not has:
        notes.append("No connected accounts with expected resource types; L2 is not measurable.")
    leaks = [
        {"provider": p, "resource_type": t, "accounts": ids}
        for (p, t), ids in sorted(missing.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    ]
    return StageResult("L2", STAGE_NAMES["L2"], num, den, value, has, leaks, notes)


def stage_l3(data: CustomerData, cat: Catalogue, ceiling: str, *, details: bool = True) -> StageResult:
    baseline = parse_version(data.settings.baseline_ceiling)
    if not data.activations:
        return StageResult("L3", STAGE_NAMES["L3"], 0, 0, 1.0, False, [],
                           ["No module activations were provided: L3 is not measured. Once they exist, an inactive relevant module counts as a leak."])
    present: dict[str, set[str]] = {}
    for r in data.inventory:
        if r.inventoried and r.count > 0:
            present.setdefault(r.account_id, set()).add(r.resource_type)
    active = {(a.account_id, a.module_id) for a in data.activations if a.active}
    num = den = 0
    per_module: dict[str, dict[str, Any]] = {}
    modules = [(m, set(m.requires_any), set(m.providers)) for m in cat.modules_at(ceiling)]
    nothing: set[str] = set()
    for a in _active_accounts(data):
        if not a.connected:
            continue
        have = present.get(a.id, nothing)
        for m, requires, providers in modules:
            if a.provider not in providers:
                continue
            if requires and not (have & requires):
                continue
            den += 1
            is_active = (a.id, m.id) in active
            if is_active:
                num += 1
            if not details:
                continue
            entry = per_module.get(m.id)
            if entry is None:
                entry = per_module[m.id] = {
                    "module": m.id,
                    "name": m.name,
                    "since": m.since,
                    "new_since_baseline": parse_version(m.since) > baseline,
                    "relevant": 0,
                    "inactive": 0,
                    "accounts": [],
                }
            entry["relevant"] += 1
            if not is_active:
                entry["inactive"] += 1
                entry["accounts"].append(a.id)
    value, has = _ratio(num, den)
    notes = [] if has else ["No relevant module/account pairs; L3 is not measurable."]
    leaks = sorted((e for e in per_module.values() if e["inactive"]), key=lambda e: (-e["inactive"], e["module"]))
    modules_detail = {k: {"relevant": v["relevant"], "active": v["relevant"] - v["inactive"]} for k, v in per_module.items()}
    return StageResult("L3", STAGE_NAMES["L3"], num, den, value, has, leaks, notes, {"modules": modules_detail})


def _triaged(data: CustomerData) -> list[Finding]:
    window = data.settings.triage_window_days
    return [f for f in data.findings if f.closed_at is None and (data.as_of - f.opened_at).days >= window]


def classify_finding(f: Finding, as_of: date) -> str:
    """Return ``ok`` or the kind of leak: unowned, no_decision, accepted_without_expiry, expired_acceptance."""
    if not f.owner:
        return "unowned"
    if not f.decision:
        return "no_decision"
    if f.decision == "accepted_risk":
        if f.expiry is None:
            return "accepted_without_expiry"
        if f.expiry < as_of:
            return "expired_acceptance"
    return "ok"


def stage_l4(data: CustomerData) -> StageResult:
    triaged = _triaged(data)
    buckets: dict[str, list[str]] = {}
    ok = 0
    for f in triaged:
        kind = classify_finding(f, data.as_of)
        if kind == "ok":
            ok += 1
        else:
            buckets.setdefault(kind, []).append(f.id)
    value, has = _ratio(ok, len(triaged))
    notes = [] if has else ["No open findings past the triage window; L4 is not measurable and counts as 100%."]
    order = ("unowned", "no_decision", "accepted_without_expiry", "expired_acceptance")
    leaks = [{"kind": k, "count": len(buckets[k]), "ids": sorted(buckets[k])} for k in order if k in buckets]
    return StageResult("L4", STAGE_NAMES["L4"], ok, len(triaged), value, has, leaks, notes)


def compute_reach(data: CustomerData) -> Optional[dict[str, Any]]:
    teams = [t for t in data.teams if t.has_assets]
    if not teams:
        return None
    cutoff = data.as_of - timedelta(days=data.settings.access_review_days)
    n = len(teams)
    no_users = [t.id for t in teams if t.active_users <= 0]
    no_sso = [t.id for t in teams if not t.sso]
    no_rbac = [t.id for t in teams if not t.role_scoped]
    stale = [t.id for t in teams if t.last_access_review is None or t.last_access_review < cutoff]
    components = {
        "team_activation": (n - len(no_users)) / n,
        "sso_coverage": (n - len(no_sso)) / n,
        "scoped_roles": (n - len(no_rbac)) / n,
        "access_review_fresh": (n - len(stale)) / n,
    }
    return {
        "value": sum(components.values()) / len(components),
        "teams": n,
        "components": components,
        "gaps": {"no_active_user": no_users, "no_sso": no_sso, "no_scoped_role": no_rbac, "stale_access_review": stale},
    }


def account_stops(data: CustomerData, cat: Catalogue, ceiling: str) -> tuple[dict[str, Optional[str]], list[str]]:
    """For each active account, the first stage where it stops ("L1".."L4"), or None when it passes every measured stage.

    An account passes when it is connected, every expected asset type is inventoried, every relevant module is on, and
    none of its findings past triage lacks an owner or a decision. A stage with no input file is not measured and stops
    nobody; the second value lists the stages that were measured.
    """
    measured = ["L1"] + (["L2"] if data.inventory else []) + (["L3"] if data.activations else []) + ["L4"]
    covered = {(r.account_id, r.resource_type) for r in data.inventory if r.inventoried}
    present: dict[str, set[str]] = {}
    for r in data.inventory:
        if r.inventoried and r.count > 0:
            present.setdefault(r.account_id, set()).add(r.resource_type)
    active = {(x.account_id, x.module_id) for x in data.activations if x.active}
    modules = [(m, set(m.requires_any), set(m.providers)) for m in cat.modules_at(ceiling)]
    bad_findings: set[str] = {f.account_id for f in _triaged(data) if classify_finding(f, data.as_of) != "ok"}
    stops: dict[str, Optional[str]] = {}
    for a in sorted(_active_accounts(data), key=lambda a: a.id):
        if not a.connected:
            stops[a.id] = "L1"
        elif "L2" in measured and any((a.id, t) not in covered for t in cat.expected_types(a.provider)):
            stops[a.id] = "L2"
        elif "L3" in measured and any(a.provider in prov and (not req or present.get(a.id, set()) & req) and (a.id, m.id) not in active
                                      for m, req, prov in modules):
            stops[a.id] = "L3"
        elif a.id in bad_findings:
            stops[a.id] = "L4"
        else:
            stops[a.id] = None
    return stops, measured


def compute_end_to_end(data: CustomerData, cat: Catalogue, ceiling: str) -> dict[str, Any]:
    """The same chain on one unit: the share of accounts that pass every stage, and where each other one first stops.

    Yield multiplies four ratios measured on different units (accounts, account and asset type pairs, account and module
    pairs, findings), so it is not the share of accounts that make it all the way. This is. See account_stops.
    """
    stops, measured = account_stops(data, cat, ceiling)
    first: dict[str, list[str]] = {"L1": [], "L2": [], "L3": [], "L4": []}
    for aid, st in stops.items():
        if st:
            first[st].append(aid)
    total = len(stops)
    through = sum(1 for st in stops.values() if st is None)
    return {
        "total": total,
        "through": through,
        "value": through / total if total else None,
        "measured": measured,
        "first_break": {k: len(v) for k, v in first.items()},
        "examples": {k: v[:5] for k, v in first.items() if v},
    }


def compute_naive(data: CustomerData) -> Optional[float]:
    plan = [a for a in data.accounts if a.in_plan]
    if not plan:
        return None
    return sum(1 for a in plan if a.connected) / len(plan)


def compute_entitlements(data: CustomerData) -> list[dict[str, Any]]:
    target = data.settings.entitlement_target
    out = []
    for e in data.entitlements:
        util = e.used / e.licensed
        out.append(
            {
                "unit": e.unit,
                "licensed": e.licensed,
                "used": e.used,
                "utilization": util,
                "target": target,
                "below_target": util < target,
                "over_licensed_use": util > 1.0,
                "unused": max(e.licensed - e.used, 0.0),
            }
        )
    return out


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile: always one of the observed values, never an interpolated one that nobody lived."""
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * q // 100))        # ceil(n * q / 100) without floats
    return float(ordered[int(rank) - 1])


def compute_outcomes(data: CustomerData) -> dict[str, Any]:
    s = data.settings
    sla = s.sla_days
    open_f = [f for f in data.findings if f.closed_at is None]
    crit_open = [f for f in open_f if f.severity == "critical" and f.decision != "false_positive"]

    lookback = data.as_of - timedelta(days=s.mttr_lookback_days)
    closed = [(f, f.closed_at) for f in data.findings if f.closed_at is not None and f.closed_at >= lookback]
    mttr: dict[str, dict[str, Any]] = {}
    for f, closed_at in closed:
        days = (closed_at - f.opened_at).days
        for key in (f.severity, f"{f.severity}/{f.exposure}"):
            mttr.setdefault(key, {"days": []})["days"].append(days)
    mttr = {
        k: {"median_days": percentile(v["days"], 50), "p90_days": percentile(v["days"], 90),
            "mean_days": _mean(v["days"]), "n": len(v["days"])}
        for k, v in sorted(mttr.items())
    }

    crit_closed = sorted(
        ((f, f.closed_at) for f in data.findings if f.severity == "critical" and f.closed_at is not None),
        key=lambda fc: (fc[1], fc[0].id),
        reverse=True,
    )
    streak = 0
    for f, closed_at in crit_closed:
        if (closed_at - f.opened_at).days <= sla["critical"]:
            streak += 1
        else:
            break

    overdue = dict.fromkeys(sla, 0)
    for f in open_f:
        if (data.as_of - f.opened_at).days > sla[f.severity]:
            overdue[f.severity] += 1

    suspects: list[dict[str, Any]] = []
    for f in data.findings:
        if not (f.previous_severity and f.severity_changed_at):
            continue
        if SEVERITY_RANK[f.previous_severity] <= SEVERITY_RANK[f.severity]:
            continue
        deadline = f.opened_at + timedelta(days=sla[f.previous_severity])
        delta = (deadline - f.severity_changed_at).days
        if -s.downgrade_window_days <= delta <= s.downgrade_window_days:
            suspects.append(
                {
                    "finding_id": f.id,
                    "from": f.previous_severity,
                    "to": f.severity,
                    "changed_at": f.severity_changed_at.isoformat(),
                    "sla_deadline": deadline.isoformat(),
                    "days_from_deadline": delta,
                }
            )
    suspects.sort(key=lambda x: x["finding_id"])

    return {
        "findings_total": len(data.findings),
        "critical_open": len(crit_open),
        "zero_critical": (len(crit_open) == 0) if data.findings else None,
        "mttr": mttr,
        "mttr_streak": streak,
        "overdue_by_severity": overdue,
        "reclassification_suspects": suspects,
    }


def next_target(y: float) -> dict[str, Any]:
    nxt = next((c for c in CHECKPOINTS if c > y + 1e-12), None)
    if y < CHECKPOINTS[-1]:
        return {"value": min(1.0, max(CHECKPOINTS[0], y + 0.05)), "mode": "raise", "next_checkpoint": nxt}
    return {"value": 1.0, "mode": "hold", "next_checkpoint": None}


def compute_score(data: CustomerData, cat: Optional[Catalogue] = None, ceiling: Optional[str] = None) -> Score:
    cat = cat or Catalogue.load()
    ceiling = ceiling or data.settings.ceiling_version
    baseline = data.settings.baseline_ceiling
    if parse_version(baseline) > parse_version(ceiling):
        baseline = ceiling
    l1, l2, l4 = stage_l1(data), stage_l2(data, cat), stage_l4(data)
    l3 = stage_l3(data, cat, ceiling)
    l3_base = stage_l3(data, cat, baseline)
    y = l1.value * l2.value * l3.value * l4.value
    y_base = l1.value * l2.value * l3_base.value * l4.value
    warnings: list[str] = []
    for st in (l1, l2, l3, l4):
        warnings.extend(st.notes)
    score = Score(
        customer=data.name,
        as_of=data.as_of.isoformat(),
        ceiling_version=ceiling,
        baseline_ceiling=baseline,
        stages={"L1": l1, "L2": l2, "L3": l3, "L4": l4},
        yield_=y,
        baseline={"ceiling": baseline, "l3": l3_base.value, "yield": y_base},
        naive=compute_naive(data),
        reach=compute_reach(data),
        entitlements=compute_entitlements(data),
        outcomes=compute_outcomes(data),
        target=next_target(y),
        universe={**estimate_universe(data, cat.terms), "unit": cat.terms["unit"], "units": cat.terms["units"]},
        relationship=compute_relationship(data),
        warnings=warnings,
        quality=assess(data, cat.terms),
        terms=dict(cat.terms),
        provenance=build_provenance(data.inputs, cat.digest, ceiling, baseline, data.schema_version, cat.profile) if data.inputs else {},
    )
    score.end_to_end = compute_end_to_end(data, cat, ceiling)
    score.rubric = compute_rubric(score, data, cat.rubric)
    score.views = adoption_views(score, cat)
    return score
