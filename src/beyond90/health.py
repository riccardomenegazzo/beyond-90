"""One customer health indicator, with every part visible.

Adoption is one input to a customer's health, not health itself, so this module combines four things that are
already measured elsewhere in the tool into a single 0 to 100 indicator a TAM can talk about:

* adoption: effective coverage, and the same coverage weighted by spend and exposure;
* outcomes: critical findings still open, most of all those exposed to the internet;
* relationship: executive sponsor, more than one contact, promises kept, key contacts reached (from the renewal signals);
* trajectory: what coverage loses over the next 90 days if nothing is done.

It is a hypothesis to discuss, not a measurement: nothing here has been validated against real renewals. The weights are
printed with the result, a part that could not be measured is left out (and the result says so) instead of counting as
good news, and the band follows the weakest part, so a good average never hides a failing one.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Optional

from .models import CustomerData

WEIGHTS = {"adoption": 0.40, "outcomes": 0.20, "relationship": 0.25, "trajectory": 0.15}
LABELS = {"adoption": "Adoption", "outcomes": "Outcomes", "relationship": "Relationship", "trajectory": "Trajectory"}
HEALTHY, WATCH = 75, 55
WEAK_RISK, WEAK_WATCH = 30, 50
RELATIONSHIP_SIGNALS = ("sponsor", "threads", "promises", "contact")
_STATUS_VALUE = {"ok": 1.0, "watch": 0.5, "risk": 0.0}
NOTE = ("A starting hypothesis for the conversation, not a measurement: the weights are a judgement and have not been checked against real renewals. "
        "A part that could not be measured is left out, and the band follows the weakest part.")


def _adoption(score: Any, weighted: Optional[dict[str, Any]]) -> tuple[Optional[float], str]:
    if not score.stages["L1"].has_data:
        return None, "No accounts to measure."
    cover = float(score.yield_)
    stake = float(weighted["value"]) if weighted and weighted.get("value") is not None else cover
    value = 100 * (0.7 * cover + 0.3 * stake)
    return value, f"Effective coverage {cover:.0%}, {stake:.0%} when weighted by spend and exposure."


def _outcomes(data: CustomerData) -> tuple[Optional[float], str]:
    if not data.findings:
        return None, "No findings were provided."
    live = [f for f in data.findings if f.closed_at is None and f.severity == "critical" and f.decision != "false_positive"]
    exposed = sum(1 for f in live if f.exposure == "internet")
    value = max(0.0, 100 - min(60, 15 * exposed) - min(25, 5 * (len(live) - exposed)))
    return value, f"{len(live)} critical finding(s) open, {exposed} exposed to the internet."


def _relationship(renewal: Optional[dict[str, Any]]) -> tuple[Optional[float], str]:
    if not renewal:
        return None, "Add a renewal date and contacts to measure this."
    sig = [s for s in renewal["signals"] if s["id"] in RELATIONSHIP_SIGNALS and s["status"] in _STATUS_VALUE]
    if not sig:
        return None, "No contacts or promises were provided."
    value = 100 * sum(_STATUS_VALUE[s["status"]] for s in sig) / len(sig)
    weak = [s["label"].lower() for s in sig if s["status"] != "ok"]
    return value, "All relationship signals are good." if not weak else f"Needs attention: {', '.join(weak)}."


def _trajectory(look: Optional[dict[str, Any]]) -> tuple[Optional[float], str]:
    if not look or look.get("loss_points") is None:
        return None, "Not enough dated events to look ahead."
    lost = max(0.0, -float(look["loss_points"]))
    return max(0.0, 100 - 4 * lost), ("Nothing already dated lowers coverage in the next 90 days." if lost < 0.05
                                       else f"If nothing is done, coverage loses {lost:.1f} points in the next 90 days.")


def resolve_weights(custom: Optional[Mapping[str, Any]]) -> tuple[dict[str, float], str]:
    """The weights to use and where they came from. Anything that is not a complete set of positive numbers is ignored."""
    if not isinstance(custom, Mapping) or set(custom) != set(WEIGHTS):
        return dict(WEIGHTS), "default"
    vals = {k: custom[k] for k in WEIGHTS}
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 and v == v and v < 1e6 for v in vals.values()):
        return dict(WEIGHTS), "default"
    total = float(sum(vals.values()))
    return {k: float(v) / total for k, v in vals.items()}, "calibrated"


def _band(score: float, weakest: float) -> str:
    by_score = "healthy" if score >= HEALTHY else "watch" if score >= WATCH else "at risk"
    by_weak = "at risk" if weakest < WEAK_RISK else "watch" if weakest < WEAK_WATCH else "healthy"
    order = ("healthy", "watch", "at risk")
    return order[max(order.index(by_score), order.index(by_weak))]


def compute(score: Any, data: CustomerData, renewal: Optional[dict[str, Any]], look: Optional[dict[str, Any]], weighted: Optional[dict[str, Any]],
            weights: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
    w, source = resolve_weights(weights)
    parts = {
        "adoption": _adoption(score, weighted),
        "outcomes": _outcomes(data),
        "relationship": _relationship(renewal),
        "trajectory": _trajectory(look),
    }
    measured = {k: v for k, (v, _) in parts.items() if v is not None}
    total = sum(w[k] for k in measured)
    components = [{
        "id": k, "label": LABELS[k], "weight": round(w[k], 3), "value": round(measured[k]) if k in measured else None,
        "share": round(w[k] / total, 3) if k in measured and total else 0.0, "reason": parts[k][1],
    } for k in WEIGHTS]
    if not measured:
        return {"score": None, "band": "not measured", "measured": 0, "of": len(WEIGHTS), "components": components, "weakest": None, "note": NOTE, "weights": source}
    value = sum(measured[k] * w[k] for k in measured) / total
    weakest = min(measured, key=lambda k: measured[k])
    return {"score": round(value), "band": _band(value, measured[weakest]), "measured": len(measured), "of": len(WEIGHTS),
            "components": components, "weakest": weakest, "note": NOTE, "weights": source}
