"""The relationship layer: trust, reliability and coverage, kept apart from adoption.

Adoption says whether the platform is used. It does not say whether the customer
trusts the person advising them, and a customer who does not will not tell you the
truth about what is blocking adoption. This module adds the second view. It never
merges the two into one number: a health score that averages adoption with
relationship hides exactly the cases that matter (a well-used platform and a
sponsor who has stopped answering).

The model follows *The Trusted Advisor* (Maister, Green and Galford, Free Press, 2000): trust has four components, and the authors present the equation as a
framework, not a scientific result:

    T = (credibility + reliability + intimacy) / self-orientation

* credibility: they believe what you say (and that you say all of it);
* reliability: you do what you said, when you said it;
* intimacy: they are willing to talk to you about the hard things;
* self-orientation: how much of your attention is on yourself rather than on them
  (the denominator, so it is the cheapest lever).

Ratings are the TAM's honest 1-10 view of each person, as in the book's own
worked examples. The equation is only as good as those ratings, and a TAM is a
poor judge of their own self-orientation, so treat the index as a prompt for a
conversation with a colleague, not as a measurement.

Reliability is the exception: it can be *measured*, from the promises made to the
customer (``commitments.csv``) and whether they were kept on time.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional

from .models import CustomerData

COMPONENTS = ("self_orientation", "intimacy", "reliability", "credibility")   # tie-break order: the cheapest lever first
BANDS = ((4.0, "strong"), (2.0, "developing"), (0.0, "fragile"))
KEY_ROLES = ("executive_sponsor", "security_leader", "champion")


def trust_index(credibility: float, reliability: float, intimacy: float, self_orientation: float) -> float:
    return (credibility + reliability + intimacy) / self_orientation


def band(t: float) -> str:
    return next(name for floor, name in BANDS if t >= floor)


def limiting_factor(c: float, r: float, i: float, s: float) -> str:
    """The component where one point of improvement raises the index the most."""
    base = trust_index(c, r, i, s)
    gains = {
        "self_orientation": trust_index(c, r, i, max(s - 1, 1)) - base,
        "intimacy": trust_index(c, r, min(i + 1, 10), s) - base,
        "reliability": trust_index(c, min(r + 1, 10), i, s) - base,
        "credibility": trust_index(min(c + 1, 10), r, i, s) - base,
    }
    return max(COMPONENTS, key=lambda k: (round(gains[k], 9), -COMPONENTS.index(k)))


def compute_relationship(data: CustomerData) -> Optional[dict[str, Any]]:
    if not data.contacts and not data.commitments:
        return None
    s, today = data.settings, data.as_of
    stale_cut = today - timedelta(days=s.contact_stale_days)
    people: list[dict[str, Any]] = []
    for c in data.contacts:
        stale = c.last_contact is None or c.last_contact < stale_cut
        row: dict[str, Any] = {
            "id": c.id, "name": c.name, "role": c.role, "team": c.team, "influence": c.influence,
            "days_since_contact": None if c.last_contact is None else (today - c.last_contact).days,
            "stale": stale, "rated": False,
        }
        parts = (c.credibility, c.reliability, c.intimacy, c.self_orientation)
        if all(p is not None for p in parts):
            cr, re, it, so = (float(p) for p in parts if p is not None)
            t = trust_index(cr, re, it, so)
            row.update(rated=True, trust=t, band=band(t), limiting=limiting_factor(cr, re, it, so),
                       components={"credibility": cr, "reliability": re, "intimacy": it, "self_orientation": so})
        people.append(row)

    rated = [p for p in people if p["rated"]]
    weighted = sum(p["influence"] * p["trust"] for p in rated) / sum(p["influence"] for p in rated) if rated else None

    # Reliability, measured: promises that fell due in the window, kept on time or not.
    window_start = today - timedelta(days=s.commitment_lookback_days)
    due = [c for c in data.commitments if window_start <= c.due_on <= today]
    on_time = [c for c in due if c.done_on is not None and c.done_on <= c.due_on]
    late = [c for c in due if c.done_on is not None and c.done_on > c.due_on]
    overdue = [c for c in data.commitments if c.done_on is None and c.due_on < today]
    reliability = {
        "due_in_window": len(due), "on_time": len(on_time), "late": len(late),
        "rate": (len(on_time) / len(due)) if due else None,
        "overdue_open": [c.id for c in sorted(overdue, key=lambda c: (c.due_on, c.id))],
        "upcoming": sum(1 for c in data.commitments if c.done_on is None and c.due_on >= today),
    }

    fresh = [p for p in people if not p["stale"]]
    contact_teams = {p["team"].lower() for p in people if p["team"]}
    uncovered = [t.id for t in data.teams if t.has_assets and t.id.lower() not in contact_teams and t.name.lower() not in contact_teams]
    weak: dict[str, list[str]] = {}
    for p in rated:
        if p["band"] != "strong" and p["influence"] >= 2:
            weak.setdefault(p["limiting"], []).append(p["id"])
    gaps = {
        "no_executive_sponsor": bool(people) and not any(p["role"] == "executive_sponsor" for p in people),
        "stale_key_contacts": [p["id"] for p in people if p["stale"] and p["role"] in KEY_ROLES],
        "single_threaded": bool(people) and len(fresh) < 2,
        "teams_without_a_contact": uncovered if data.contacts else [],
        "overdue_commitments": reliability["overdue_open"],
        "weak_by_component": {k: sorted(v) for k, v in weak.items()},
    }
    return {
        "contacts": people,
        "weighted_trust": weighted,
        "weighted_band": band(weighted) if weighted is not None else None,
        "reliability": reliability,
        "coverage": {
            "contacts": len(people), "touched_recently": len(fresh),
            "sponsor": next((p["id"] for p in people if p["role"] == "executive_sponsor"), None),
            "champions": [p["id"] for p in people if p["role"] == "champion"],
        },
        "gaps": gaps,
    }
