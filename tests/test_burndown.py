"""Risk burn-down: what is open, how old, how long fixes take, and whether the customer is at zero."""
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

from beyond90 import web
from beyond90.burndown import DEFAULT_SLA, MTTR_MIN, build
from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.models import Finding

DIR = Path(__file__).parent.parent / "examples" / "portfolio" / "northwind"
TODAY = date(2026, 11, 9)


def data_with(findings):
    d = load_customer(str(DIR), Catalogue.for_directory(str(DIR)), require_accounts=True)[0]
    return replace(d, as_of=TODAY, findings=findings)


def f(i, sev, opened, closed=None, owner="x"):
    return Finding(id=f"f{i}", account_id="a", severity=sev, exposure="internal", opened_at=opened, closed_at=closed, owner=owner)


def test_open_counts_aging_and_past_target():
    r = build(data_with([f(1, "critical", TODAY - timedelta(days=3)), f(2, "critical", TODAY - timedelta(days=40)),
                         f(3, "high", TODAY - timedelta(days=100)), f(4, "low", TODAY - timedelta(days=5)),
                         f(5, "high", TODAY - timedelta(days=60), TODAY - timedelta(days=2))]))
    assert r["open"] == {"critical": 2, "high": 1, "medium": 0, "low": 1}
    assert r["open_total"] == 4
    assert r["aging"]["critical"] == {"0-7": 1, "8-30": 0, "31-90": 1, "91+": 0}
    assert r["past_sla"]["critical"] == 1 and r["past_sla"]["high"] == 1 and r["past_sla"]["low"] == 0
    assert r["sla_days"] == DEFAULT_SLA and r["sla_is_default"]


def test_a_custom_target_changes_what_is_late():
    d = data_with([f(1, "critical", TODAY - timedelta(days=3))])
    assert build(d)["past_sla"]["critical"] == 0
    r = build(d, {"critical": 2})
    assert r["past_sla"]["critical"] == 1 and not r["sla_is_default"]


def test_time_to_fix_needs_enough_closed_findings():
    few = [f(i, "high", TODAY - timedelta(days=20), TODAY - timedelta(days=10)) for i in range(MTTR_MIN - 1)]
    assert build(data_with(few))["mttr"]["high"] == {"days": None, "n": MTTR_MIN - 1}
    enough = [f(i, "high", TODAY - timedelta(days=20), TODAY - timedelta(days=10 - i)) for i in range(MTTR_MIN)]
    m = build(data_with(enough))["mttr"]["high"]
    assert m["n"] == MTTR_MIN and m["days"] == 11.0
    old = [f(i, "high", TODAY - timedelta(days=400), TODAY - timedelta(days=300)) for i in range(5)]
    assert build(data_with(old))["mttr"]["high"]["n"] == 0


def test_flow_rebuilds_the_past_from_dates():
    r = build(data_with([f(1, "critical", date(2026, 8, 10), date(2026, 9, 20)), f(2, "critical", date(2026, 10, 5))]))
    by = {m["month"]: m for m in r["flow"]}
    assert len(r["flow"]) == 6 and r["flow"][-1]["month"] == "2026-11"
    assert by["2026-08"]["opened"] == 1 and by["2026-08"]["open_critical"] == 1
    assert by["2026-09"]["closed"] == 1 and by["2026-09"]["open_critical"] == 0
    assert by["2026-10"]["opened"] == 1 and by["2026-10"]["open_critical"] == 1


def test_zero_critical_now_since_and_last_zero():
    r = build(data_with([f(1, "critical", TODAY - timedelta(days=50), TODAY - timedelta(days=12))]))["zero_critical"]
    assert r["now"] and r["days"] == 12 and r["since"] == str(TODAY - timedelta(days=12))
    r = build(data_with([f(1, "critical", TODAY - timedelta(days=50), TODAY - timedelta(days=30)), f(2, "critical", TODAY - timedelta(days=5))]))["zero_critical"]
    assert not r["now"] and r["last_zero"] == str(TODAY - timedelta(days=30))
    r = build(data_with([f(1, "high", TODAY - timedelta(days=5))]))["zero_critical"]
    assert r["now"] and r["never_had"] and r["days"] is None
    r = build(data_with([f(1, "critical", TODAY - timedelta(days=5))]))["zero_critical"]
    assert not r["now"] and r["last_zero"] is None


def test_unowned_and_oldest_urgent():
    r = build(data_with([f(1, "critical", TODAY - timedelta(days=9), owner=""), f(2, "high", TODAY - timedelta(days=30)), f(3, "low", TODAY - timedelta(days=90), owner="")]))
    assert r["unowned_urgent"] == 1
    assert [x["id"] for x in r["oldest_urgent"]] == ["f2", "f1"]


def test_no_findings_is_quiet_not_an_error():
    r = build(data_with([]))
    assert r["open_total"] == 0 and r["zero_critical"]["never_had"] and all(m["opened"] == 0 for m in r["flow"])


def test_the_browser_result_carries_it():
    r = web.analyze(str(DIR))
    assert r["ok"] and r["dashboard"]["burndown"]["open_total"] >= 0 and "flow" in r["dashboard"]["burndown"]


def test_uses_the_customers_own_targets_and_reports_the_closure_funnel():
    t = TODAY
    fs = [Finding("a", "a", "critical", "internal", t - timedelta(days=30), t - timedelta(days=20), owner="o", decision="fix", verified_at=t - timedelta(days=18)),
          Finding("b", "a", "high", "internal", t - timedelta(days=25), t - timedelta(days=10), owner="o", reopened=1),
          Finding("c", "a", "critical", "internal", t - timedelta(days=60))]
    d = data_with(fs)
    d = replace(d, settings=replace(d.settings, sla_days={"critical": 3, "high": 14, "medium": 60, "low": 120}))
    r = build(d)
    assert r["sla_days"]["critical"] == 3 and not r["sla_is_default"]
    c = r["closure"]
    assert c["raised"] == 3 and c["with_owner"] == 3 - 1 and c["closed"] == 2 and c["tracks_verification"]
    assert c["verified"] == 1 and c["reopened"] == 1 and c["recurrence_rate"] == 0.5


def test_closure_funnel_says_nothing_about_verification_when_not_recorded():
    t = TODAY
    c = build(data_with([f(1, "critical", t - timedelta(days=30), t - timedelta(days=20))]))["closure"]
    assert not c["tracks_verification"] and c["verified"] is None and c["recurrence_rate"] is None


def test_focus_counts_what_needs_a_decision():
    r = build(data_with([f(1, "critical", TODAY - timedelta(days=3)), f(2, "high", TODAY - timedelta(days=3)),
                         f(3, "medium", TODAY - timedelta(days=200)), f(4, "medium", TODAY - timedelta(days=5)),
                         f(5, "low", TODAY - timedelta(days=500)), f(6, "critical", TODAY - timedelta(days=9), TODAY - timedelta(days=1))]))
    assert r["focus"]["raw"] == 5 and r["focus"]["matter"] == 3 and r["focus"]["share"] == 0.6
    assert build(data_with([]))["focus"] == {**r["focus"], "raw": 0, "matter": 0, "share": None}


def test_automation_counts_how_fixes_were_made():
    from dataclasses import replace
    def closed(i, how, days=4):
        return replace(f(i, "high", TODAY - timedelta(days=days + 5), TODAY - timedelta(days=5)), closed_by=how)
    r = build(data_with([closed(1, "manual", 10), closed(2, "manual", 20), closed(3, "manual", 30), closed(4, "automated", 1), closed(5, "automated", 2),
                         closed(6, "automated", 3), closed(7, "assisted"), closed(8, "")]))["automation"]
    assert r["closed"] == 8 and r["tracked"] == 7
    assert r["rungs"]["manual"] == {"n": 3, "mean_days": 20.0}
    assert r["rungs"]["automated"] == {"n": 3, "mean_days": 2.0}
    assert r["rungs"]["assisted"] == {"n": 1, "mean_days": None}, "fewer than three is too few for a mean"
    assert r["automated_share"] == round(3 / 7, 3)


def test_automation_is_empty_when_nothing_is_recorded_and_ignores_old_fixes():
    from dataclasses import replace
    old = replace(f(1, "high", TODAY - timedelta(days=400), TODAY - timedelta(days=300)), closed_by="automated")
    r = build(data_with([old, f(2, "high", TODAY - timedelta(days=9), TODAY - timedelta(days=2))]))["automation"]
    assert r["tracked"] == 0 and r["automated_share"] is None and r["closed"] == 1
