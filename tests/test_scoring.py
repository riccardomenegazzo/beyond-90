from datetime import timedelta

import pytest

from beyond90.catalogue import Catalogue
from beyond90.models import Activation, Entitlement, InventoryRow, Team
from beyond90.scoring import classify_finding, compute_score, next_target, stage_l1, stage_l2, stage_l3, stage_l4

from helpers import AS_OF, account, data, finding, full_inventory

CAT = Catalogue.load()


def test_l1_counts_active_accounts_only_and_sorts_leaks_by_spend():
    d = data(accounts=[
        account("a", connected=True),
        account("b", connected=False, last_spend=10),
        account("c", connected=False, last_spend=900),
        account("old", connected=False, status="decommissioned"),
    ])
    s = stage_l1(d)
    assert (s.numerator, s.denominator) == (1, 3)
    assert s.value == pytest.approx(1 / 3)
    assert [x["account_id"] for x in s.leaks] == ["c", "b"]


def test_l2_pairs_over_connected_accounts_and_zero_resources_is_not_a_leak():
    expected = CAT.expected_types("aws")
    inv = full_inventory("a1", skip=("container_registry",))
    inv.append(InventoryRow("a1", "container_registry", 0, False))      # unreadable
    inv = [InventoryRow(r.account_id, r.resource_type, 0, True) if r.resource_type == "ai_service" else r for r in inv]  # zero but inventoried
    d = data(accounts=[account("a1"), account("a2", connected=False)], inventory=inv)
    s = stage_l2(d, CAT)
    assert s.denominator == len(expected)            # a2 is not connected: not in L2
    assert s.numerator == len(expected) - 1
    assert s.leaks == [{"provider": "aws", "resource_type": "container_registry", "accounts": ["a1"]}]


def test_l2_unknown_provider_is_skipped_with_a_note():
    d = data(accounts=[account("x", provider="mars")], inventory=[InventoryRow("x", "compute", 1, True)])
    s = stage_l2(d, CAT)
    assert not s.has_data and s.value == 1.0
    assert any("mars" in n for n in s.notes)


def test_missing_inventory_or_activations_means_not_measured_not_zero():
    d = data(accounts=[account("a1")])
    s2, s3 = stage_l2(d, CAT), stage_l3(d, CAT, "2026.4")
    assert (s2.has_data, s2.value, s3.has_data, s3.value) == (False, 1.0, False, 1.0)
    assert "not measured" in s2.notes[0] and "not measured" in s3.notes[0]
    # with inventory but no activations, L2 is measured and L3 is not
    d.inventory = full_inventory("a1", skip=("compute",))
    assert stage_l2(d, CAT).has_data and not stage_l3(d, CAT, "2026.4").has_data


def test_l3_ceiling_moves_the_denominator_and_flags_new_modules():
    d = data(
        accounts=[account("a1")],
        inventory=full_inventory("a1"),
        activations=[Activation("a1", m.id, True) for m in CAT.modules_at("2026.1")],
        baseline_ceiling="2026.1",
    )
    old = stage_l3(d, CAT, "2026.1")
    new = stage_l3(d, CAT, "2026.4")
    assert old.value == 1.0
    assert new.denominator > old.denominator and new.value < 1.0
    flagged = {leak["module"] for leak in new.leaks if leak["new_since_baseline"]}
    assert {"attack_surface", "workflow_automation"} <= flagged


def test_l3_module_is_relevant_only_when_its_resource_type_is_present():
    inv = [InventoryRow("a1", "compute", 3, True)]      # no identity, no storage, no registry
    d = data(accounts=[account("a1")], inventory=inv, activations=[Activation("a1", "posture", False)])
    ids = {leak["module"] for leak in stage_l3(d, CAT, "2026.4").leaks}
    assert "identity_analysis" not in ids and "data_security" not in ids
    assert "posture" in ids and "runtime_sensor" in ids


def test_report_at_older_ceiling_never_counts_newer_modules():
    d = data(accounts=[account("a1")], inventory=full_inventory("a1"))
    ids = {leak["module"] for leak in stage_l3(d, CAT, "2025.1").leaks}
    assert "ai_posture" not in ids and "attack_surface" not in ids


@pytest.mark.parametrize("kwargs,expected", [
    ({}, "unowned"),
    ({"owner": "x"}, "no_decision"),
    ({"owner": "x", "decision": "fix"}, "ok"),
    ({"owner": "x", "decision": "false_positive"}, "ok"),
    ({"owner": "x", "decision": "accepted_risk"}, "accepted_without_expiry"),
    ({"owner": "x", "decision": "accepted_risk", "expiry": AS_OF - timedelta(days=1)}, "expired_acceptance"),
    ({"owner": "x", "decision": "accepted_risk", "expiry": AS_OF + timedelta(days=30)}, "ok"),
])
def test_classify_finding(kwargs, expected):
    assert classify_finding(finding(**kwargs), AS_OF) == expected


def test_l4_only_counts_open_findings_past_the_triage_window():
    fs = [
        finding("old-ok", owner="o", decision="fix", opened_days_ago=20),
        finding("old-bad", opened_days_ago=20),
        finding("fresh", opened_days_ago=2),                       # inside window
        finding("closed", opened_days_ago=40, closed_after=3),     # closed
    ]
    s = stage_l4(data(findings=fs, triage_window_days=7))
    assert (s.numerator, s.denominator) == (1, 2)
    assert s.leaks == [{"kind": "unowned", "count": 1, "ids": ["old-bad"]}]


def test_empty_input_does_not_crash_and_counts_as_full():
    sc = compute_score(data(), CAT)
    assert sc.yield_ == 1.0
    assert all(not st.has_data for st in sc.stages.values())
    assert sc.naive is None and sc.reach is None and sc.outcomes["zero_critical"] is None


def test_yield_is_the_product_and_baseline_yield_differs_when_modules_are_new():
    d = data(
        accounts=[account("a1"), account("a2", connected=False)],
        inventory=full_inventory("a1"),
        activations=[Activation("a1", m.id, True) for m in CAT.modules_at("2026.1")],
        findings=[finding(owner="o", decision="fix"), finding("g", opened_days_ago=30)],
    )
    sc = compute_score(d, CAT)
    prod = 1.0
    for st in sc.stages.values():
        prod *= st.value
    assert sc.yield_ == pytest.approx(prod)
    assert sc.baseline["yield"] > sc.yield_
    assert sc.baseline["ceiling"] == "2026.1"


def test_naive_uses_only_accounts_in_the_plan():
    d = data(accounts=[account("a", in_plan=True), account("b", in_plan=True, connected=False), account("c", connected=False)])
    sc = compute_score(d, CAT)
    assert sc.naive == 0.5
    assert sc.stages["L1"].value == pytest.approx(1 / 3)


def test_reach_components():
    teams = [
        Team("t1", "T1", True, 3, True, True, AS_OF - timedelta(days=10)),
        Team("t2", "T2", True, 0, False, False, None),
        Team("t3", "T3", False, 0, False, False, None),          # owns no assets: ignored
    ]
    r = compute_score(data(teams=teams), CAT).reach
    assert r["teams"] == 2
    assert r["components"] == {"team_activation": 0.5, "sso_coverage": 0.5, "scoped_roles": 0.5, "access_review_fresh": 0.5}
    assert r["value"] == 0.5 and r["gaps"]["no_active_user"] == ["t2"]


def test_entitlements_flag_underuse_and_overuse():
    es = [Entitlement("sensors", 100, 40), Entitlement("workloads", 100, 120)]
    out = {e["unit"]: e for e in compute_score(data(entitlements=es), CAT).entitlements}
    assert out["sensors"]["below_target"] and out["sensors"]["unused"] == 60
    assert out["workloads"]["over_licensed_use"] and not out["workloads"]["below_target"]


def test_outcomes_streak_zero_critical_and_downgrades():
    fs = [
        finding("c1", severity="critical", opened_days_ago=30, closed_after=3),
        finding("c2", severity="critical", opened_days_ago=40, closed_after=20),     # misses the 7-day SLA
        finding("c3", severity="critical", opened_days_ago=10, closed_after=2),
        finding("c4", severity="critical", opened_days_ago=5, closed_after=1),
        finding("m1", severity="high", opened_days_ago=40),
    ]
    o = compute_score(data(findings=fs), CAT).outcomes
    assert o["mttr_streak"] == 2          # c4, c3 are within SLA; c2 breaks the streak
    assert o["critical_open"] == 0 and o["zero_critical"] is True
    assert o["overdue_by_severity"]["high"] == 1

    opened = 40
    deadline = AS_OF - timedelta(days=opened) + timedelta(days=30)
    sus = finding("s", severity="medium", opened_days_ago=opened, previous_severity="high",
                  severity_changed_at=deadline - timedelta(days=1), owner="o", decision="fix")
    legit = finding("l", severity="medium", opened_days_ago=opened, previous_severity="high",
                    severity_changed_at=AS_OF - timedelta(days=opened - 2), owner="o", decision="fix")
    o = compute_score(data(findings=[sus, legit]), CAT).outcomes
    assert [x["finding_id"] for x in o["reclassification_suspects"]] == ["s"]


def test_a_false_positive_critical_does_not_break_zero_critical():
    fs = [finding("c", severity="critical", owner="o", decision="false_positive")]
    assert compute_score(data(findings=fs), CAT).outcomes["zero_critical"] is True


@pytest.mark.parametrize("y,value,mode,nxt", [
    (0.71, 0.90, "raise", 0.90),
    (0.90, 0.95, "raise", 0.95),
    (0.96, 1.0, "raise", 0.98),
    (0.985, 1.0, "hold", None),
])
def test_next_target(y, value, mode, nxt):
    t = next_target(y)
    assert t["value"] == pytest.approx(value) and t["mode"] == mode and t["next_checkpoint"] == nxt
