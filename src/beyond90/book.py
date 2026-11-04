"""One TAM, many customers, one budget of hours.

A TAM with a book of 5 to 10 customers does not have a plan per customer, they
have a week. The question is where the next hour goes. This module answers it
with the same exact simulation the single-customer planner uses: every week it
asks each customer what its best next piece of work is and how much Yield (and so
how much of the book's ARR-weighted Yield) it would add per hour, and spends the
hour where that is highest.

The objective is the ARR-weighted Yield of the book: ``sum(arr_i x yield_i) / sum(arr_i)``
(or equal weights). The result is compared with two simple rules a person would
actually follow, an equal split of hours and a split proportional to ARR, so the
value of choosing is a number and not a claim.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from html import escape as e
from typing import Any, Optional

from .catalogue import Catalogue
from .models import CustomerData
from .planner import EPS, MIN_HOURS, CustomerPlanner, Plan, build_plan
from .simulate import DEFAULT_RAMP, RampModel

RULE_LABELS = {"equal_split": "Equal split of hours", "arr_proportional": "Hours proportional to ARR"}
PALETTE_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
PALETTE_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"]


@dataclass
class BookCustomer:
    name: str
    arr: float
    weight: float
    start_yield: float
    end_yield: float
    hours: float = 0.0
    hours_share: float = 0.0
    jobs: int = 0
    dips: list[dict[str, Any]] = field(default_factory=list[Any])
    residual: dict[str, int] = field(default_factory=dict)


@dataclass
class BookWeek:
    week: int
    hours: dict[str, float]
    yields: dict[str, float]
    weighted_yield: float


@dataclass
class BookJob:
    customer: str
    week: int
    title: str
    hours: float
    gain_points: float


@dataclass
class BookPlan:
    hours_per_week: float
    horizon_weeks: int
    realization: float
    weighting: str
    customers: list[BookCustomer]
    weeks: list[BookWeek]
    jobs: list[BookJob]
    baselines: dict[str, float]
    notes: list[str]

    @property
    def weighted_start(self) -> float:
        return self.weeks[0].weighted_yield

    @property
    def weighted_end(self) -> float:
        return self.weeks[-1].weighted_yield

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _weights(customers: list[tuple[str, CustomerData]], weighting: str) -> dict[str, float]:
    if weighting not in ("arr", "equal"):
        raise ValueError("weighting must be 'arr' or 'equal'")
    total = sum(d.arr for _, d in customers)
    if weighting == "equal" or total <= 0:
        return {n: 1.0 / len(customers) for n, _ in customers}
    return {n: d.arr / total for n, d in customers}


def _weighted_end(plans: dict[str, Plan], w: dict[str, float]) -> float:
    return sum(w[n] * p.end_yield for n, p in plans.items())


def build_book_plan(
    customers: list[tuple[str, CustomerData]],
    cat: Optional[Catalogue] = None,
    *,
    hours_per_week: float = 30.0,
    horizon_weeks: int = 26,
    realization: float = 0.9,
    weighting: str = "arr",
    ramp: RampModel = DEFAULT_RAMP,
    baselines: bool = True,
) -> BookPlan:
    if not customers:
        raise ValueError("a book needs at least one customer")
    if hours_per_week <= 0 or horizon_weeks <= 0:
        raise ValueError("hours_per_week and horizon_weeks must be positive")
    names = [n for n, _ in customers]
    if len(set(names)) != len(names):
        raise ValueError("customer names must be unique")
    cat = cat or Catalogue.load()
    w = _weights(customers, weighting)
    eng = {n: CustomerPlanner(d, cat, hours_per_week=hours_per_week, realization=realization, ramp=ramp) for n, d in customers}

    def snapshot(week: int, hours: dict[str, float]) -> BookWeek:
        ys = {n: p.weeks[-1].yield_ for n, p in eng.items()}
        return BookWeek(week, {n: round(h, 2) for n, h in hours.items()}, ys, sum(w[n] * ys[n] for n in ys))

    weeks = [snapshot(0, dict.fromkeys(names, 0.0))]
    jobs: list[BookJob] = []
    notes: list[str] = []
    for week in range(1, horizon_weeks + 1):
        for p in eng.values():
            p.begin_week(week)
        budget = hours_per_week
        used = dict.fromkeys(names, 0.0)
        while budget > EPS:
            best: Optional[tuple[float, str]] = None
            for n in names:
                pick = eng[n].peek()
                if pick is None:
                    continue
                rank = w[n] * pick.gain / max(pick.remaining_hours, MIN_HOURS)
                if best is None or rank > best[0] + 1e-15 or (abs(rank - best[0]) <= 1e-15 and n < best[1]):
                    best = (rank, n)
            if best is None:
                break
            n = best[1]
            before = len(eng[n].jobs)
            spent = eng[n].work(week, budget)
            if spent <= EPS:
                break
            budget -= spent
            used[n] += spent
            for j in eng[n].jobs[before:]:
                jobs.append(BookJob(n, week, j.title, j.hours, j.steady_gain_points))
        if sum(used.values()) <= EPS and all(p.current is None and not p.deferred for p in eng.values()):
            notes.append(f"No further action improves any customer's Yield after week {week - 1}; the plan stops there.")
            break
        for n, p in eng.items():
            p.end_week(week, used[n])
        weeks.append(snapshot(week, used))

    plans = {n: p.finalize(hours_per_week, horizon_weeks) for n, p in eng.items()}
    total_hours = sum(sum(bw.hours.values()) for bw in weeks)
    cust = []
    for n, d in customers:
        hrs = sum(bw.hours[n] for bw in weeks)
        pl = plans[n]
        cust.append(BookCustomer(n, d.arr, w[n], pl.start_yield, pl.end_yield, round(hrs, 2), hrs / total_hours if total_hours else 0.0,
                                 len(pl.jobs), pl.dips, pl.residual))
    cust.sort(key=lambda c: (-c.arr, c.name))

    base: dict[str, float] = {}
    if baselines and len(customers) > 1:
        n_cust = len(customers)
        splits = {"equal_split": dict.fromkeys(names, 1.0 / n_cust), "arr_proportional": _weights(customers, "arr")}
        for label, share in splits.items():
            alone = {n: build_plan(d, cat, hours_per_week=max(hours_per_week * share[n], 0.25), horizon_weeks=horizon_weeks,
                                   realization=realization, ramp=ramp) for n, d in customers}
            base[label] = _weighted_end(alone, w)
    if base:
        best_baseline = max(base.values())
        gain = (weeks[-1].weighted_yield - best_baseline) * 100
        if gain >= 0.05:
            notes.append(
                f"Allocating hours by exact gain per hour ends at {weeks[-1].weighted_yield:.1%} weighted Yield, "
                f"{gain:+.1f} points against the better of an equal split and an ARR-proportional split."
            )
        else:
            notes.append(
                f"Every allocation rule ends at about {weeks[-1].weighted_yield:.1%}: with this many hours there is enough for everything "
                "that can be done, so where the hours go does not matter. Try fewer hours to see the difference."
            )
    return BookPlan(hours_per_week, horizon_weeks, realization, weighting, cust, weeks, jobs, base, notes)


# ------------------------------------------------------------------ rendering

def _customers(n: int) -> str:
    return f"{n} customer" + ("" if n == 1 else "s")


def _pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def render_book_text(b: BookPlan, top: int = 12) -> str:
    L = [f"Book plan: {b.hours_per_week:g} h/week for {b.horizon_weeks} weeks across {_customers(len(b.customers))} ({b.weighting}-weighted, {b.realization:.0%} realization)",
         f"Weighted Yield {_pct(b.weighted_start)} -> {_pct(b.weighted_end)}"]
    for label, v in b.baselines.items():
        L.append(f"  baseline {RULE_LABELS[label]:<28} {_pct(v)}")
    L += ["", f"{'customer':<26}{'ARR':>11}{'Yield':>16}{'hours':>9}{'share':>8}{'jobs':>6}"]
    for c in b.customers:
        L.append(f"{c.name[:25]:<26}{c.arr:>11,.0f}{_pct(c.start_yield) + ' -> ' + _pct(c.end_yield):>16}{c.hours:>9.1f}{c.hours_share:>8.0%}{c.jobs:>6}")
    L += ["", f"First {min(top, len(b.jobs))} jobs:"]
    for j in b.jobs[:top]:
        L.append(f"  week {j.week:>2}  {j.customer[:22]:<22} {j.title[:60]:<60} {j.hours:>5.1f} h  +{j.gain_points:.1f} pts")
    for c in b.customers:
        for d in c.dips[:1]:
            L.append(f"\nJ-curve at {c.name}: week {d['week']} dips {d['drop_points']:.1f} pts.")
    L += [f"\n{n}" for n in b.notes]
    return "\n".join(L) + "\n"


def render_book_markdown(b: BookPlan, top: int = 15) -> str:
    L = ["# Book plan", "", (f"{b.hours_per_week:g} hours a week for {b.horizon_weeks} weeks across {_customers(len(b.customers))} "
         f"({b.weighting}-weighted, {b.realization:.0%} of each action assumed to succeed)."), "",
         f"**Weighted Yield {_pct(b.weighted_start)} to {_pct(b.weighted_end)}.**", ""]
    if b.baselines:
        L += ["| Allocation rule | Weighted Yield at the horizon |", "|---|---|", f"| Exact gain per hour (this plan) | **{_pct(b.weighted_end)}** |"]
        L += [f"| {RULE_LABELS[k]} | {_pct(v)} |" for k, v in b.baselines.items()]
        L.append("")
    L += ["| Customer | ARR | Yield | Hours | Share of hours | Jobs |", "|---|---|---|---|---|---|"]
    for c in b.customers:
        L.append(f"| {c.name} | {c.arr:,.0f} | {_pct(c.start_yield)} to {_pct(c.end_yield)} | {c.hours:.1f} | {c.hours_share:.0%} | {c.jobs} |")
    L += ["", f"## First {min(top, len(b.jobs))} jobs", "", "| Week | Customer | Job | Hours | Effect when settled |", "|---|---|---|---|---|"]
    for j in b.jobs[:top]:
        L.append(f"| {j.week} | {j.customer} | {j.title} | {j.hours:.1f} | +{j.gain_points:.1f} pts |")
    dips = [(c.name, d) for c in b.customers for d in c.dips[:1]]
    if dips:
        L += ["", "## Dips to warn customers about", ""]
        L += [f"- {n}: week {d['week']}, Yield dips {d['drop_points']:.1f} pts." for n, d in dips]
    resid = [(c.name, c.residual) for c in b.customers if c.residual]
    if resid:
        L += ["", "## Needs escalation, not more effort", ""]
        L += [f"- {n}: " + "; ".join(f"{k} {v}" for k, v in r.items()) + "." for n, r in resid]
    L += [""] + [f"_{n}_" for n in b.notes] + [""]
    return "\n".join(L)


def render_book_json(b: BookPlan) -> str:
    import json
    return json.dumps(b.to_dict(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_book_html(b: BookPlan, top: int = 15) -> str:
    from .report import CSS  # shared tokens and base styles

    n = len(b.customers)
    shown = b.customers[:8] if n <= 8 else b.customers[:7]
    others = [] if n <= 8 else b.customers[7:]
    names = [c.name for c in shown]
    series = names + (["Other"] if others else [])
    W, H, ml, mr, mt, mb = 640, 260, 44, 12, 14, 36
    steps = len(b.weeks) - 1
    cap = b.hours_per_week
    bw = (W - ml - mr) / max(steps, 1) * 0.72

    def y(v: float) -> float:
        return mt + (H - mt - mb) * (1 - v / cap)

    css_vars = "".join(f"--c{i}:{PALETTE_LIGHT[i]};" for i in range(len(series)))
    dark_vars = "".join(f"--c{i}:{PALETTE_DARK[i]};" for i in range(len(series)))
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Hours per week allocated to each customer">']
    for t in (0, 0.5, 1.0):
        out.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(cap * t):.1f}" y2="{y(cap * t):.1f}" stroke="var(--grid)"/>'
                   f'<text class="m" x="{ml - 6}" y="{y(cap * t) + 4:.1f}" text-anchor="end">{cap * t:g} h</text>')
    for k, bwk in enumerate(b.weeks[1:], start=0):
        x = ml + (W - ml - mr) * (k + 0.14) / max(steps, 1)
        base = 0.0
        for si, s in enumerate(series):
            h = bwk.hours.get(s, 0.0) if s != "Other" else sum(bwk.hours.get(c.name, 0.0) for c in others)
            if h <= 0:
                continue
            out.append(f'<g><title>Week {bwk.week}: {e(s)} {h:.1f} h</title><rect x="{x:.1f}" y="{y(base + h):.1f}" width="{bw:.1f}" '
                       f'height="{max(y(base) - y(base + h) - 2, 0.5):.1f}" rx="2" fill="var(--c{si})"/></g>')
            base += h
        if k % 2 == 0 or steps <= 13:
            out.append(f'<text class="m" x="{x + bw / 2:.1f}" y="{H - 20}" text-anchor="middle">{bwk.week}</text>')
    out.append(f'<text class="m" x="{(ml + W - mr) / 2}" y="{H - 4}" text-anchor="middle">week</text></svg>')
    legend = "".join(f'<span style="margin-right:14px"><svg width="10" height="10" viewBox="0 0 10 10" style="display:inline"><rect width="10" height="10" rx="2" fill="var(--c{i})"/></svg> {e(s)}</span>'
                     for i, s in enumerate(series))
    base_rows = "".join(f"<tr><td>{e(RULE_LABELS[k])}</td><td class=\"n\">{_pct(v)}</td></tr>" for k, v in b.baselines.items())
    crow = "".join(f'<tr><td>{e(c.name)}</td><td class="n">{c.arr:,.0f}</td><td class="n">{_pct(c.start_yield)} to {_pct(c.end_yield)}</td>'
                   f'<td class="n">{c.hours:.1f}</td><td class="n">{c.hours_share:.0%}</td><td class="n">{c.jobs}</td></tr>' for c in b.customers)
    jrow = "".join(f'<tr><td class="n">{j.week}</td><td>{e(j.customer)}</td><td>{e(j.title)}</td><td class="n">{j.hours:.1f}</td><td class="n">+{j.gain_points:.1f} pts</td></tr>' for j in b.jobs[:top])
    dips = "".join(f"<li><strong>{e(c.name)}</strong>: week {d['week']}, Yield dips {d['drop_points']:.1f} pts.</li>" for c in b.customers for d in c.dips[:1])
    notes = "".join(f'<p class="warn">{e(x)}</p>' for x in b.notes)
    table = ('<details><summary>Table view</summary><table><thead><tr><th class="n">Week</th>'
             + "".join(f'<th class="n">{e(s)}</th>' for s in series) + '<th class="n">Weighted Yield</th></tr></thead><tbody>'
             + "".join("<tr><td class=\"n\">" + str(bwk.week) + "</td>" + "".join(
                 f'<td class="n">{(bwk.hours.get(s, 0.0) if s != "Other" else sum(bwk.hours.get(c.name, 0.0) for c in others)):.1f}</td>' for s in series)
                 + f'<td class="n">{_pct(bwk.weighted_yield)}</td></tr>' for bwk in b.weeks[1:]) + '</tbody></table></details>')
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>Book plan</title><style>{CSS}:root{{{css_vars}}}@media (prefers-color-scheme:dark){{:root{{{dark_vars}}}}}</style></head><body><main>'
            f'<header><h1>Book plan</h1><p>{b.hours_per_week:g} hours a week, {b.horizon_weeks} weeks, {n} customers, {e(b.weighting)}-weighted, {b.realization:.0%} realization</p></header>'
            f'<section><h2>Weighted Yield</h2><div class="hero"><div><div class="big">{_pct(b.weighted_end)}</div><div class="cap">at the horizon, from {_pct(b.weighted_start)}</div></div></div>'
            + (f'<table><thead><tr><th>Allocation rule</th><th class="n">Weighted Yield</th></tr></thead><tbody><tr><td><strong>Exact gain per hour (this plan)</strong></td><td class="n"><strong>{_pct(b.weighted_end)}</strong></td></tr>{base_rows}</tbody></table>' if b.baselines else '')
            + f'{notes}</section>'
            f'<section><h2>Where the hours go</h2>{"".join(out)}<p style="margin-top:8px">{legend}</p>{table}</section>'
            f'<section><h2>Customers</h2><table><thead><tr><th>Customer</th><th class="n">ARR</th><th class="n">Yield</th><th class="n">Hours</th><th class="n">Share</th><th class="n">Jobs</th></tr></thead><tbody>{crow}</tbody></table></section>'
            f'<section><h2>First jobs</h2><table><thead><tr><th class="n">Week</th><th>Customer</th><th>Job</th><th class="n">Hours</th><th class="n">Effect</th></tr></thead><tbody>{jrow}</tbody></table>'
            + (f'<h3 style="font-size:14px;margin:12px 0 4px">Dips to warn customers about</h3><ul>{dips}</ul>' if dips else '')
            + '</section><footer>Generated by beyond90. A model: it rests on the effort figures and ramp assumptions in the catalogue.</footer></main></body></html>')
