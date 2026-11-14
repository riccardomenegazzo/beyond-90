"""How many accounts each action would bring all the way through every stage.

Yield gives partial credit, so an action's effect in points can hide how many accounts it finishes. Here each action's
operations are applied to a copy of the data (as the what-if does, with every deferred change landed) and the accounts
that pass every stage are counted again. The gain is "unlocks": accounts that pass after the action and did not before.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .catalogue import Catalogue
from .models import CustomerData
from .scoring import account_stops
from .simulate import apply_ops

LIMIT = 25   # the first actions only: each one re-runs the per-account check, and the page runs in the browser


def unlocks(data: CustomerData, cat: Catalogue, ceiling: str, actions: Iterable[Any], limit: int = LIMIT) -> dict[str, int]:
    base, _ = account_stops(data, cat, ceiling)
    through = {aid for aid, st in base.items() if st is None}
    out: dict[str, int] = {}
    for i, a in enumerate(actions):
        if i >= limit:
            break
        ops = list(getattr(a, "ops", None) or [])
        if not ops:
            continue
        after, _ = apply_ops(data, ops, cat, steady=True)
        stops, _ = account_stops(after, cat, ceiling)
        out[a.id] = sum(1 for aid, st in stops.items() if st is None and aid not in through)
    return out
