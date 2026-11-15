"""Discovery questions for a customer, in the order that matters for them.

Each profile can ship questions tied to a stage (L1 to L4) or to business value. The order puts value first (it frames
the call), then the stages from the customer's weakest to the strongest, so the first questions about the product are the
ones that touch where the customer loses most.
"""

from __future__ import annotations

from typing import Any

from .catalogue import Catalogue
from .scoring import Score


def ordered(cat: Catalogue, score: Score) -> list[dict[str, Any]]:
    stages = {k: v.value for k, v in score.stages.items() if v.has_data and v.value is not None}
    weakest = min(stages, key=lambda k: stages[k]) if stages else None
    rank = {k: i for i, k in enumerate(sorted(stages, key=lambda k: stages[k]))}

    def key(item: tuple[int, dict[str, str]]) -> tuple[int, int, int]:
        i, x = item
        return (0 if x["stage"] == "value" else 1, rank.get(x["stage"], 9), i)

    out = []
    for _, x in sorted(enumerate(cat.discovery), key=key):
        out.append({**x, "focus": x["stage"] == weakest, "stage_value": stages.get(x["stage"])})
    return out
