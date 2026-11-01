import random

import pytest

from beyond90.universe import estimate_universe

from helpers import account, data


def accts(spec):
    """spec: {sources-tuple: count}."""
    out, i = [], 0
    for sources, n in spec.items():
        for _ in range(n):
            i += 1
            out.append(account(f"x{i}", sources=tuple(sources)))
    return out


def test_chao_estimate_by_hand():
    # T = 3 sources, Q1 = 10 (seen once), Q2 = 5 (seen twice): (2/3) * 10^2 / (2*5) = 6.67
    spec = {("billing",): 4, ("org",): 3, ("sso",): 3, ("billing", "org"): 3, ("org", "sso"): 2, ("billing", "org", "sso"): 20}
    u = estimate_universe(data(accounts=accts(spec)))
    assert u["estimable"] and (u["seen_by_one"], u["seen_by_two"], u["seen_by_all"]) == (10, 5, 20)
    assert u["unseen_estimate"] == pytest.approx(6.7, abs=0.05)
    assert u["completeness"] == pytest.approx(35 / (35 + 6.667), abs=1e-3)
    assert u["only_in"] == {"billing": 4, "org": 3, "sso": 3}


def test_bias_corrected_form_when_no_account_is_seen_twice():
    spec = {("billing",): 3, ("org",): 3, ("sso",): 2, ("billing", "org", "sso"): 10}
    u = estimate_universe(data(accounts=accts(spec)))
    assert u["seen_by_two"] == 0 and u["unseen_estimate"] == pytest.approx(2 / 3 * 8 * 7 / 2, abs=0.05)


def test_not_estimable_with_fewer_than_two_sources_or_no_accounts():
    assert not estimate_universe(data())["estimable"]
    u = estimate_universe(data(accounts=accts({("billing",): 5})))
    assert not u["estimable"] and "two independent sources" in u["reason"]


def test_a_source_that_lists_everything_is_flagged():
    spec = {("billing",): 5, ("billing", "org"): 10, ("billing", "org", "sso"): 10}
    u = estimate_universe(data(accounts=accts(spec)))
    assert any("billing lists every known account" in w for w in u["warnings"])


def test_everything_seen_by_all_means_nothing_hidden():
    u = estimate_universe(data(accounts=accts({("billing", "org", "sso"): 30})))
    assert u["unseen_estimate"] == 0 and u["completeness"] == 1.0 and u["confidence"] == "high"


def test_pessimistic_l1_uses_the_estimate():
    spec = {("billing", "org"): 20, ("billing",): 5, ("org",): 5, ("sso",): 2, ("sso", "org"): 8}
    accounts = [a if i % 2 else account(a.id, sources=a.sources, connected=False) for i, a in enumerate(accts(spec))]
    u = estimate_universe(data(accounts=accounts))
    connected = sum(a.connected for a in accounts)
    assert u["pessimistic_l1"] == pytest.approx(connected / (len(accounts) + u["unseen_estimate"]), abs=1e-3)


def test_recovers_the_hidden_count_in_a_simulated_estate():
    rng = random.Random(11)
    p = {"billing": 0.8, "org": 0.7, "sso": 0.5}
    truth, hidden, seen = 600, 0, []
    for i in range(truth):
        src = tuple(s for s, q in p.items() if rng.random() < q)
        if src:
            seen.append(account(f"s{i}", sources=src))
        else:
            hidden += 1
    u = estimate_universe(data(accounts=seen))
    assert hidden > 5
    assert 0.5 * hidden <= u["unseen_estimate"] <= 1.6 * hidden             # a lower bound that lands close when sources are independent
