"""What real renewals say about the health indicator.

The health indicator (``health.py``) starts as a judgement. This module is how it earns, or loses, trust: a TAM records
what happened to each customer (renewed, expanded, reduced, churned) next to the health reading taken before the
decision, and this module compares the parts of that reading between the customers that stayed and the ones that
did not.

It is deliberately modest. It says nothing about a part until at least ``MIN_EACH`` customers on each side were
measured on it, it reports the counts every time, and its suggested weights are a blend of the current weights and
what the data hints at, never the data alone. With a handful of customers this is a hint for a conversation, not
proof, and the output says so in numbers.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any, Optional

from .health import LABELS, WEIGHTS

GOOD = ("renewed", "expanded")
BAD = ("reduced", "churned")
OUTCOMES = GOOD + BAD
MIN_EACH = 3
MIN_WEIGHT = 0.05
BLEND = 0.5                      # how much of a suggestion comes from the data; the rest stays with the current weights
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean(raw: Iterable[Any]) -> tuple[list[dict[str, Any]], int]:
    """The usable outcomes, and how many entries had to be left out because they were malformed."""
    out: list[dict[str, Any]] = []
    bad = 0
    for o in raw:
        if not isinstance(o, Mapping) or not isinstance(o.get("customer"), str) or o.get("outcome") not in OUTCOMES:
            bad += 1
            continue
        reading = o.get("reading")
        comps = reading.get("components") if isinstance(reading, Mapping) else None
        if not isinstance(comps, Mapping):
            bad += 1
            continue
        values: dict[str, Optional[float]] = {}
        for k in WEIGHTS:
            v = comps.get(k)
            values[k] = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100 else None
        score = reading.get("score") if isinstance(reading, Mapping) else None
        out.append({
            "customer": o["customer"][:200], "outcome": o["outcome"], "decided_on": str(o.get("decided_on", ""))[:10] if _DATE.match(str(o.get("decided_on", ""))) else "",
            "score": float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) and 0 <= score <= 100 else None, "components": values,
        })
    return out, bad


def _mean(values: list[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def _concordance(good: list[float], bad: list[float]) -> Optional[float]:
    """How often a customer that stayed scored higher than one that left (0.5 is a coin toss, 1 is perfect)."""
    if not good or not bad:
        return None
    wins = sum(1.0 if g > b else 0.5 if g == b else 0.0 for g in good for b in bad)
    return wins / (len(good) * len(bad))


def _suggest(gaps: dict[str, Optional[float]]) -> tuple[Optional[dict[str, float]], str]:
    usable = {k: g for k, g in gaps.items() if g is not None}
    if not usable:
        return None, "No part has enough measured customers on both sides yet."
    positive = {k: max(g, 0.0) for k, g in usable.items()}
    if not any(positive.values()):
        return None, "None of the measured parts was higher among the customers that stayed, so the data gives no reason to move any weight."
    room = sum(WEIGHTS[k] for k in usable)
    total = sum(positive.values())
    raw = {k: (BLEND * positive[k] / total * room + (1 - BLEND) * WEIGHTS[k]) if k in usable else WEIGHTS[k] for k in WEIGHTS}
    raw = {k: max(v, MIN_WEIGHT) for k, v in raw.items()}
    norm = sum(raw.values())
    return {k: round(v / norm, 2) for k, v in raw.items()}, "Half of each measured part's share follows how well it separated the customers that stayed from those that left; the rest stays as it was."


def report(outcomes: Iterable[Any]) -> dict[str, Any]:
    """The comparison, the plain-words findings, and a suggestion for the weights when the data supports one."""
    rows, skipped = clean(outcomes)
    good = [r for r in rows if r["outcome"] in GOOD]
    bad = [r for r in rows if r["outcome"] in BAD]
    enough = len(good) >= MIN_EACH and len(bad) >= MIN_EACH
    parts: list[dict[str, Any]] = []
    gaps: dict[str, Optional[float]] = {}
    for k in WEIGHTS:
        g = [r["components"][k] for r in good if r["components"][k] is not None]
        b = [r["components"][k] for r in bad if r["components"][k] is not None]
        mg, mb = _mean(g), _mean(b)
        gap = round(mg - mb, 1) if (mg is not None and mb is not None and len(g) >= MIN_EACH and len(b) >= MIN_EACH) else None
        gaps[k] = gap
        parts.append({"id": k, "label": LABELS[k], "stayed": None if mg is None else round(mg), "left": None if mb is None else round(mb), "n_stayed": len(g), "n_left": len(b), "gap": gap})
    conc = _concordance([r["score"] for r in good if r["score"] is not None], [r["score"] for r in bad if r["score"] is not None]) if enough else None
    findings: list[str] = []
    for p in parts:
        if p["gap"] is None:
            continue
        verb = "separated" if p["gap"] >= 10 else "barely separated" if p["gap"] > -10 else "pointed the wrong way for"
        findings.append(f"{p['label']} {verb} the customers that stayed ({p['stayed']} on average) from those that left ({p['left']}).")
    if conc is not None:
        findings.append(f"A customer that stayed had the higher health score than one that left in {conc:.0%} of the pairs (50% would be chance).")
    weights, why = _suggest(gaps) if enough else (None, f"Needs at least {MIN_EACH} customers that stayed and {MIN_EACH} that left; there are {len(good)} and {len(bad)}.")
    return {
        "total": len(rows), "stayed": len(good), "left": len(bad), "skipped": skipped, "enough": enough, "parts": parts, "concordance": None if conc is None else round(conc, 3),
        "findings": findings, "suggested_weights": weights, "why": why,
        "caveat": f"Based on {len(rows)} outcome(s) ({len(good)} stayed, {len(bad)} left): a hint to discuss, not proof." if rows else "No outcomes recorded yet.",
    }
