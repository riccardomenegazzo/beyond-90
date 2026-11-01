import pytest

from beyond90.catalogue import Catalogue
from beyond90.models import Activation
from beyond90.simulate import RampModel, apply_ops, quick_stages, quick_yield, settle_pending

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()


def estate():
    """a1 is fully covered with every module on; a2 is not connected yet."""
    acts = [Activation("a1", m.id, True) for m in CAT.modules_at("2026.4") if "aws" in m.providers]
    return data(accounts=[account("a1"), account("a2", connected=False)], inventory=full_inventory("a1"), activations=acts)


def test_connecting_an_account_first_lowers_yield_then_raises_it_above_where_it_started():
    d = estate()
    before = quick_yield(d, CAT)
    assert before == pytest.approx(0.5)                                   # L1 = 1/2, everything else perfect
    connected, deferred = apply_ops(d, [{"op": "connect", "accounts": ["a2"]}], CAT, week=1)
    assert quick_stages(connected, CAT)["L1"] == 1.0
    assert quick_yield(connected, CAT) < before                           # the J-curve: L2 and L3 collapse on a2
    assert [x.week for x in deferred] == [3]
    settled, _ = apply_ops(connected, deferred[0].ops, CAT, week=3)
    assert quick_yield(settled, CAT) > before
    steady, none = apply_ops(d, [{"op": "connect", "accounts": ["a2"]}], CAT, steady=True)
    assert none == [] and quick_yield(steady, CAT) == pytest.approx(quick_yield(settled, CAT))


def test_only_agentless_modules_switch_on_with_the_connection():
    d = estate()
    steady, _ = apply_ops(d, [{"op": "connect", "accounts": ["a2"]}], CAT, steady=True)
    active = {a.module_id for a in steady.activations if a.account_id == "a2" and a.active}
    on_connect = {m.id for m in CAT.modules if m.on_connect and "aws" in m.providers}
    assert active == on_connect and "runtime_sensor" not in active


def test_zero_lag_applies_everything_at_once():
    steady, deferred = apply_ops(estate(), [{"op": "connect", "accounts": ["a2"]}], CAT, ramp=RampModel(0))
    assert deferred == [] and any(r.account_id == "a2" for r in steady.inventory)


def test_inventory_and_enable_ops_and_the_original_is_untouched():
    d = data(accounts=[account("a1")], inventory=full_inventory("a1", skip=("container_registry",)))
    n_inv, n_act = len(d.inventory), len(d.activations)
    out, _ = apply_ops(d, [{"op": "inventory", "resource_type": "container_registry", "accounts": ["a1"]},
                           {"op": "enable", "module": "posture", "accounts": ["a1"]}], CAT)
    assert any(r.resource_type == "container_registry" and r.inventoried for r in out.inventory)
    assert any(a.module_id == "posture" and a.active for a in out.activations)
    assert (len(d.inventory), len(d.activations)) == (n_inv, n_act)       # copy-on-write


def test_finding_ops():
    fs = [finding("u"), finding("d", owner="o"), finding("a", owner="o", decision="accepted_risk")]
    out, _ = apply_ops(data(findings=fs), [{"op": "own", "findings": ["u"]}, {"op": "decide", "findings": ["u", "d"]},
                                           {"op": "set_expiry", "findings": ["a"]}], CAT)
    by = {f.id: f for f in out.findings}
    assert by["u"].owner == "(assigned)" and by["u"].decision == "fix" and by["d"].decision == "fix"
    assert by["a"].expiry is not None and by["a"].expiry > out.as_of


def test_unknown_op_is_rejected():
    with pytest.raises(ValueError, match="unknown op"):
        apply_ops(estate(), [{"op": "teleport"}], CAT)


def test_settle_pending_equals_waiting_for_the_ramp():
    d = estate()
    connected, _ = apply_ops(d, [{"op": "connect", "accounts": ["a2"]}], CAT, week=1)
    converged = settle_pending(connected, ["a2"], CAT)
    steady, _ = apply_ops(d, [{"op": "connect", "accounts": ["a2"]}], CAT, steady=True)
    assert quick_yield(converged, CAT) == pytest.approx(quick_yield(steady, CAT))
