"""Accounts finished per action: applying an action's operations and counting accounts that pass every stage again."""
from pathlib import Path

from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.playbooks import generate_actions
from beyond90.scoring import compute_score
from beyond90.unlocks import unlocks

ROOT = Path(__file__).resolve().parents[1]


def _northwind():
    d, _ = load_customer(ROOT / "examples" / "portfolio" / "northwind")
    cat = Catalogue.for_directory(ROOT / "examples" / "portfolio" / "northwind")
    sc = compute_score(d, cat)
    return d, cat, sc, generate_actions(d, sc, cat)


def test_connecting_an_account_finishes_nothing_but_switching_a_capability_on_does():
    d, cat, sc, acts = _northwind()
    gain = unlocks(d, cat, sc.ceiling_version, acts)
    by_leak = {}
    for a in acts:
        if a.id in gain:
            by_leak.setdefault(a.leak, []).append(gain[a.id])
    assert set(by_leak["L1"]) == {0}                     # a newly connected account still has every other stage to do
    assert max(by_leak["L3"]) > 0 and max(by_leak["L4"]) > 0
    assert all(0 <= g <= sc.end_to_end["total"] - sc.end_to_end["through"] for g in gain.values())


def test_the_limit_keeps_the_browser_fast_and_the_data_untouched():
    d, cat, sc, acts = _northwind()
    before = [(a.id, a.connected) for a in d.accounts]
    assert len(unlocks(d, cat, sc.ceiling_version, acts, limit=3)) <= 3
    assert [(a.id, a.connected) for a in d.accounts] == before
