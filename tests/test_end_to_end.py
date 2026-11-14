"""The end-to-end chain: one unit (the account), every stage, no partial credit."""
from beyond90.catalogue import Catalogue
from beyond90.models import Activation
from beyond90.scoring import compute_end_to_end, compute_score

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()
CEIL = "2026.4"


def all_on(account_id, provider="aws"):
    return [Activation(account_id, m.id, True) for m in CAT.modules_at(CEIL) if provider in m.providers]


def test_each_account_stops_at_its_first_broken_stage():
    d = data(
        accounts=[account("ok"), account("off", connected=False), account("blind"), account("idle"), account("stuck")],
        inventory=full_inventory("ok") + full_inventory("blind", skip=("compute",)) + full_inventory("idle") + full_inventory("stuck"),
        activations=all_on("ok") + all_on("blind") + all_on("idle")[1:] + all_on("stuck"),
        findings=[finding("f", account_id="stuck", opened_days_ago=40), finding("g", account_id="ok", opened_days_ago=40, owner="x", decision="fix")],
    )
    e = compute_end_to_end(d, CAT, CEIL)
    assert e["first_break"] == {"L1": 1, "L2": 1, "L3": 1, "L4": 1}
    assert (e["through"], e["total"]) == (1, 5) and e["value"] == 0.2
    assert e["examples"]["L2"] == ["blind"] and e["measured"] == ["L1", "L2", "L3", "L4"]


def test_a_stage_without_data_stops_nobody_and_says_so():
    e = compute_end_to_end(data(accounts=[account("a"), account("b", connected=False)]), CAT, CEIL)
    assert e["measured"] == ["L1", "L4"] and (e["through"], e["total"]) == (1, 2)


def test_no_accounts_no_value():
    assert compute_end_to_end(data(), CAT, CEIL)["value"] is None


def test_it_rides_on_the_score_and_never_exceeds_yield_on_the_examples():
    from pathlib import Path

    from beyond90.loader import load_customer
    root = Path(__file__).resolve().parents[1] / "examples" / "portfolio"
    for name in ("northwind", "fabrikam-labs", "contoso-bank"):
        d, _ = load_customer(root / name)
        sc = compute_score(d)
        assert sc.to_dict()["end_to_end"]["total"] == len([a for a in d.accounts if a.status == "active"]) or sc.end_to_end["total"] > 0
        assert sc.end_to_end["value"] <= sc.yield_ + 1e-9
