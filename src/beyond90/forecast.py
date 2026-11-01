"""When do we reach zero critical, and how likely is it to break?

Wiz-style programs celebrate reaching zero critical issues, and then the work is
to stay there. Both questions are about a queue: critical findings arrive at some
rate and each takes some time to close. This module learns both from the
customer's own history and runs a seeded Monte Carlo (deterministic for a given
seed) of that queue.

* Open criticals get a residual time drawn from the empirical close times that
  are longer than the finding's age so far. A finding older than anything ever
  closed is outside the history: it gets an exponential residual with a mean
  equal to its age (the longer something has stayed open, the longer it is
  likely to stay), and the output counts these as ``stuck_beyond_history``.
* New criticals arrive as a Poisson process at the rate seen over the lookback
  window and are closed after a time drawn from the same empirical distribution.
* "Zero" is the first moment with no open critical finding.

The forecast needs closed critical findings to learn from; without them it says
so and does not guess. It is only as good as the history it sees.
"""

from __future__ import annotations

import math
import random
from datetime import timedelta
from typing import Optional

from .models import CustomerData


def _quantile(sorted_vals: list[float], q: float) -> Optional[float]:
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, max(0, math.ceil(q * len(sorted_vals)) - 1))
    v = sorted_vals[i]
    return None if math.isinf(v) else v


def forecast_zero_critical(data: CustomerData, *, runs: int = 2000, horizon_days: int = 365, seed: int = 7) -> dict:
    crit = [f for f in data.findings if f.severity == "critical" and f.decision != "false_positive"]
    open_ = [f for f in crit if f.closed_at is None]
    durations = [max(1, (f.closed_at - f.opened_at).days) for f in crit if f.closed_at is not None]
    lookback = data.settings.mttr_lookback_days
    since = data.as_of - timedelta(days=lookback)
    arrivals = [f for f in crit if f.opened_at >= since]
    rate = len(arrivals) / lookback if lookback else 0.0
    out = {"available": True, "open_critical": len(open_), "arrivals_per_week": round(rate * 7, 2),
           "closed_samples": len(durations), "runs": runs, "seed": seed, "horizon_days": horizon_days}
    if not durations:
        return {**out, "available": False, "reason": "No closed critical findings to learn close times from."}
    rng = random.Random(seed)

    if not open_:
        out.update(state="zero", p_new_critical_30d=round(1 - math.exp(-rate * 30), 3),
                   p_new_critical_90d=round(1 - math.exp(-rate * 90), 3),
                   median_days_to_recover=sorted(durations)[len(durations) // 2],
                   note="Already at zero critical. The numbers describe how likely it is to break and how long recovery takes.")
        return out

    ages = [(data.as_of - f.opened_at).days for f in open_]
    longest = max(durations)
    out["stuck_beyond_history"] = sum(1 for a in ages if a >= longest)
    zero_at: list[float] = []
    for _ in range(runs):
        intervals: list[tuple[float, float]] = []
        for age in ages:
            longer = [d - age for d in durations if d > age]
            intervals.append((0.0, float(rng.choice(longer)) if longer else rng.expovariate(1.0 / max(age, 1))))
        if rate > 0:
            t = 0.0
            while True:
                t += rng.expovariate(rate)
                if t >= horizon_days:
                    break
                intervals.append((t, t + rng.choice(durations)))
        intervals.sort()
        covered = 0.0
        for start, end in intervals:
            if start > covered:
                break
            covered = max(covered, end)
        zero_at.append(covered if covered < horizon_days else math.inf)
    zero_at.sort()
    p = lambda d: round(sum(1 for z in zero_at if z <= d) / runs, 3)
    p50, p90 = _quantile(zero_at, 0.5), _quantile(zero_at, 0.9)
    day = lambda x: None if x is None else (data.as_of + timedelta(days=math.ceil(x))).isoformat()
    out.update(
        state="open",
        p50_days=None if p50 is None else math.ceil(p50), p50_date=day(p50),
        p90_days=None if p90 is None else math.ceil(p90), p90_date=day(p90),
        p_zero_within={"30": p(30), "60": p(60), "90": p(90)},
        note="Monte Carlo of the critical-finding queue, learned from this customer's own history.",
    )
    return out


def render_forecast(f: dict) -> str:
    if not f["available"]:
        return f"Zero-critical forecast: not available. {f['reason']}\n"
    if f["state"] == "zero":
        return (f"Zero critical now. Chance a new critical appears within 30 days: {f['p_new_critical_30d']:.0%}, within 90 days: "
                f"{f['p_new_critical_90d']:.0%} (about {f['arrivals_per_week']} per week). Typical recovery: {f['median_days_to_recover']} days.\n")
    p50 = "not within a year" if f["p50_days"] is None else f"{f['p50_days']} days ({f['p50_date']})"
    p90 = "not within a year" if f["p90_days"] is None else f"{f['p90_days']} days ({f['p90_date']})"
    z = f["p_zero_within"]
    stuck = (f"{f['stuck_beyond_history']} of them are older than anything this customer has ever closed, so the model treats them as likely to stay open.\n"
             if f.get("stuck_beyond_history") else "")
    return (f"{f['open_critical']} critical finding(s) open, {f['arrivals_per_week']} new per week.\n" + stuck +
            f"Zero critical: median {p50}, 90th percentile {p90}.\n"
            f"Probability of reaching zero within 30 / 60 / 90 days: {z['30']:.0%} / {z['60']:.0%} / {z['90']:.0%}.\n")
