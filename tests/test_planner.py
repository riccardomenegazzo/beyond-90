from pathlib import Path

import pytest

from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.models import Activation
from beyond90.planner import build_plan

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()
NW = Path(__file__).parent.parent / "examples" / "portfolio" / "northwind"


def estate():
    acts = [Activation("a1", m.id, True) for m in CAT.modules_at("2026.4") if "aws" in m.providers]
    return data(accounts=[account("a1"), account("a2", connected=False, owner="x", last_spend=10)],
                inventory=full_inventory("a1"), activations=acts)


def test_the_plan_shows_the_j_curve_and_then_beats_the_starting_point():
    plan = build_plan(estate(), CAT, hours_per_week=8, horizon_weeks=12, realization=1.0)
    ys = [w.yield_ for w in plan.weeks]
    assert plan.dips, "connecting the account must produce a dip"
    assert min(ys[1:]) < ys[0]
    assert plan.end_yield > plan.start_yield
    assert "dips before it recovers" in plan.dips[0]["cause"]


def test_follow_up_work_appears_by_itself():
    plan = build_plan(estate(), CAT, hours_per_week=8, horizon_weeks=12, realization=1.0)
    playbooks = [j.playbook for j in plan.jobs]
    assert playbooks[0] == "l1_connect_account"
    assert any(p.startswith("l3_") for p in playbooks[1:])                # enable the modules that connecting does not switch on


def test_plan_is_deterministic():
    a = build_plan(estate(), CAT, horizon_weeks=10).to_dict()
    b = build_plan(estate(), CAT, horizon_weeks=10).to_dict()
    assert a == b


def test_realization_creates_a_plateau_and_a_residual():
    d, _ = load_customer(NW, CAT)
    full = build_plan(d, CAT, horizon_weeks=20, realization=1.0)
    part = build_plan(d, CAT, horizon_weeks=20, realization=0.8)
    assert full.end_yield > part.end_yield
    assert part.residual and any("could not" in k or "did not" in k or "stayed" in k for k in part.residual)
    assert any("plateaus" in n for n in part.notes)


def test_more_hours_never_make_the_plan_slower():
    d, _ = load_customer(NW, CAT)
    slow = build_plan(d, CAT, hours_per_week=4, horizon_weeks=14)
    fast = build_plan(d, CAT, hours_per_week=16, horizon_weeks=14)
    assert fast.end_yield >= slow.end_yield - 1e-9
    w_fast, w_slow = fast.milestones["90%"], slow.milestones["90%"]
    assert w_fast is not None and (w_slow is None or w_fast <= w_slow)


def test_nothing_to_plan():
    d = data(accounts=[account("a1")], inventory=full_inventory("a1"),
             activations=[Activation("a1", m.id, True) for m in CAT.modules_at("2026.4") if "aws" in m.providers])
    plan = build_plan(d, CAT)
    assert plan.jobs == [] and plan.start_yield == plan.end_yield == 1.0
    assert any("nothing to plan" in n for n in plan.notes)


def test_invalid_parameters():
    for kw in ({"hours_per_week": 0}, {"horizon_weeks": 0}, {"realization": 0}, {"realization": 1.5}):
        with pytest.raises(ValueError):
            build_plan(estate(), CAT, **kw)


def test_ownership_bundles_are_planned_as_owner_plus_decision():
    d = data(accounts=[account("a1")], inventory=full_inventory("a1"),
             activations=[Activation("a1", m.id, True) for m in CAT.modules_at("2026.4") if "aws" in m.providers],
             findings=[finding(f"f{i}", opened_days_ago=20) for i in range(4)])
    plan = build_plan(d, CAT, realization=1.0, horizon_weeks=4)
    assert plan.end_yield == pytest.approx(1.0) and plan.jobs[0].playbook == "l4_assign_owners"


def test_large_actions_are_planned_in_weekly_batches():
    accounts = [account("ok")] + [account(f"u{i}", connected=False, owner="x", last_spend=100 - i) for i in range(60)]
    acts = [Activation("ok", m.id, True) for m in CAT.modules_at("2026.4") if "aws" in m.providers]
    d = data(accounts=accounts, inventory=full_inventory("ok"), activations=acts)
    plan = build_plan(d, CAT, hours_per_week=8, horizon_weeks=10, realization=1.0)
    first = plan.jobs[0]
    assert "first" in first.title and first.hours <= 8.0 + 1e-9    # a batch that fits in a week, not a 46-hour lump
    assert len(plan.jobs) >= 3 and plan.end_yield > plan.start_yield
