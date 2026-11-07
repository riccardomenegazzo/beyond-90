"""What-if scenarios: change the data on paper, rescore, and say what it would take to reach a target.

Two questions a TAM is asked in every review:

* "If we do X, where does Yield land, and does it dip first?"  -> :func:`run`
* "What would it take to reach 90%?"                           -> :func:`reach`

Both reuse :func:`beyond90.simulate.apply_ops`, so the numbers come from the same engine as the score.
Nothing is written anywhere: every scenario works on a copy.

A scenario is plain data (so the command line, the browser and the MCP server share it)::

    {"name": "Connect everything", "steps": [{"kind": "connect_all"}, {"kind": "enable_all"}]}

Step kinds:

``connect_all``         connect every active account that is not connected
``connect``             ``accounts``: connect these accounts
``enable_module``       ``module`` (and optionally ``accounts``): switch the module on where it can run
``enable_all``          switch on every module the ceiling version allows, wherever it can run
``fix_findings``        ``leak`` (``unowned``, ``no_decision``, ``accepted_without_expiry``,
                        ``expired_acceptance`` or ``all``): give the open findings an owner, a decision or an expiry

Each scenario reports three readings: today, right after the steps (connecting dips first: the J-curve), and
the steady state once inventory has settled. Effort is not estimated here; use ``plan`` for hours and weeks.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Optional

from .catalogue import Catalogue
from .models import CustomerData
from .scoring import _active_accounts, _triaged, classify_finding
from .simulate import DEFAULT_RAMP, RampModel, apply_ops, quick_stages

STEP_KINDS = ("connect_all", "connect", "enable_module", "enable_all", "fix_findings")
LEAKS = ("unowned", "no_decision", "accepted_without_expiry", "expired_acceptance")
MAX_STEPS = 50
MAX_SCENARIOS = 20
_DIP = 0.0005  # half a tenth of a point: below this a "dip" is rounding


class ScenarioError(ValueError):
    """The scenario is not well formed. The message says which part."""


def _stages(data: CustomerData, cat: Catalogue) -> dict[str, float]:
    return quick_stages(data, cat)


def _yield(stages: Mapping[str, float]) -> float:
    return stages["L1"] * stages["L2"] * stages["L3"] * stages["L4"]


def _eligible(data: CustomerData, cat: Catalogue, module_id: str, only: Optional[set[str]] = None) -> list[str]:
    """Accounts where the module can run and is not already on."""
    mod = next((m for m in cat.modules_at(data.settings.ceiling_version) if m.id == module_id), None)
    if mod is None:
        return []
    on = {(a.account_id, a.module_id) for a in data.activations if a.active}
    return sorted(
        a.id for a in _active_accounts(data)
        if a.connected and a.provider in mod.providers and (a.id, mod.id) not in on and (only is None or a.id in only)
    )


def _leaking(data: CustomerData, leak: str) -> list[str]:
    ids = []
    for f in _triaged(data):
        kind = classify_finding(f, data.as_of)
        if kind != "ok" and leak in ("all", kind):
            ids.append(f.id)
    return sorted(ids)


def _ops_for(data: CustomerData, cat: Catalogue, step: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The engine operations a step means on the data as it stands now."""
    kind = step.get("kind")
    if kind == "connect_all":
        ids = sorted(a.id for a in _active_accounts(data) if not a.connected)
        return [{"op": "connect", "accounts": ids}] if ids else []
    if kind == "connect":
        known = {a.id for a in data.accounts}
        wanted = step.get("accounts")
        if not isinstance(wanted, list) or not wanted:
            raise ScenarioError("connect: 'accounts' must be a non-empty list")
        unknown = sorted(str(x) for x in wanted if str(x) not in known)
        if unknown:
            raise ScenarioError(f"connect: unknown account(s): {', '.join(unknown[:5])}")
        ids = sorted(str(x) for x in wanted if any(a.id == str(x) and not a.connected for a in data.accounts))
        return [{"op": "connect", "accounts": ids}] if ids else []
    if kind == "enable_module":
        module = step.get("module")
        if not isinstance(module, str) or module not in {m.id for m in cat.modules_at(data.settings.ceiling_version)}:
            raise ScenarioError(f"enable_module: unknown module {module!r} at version {data.settings.ceiling_version}")
        only = {str(x) for x in step["accounts"]} if isinstance(step.get("accounts"), list) else None
        ids = _eligible(data, cat, module, only)
        return [{"op": "enable", "module": module, "accounts": ids}] if ids else []
    if kind == "enable_all":
        ops = []
        for m in cat.modules_at(data.settings.ceiling_version):
            ids = _eligible(data, cat, m.id)
            if ids:
                ops.append({"op": "enable", "module": m.id, "accounts": ids})
        return ops
    if kind == "fix_findings":
        leak = step.get("leak", "all")
        if leak != "all" and leak not in LEAKS:
            raise ScenarioError(f"fix_findings: 'leak' must be one of all, {', '.join(LEAKS)}")
        ops = []
        for name, op in (("unowned", "own"), ("no_decision", "decide"),
                         ("accepted_without_expiry", "set_expiry"), ("expired_acceptance", "set_expiry")):
            if leak in ("all", name):
                ids = _leaking(data, name)
                if ids:
                    ops.append({"op": op, "findings": ids})
        # a finding with no owner and no decision needs both, in that order
        if leak in ("all", "unowned"):
            both = _leaking(data, "unowned")
            if both:
                ops.append({"op": "decide", "findings": both})
        return ops
    raise ScenarioError(f"unknown step kind {kind!r}; use one of {', '.join(STEP_KINDS)}")


def _touched(ops: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    out = {"accounts_connected": 0, "activations_added": 0, "findings_fixed": 0}
    fixed: set[str] = set()
    for op in ops:
        if op["op"] == "connect":
            out["accounts_connected"] += len(op["accounts"])
        elif op["op"] == "enable":
            out["activations_added"] += len(op["accounts"])
        else:
            fixed |= set(op["findings"])
    out["findings_fixed"] = len(fixed)
    return out


def _clean(scenario: Mapping[str, Any], index: int) -> tuple[str, list[Mapping[str, Any]]]:
    if not isinstance(scenario, Mapping):
        raise ScenarioError(f"scenario {index + 1}: must be an object")
    steps = scenario.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ScenarioError(f"scenario {index + 1}: 'steps' must be a non-empty list")
    if len(steps) > MAX_STEPS:
        raise ScenarioError(f"scenario {index + 1}: at most {MAX_STEPS} steps")
    for s in steps:
        if not isinstance(s, Mapping) or s.get("kind") not in STEP_KINDS:
            raise ScenarioError(f"scenario {index + 1}: each step needs a 'kind' of {', '.join(STEP_KINDS)}")
    name = str(scenario.get("name") or f"Scenario {index + 1}")[:80]
    return name, list(steps)


def _row(stages: Mapping[str, float], base: Mapping[str, float]) -> dict[str, Any]:
    y = _yield(stages)
    return {
        "yield": y,
        "delta_points": (y - _yield(base)) * 100,
        "stages": {k: stages[k] for k in ("L1", "L2", "L3", "L4")},
    }


def run_one(
    data: CustomerData,
    cat: Catalogue,
    name: str,
    steps: Sequence[Mapping[str, Any]],
    ramp: RampModel = DEFAULT_RAMP,
) -> dict[str, Any]:
    """Apply the steps to a copy twice: as it looks right after, and once everything has settled."""
    base = _stages(data, cat)
    now, steady = data, data
    all_ops: list[dict[str, Any]] = []
    for step in steps:
        ops_now = _ops_for(now, cat, step)
        now, _ = apply_ops(now, ops_now, cat, ramp=ramp)
        ops_steady = _ops_for(steady, cat, step)
        steady, _ = apply_ops(steady, ops_steady, cat, steady=True)
        all_ops += ops_steady
    after, settled = _stages(now, cat), _stages(steady, cat)
    dip = _yield(after) < _yield(base) - _DIP
    notes = []
    if not all_ops:
        notes.append("Nothing in these steps changes the data: everything they ask for is already true, or cannot run here.")
    if dip:
        notes.append(
            f"Yield dips first ({(_yield(after) - _yield(base)) * 100:+.1f} pts) while inventory settles "
            f"(about {ramp.inventory_lag_weeks} weeks), then reaches the steady state."
        )
    return {
        "name": name,
        "today": {"yield": _yield(base), "stages": dict(base)},
        "right_after": _row(after, base),
        "steady": _row(settled, base),
        "dip": dip,
        "touched": _touched(all_ops),
        "notes": notes,
    }


def run(
    data: CustomerData,
    cat: Catalogue,
    scenarios: Sequence[Mapping[str, Any]],
    ramp: RampModel = DEFAULT_RAMP,
) -> dict[str, Any]:
    """Several scenarios side by side, best steady-state first (ties keep the order given)."""
    if not isinstance(scenarios, Sequence) or isinstance(scenarios, (str, bytes)) or not scenarios:
        raise ScenarioError("give at least one scenario")
    if len(scenarios) > MAX_SCENARIOS:
        raise ScenarioError(f"at most {MAX_SCENARIOS} scenarios at a time")
    out = [run_one(data, cat, *_clean(s, i), ramp=ramp) for i, s in enumerate(scenarios)]
    out.sort(key=lambda r: -r["steady"]["yield"])
    return {
        "customer": data.name,
        "as_of": data.as_of.isoformat(),
        "scenarios": out,
        "assumptions": _ASSUMPTIONS,
    }


_ASSUMPTIONS = [
    "Steady state assumes inventory has completed and the agentless modules are on after connecting; other modules stay off until a step enables them.",
    "Newly inventoried resource types count as present, which can only make L3 look worse, never better.",
    "Fixed findings get an assigned owner, a 'fix' decision, or a 90-day expiry: the process is repaired, the findings are not closed.",
    "Effort and calendar time are not estimated here. Use the roadmap (plan) for hours and weeks.",
]


def _candidates(data: CustomerData, cat: Catalogue) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    if any(not a.connected for a in _active_accounts(data)):
        out.append(("Connect the accounts that are not connected", {"kind": "connect_all"}))
    for m in cat.modules_at(data.settings.ceiling_version):
        n = len(_eligible(data, cat, m.id))
        if n:
            out.append((f"Enable {m.name} on {n} account{'s' if n != 1 else ''}", {"kind": "enable_module", "module": m.id}))
    labels = {
        "unowned": "Give an owner to findings without one",
        "no_decision": "Record a decision on owned findings",
        "accepted_without_expiry": "Put an expiry on accepted risks",
        "expired_acceptance": "Renew expired risk acceptances",
    }
    for leak in LEAKS:
        n = len(_leaking(data, leak))
        if n:
            out.append((f"{labels[leak]} ({n})", {"kind": "fix_findings", "leak": leak}))
    return out


def reach(data: CustomerData, cat: Catalogue, target: float = 0.9, max_steps: int = 30) -> dict[str, Any]:
    """The smallest greedy sequence of changes that reaches ``target`` Yield in the steady state.

    Greedy means each step is the one that adds the most at that moment. It is a good order to start in, not a
    proof of the shortest path, and it says nothing about effort: a small gain can be hard and a large one easy.
    """
    if not 0.0 < target <= 1.0:
        raise ScenarioError("target must be above 0 and at most 1 (for example 0.9)")
    base = _stages(data, cat)
    current, y = data, _yield(base)
    start = y
    path: list[dict[str, Any]] = []
    while y < target and len(path) < max(1, min(max_steps, 60)):
        best: Optional[tuple[float, str, dict[str, Any], CustomerData]] = None
        for label, step in _candidates(current, cat):
            ops = _ops_for(current, cat, step)
            if not ops:
                continue
            nxt, _ = apply_ops(current, ops, cat, steady=True)
            gain = _yield(_stages(nxt, cat)) - y
            if best is None or gain > best[0] + 1e-12:
                best = (gain, label, step, nxt)
        if best is None or best[0] <= 1e-9:
            break
        gain, label, step, current = best
        y += gain
        path.append({"step": step, "title": label, "gain_points": gain * 100, "yield_after": y})
    return {
        "customer": data.name,
        "as_of": data.as_of.isoformat(),
        "target": target,
        "start_yield": start,
        "end_yield": y,
        "reached": y >= target,
        "path": path,
        "assumptions": _ASSUMPTIONS,
        "notes": [] if y >= target else [(
            "The target is not reachable with the changes this engine can model (connecting, enabling modules, "
            "repairing ownership and decisions). What is left needs something else, for example modules the "
            "customer does not license or accounts that cannot be connected."
        )],
    }
