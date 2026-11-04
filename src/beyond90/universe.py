"""How many accounts does no source know about?

L1 is measured against the accounts you know. That is the weak point of any
adoption metric: the accounts nobody listed are, by definition, missing from
the denominator. They are not invisible to statistics, though. Each independent
source (billing, the organization hierarchy, SSO) sees most accounts and misses
some. How often accounts are seen by exactly one source, compared with exactly
two, tells you how many are likely seen by none. This is the capture-recapture
problem ecologists use to count animals nobody has seen.

Estimator: Chao's incidence-based lower bound (Chao 1987), with ``T`` sources,
``Q1`` accounts seen by exactly one and ``Q2`` by exactly two:

    unseen = ((T - 1) / T) x Q1^2 / (2 x Q2)           (Q2 > 0)
    unseen = ((T - 1) / T) x Q1 x (Q1 - 1) / 2         (Q2 = 0, bias-corrected)

It is a *lower bound* when sources differ in how likely they are to see an
account, and it assumes sources look at accounts independently-ish. A source
that sees everything (billing in a company where every account has a bill)
breaks that assumption: the report says so instead of hiding it. Treat the
number as a prompt to go looking, not as a count.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Optional

from .models import INDEPENDENT_SOURCES, CustomerData
from .terms import say


def _chapman(n1: int, n2: int, m: int) -> float:
    return (n1 + 1) * (n2 + 1) / (m + 1) - 1


def estimate_universe(data: CustomerData, terms: Optional[Mapping[str, str]] = None) -> dict[str, Any]:
    out = _estimate(data)
    if terms:
        for key in ("reason",):
            if key in out:
                out[key] = say(out[key], terms)
        out["warnings"] = [say(w, terms) for w in out.get("warnings", [])]
    return out


def _estimate(data: CustomerData) -> dict[str, Any]:
    active = [a for a in data.accounts if a.status == "active"]
    present = [s for s in INDEPENDENT_SOURCES if any(s in a.sources for a in active)]
    t = len(present)
    observed = len(active)
    connected = sum(1 for a in active if a.connected)
    base = {"observed": observed, "sources": present}
    if observed == 0:
        return {**base, "estimable": False, "reason": "No active accounts."}
    if t < 2:
        return {**base, "estimable": False,
                "reason": "Needs accounts seen in at least two independent sources (billing, org, sso) to estimate what no source sees."}
    k = {a.id: len(set(a.sources) & set(present)) for a in active}
    q1 = sum(1 for v in k.values() if v == 1)
    q2 = sum(1 for v in k.values() if v == 2)
    if q1 == 0:
        unseen = 0.0
    elif q2 > 0:
        unseen = (t - 1) / t * q1 * q1 / (2 * q2)
    else:
        unseen = (t - 1) / t * q1 * (q1 - 1) / 2
    only = {s: sum(1 for a in active if set(a.sources) & set(present) == {s}) for s in present}
    pairs = {}
    for i, s1 in enumerate(present):
        for s2 in present[i + 1:]:
            n1 = sum(1 for a in active if s1 in a.sources)
            n2 = sum(1 for a in active if s2 in a.sources)
            m = sum(1 for a in active if s1 in a.sources and s2 in a.sources)
            pairs[f"{s1}+{s2}"] = round(_chapman(n1, n2, m) - len({a.id for a in active if s1 in a.sources or s2 in a.sources}), 1)
    total = observed + unseen
    completeness = observed / total if total else 1.0
    warnings = []
    full = [s for s in present if all(s in a.sources for a in active)]
    if full:
        warnings.append(f"{', '.join(full)} lists every known account, so it is not independent of the others; the estimate is unreliable.")
    if q1 / observed > 0.5:
        warnings.append("More than half the accounts are seen by only one source: reconcile your sources before trusting any adoption number.")
    return {
        **base,
        "estimable": True,
        "seen_by_one": q1,
        "seen_by_two": q2,
        "seen_by_all": sum(1 for v in k.values() if v == t),
        "only_in": only,
        "unseen_estimate": round(unseen, 1),
        "completeness": completeness,
        "confidence": "high" if completeness >= 0.98 else "medium" if completeness >= 0.90 else "low",
        "pessimistic_l1": connected / total if total else 1.0,
        "pairwise_unseen_chapman": pairs,
        "warnings": warnings,
        "method": "Chao 1987 incidence lower bound",
    }


def render_universe(u: dict[str, Any]) -> str:
    if not u["estimable"]:
        return f"Universe: not estimable. {u['reason']}\n"
    units = u.get("units", "accounts")
    L = [f"Known {units}: {u['observed']} (sources: {', '.join(u['sources'])})",
         f"Seen by one source only: {u['seen_by_one']}, by two: {u['seen_by_two']}, by all: {u['seen_by_all']}",
         "Only in: " + ", ".join(f"{s} {n}" for s, n in u["only_in"].items()),
         f"Estimated {units} no source has seen: about {u['unseen_estimate']:.1f} (lower bound)",
         f"Universe completeness: {u['completeness']:.1%} ({u['confidence']} confidence)",
         f"L1 if the hidden {units} are unconnected: {u['pessimistic_l1']:.1%}"]
    L += [f"Warning: {w}" for w in u["warnings"]]
    return "\n".join(L) + "\n"
