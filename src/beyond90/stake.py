"""Coverage weighted by what is at stake, next to coverage by count.

Yield counts accounts, resource types, capabilities and findings as equals. A customer with 90% of accounts connected
may still leave a third of its cloud spend unwatched, and an L4 of 90% may hide the one internet-facing critical finding
that nobody owns. This module asks the same four questions with weights the customer already pays for or is exposed by:

* L1, L2 and L3 by **spend**: each account weighs its last billed spend (equal weights when no spend is known).
* L4 by **severity and exposure**: critical 8, high 4, medium 2, low 1, doubled when the finding is internet-facing.

The weights are plain and printed. The result is a second number, not a replacement: when the two disagree, the
weighted one says where the gap matters, and ``heaviest`` names the accounts and findings that carry it.
"""

from __future__ import annotations

from typing import Any

from .catalogue import Catalogue
from .models import CustomerData
from .scoring import Score, classify_finding

SEVERITY_WEIGHT = {"critical": 8, "high": 4, "medium": 2, "low": 1}
EXPOSURE_FACTOR = {"internet": 2.0}


def _ratio(num: float, den: float) -> float:
    return 1.0 if den <= 0 else num / den


def weighted(data: CustomerData, score: Score, cat: Catalogue) -> dict[str, Any]:
    active = [a for a in data.accounts if a.status == "active"]
    spend_known = any(a.last_spend > 0 for a in active)
    w = {a.id: (a.last_spend if spend_known else 1.0) for a in active}
    total = sum(w.values())
    l1 = _ratio(sum(w[a.id] for a in active if a.connected), total)

    covered = {(r.account_id, r.resource_type) for r in data.inventory if r.inventoried}
    present: dict[str, set[str]] = {}
    for r in data.inventory:
        if r.inventoried and r.count > 0:
            present.setdefault(r.account_id, set()).add(r.resource_type)
    on = {(x.account_id, x.module_id) for x in data.activations if x.active}
    modules = cat.modules_at(data.settings.ceiling_version)
    l2n = l2d = l3n = l3d = 0.0
    per_acc: list[dict[str, Any]] = []
    for a in active:
        if not a.connected:
            per_acc.append({"id": a.id, "provider": a.provider, "owner": a.owner, "spend": a.last_spend, "share": w[a.id] / total if total else 0.0, "gap": "not connected", "lost": 1.0})
            continue
        exp = cat.expected_types(a.provider)
        f2 = _ratio(sum(1 for t in exp if (a.id, t) in covered), len(exp)) if exp and data.inventory else 1.0
        rel = [m for m in modules if a.provider in m.providers and (not m.requires_any or present.get(a.id, set()) & set(m.requires_any))]
        f3 = _ratio(sum(1 for m in rel if (a.id, m.id) in on), len(rel)) if rel and data.activations else 1.0
        if exp and data.inventory:
            l2n, l2d = l2n + w[a.id] * f2, l2d + w[a.id]
        if rel and data.activations:
            l3n, l3d = l3n + w[a.id] * f3, l3d + w[a.id]
        lost = 1 - f2 * f3
        if lost > 1e-9:
            per_acc.append({"id": a.id, "provider": a.provider, "owner": a.owner, "spend": a.last_spend, "share": w[a.id] / total if total else 0.0,
                            "gap": f"inventory {f2:.0%}, capabilities {f3:.0%}", "lost": lost})
    l2, l3 = _ratio(l2n, l2d), _ratio(l3n, l3d)

    window = data.settings.triage_window_days
    tri = [f for f in data.findings if f.closed_at is None and (data.as_of - f.opened_at).days >= window]
    fw = {f.id: SEVERITY_WEIGHT.get(f.severity, 1) * EXPOSURE_FACTOR.get(f.exposure, 1.0) for f in tri}
    bad = [f for f in tri if classify_finding(f, data.as_of) != "ok"]
    l4 = _ratio(sum(fw.values()) - sum(fw[f.id] for f in bad), sum(fw.values()))

    value = l1 * l2 * l3 * l4
    stages = {"L1": l1, "L2": l2, "L3": l3, "L4": l4}
    count = {k: score.stages[k].value for k in stages}
    per_acc.sort(key=lambda r: (-float(r["share"]) * float(r["lost"]), str(r["id"])))
    bad_sorted = sorted(bad, key=lambda f: (-fw[f.id], f.id))
    heavy_findings: list[dict[str, Any]] = [{"id": f.id, "account": f.account_id, "severity": f.severity, "exposure": f.exposure, "weight": fw[f.id],
                                             "state": classify_finding(f, data.as_of)} for f in bad_sorted]
    unconnected_share = sum(w[a.id] for a in active if not a.connected) / total if total else 0.0
    differs = {k: round((stages[k] - count[k]) * 100, 1) for k in stages if abs(stages[k] - count[k]) >= 0.01}
    say = []
    if abs(l1 - count["L1"]) >= 0.02:
        say.append(f"By count {count['L1']:.0%} of accounts are connected; by spend {l1:.0%}. The unconnected accounts hold {unconnected_share:.0%} of spend.")
    if abs(l4 - count["L4"]) >= 0.02:
        say.append(f"By count {count['L4']:.0%} of triaged findings are owned and decided; weighted by severity and exposure {l4:.0%}.")
    return {"value": value, "stages": stages, "count": count, "yield": score.yield_, "spend_known": spend_known, "unconnected_spend_share": unconnected_share,
            "differs": differs, "say": say, "heaviest_accounts": [dict(r, share=round(r["share"], 4), lost=round(r["lost"], 3)) for r in per_acc[:10]],
            "heaviest_findings": heavy_findings[:10],
            "weights": {"accounts": "last billed spend" if spend_known else "equal (no spend known)", "findings": "critical 8, high 4, medium 2, low 1; x2 when internet-facing"}}
