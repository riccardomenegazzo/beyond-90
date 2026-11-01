import pytest

from beyond90.forecast import forecast_zero_critical, render_forecast

from helpers import data, finding


def crit(i, age, closed_after=None, **kw):
    return finding(f"c{i}", severity="critical", opened_days_ago=age, closed_after=closed_after, **kw)


HISTORY = [crit(f"h{i}", 40 + i, closed_after=d) for i, d in enumerate([3, 5, 6, 8, 12, 4, 7, 9])]


def test_not_available_without_closed_criticals():
    f = forecast_zero_critical(data(findings=[crit(1, 10)]))
    assert f["available"] is False and "No closed critical" in f["reason"]
    assert "not available" in render_forecast(f)


def test_already_at_zero_reports_the_risk_of_breaking_it():
    f = forecast_zero_critical(data(findings=HISTORY))
    assert f["state"] == "zero" and 0 <= f["p_new_critical_30d"] <= f["p_new_critical_90d"] <= 1
    assert f["median_days_to_recover"] > 0


def test_open_criticals_with_a_known_pace_reach_zero_soon():
    f = forecast_zero_critical(data(findings=HISTORY + [crit("o", 1)]), runs=500)
    assert f["state"] == "open" and f["p50_days"] is not None and f["p50_days"] <= 30
    z = f["p_zero_within"]
    assert z["30"] <= z["60"] <= z["90"]


def test_findings_older_than_any_closure_are_counted_and_slow_the_forecast():
    fresh = forecast_zero_critical(data(findings=HISTORY + [crit("o", 1)]), runs=500)
    stuck = forecast_zero_critical(data(findings=HISTORY + [crit("o", 200)]), runs=500)
    assert stuck["stuck_beyond_history"] == 1 and fresh["stuck_beyond_history"] == 0
    assert (stuck["p50_days"] or 10**6) > (fresh["p50_days"] or 0)
    assert "likely to stay open" in render_forecast(stuck)


def test_deterministic_for_a_seed_and_different_across_seeds():
    d = data(findings=HISTORY + [crit("o", 30), crit("p", 5)])
    assert forecast_zero_critical(d, runs=400, seed=1) == forecast_zero_critical(d, runs=400, seed=1)
    assert forecast_zero_critical(d, runs=400, seed=1) != forecast_zero_critical(d, runs=400, seed=2)


def test_false_positives_do_not_count_as_open_criticals():
    d = data(findings=HISTORY + [crit("fp", 60, owner="o", decision="false_positive")])
    assert forecast_zero_critical(d)["state"] == "zero"
