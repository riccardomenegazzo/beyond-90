"""What-if engine: apply an action's changes to a copy of the data and rescore.

This is what makes the estimates exact instead of isolated, and it shows
something a dashboard cannot: **connecting an account first lowers the score.**
A newly connected account enters the denominators of L2 and L3 with nothing
inventoried and most modules off, so Yield dips before it recovers (the J-curve
of adoption). A TAM who promises "connect the eight accounts and we reach 90%"
is wrong for several weeks; this module quantifies how wrong and for how long.

Assumptions (all explicit and editable):

* Connecting an account makes its inventory complete after ``inventory_lag_weeks``
  and switches on the modules marked ``on_connect`` in the catalogue (the
  agentless ones). Other modules stay off until someone enables them.
* Newly inventoried types are assumed to contain at least one resource, so they
  count as relevant for the modules that need them. This is the conservative
  choice: it can only make L3 look worse, never better.
* Ownership and decisions are applied as ``owner="(assigned)"`` and ``decision="fix"``.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Iterable, Optional

from .catalogue import Catalogue
from .models import Activation, CustomerData, InventoryRow
from .scoring import stage_l1, stage_l2, stage_l3, stage_l4


@dataclass(frozen=True)
class RampModel:
    inventory_lag_weeks: int = 2


@dataclass(frozen=True)
class Deferred:
    week: int
    ops: tuple[dict, ...]


def quick_stages(data: CustomerData, cat: Catalogue, ceiling: Optional[str] = None) -> dict[str, float]:
    """Stage values only (no outcomes, no leak formatting beyond what the stages compute)."""
    ceiling = ceiling or data.settings.ceiling_version
    return {
        "L1": stage_l1(data).value,
        "L2": stage_l2(data, cat).value,
        "L3": stage_l3(data, cat, ceiling).value,
        "L4": stage_l4(data).value,
    }


def quick_yield(data: CustomerData, cat: Catalogue, ceiling: Optional[str] = None) -> float:
    s = quick_stages(data, cat, ceiling)
    return s["L1"] * s["L2"] * s["L3"] * s["L4"]


def _clone(data: CustomerData) -> CustomerData:
    # Rows are frozen dataclasses; copying the lists is enough.
    return replace(
        data,
        accounts=list(data.accounts),
        inventory=list(data.inventory),
        activations=list(data.activations),
        findings=list(data.findings),
        teams=list(data.teams),
        entitlements=list(data.entitlements),
    )


def _settle(data: CustomerData, accounts: Iterable[str], cat: Catalogue) -> None:
    """Inventory completes and the agentless modules switch on."""
    ids = set(accounts)
    provider = {a.id: a.provider for a in data.accounts}
    inv = {(r.account_id, r.resource_type): r for r in data.inventory}
    act = {(a.account_id, a.module_id): a for a in data.activations}
    for aid in sorted(ids):
        if aid not in provider:
            continue
        for t in cat.expected_types(provider[aid]):
            row = inv.get((aid, t))
            inv[(aid, t)] = InventoryRow(aid, t, max(row.count if row else 0, 1), True)
        for m in cat.modules_at(data.settings.ceiling_version):
            if m.on_connect and provider[aid] in m.providers:
                act[(aid, m.id)] = Activation(aid, m.id, True)
    data.inventory = list(inv.values())
    data.activations = list(act.values())


def apply_ops(
    data: CustomerData,
    ops: Iterable[dict],
    cat: Catalogue,
    *,
    week: int = 0,
    ramp: RampModel = RampModel(),
    steady: bool = False,
) -> tuple[CustomerData, list[Deferred]]:
    """Return a modified copy and the changes that land later.

    With ``steady=True`` every deferred change is applied immediately: the
    state the estate converges to once the action has fully taken effect.
    """
    out = _clone(data)
    deferred: list[Deferred] = []
    for op in ops:
        kind = op["op"]
        if kind == "connect":
            ids = set(op["accounts"])
            out.accounts = [replace(a, connected=True) if a.id in ids else a for a in out.accounts]
            if steady or ramp.inventory_lag_weeks <= 0:
                _settle(out, ids, cat)
            else:
                deferred.append(Deferred(week + ramp.inventory_lag_weeks, ({"op": "settle", "accounts": sorted(ids)},)))
        elif kind == "settle":
            _settle(out, op["accounts"], cat)
        elif kind == "inventory":
            t, ids = op["resource_type"], set(op["accounts"])
            inv = {(r.account_id, r.resource_type): r for r in out.inventory}
            for aid in sorted(ids):
                row = inv.get((aid, t))
                inv[(aid, t)] = InventoryRow(aid, t, max(row.count if row else 0, 1), True)
            out.inventory = list(inv.values())
        elif kind == "enable":
            m, ids = op["module"], set(op["accounts"])
            act = {(a.account_id, a.module_id): a for a in out.activations}
            for aid in sorted(ids):
                act[(aid, m)] = Activation(aid, m, True)
            out.activations = list(act.values())
        elif kind == "own":
            ids = set(op["findings"])
            out.findings = [replace(f, owner=f.owner or "(assigned)") if f.id in ids else f for f in out.findings]
        elif kind == "decide":
            ids = set(op["findings"])
            out.findings = [replace(f, decision=f.decision or "fix") if f.id in ids else f for f in out.findings]
        elif kind == "set_expiry":
            ids = set(op["findings"])
            until = out.as_of + timedelta(days=90)
            out.findings = [
                replace(f, expiry=until, decision_reason=f.decision_reason or "reviewed")
                if f.id in ids and f.decision == "accepted_risk" else f
                for f in out.findings
            ]
        else:
            raise ValueError(f"unknown op {kind!r}")
    return out, deferred


def settle_pending(data: CustomerData, pending_accounts: Iterable[str], cat: Catalogue) -> CustomerData:
    """The state the data converges to once connected-but-unsettled accounts finish ramping."""
    out, _ = apply_ops(data, [{"op": "settle", "accounts": sorted(set(pending_accounts))}], cat, steady=True)
    return out
