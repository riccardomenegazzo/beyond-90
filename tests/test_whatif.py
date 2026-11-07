"""What-if scenarios and the path to a target: same engine as the score, never touches the input."""
from pathlib import Path

import pytest

from beyond90 import whatif
from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.scoring import compute_score

ROOT = Path(__file__).parent.parent / "examples" / "portfolio"
CAT = Catalogue.load()


def northwind():
    data, _ = load_customer(ROOT / "northwind", CAT)
    return data


def test_scenarios_never_change_the_input():
    data = northwind()
    before = compute_score(data, CAT).yield_
    whatif.run(data, CAT, [{"steps": [{"kind": "connect_all"}, {"kind": "enable_all"}, {"kind": "fix_findings"}]}])
    assert compute_score(data, CAT).yield_ == before


def test_settled_reading_never_below_today_for_repairs_and_matches_the_score():
    data = northwind()
    out = whatif.run(data, CAT, [{"name": "fix", "steps": [{"kind": "fix_findings"}]}])["scenarios"][0]
    assert out["steady"]["yield"] >= out["today"]["yield"]
    assert out["today"]["yield"] == pytest.approx(compute_score(data, CAT).yield_, abs=1e-9)
    assert out["touched"]["findings_fixed"] > 0 and out["touched"]["accounts_connected"] == 0


def test_connecting_dips_first_then_improves():
    data = northwind()
    sc = whatif.run(data, CAT, [{"steps": [{"kind": "connect_all"}]}])["scenarios"][0]
    assert sc["touched"]["accounts_connected"] > 0
    assert sc["steady"]["yield"] > sc["today"]["yield"]
    assert sc["dip"] == (sc["right_after"]["yield"] < sc["today"]["yield"] - 0.0005)


def test_scenarios_are_sorted_best_settled_first():
    data = northwind()
    out = whatif.run(data, CAT, [
        {"name": "small", "steps": [{"kind": "fix_findings", "leak": "unowned"}]},
        {"name": "big", "steps": [{"kind": "connect_all"}, {"kind": "enable_all"}, {"kind": "fix_findings"}]},
    ])["scenarios"]
    assert [s["name"] for s in out] == ["big", "small"]


def test_a_step_that_changes_nothing_says_so():
    data = northwind()
    connected = next(a.id for a in data.accounts if a.connected)
    sc = whatif.run(data, CAT, [{"steps": [{"kind": "connect", "accounts": [connected]}]}])["scenarios"][0]
    assert sc["touched"] == {"accounts_connected": 0, "activations_added": 0, "findings_fixed": 0}
    assert sc["steady"]["yield"] == pytest.approx(sc["today"]["yield"]) and "Nothing in these steps" in sc["notes"][0]


def test_repeating_a_step_adds_nothing():
    data = northwind()
    once = whatif.run(data, CAT, [{"steps": [{"kind": "enable_all"}]}])["scenarios"][0]
    twice = whatif.run(data, CAT, [{"steps": [{"kind": "enable_all"}, {"kind": "enable_all"}]}])["scenarios"][0]
    assert twice["steady"]["yield"] == pytest.approx(once["steady"]["yield"])
    assert twice["touched"] == once["touched"]


@pytest.mark.parametrize("scenarios,message", [
    ([], "at least one"),
    ([{"steps": []}], "non-empty"),
    ([{"steps": [{"kind": "launch_rocket"}]}], "kind"),
    ([{"steps": [{"kind": "enable_module", "module": "nope"}]}], "unknown module"),
    ([{"steps": [{"kind": "connect", "accounts": ["ghost"]}]}], "unknown account"),
    ([{"steps": [{"kind": "connect"}]}], "non-empty list"),
    ([{"steps": [{"kind": "fix_findings", "leak": "weird"}]}], "leak"),
    (["not an object"], "must be an object"),
    ([{"steps": [{"kind": "connect_all"}]}] * 21, "at most"),
])
def test_bad_scenarios_are_refused_with_a_reason(scenarios, message):
    with pytest.raises(whatif.ScenarioError, match=message):
        whatif.run(northwind(), CAT, scenarios)


def test_path_to_target_is_consistent_with_running_its_steps():
    data = northwind()
    r = whatif.reach(data, CAT, 0.85)
    assert r["reached"] and r["end_yield"] >= 0.85 and r["start_yield"] < 0.85
    assert all(p["gain_points"] > 0 for p in r["path"])
    replay = whatif.run(data, CAT, [{"steps": [p["step"] for p in r["path"]]}])["scenarios"][0]
    assert replay["steady"]["yield"] == pytest.approx(r["end_yield"], abs=1e-9)


def test_path_to_a_target_already_met_is_empty():
    data = northwind()
    r = whatif.reach(data, CAT, 0.01)
    assert r["reached"] and r["path"] == []


def test_path_says_when_the_target_cannot_be_reached():
    data, _ = load_customer(ROOT / "fabrikam-labs", CAT)
    r = whatif.reach(data, CAT, 1.0, max_steps=1)
    assert not r["reached"] and r["notes"]


@pytest.mark.parametrize("target", [0, -1, 1.5])
def test_path_refuses_a_target_out_of_range(target):
    with pytest.raises(whatif.ScenarioError):
        whatif.reach(northwind(), CAT, target)
