"""A dated roadmap: which actions, in which order, and what the score does week by week.

The planner is greedy on *exact* gain per hour: for every candidate action it
simulates the converged state (``simulate.apply_ops(..., steady=True)``) and
rescores the whole estate, so interactions between stages are included. It then
spends a weekly budget of hours on the best action, applies the change to the
simulated estate (with the ramp that real connections need), regenerates the
actions from the new state, and repeats. Follow-up work therefore appears on its
own: connecting accounts creates enablement work, assigning owners creates
decision work.

The projection is a model, not a promise. It rests on the effort figures in the
playbook catalogue, the ramp model and the assumptions in ``simulate.py``.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

from .catalogue import Catalogue
from .models import CustomerData
from .playbooks import Action, generate_actions
from .scoring import CHECKPOINTS, compute_score
from .simulate import Deferred, RampModel, apply_ops, quick_stages, quick_yield, settle_pending

MIN_HOURS = 0.25
EPS = 1e-9


@dataclass
class Job:
    action_id: str
    title: str
    playbook: str
    leak: str
    units: float
    hours: float
    started_week: int
    done_week: int
    steady_gain_points: float


@dataclass
class WeekState:
    week: int
    yield_: float
    stages: dict[str, float]
    hours_used: float = 0.0
    completed: list[str] = field(default_factory=list)
    events: list[str] = field(default_factory=list)


@dataclass
class Plan:
    customer: str
    as_of: str
    hours_per_week: float
    horizon_weeks: int
    realization: float
    weeks: list[WeekState]
    jobs: list[Job]
    milestones: dict[str, Optional[int]]
    dips: list[dict]
    residual: dict[str, int]
    notes: list[str]

    @property
    def start_yield(self) -> float:
        return self.weeks[0].yield_

    @property
    def end_yield(self) -> float:
        return self.weeks[-1].yield_

    def to_dict(self) -> dict:
        d = asdict(self)
        for w in d["weeks"]:
            w["yield"] = w.pop("yield_")
        return d


def _restrict(action: Action, pending: set[str], blocked: set, cat: Catalogue) -> Optional[Action]:
    """Drop accounts still ramping and units assumed blocked; None if nothing is left to do."""
    ops = []
    for op in action.ops:
        if "accounts" in op:
            ids = [a for a in op["accounts"] if a not in pending and _key(op, a) not in blocked]
            if not ids:
                return None
            op = {**op, "accounts": ids}
        elif "findings" in op:
            ids = [f for f in op["findings"] if _key(op, f) not in blocked]
            if not ids:
                return None
            op = {**op, "findings": ids}
        ops.append(op)
    if not ops:
        return None
    n = len(ops[0].get("accounts") or ops[0].get("findings") or [])
    p = cat.playbooks[action.playbook]
    hours = round(p.effort_base + p.effort_per_unit * n, 2)
    return Action(**{**action.__dict__, "ops": ops, "units": n, "effort_hours": hours})


def _key(op: dict, ident: str) -> tuple[str, str, str]:
    return (op["op"], op.get("resource_type") or op.get("module") or "", ident)


def _realize(ops: list[dict], rate: float) -> tuple[list[dict], set[tuple[str, str, str]]]:
    """Not every unit of an action succeeds (a blocked account, a finding that needs a vendor fix).

    Apply the first ``round(n x rate)`` ids of each op, at least one. The rest is
    assumed blocked: it never succeeds in this plan and is reported as a residual
    that needs escalation, so the projection plateaus instead of reaching 100%.
    """
    blocked: set[tuple[str, str, str]] = set()
    if rate >= 1.0:
        return ops, blocked
    out = []
    for op in ops:
        key = "accounts" if "accounts" in op else "findings" if "findings" in op else None
        if key and len(op[key]) > 1:
            k = max(1, round(len(op[key]) * rate))
            blocked |= {_key(op, i) for i in op[key][k:]}
            op = {**op, key: op[key][:k]}
        out.append(op)
    return out, blocked


def build_plan(
    data: CustomerData,
    cat: Optional[Catalogue] = None,
    *,
    hours_per_week: float = 8.0,
    horizon_weeks: int = 26,
    ramp: RampModel = RampModel(),
    realization: float = 0.9,
) -> Plan:
    if hours_per_week <= 0 or horizon_weeks <= 0:
        raise ValueError("hours_per_week and horizon_weeks must be positive")
    if not 0 < realization <= 1:
        raise ValueError("realization must be in (0, 1]")
    cat = cat or Catalogue.load()
    state = data
    deferred: list[Deferred] = []
    pending: set[str] = set()
    blocked: set[tuple[str, str, str]] = set()
    jobs: list[Job] = []
    notes: list[str] = []

    def snapshot(week: int, hours: float, done: list[str], events: list[str]) -> WeekState:
        st = quick_stages(state, cat)
        return WeekState(week, st["L1"] * st["L2"] * st["L3"] * st["L4"], st, round(hours, 2), done, events)

    weeks = [snapshot(0, 0.0, [], [])]
    current: Optional[tuple[Action, float, int, float]] = None  # action, remaining hours, started week, steady gain

    def choose() -> Optional[tuple[Action, float]]:
        score = compute_score(state, cat)
        base = settle_pending(state, pending, cat)
        y0 = quick_yield(base, cat)
        best: Optional[tuple[float, str, Action, float]] = None
        for a in generate_actions(state, score, cat):
            a2 = _restrict(a, pending, blocked, cat)
            if a2 is None:
                continue
            after, _ = apply_ops(base, a2.ops, cat, steady=True)
            gain = quick_yield(after, cat) - y0
            if gain <= EPS:
                continue
            key = (gain / max(a2.effort_hours, MIN_HOURS), a2.id)
            if best is None or key[0] > best[0] + 1e-12 or (abs(key[0] - best[0]) <= 1e-12 and key[1] < best[1]):
                best = (key[0], key[1], a2, gain)
        return None if best is None else (best[2], best[3])

    for week in range(1, horizon_weeks + 1):
        events: list[str] = []
        done: list[str] = []
        due = [d for d in deferred if d.week <= week]
        deferred = [d for d in deferred if d.week > week]
        settled = 0
        for d in due:
            state, _ = apply_ops(state, d.ops, cat, week=week)
            for op in d.ops:
                if op["op"] == "settle":
                    pending -= set(op["accounts"])
                    settled += len(op["accounts"])
        if settled:
            events.append(f"Inventory completes and agentless modules switch on for {settled} newly connected account(s).")
        connected_now = 0
        budget = hours_per_week
        used = 0.0
        while budget > EPS:
            if current is None:
                pick = choose()
                if pick is None:
                    break
                a, gain = pick
                current = (a, max(a.effort_hours, MIN_HOURS), week, gain)
            a, remaining, started, gain = current
            spend = min(budget, remaining)
            budget -= spend
            used += spend
            remaining -= spend
            if remaining > EPS:
                current = (a, remaining, started, gain)
                break
            applied, newly_blocked = _realize(a.ops, realization)
            blocked |= newly_blocked
            state, new_deferred = apply_ops(state, applied, cat, week=week, ramp=ramp)
            deferred.extend(new_deferred)
            for d in new_deferred:
                for op in d.ops:
                    pending |= set(op["accounts"])
            jobs.append(Job(a.id, a.title, a.playbook, a.leak, a.units, a.effort_hours, started, week, round(gain * 100, 2)))
            done.append(a.title)
            connected_now += sum(len(op["accounts"]) for op in applied if op["op"] == "connect")
            current = None
        if connected_now:
            events.append(f"{connected_now} account(s) connected: they enter L2 and L3 with nothing covered yet, so Yield dips before it recovers.")
        weeks.append(snapshot(week, used, done, events))
        if current is None and not deferred and used <= EPS:
            notes.append(f"No further action improves Yield after week {week - 1}; the plan stops there.")
            weeks.pop()
            break

    if current is not None:
        notes.append(f"Work in progress at the horizon: {current[0].title}.")
    if deferred:
        notes.append("Some changes were still ramping at the horizon; Yield is higher once they settle.")

    milestones: dict[str, Optional[int]] = {}
    for c in CHECKPOINTS:
        milestones[f"{int(c * 100)}%"] = next((w.week for w in weeks if w.yield_ >= c - 1e-12), None)
    dips = []
    for prev, cur in zip(weeks, weeks[1:]):
        if cur.yield_ < prev.yield_ - 1e-9:
            dips.append({"week": cur.week, "drop_points": round((prev.yield_ - cur.yield_) * 100, 2),
                         "cause": cur.events[-1] if cur.events else "A change made earlier took effect."})
    residual: dict[str, int] = {}
    for op, extra, _ in blocked:
        label = {"connect": "accounts that could not be connected", "inventory": "inventory gaps that could not be closed",
                 "enable": "module activations that did not happen", "own": "findings that stayed unowned",
                 "decide": "findings that stayed undecided", "set_expiry": "accepted risks that stayed unreviewed"}[op]
        residual[label] = residual.get(label, 0) + 1
    if residual:
        notes.append(f"At {realization:.0%} realization the plan plateaus: the residual needs escalation, not more of the same effort.")
    if not jobs:
        notes.append("There is nothing to plan: no open action changes Yield.")
    return Plan(data.name, data.as_of.isoformat(), hours_per_week, horizon_weeks, realization, weeks, jobs, milestones, dips, residual, notes)
