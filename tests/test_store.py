from beyond90.catalogue import Catalogue
from beyond90.scoring import compute_score
from beyond90.store import Store

from helpers import account, data, finding

CAT = Catalogue.load()


def score_on(day, findings=()):
    from datetime import date, timedelta
    d = data(accounts=[account("a1")], findings=list(findings))
    d.as_of = date(2026, 10, 1) + timedelta(days=day)
    return compute_score(d, CAT)


def test_save_history_upsert_and_previous(tmp_path):
    s = Store(tmp_path / "h.db")
    s.save(score_on(0))
    s.save(score_on(10))
    s.save(score_on(10))      # same day twice: one row
    hist = s.history("Test")
    assert [h["as_of"] for h in hist] == ["2026-10-01", "2026-10-11"]
    assert s.previous("Test", "2026-10-11")["as_of"] == "2026-10-01"
    assert s.previous("Test", "2026-10-01") is None
    assert s.customers() == ["Test"]


def test_time_to_zero_critical(tmp_path):
    s = Store(tmp_path / "h.db")
    crit = finding("c", severity="critical", opened_days_ago=60)
    s.save(score_on(0, [crit]))
    s.save(score_on(7, [crit]))
    s.save(score_on(20))                                  # the critical is gone from the export
    # findings_total == 0 stores critical_open as NULL; use a closed finding to keep data present
    closed = finding("c", severity="critical", opened_days_ago=60, closed_after=30, owner="o", decision="fix")
    s.save(score_on(21, [closed]))
    ttz = s.time_to_zero("Test")
    assert ttz == {"first_snapshot": "2026-10-01", "reached": "2026-10-22", "days": 21}


def test_no_zero_critical_yet(tmp_path):
    s = Store(tmp_path / "h.db")
    s.save(score_on(0, [finding("c", severity="critical")]))
    assert s.time_to_zero("Test") is None
