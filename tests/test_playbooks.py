import pytest

from beyond90.catalogue import Catalogue
from beyond90.models import Activation, Entitlement
from beyond90.playbooks import generate_actions
from beyond90.scoring import compute_score

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()


def build(**kw):
    d = data(**kw)
    sc = compute_score(d, CAT)
    return d, sc, generate_actions(d, sc, CAT)


def test_unconnected_accounts_are_grouped_by_owner_and_effect_is_the_stage_share():
    acts = [Activation(i, m.id, True) for i in ("a", "d") for m in CAT.modules_at("2026.4")]
    d, sc, actions = build(accounts=[
        account("a", connected=True),
        account("b", connected=False, owner="retail", last_spend=100),
        account("c", connected=False, owner="retail", last_spend=50),
        account("d", connected=True),
    ], inventory=full_inventory("a") + full_inventory("d"), activations=acts)
    a = next(x for x in actions if x.playbook == "l1_connect_account")
    assert a.owner == "retail" and a.units == 2 and a.id == "l1_connect_account:retail"
    # L1 is 2/4; closing both is worth 50 pts times the other stages, which are all 100% here.
    assert a.effect_points == pytest.approx(50.0)


def test_new_unconnected_accounts_trigger_auto_onboarding():
    from datetime import timedelta
    from helpers import AS_OF
    d, _, actions = build(accounts=[account("new", connected=False, created_at=AS_OF - timedelta(days=5)),
                                    account("old", connected=False, created_at=AS_OF - timedelta(days=400))])
    assert [a for a in actions if a.playbook == "l1_auto_onboarding"]


def test_modules_released_after_baseline_use_the_adoption_playbook():
    inv = full_inventory("a1")
    acts = [Activation("a1", m.id, True) for m in CAT.modules_at("2026.1")]
    _, _, actions = build(accounts=[account("a1")], inventory=inv, activations=acts, baseline_ceiling="2026.1")
    pbs = {a.playbook for a in actions if a.leak == "L3"}
    assert pbs == {"l3_new_release_adoption"}


def test_l4_actions_per_kind_and_sorted_by_effect_descending():
    fs = [finding(f"u{i}") for i in range(3)] + [finding("n", owner="o")]
    _, _, actions = build(accounts=[account("a1")], inventory=full_inventory("a1"), findings=fs)
    l4 = [a for a in actions if a.leak == "L4"]
    assert {a.playbook for a in l4} == {"l4_assign_owners", "l4_record_decisions"}
    effects = [a.effect_points for a in actions]
    assert effects == sorted(effects, reverse=True)


def test_entitlement_gap_action_and_due_dates():
    _, sc, actions = build(entitlements=[Entitlement("sensors", 100, 20)])
    a = next(x for x in actions if x.playbook == "ent_adoption_gap")
    assert "20 of 100" in a.detail and a.due > sc.as_of


def test_every_generated_playbook_exists_in_the_catalogue():
    from pathlib import Path
    import subprocess, sys
    root = Path(__file__).parent.parent / "examples" / "portfolio"
    from beyond90.loader import load_customer
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        data_, _ = load_customer(d, CAT)
        sc = compute_score(data_, CAT)
        for a in generate_actions(data_, sc, CAT):
            assert a.playbook in CAT.playbooks
