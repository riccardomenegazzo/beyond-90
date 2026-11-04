from datetime import timedelta
from types import SimpleNamespace

import pytest

from beyond90.catalogue import Catalogue
from beyond90.drift import html_drift, input_drift, md_drift
from beyond90.ladder import describe, path_to_next_level
from beyond90.models import Activation
from beyond90.planner import build_plan
from beyond90.scoring import compute_score

from helpers import AS_OF, account, data, finding, full_inventory

CAT = Catalogue.load()


def week(n, l1=1.0, l2=1.0, l3=1.0, l4=1.0, hours=2.0):
    st = {"L1": l1, "L2": l2, "L3": l3, "L4": l4}
    return SimpleNamespace(week=n, yield_=l1 * l2 * l3 * l4, stages=st, hours_used=hours)


def score_with(blocking, next_level="silver"):
    return SimpleNamespace(rubric={"checks": [1], "next_level": next_level, "blocking": blocking})


def check(metric, op, target, id=None, title=None):
    return {"id": id or metric, "title": title or metric, "metric": metric, "op": op, "target": target, "value": 0.0, "playbooks": [], "level": "silver", "status": "fail"}


def plan(*weeks, hpw=8.0):
    return SimpleNamespace(weeks=list(weeks), hours_per_week=hpw, horizon_weeks=26)


def test_the_week_is_the_first_one_from_which_the_stage_checks_keep_passing():
    p = plan(week(0, l1=0.9), week(1, l1=0.96), week(2, l1=0.93), week(3, l1=0.97), week(4, l1=0.98))
    r = path_to_next_level(score_with([check("l1", ">=", 0.95)]), p)
    assert r["week"] == 3 and r["hours"] == 8.0 and r["dip_after"] is False        # week 1 passed, then dipped: it does not count
    assert r["hours"] == pytest.approx(2.0 * 3 + 2.0, abs=2.0)


def test_hours_are_those_spent_up_to_that_week():
    p = plan(week(0, l1=0.9, hours=0.0), week(1, l1=0.9, hours=8.0), week(2, l1=0.96, hours=5.0), week(3, l1=0.97, hours=8.0))
    assert path_to_next_level(score_with([check("l1", ">=", 0.95)]), p)["hours"] == 13.0


def test_a_check_that_never_passes_in_the_horizon_says_so():
    r = path_to_next_level(score_with([check("l1", ">=", 0.95)]), plan(week(0, l1=0.9), week(1, l1=0.92)))
    assert r["week"] is None and "does not pass" in describe(r)[0]


def test_checks_the_roadmap_cannot_move_are_listed_as_outside_it():
    r = path_to_next_level(score_with([check("l1", ">=", 0.95), check("critical_overdue", "<=", 0, title="No critical is overdue")]), plan(week(0, l1=0.9), week(1, l1=0.97)))
    assert [c["id"] for c in r["outside_plan"]] == ["critical_overdue"] and r["week"] == 1
    assert "Outside the roadmap" in " ".join(describe(r)) and "No critical is overdue" in " ".join(describe(r))


def test_when_nothing_is_movable_by_the_roadmap_it_does_not_pretend():
    r = path_to_next_level(score_with([check("sponsor", ">=", 1)]), plan(week(0), week(1)))
    assert r["no_plan_checks"] and "need decisions or conversations" in describe(r)[0]


def test_already_passing_stage_checks_are_week_zero():
    r = path_to_next_level(score_with([check("l1", ">=", 0.5)]), plan(week(0, l1=0.9), week(1, l1=0.9)))
    assert r["week"] == 0 and "already pass" in describe(r)[0]


def test_nothing_to_say_at_the_top_or_without_a_plan():
    assert path_to_next_level(SimpleNamespace(rubric={"checks": [1], "next_level": None, "blocking": []}), plan(week(0))) is None
    assert path_to_next_level(score_with([check("l1", ">=", 1)]), None) is None
    assert describe(None) == []


def test_it_works_on_a_real_plan():
    accs = [account(f"a{i}", sources=("billing", "org"), connected=i < 7, owner="o") for i in range(10)]
    d = data(accounts=accs, inventory=[r for a in accs if a.connected for r in full_inventory(a.id)],
             activations=[Activation(a.id, "posture", True) for a in accs if a.connected], findings=[finding("f", owner="o", decision="fix")])
    s = compute_score(d, CAT)
    pl = build_plan(d, CAT, hours_per_week=8, horizon_weeks=26)
    r = path_to_next_level(s, pl)
    assert r is not None and r["level"] == s.rubric["next_level"]
    if r["week"]:
        assert r["hours"] > 0


# ------------------------------------------------------------------------- drift

def two(old_accounts, new_accounts, **kw):
    old = data(accounts=old_accounts, **kw.get("old", {}))
    new = data(accounts=new_accounts, **kw.get("new", {}))
    new.as_of = AS_OF
    old.as_of = AS_OF - timedelta(days=31)
    return new, old


def ids(items):
    return {i["id"]: i["status"] for i in items["items"]}


def test_identical_inputs_show_no_drift():
    accs = [account(f"a{i}") for i in range(6)]
    new, old = two(accs, accs)
    assert input_drift(new, old) == {"since": old.as_of.isoformat(), "status": "ok", "items": []}
    assert "No sign" in "\n".join(md_drift(input_drift(new, old)))


def test_units_that_vanish_without_being_decommissioned_are_a_warning_when_many():
    old_accs = [account(f"a{i}") for i in range(20)]
    new, old = two(old_accs, old_accs[:15])
    d = input_drift(new, old)
    assert ids(d)["vanished_units"] == "warn" and d["status"] == "warn"
    new2, old2 = two(old_accs, old_accs[:19])
    assert ids(input_drift(new2, old2))["vanished_units"] == "note"


def test_decommissioned_units_are_not_a_surprise():
    old_accs = [account(f"a{i}") for i in range(20)]
    new_accs = old_accs[:10] + [account(f"a{i}", status="decommissioned") for i in range(10, 20)]
    new, old = two(old_accs, new_accs)
    assert "vanished_units" not in ids(input_drift(new, old))


def test_new_units_are_noted_with_the_profiles_word():
    old_accs = [account(f"a{i}") for i in range(5)]
    new, old = two(old_accs, [*old_accs, account("n1"), account("n2")])
    text = input_drift(new, old, {"unit": "site", "units": "sites"})["items"][0]["text"]
    assert "2 site(s) are new" in text and "sites" in text


def test_a_much_smaller_inventory_or_activation_file_is_flagged():
    accs = [account(f"a{i}") for i in range(3)]
    inv = [r for a in accs for r in full_inventory(a.id)]
    new, old = two(accs, accs, old={"inventory": inv, "activations": [Activation("a0", "posture", True)] * 8}, new={"inventory": inv[: len(inv) // 3], "activations": [Activation("a0", "posture", True)] * 2})
    got = ids(input_drift(new, old))
    assert got["inventory_drop"] == "warn" and got["activation_drop"] == "warn"


def test_open_findings_that_vanish_are_flagged_and_reopened_ones_noted():
    accs = [account("a1")]
    old_f = [finding(f"f{i}", opened_days_ago=40) for i in range(10)]
    new, old = two(accs, accs, old={"findings": old_f}, new={"findings": old_f[:6]})
    assert ids(input_drift(new, old))["vanished_findings"] == "warn"
    moved = [finding("f0", opened_days_ago=10), *old_f[1:]]
    new2, old2 = two(accs, accs, old={"findings": old_f}, new={"findings": moved})
    assert ids(input_drift(new2, old2))["reopened"] == "note"


def test_a_comparison_file_that_is_not_older_is_a_warning():
    accs = [account("a1")]
    new, old = two(accs, accs)
    old.as_of = new.as_of
    assert ids(input_drift(new, old))["dates"] == "warn"


def test_html_is_escaped_and_empty_without_input():
    accs = [account(f"a{i}") for i in range(20)]
    new, old = two(accs, accs[:5])
    assert "<li>" in html_drift(input_drift(new, old)) and html_drift(None) == "" and md_drift(None) == []
