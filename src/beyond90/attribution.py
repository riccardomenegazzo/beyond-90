"""Why did Yield move? An exact answer, split between "the customer moved" and "the bar moved".

Yield is a product of stage rates, so it decomposes exactly with the
log-mean Divisia index (LMDI-I): for each factor ``k`` with ratio
``r_k = new_k / old_k``,

    contribution_k = L(Y1, Y0) x ln(r_k),    L(a, b) = (a - b) / (ln a - ln b)

and the contributions sum to ``Y1 - Y0`` with no residual, even when large
gains and losses cancel out. L3 is split in two: its change *at the previous
ceiling* is the customer's doing; the rest comes from capabilities released
since. That separation is the point: a drop caused by a new release is headroom,
not a regression, and a TAM should be able to say so with numbers.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from .catalogue import Catalogue, parse_version
from .models import CustomerData
from .scoring import Score, stage_l3

FLOOR = 1e-9
LABELS = {
    "L1": "Accounts connected (L1)",
    "L2": "Resource types inventoried (L2)",
    "L3": "Controls switched on (L3)",
    "L3_organic": "Controls on, same ceiling (L3)",
    "L3_bar": "New capabilities since (L3)",
    "L4": "Findings with owner and decision (L4)",
}


@dataclass
class Factor:
    key: str
    label: str
    kind: str            # "customer" or "bar"
    old: float
    new: float
    points: float        # contribution to the change in Yield, in percentage points


@dataclass
class Attribution:
    customer: str
    from_as_of: str
    to_as_of: str
    from_ceiling: str
    to_ceiling: str
    yield_from: float
    yield_to: float
    delta_points: float
    customer_points: float
    bar_points: float
    factors: list[Factor] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _logmean(a: float, b: float) -> float:
    a, b = max(a, FLOOR), max(b, FLOOR)
    return a if abs(a - b) < 1e-12 else (a - b) / (math.log(a) - math.log(b))


def explain(current: Score, previous: dict[str, Any], data: Optional[CustomerData] = None, cat: Optional[Catalogue] = None) -> Attribution:
    """``previous`` is a stored snapshot payload (``Store.previous``) or ``Score.to_dict()``."""
    old = {k: previous["stages"][k]["value"] for k in ("L1", "L2", "L3", "L4")}
    new = {k: current.stages[k].value for k in ("L1", "L2", "L3", "L4")}
    prev_ceiling = previous["ceiling_version"]
    notes: list[str] = []

    pairs: list[tuple[str, str, float, float]] = []   # key, kind, old, new
    pairs.append(("L1", "customer", old["L1"], new["L1"]))
    pairs.append(("L2", "customer", old["L2"], new["L2"]))
    if current.ceiling_version != prev_ceiling and parse_version(current.ceiling_version) > parse_version(prev_ceiling):
        if data is not None:
            same = stage_l3(data, cat or Catalogue.load(), prev_ceiling).value
            pairs.append(("L3_organic", "customer", old["L3"], same))
            pairs.append(("L3_bar", "bar", same, new["L3"]))
        else:
            pairs.append(("L3", "customer", old["L3"], new["L3"]))
            notes.append("The ceiling changed but no data was given, so L3 cannot be split between customer and bar.")
    else:
        pairs.append(("L3", "customer", old["L3"], new["L3"]))
        if parse_version(current.ceiling_version) < parse_version(prev_ceiling):
            notes.append("The current ceiling is older than the previous one; L3 is not split.")
    pairs.append(("L4", "customer", old["L4"], new["L4"]))

    y0 = math.prod(old.values())
    y1 = math.prod(new.values())
    lm = _logmean(y1, y0)
    factors = [
        Factor(k, LABELS[k].replace("Accounts", (getattr(current, "terms", None) or {}).get("units", "accounts").capitalize()), kind, o, n, 100.0 * lm * (math.log(max(n, FLOOR)) - math.log(max(o, FLOOR))))
        for k, kind, o, n in pairs
    ]
    # A stage at exactly zero cannot sit inside a logarithm, so it is held at a tiny floor and the split of the change
    # between factors is then only approximate. The total is not: the parts are scaled to add up to the real change.
    total, target = sum(f.points for f in factors), 100.0 * (y1 - y0)
    if abs(total - target) > 1e-9 and abs(total) > 1e-12:
        scale = target / total
        factors = [Factor(f.key, f.label, f.kind, f.old, f.new, f.points * scale) for f in factors]
        notes.append("A stage is at zero, so how the change splits between factors is approximate; the parts are scaled to add up exactly.")
    cust = sum(f.points for f in factors if f.kind == "customer")
    bar = sum(f.points for f in factors if f.kind == "bar")
    if abs(previous.get("yield", y0) - y0) > 1e-6:
        notes.append("The stored Yield differs from the product of its stage values; the product is used.")
    return Attribution(
        customer=current.customer,
        from_as_of=previous["as_of"],
        to_as_of=current.as_of,
        from_ceiling=prev_ceiling,
        to_ceiling=current.ceiling_version,
        yield_from=y0,
        yield_to=y1,
        delta_points=100.0 * (y1 - y0),
        customer_points=cust,
        bar_points=bar,
        factors=factors,
        notes=notes,
    )


def render_attribution(a: Attribution) -> str:
    L = [f"{a.customer}: Yield {a.yield_from:.1%} on {a.from_as_of} -> {a.yield_to:.1%} on {a.to_as_of} ({a.delta_points:+.1f} pts)", ""]
    for f in a.factors:
        L.append(f"  {f.points:+6.1f} pts  {f.label}   {f.old:.1%} -> {f.new:.1%}")
    L.append("")
    L.append(f"The customer moved {a.customer_points:+.1f} pts; the bar moved {a.bar_points:+.1f} pts.")
    if a.bar_points < -0.05 and a.customer_points > 0:
        L.append("Real progress was partly hidden by new headroom: capabilities released since "
                 f"{a.from_ceiling} raised the denominator.")
    for n in a.notes:
        L.append(f"Note: {n}")
    return "\n".join(L) + "\n"
