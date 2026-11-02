import json
from pathlib import Path

import pytest

from beyond90 import dashboard
from beyond90.web import analyze, analyze_files, plan_files

ROOT = Path(__file__).resolve().parent.parent
NORTH = ROOT / "examples" / "portfolio" / "northwind"
SEPT = ROOT / "examples" / "history" / "northwind-2026-09"


def files(d):
    return {p.name: p.read_text() for p in d.iterdir() if p.suffix in (".csv", ".toml")}


@pytest.fixture(scope="module")
def res():
    return analyze(str(NORTH), since=str(SEPT))


def test_the_dashboard_is_plain_json_and_agrees_with_the_score(res):
    d = res["dashboard"]
    json.dumps(d)
    sc = json.loads(res["score_json"])
    assert d["accounts"]["total"] == sc["stages"]["L1"]["denominator"]
    assert sum(1 for r in d["accounts"]["rows"] if r["connected"]) == sc["stages"]["L1"]["numerator"]
    assert [a["id"] for a in d["actions"]] == [a["id"] for a in sc["actions"]]
    assert d["plan"]["weeks"][0]["yield"] == pytest.approx(sc["yield"])
    assert d["attribution"]["delta_points"] == pytest.approx((sc["yield"] - d["attribution"]["yield_from"]) * 100)
    assert sum(f["points"] for f in d["attribution"]["factors"]) == pytest.approx(d["attribution"]["delta_points"])


def test_every_leak_in_the_stages_shows_up_per_account_and_per_finding(res):
    d, sc = res["dashboard"], json.loads(res["score_json"])
    missing = {(a, leak["resource_type"]) for leak in sc["stages"]["L2"]["leaks"] for a in leak["accounts"]}
    got = {(r["id"], t) for r in d["accounts"]["rows"] for t in r["missing_types"]}
    assert got == missing
    states = d["findings"]["states"]
    for leak in sc["stages"]["L4"]["leaks"]:
        assert states[leak["kind"]] == leak["count"]
    assert states["ok"] == sc["stages"]["L4"]["numerator"]


def test_without_a_comparison_there_is_no_attribution_and_the_candor_is_structured():
    r = analyze(str(NORTH))
    assert r["dashboard"]["attribution"] is None and r["dashboard"]["drift"] is None
    assert all({"say", "evidence", "why"} <= set(c) for c in r["dashboard"]["candor"])


def test_lists_are_capped_and_say_so(monkeypatch):
    monkeypatch.setattr(dashboard, "ACCOUNT_CAP", 5)
    monkeypatch.setattr(dashboard, "FINDING_CAP", 7)
    d = analyze(str(NORTH))["dashboard"]
    assert len(d["accounts"]["rows"]) == 5 and d["accounts"]["truncated"] and d["accounts"]["total"] > 5
    assert len(d["findings"]["rows"]) == 7 and d["findings"]["truncated"]


def test_the_what_if_plan_matches_the_report_plan_and_moves_with_the_hours():
    f = files(NORTH)
    base = plan_files(f, hours=8, weeks=26, realization=0.9)["plan"]
    assert base["weeks"] == analyze_files(f)["dashboard"]["plan"]["weeks"]
    more = plan_files(f, hours=20, weeks=26, realization=0.9)["plan"]
    assert more["milestones"]["90%"] <= base["milestones"]["90%"]
    assert more["weeks"][-1]["yield"] >= base["weeks"][-1]["yield"] - 1e-9


def test_the_what_if_reports_bad_data_instead_of_failing():
    r = plan_files({"accounts.csv": "id,provider\n,aws\n"})
    assert r["ok"] is False and r["errors"]
