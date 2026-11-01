import math
import random

import pytest

from beyond90.attribution import explain
from beyond90.catalogue import Catalogue
from beyond90.models import Activation
from beyond90.scoring import compute_score

from helpers import account, data, full_inventory

CAT = Catalogue.load()


def fake_prev(stages, ceiling="2026.4", as_of="2026-09-30"):
    return {"as_of": as_of, "ceiling_version": ceiling, "yield": math.prod(stages.values()),
            "stages": {k: {"value": v} for k, v in stages.items()}}


class FakeScore:
    def __init__(self, stages, ceiling="2026.4"):
        from types import SimpleNamespace
        self.stages = {k: SimpleNamespace(value=v) for k, v in stages.items()}
        self.ceiling_version, self.as_of, self.customer = ceiling, "2026-10-31", "T"


def test_contributions_always_sum_to_the_change_exactly():
    rng = random.Random(3)
    for _ in range(200):
        old = {k: rng.uniform(0.05, 1.0) for k in ("L1", "L2", "L3", "L4")}
        new = {k: rng.uniform(0.05, 1.0) for k in old}
        a = explain(FakeScore(new), fake_prev(old))
        assert sum(f.points for f in a.factors) == pytest.approx(100 * (math.prod(new.values()) - math.prod(old.values())), abs=1e-9)
        assert a.delta_points == pytest.approx(sum(f.points for f in a.factors), abs=1e-9)


def test_offsetting_moves_are_shown_not_hidden():
    old = {"L1": 0.5, "L2": 1.0, "L3": 1.0, "L4": 1.0}
    swap = {"L1": 1.0, "L2": 0.5, "L3": 1.0, "L4": 1.0}                    # Yield unchanged, but the estate changed
    a = explain(FakeScore(swap), fake_prev(old))
    assert a.delta_points == pytest.approx(0, abs=1e-9)
    gained, lost = a.factors[0].points, a.factors[1].points
    assert gained > 30 and lost == pytest.approx(-gained) and sum(f.points for f in a.factors) == pytest.approx(0, abs=1e-9)
    assert [f.points for f in a.factors[2:]] == [0.0, 0.0]


def test_a_zero_stage_does_not_crash():
    a = explain(FakeScore({"L1": 0.0, "L2": 1, "L3": 1, "L4": 1}), fake_prev({"L1": 0.5, "L2": 1, "L3": 1, "L4": 1}))
    assert a.delta_points == pytest.approx(-50.0)


def test_new_release_is_attributed_to_the_bar_not_the_customer():
    # The customer does nothing between the two dates; a release adds modules to the denominator.
    d = data(accounts=[account("a1")], inventory=full_inventory("a1"),
             activations=[Activation("a1", m.id, True) for m in CAT.modules_at("2026.1") if "aws" in m.providers])
    d.settings.ceiling_version, d.settings.baseline_ceiling = "2026.1", "2026.1"
    old = compute_score(d, CAT).to_dict()
    d.settings.ceiling_version = "2026.4"
    new = compute_score(d, CAT)
    a = explain(new, old, d, CAT)
    assert a.customer_points == pytest.approx(0, abs=1e-9)
    assert a.bar_points < 0 and a.bar_points == pytest.approx(a.delta_points)
    assert {f.key for f in a.factors} >= {"L3_organic", "L3_bar"}


def test_without_data_the_split_is_not_possible_and_says_so():
    old = fake_prev({"L1": 1, "L2": 1, "L3": 1, "L4": 1}, ceiling="2026.1")
    a = explain(FakeScore({"L1": 1, "L2": 1, "L3": 0.9, "L4": 1}, ceiling="2026.4"), old)
    assert any("cannot be split" in n for n in a.notes) and a.bar_points == 0
