"""A dated roadmap: which actions, in which order, and what the score does week by week.

The planner is greedy on *exact* gain per hour: for every candidate action it
simulates the converged state (``simulate.apply_ops(..., steady=True)``) and
rescores the estate, so interactions between stages are included. It then spends
a weekly budget of hours on the best action, applies the change to the simulated
estate (with the ramp real connections need), regenerates the actions from the
new state, and repeats. Follow-up work appears on its own: connecting accounts
creates enablement work, assigning owners creates decision work.

``CustomerPlanner`` is the stepping engine for one customer. ``build_plan`` runs
it alone; ``book.py`` runs several against one shared budget of hours.

The projection is a model, not a promise. It rests on the effort figures in the
playbook catalogue, the ramp model, the realization rate and the assumptions in
``simulate.py``.
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass, field
from typing import Optional

from .catalogue import Catalogue
from .models import CustomerData
from .playbooks import Action, generate_actions
from .scoring import CHECKPOINTS, compute_score
from .simulate import DEFAULT_RAMP, Deferred, RampModel, affected_stages, apply_ops, quick_stages, settle_pending

MIN_HOURS = 0.25
EPS = 1e-9

BLOCKED_LABELS = {
    "connect": "accounts that could not be connected",
    "inventory": "inventory gaps that could not be closed",
    "enable": "module activations that did not happen",
    "own": "findings that stayed unowned",
    "decide": "findings that stayed undecided",
    "set_expiry": "accepted risks that stayed unreviewed",
}


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


@dataclass
class Pick:
    """The next piece of work a customer wants, and how much of it is left."""
    action: Action
    gain: float            # Yield gained when it has fully taken effect (a fraction, not points)
    remaining_hours: float


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


def _batch(action: Action, hours_per_week: float, cat: Catalogue) -> Action:
    """Split an action that would take longer than a week into the first batch that fits.

    Large estates have actions worth hundreds of hours ("connect 160 accounts"). Planning
    them as one lump would show nothing for months; a batch is a real unit of weekly work,
    taken from the head of the list (accounts are ordered by spend, so the biggest go first).
    """
    if action.effort_hours <= hours_per_week:
        return action
    p = cat.playbooks[action.playbook]
    n = int(action.units)
    fit = n if p.effort_per_unit <= 0 else int((hours_per_week - p.effort_base) / p.effort_per_unit)
    k = max(1, min(n, fit))
    if k >= n:
        return action
    ops = []
    for op in action.ops:
        key = "accounts" if "accounts" in op else "findings" if "findings" in op else None
        ops.append({**op, key: op[key][:k]} if key else op)
    hours = round(p.effort_base + p.effort_per_unit * k, 2)
    title = re.sub(r" \(\d+\)$", "", action.title)          # drop a trailing "(13)" count; the batch size replaces it
    return Action(**{**action.__dict__, "ops": ops, "units": k, "effort_hours": hours, "title": f"{title}: first {k} of {n}"})


class CustomerPlanner:
    """Steps one customer through time. Spend hours with :meth:`work`, advance with the week methods."""

    def __init__(
        self,
        data: CustomerData,
        cat: Catalogue,
        *,
        hours_per_week: float,
        realization: float = 0.9,
        ramp: RampModel = DEFAULT_RAMP,
    ) -> None:
        if not 0 < realization <= 1:
            raise ValueError("realization must be in (0, 1]")
        self.data, self.cat = data, cat
        self.state = data
        self.batch_hours = hours_per_week
        self.realization, self.ramp = realization, ramp
        self.deferred: list[Deferred] = []
        self.pending: set[str] = set()
        self.blocked: set[tuple[str, str, str]] = set()
        self.jobs: list[Job] = []
        self.current: Optional[tuple[Action, float, int, float]] = None   # action, remaining hours, started week, gain
        self.versions = {"L1": 0, "L2": 0, "L3": 0, "L4": 0}              # bumped whenever a stage's inputs change
        self._cache: dict[tuple, Optional[dict[str, float]]] = {}
        self._pick: Optional[Pick] = None
        self._pick_valid = False
        self._events: list[str] = []
        self._done: list[str] = []
        self._connected_now = 0
        self.weeks = [self._snapshot(0, 0.0, [], [])]

    # ---------------------------------------------------------------- helpers
    def _snapshot(self, week: int, hours: float, done: list[str], events: list[str]) -> WeekState:
        st = quick_stages(self.state, self.cat)
        return WeekState(week, st["L1"] * st["L2"] * st["L3"] * st["L4"], st, round(hours, 2), done, events)

    def _changed(self, ops: list[dict]) -> None:
        for s in affected_stages(ops):
            self.versions[s] += 1
        self._pick_valid = False

    def _choose(self) -> Optional[Pick]:
        cat = self.cat
        score = compute_score(self.state, cat)
        base = settle_pending(self.state, self.pending, cat)
        base_stages = quick_stages(base, cat)
        y0 = math.prod(base_stages.values())
        pending_sig = hash(frozenset(self.pending))
        best: Optional[tuple[float, str, Action, float]] = None
        for a in generate_actions(self.state, score, cat):
            a2 = _restrict(a, self.pending, self.blocked, cat)
            if a2 is None:
                continue
            a2 = _batch(a2, self.batch_hours, cat)
            aff = affected_stages(a2.ops)
            ids_sig = hash(tuple(tuple(op.get("accounts") or op.get("findings") or ()) for op in a2.ops))
            key = (a2.id, ids_sig, tuple(self.versions[x] for x in sorted(aff)), pending_sig if aff & {"L2", "L3"} else 0)
            ratios = self._cache.get(key)
            gain: float
            if key not in self._cache:
                after, _ = apply_ops(base, a2.ops, cat, steady=True)
                new_stages = quick_stages(after, cat, only=aff, reuse=base_stages)
                if any(base_stages[x] <= 0 for x in aff):
                    gain = math.prod(new_stages.values()) - y0       # a zero stage has no ratio: compute directly, do not cache
                    ratios = None
                else:
                    ratios = {x: new_stages[x] / base_stages[x] for x in aff}
                    self._cache[key] = ratios
                    gain = y0 * (math.prod(ratios.values()) - 1.0)
            else:
                assert ratios is not None
                gain = y0 * (math.prod(ratios.values()) - 1.0)
            if gain <= EPS:
                continue
            rank = gain / max(a2.effort_hours, MIN_HOURS)
            if best is None or rank > best[0] + 1e-12 or (abs(rank - best[0]) <= 1e-12 and a2.id < best[1]):
                best = (rank, a2.id, a2, gain)
        if best is None:
            return None
        return Pick(best[2], best[3], max(best[2].effort_hours, MIN_HOURS))

    # ------------------------------------------------------------------- api
    def begin_week(self, week: int) -> None:
        self._events, self._done, self._connected_now = [], [], 0
        due = [d for d in self.deferred if d.week <= week]
        self.deferred = [d for d in self.deferred if d.week > week]
        settled = 0
        for d in due:
            self.state, _ = apply_ops(self.state, d.ops, self.cat, week=week)
            self._changed(list(d.ops))
            for op in d.ops:
                if op["op"] == "settle":
                    self.pending -= set(op["accounts"])
                    settled += len(op["accounts"])
        if settled:
            self._events.append(f"Inventory completes and agentless modules switch on for {settled} newly connected account(s).")

    def peek(self) -> Optional[Pick]:
        """What this customer would work on next, without spending anything."""
        if self.current is not None:
            a, remaining, _, gain = self.current
            return Pick(a, gain, remaining)
        if not self._pick_valid:
            self._pick, self._pick_valid = self._choose(), True
        return self._pick

    def work(self, week: int, budget: float) -> float:
        """Spend up to ``budget`` hours on the current or next job; returns the hours used."""
        if budget <= EPS:
            return 0.0
        if self.current is None:
            pick = self.peek()
            if pick is None:
                return 0.0
            self.current = (pick.action, pick.remaining_hours, week, pick.gain)
            self._pick_valid = False
        a, remaining, started, gain = self.current
        spend = min(budget, remaining)
        remaining -= spend
        if remaining > EPS:
            self.current = (a, remaining, started, gain)
            return spend
        applied, newly_blocked = _realize(a.ops, self.realization)
        self.blocked |= newly_blocked
        self.state, new_deferred = apply_ops(self.state, applied, self.cat, week=week, ramp=self.ramp)
        self._changed(applied)
        self.deferred.extend(new_deferred)
        for d in new_deferred:
            for op in d.ops:
                self.pending |= set(op["accounts"])
        self.jobs.append(Job(a.id, a.title, a.playbook, a.leak, a.units, a.effort_hours, started, week, round(gain * 100, 2)))
        self._done.append(a.title)
        self._connected_now += sum(len(op["accounts"]) for op in applied if op["op"] == "connect")
        self.current = None
        self._pick_valid = False
        return spend

    def end_week(self, week: int, hours_used: float) -> WeekState:
        events = list(self._events)
        if self._connected_now:
            events.append(f"{self._connected_now} account(s) connected: they enter L2 and L3 with nothing covered yet, so Yield dips before it recovers.")
        w = self._snapshot(week, hours_used, list(self._done), events)
        self.weeks.append(w)
        return w

    @property
    def idle(self) -> bool:
        return self.current is None and not self.deferred and self.peek() is None

    def finalize(self, hours_per_week: float, horizon_weeks: int) -> Plan:
        notes: list[str] = []
        if self.current is not None:
            notes.append(f"Work in progress at the horizon: {self.current[0].title}.")
        if self.deferred:
            notes.append("Some changes were still ramping at the horizon; Yield is higher once they settle.")
        weeks = self.weeks
        milestones: dict[str, Optional[int]] = {
            f"{int(c * 100)}%": next((w.week for w in weeks if w.yield_ >= c - 1e-12), None) for c in CHECKPOINTS
        }
        dips = []
        for prev, cur in zip(weeks, weeks[1:]):
            if cur.yield_ < prev.yield_ - 1e-9:
                dips.append({"week": cur.week, "drop_points": round((prev.yield_ - cur.yield_) * 100, 2),
                             "cause": cur.events[-1] if cur.events else "A change made earlier took effect."})
        residual: dict[str, int] = {}
        for kind, _, _ in self.blocked:
            label = BLOCKED_LABELS[kind]
            residual[label] = residual.get(label, 0) + 1
        if residual:
            notes.append(f"At {self.realization:.0%} realization the plan plateaus: the residual needs escalation, not more of the same effort.")
        if not self.jobs:
            notes.append("There is nothing to plan: no open action changes Yield.")
        return Plan(self.data.name, self.data.as_of.isoformat(), hours_per_week, horizon_weeks, self.realization,
                    weeks, self.jobs, milestones, dips, residual, notes)


def build_plan(
    data: CustomerData,
    cat: Optional[Catalogue] = None,
    *,
    hours_per_week: float = 8.0,
    horizon_weeks: int = 26,
    ramp: RampModel = DEFAULT_RAMP,
    realization: float = 0.9,
) -> Plan:
    if hours_per_week <= 0 or horizon_weeks <= 0:
        raise ValueError("hours_per_week and horizon_weeks must be positive")
    cat = cat or Catalogue.load()
    eng = CustomerPlanner(data, cat, hours_per_week=hours_per_week, realization=realization, ramp=ramp)
    stopped_note = ""
    for week in range(1, horizon_weeks + 1):
        eng.begin_week(week)
        budget, used = hours_per_week, 0.0
        while budget > EPS:
            spent = eng.work(week, budget)
            if spent <= EPS:
                break
            budget -= spent
            used += spent
        if used <= EPS and eng.current is None and not eng.deferred:
            stopped_note = f"No further action improves Yield after week {week - 1}; the plan stops there."
            break
        eng.end_week(week, used)
    plan = eng.finalize(hours_per_week, horizon_weeks)
    if stopped_note:
        plan.notes.insert(0, stopped_note)
    return plan
