from datetime import timedelta

import pytest

from beyond90.models import Commitment, Contact, Team
from beyond90.relationship import band, compute_relationship, limiting_factor, trust_index
from beyond90.trust import classify

from helpers import AS_OF, data


def person(id, role="practitioner", team="", days=10, ratings=(7, 7, 7, 3), influence=None):
    c, r, i, s = ratings if ratings else (None,) * 4
    return Contact(id=id, name=id.upper(), role=role, team=team, influence=influence or {"executive_sponsor": 3, "champion": 2}.get(role, 1),
                   last_contact=None if days is None else AS_OF - timedelta(days=days), credibility=c, reliability=r, intimacy=i, self_orientation=s)


def promise(id, due_days_ago, done_days_ago=None):
    due = AS_OF - timedelta(days=due_days_ago)
    return Commitment(id=id, description=id, due_on=due, done_on=None if done_days_ago is None else AS_OF - timedelta(days=done_days_ago))


def test_the_equation_reproduces_the_books_worked_examples():
    assert trust_index(5, 3, 2, 8) == pytest.approx(1.25)        # a new client, in the book's chapter on cross-selling
    assert trust_index(7, 8, 5, 4) == pytest.approx(5.0)         # a current client
    assert (band(1.25), band(5.0), band(3.0)) == ("fragile", "strong", "developing")


def test_self_orientation_is_the_cheapest_lever_when_it_is_high():
    assert limiting_factor(7, 8, 5, 8) == "self_orientation"
    assert limiting_factor(9, 9, 9, 1) in ("credibility", "reliability", "intimacy")       # nothing to gain from the denominator at 1
    assert limiting_factor(5, 5, 5, 1) == "intimacy"                                       # a three-way tie resolves deterministically, by component order
    assert limiting_factor(10, 10, 2, 1) == "intimacy"                                     # the only component with room


def test_no_contacts_and_no_commitments_means_no_relationship_layer():
    assert compute_relationship(data()) is None


def test_weighted_trust_and_measured_reliability():
    d = data(
        contacts=[person("boss", "executive_sponsor", ratings=(8, 8, 8, 2)),          # T = 12, weight 3
                  person("peer", "practitioner", ratings=(5, 5, 5, 5))],               # T = 3, weight 1
        commitments=[promise("a", 30, 31), promise("b", 20, 15), promise("c", 10, 12), promise("d", 5), promise("e", -10)],
    )
    r = compute_relationship(d)
    assert r["weighted_trust"] == pytest.approx((3 * 12 + 1 * 3) / 4)
    rel = r["reliability"]
    assert (rel["due_in_window"], rel["on_time"], rel["late"]) == (4, 2, 1)
    assert rel["rate"] == pytest.approx(0.5) and rel["overdue_open"] == ["d"] and rel["upcoming"] == 1


def test_commitments_outside_the_window_do_not_count():
    r = compute_relationship(data(commitments=[promise("old", 400, 399)]))
    assert r["reliability"]["rate"] is None and r["reliability"]["due_in_window"] == 0


def test_gaps():
    d = data(
        contacts=[person("only", "champion", team="platform", days=5), person("old", "security_leader", team="security", days=200),
                  person("weak", "procurement", team="finance", days=3, ratings=(4, 4, 2, 8), influence=2)],
        teams=[Team("platform", "Platform", True, 3, True, True), Team("data", "Data", True, 1, True, True), Team("idle", "Idle", False, 0, True, True)],
    )
    g = compute_relationship(d)["gaps"]
    assert g["no_executive_sponsor"] is True
    assert g["stale_key_contacts"] == ["old"]
    assert g["teams_without_a_contact"] == ["data"]                 # Idle owns no assets and is ignored
    assert g["weak_by_component"] == {"self_orientation": ["weak"]}
    assert g["single_threaded"] is False                            # two contacts spoken to in the last 90 days


def test_single_threaded_and_unrated_contacts():
    r = compute_relationship(data(contacts=[person("one", "champion", ratings=None)]))
    assert r["gaps"]["single_threaded"] is True and r["weighted_trust"] is None and r["contacts"][0]["rated"] is False
    assert compute_relationship(data(contacts=[person("never", "champion", days=None, ratings=None)]))["contacts"][0]["stale"] is True


@pytest.mark.parametrize("offer,people,known,expected", [
    ("new", ["a"], {"a"}, "expand"),
    ("new", ["x"], {"a"}, "diversify"),
    ("same", ["x"], {"a"}, "broaden"),
    ("same", ["a"], {"a"}, ""),
    ("new", [], {"a"}, "diversify"),                     # unknown owners are unknown people
    ("", ["a"], {"a"}, ""),                              # not an expansion at all
])
def test_cross_sell_types(offer, people, known, expected):
    assert classify(offer, people, known, True) == expected


def test_cross_sell_needs_to_know_who_you_know_and_uses_a_majority():
    assert classify("new", ["a"], set(), False) == ""                          # no contacts file: cannot tell
    assert classify("new", ["a", "b", "x"], {"a", "b"}, True) == "expand"      # most of the people are known
    assert classify("new", ["a", "x", "y"], {"a"}, True) == "diversify"
