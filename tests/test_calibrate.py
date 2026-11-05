"""Calibration: modest by construction, and never louder than its data."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from beyond90 import calibrate, health, web

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "portfolio" / "contoso-bank"


def outcome(customer: str, result: str, **comps: float | None) -> dict:
    base = {"adoption": 70.0, "outcomes": 70.0, "relationship": 70.0, "trajectory": 70.0}
    base.update(comps)
    vals = [v for v in base.values() if v is not None]
    return {"customer": customer, "outcome": result, "decided_on": "2026-10-01",
            "reading": {"as_of": "2026-09-01", "score": sum(vals) / len(vals), "components": base}}


def cohort() -> list[dict]:
    stayed = [outcome(f"s{i}", "renewed", relationship=85 + i, adoption=75) for i in range(4)]
    left = [outcome(f"l{i}", "churned", relationship=35 + i, adoption=72) for i in range(4)]
    return stayed + left


def test_no_outcomes_says_so() -> None:
    r = calibrate.report([])
    assert r["total"] == 0 and not r["enough"] and r["suggested_weights"] is None and "No outcomes" in r["caveat"]


def test_too_few_is_reported_with_the_counts_and_no_conclusion() -> None:
    r = calibrate.report([outcome("a", "renewed"), outcome("b", "renewed"), outcome("c", "churned")])
    assert not r["enough"] and r["suggested_weights"] is None and r["findings"] == []
    assert "2 customers that stayed" in r["why"] or "there are 2 and 1" in r["why"]
    assert all(p["gap"] is None for p in r["parts"])


def test_a_part_that_separates_is_found_and_gets_more_weight() -> None:
    r = calibrate.report(cohort())
    rel = next(p for p in r["parts"] if p["id"] == "relationship")
    assert rel["gap"] > 40 and rel["n_stayed"] == 4
    assert r["concordance"] == 1.0
    w = r["suggested_weights"]
    assert w and sum(w.values()) == pytest.approx(1.0, abs=0.02)
    assert w["relationship"] > health.WEIGHTS["relationship"]
    assert w["relationship"] < 1.0                                  # the data never takes everything
    assert min(w.values()) >= 0.04
    assert any("Relationship separated" in f for f in r["findings"])


def test_nothing_separating_gives_no_weights() -> None:
    flat = [outcome(f"s{i}", "renewed") for i in range(3)] + [outcome(f"l{i}", "reduced") for i in range(3)]
    r = calibrate.report(flat)
    assert r["enough"] and r["suggested_weights"] is None and "no reason" in r["why"]


def test_a_part_pointing_the_wrong_way_is_not_rewarded() -> None:
    rows = [outcome(f"s{i}", "renewed", trajectory=30) for i in range(3)] + [outcome(f"l{i}", "churned", trajectory=80) for i in range(3)]
    r = calibrate.report(rows)
    traj = next(p for p in r["parts"] if p["id"] == "trajectory")
    assert traj["gap"] < 0 and any("wrong way" in f for f in r["findings"])


def test_unmeasured_parts_are_left_out_of_the_comparison() -> None:
    rows = cohort()
    for r in rows:
        r["reading"]["components"]["relationship"] = None
    rel = next(p for p in calibrate.report(rows)["parts"] if p["id"] == "relationship")
    assert rel["gap"] is None and rel["n_stayed"] == 0


def test_malformed_entries_are_counted_not_trusted() -> None:
    junk = [None, 5, {"customer": 1}, {"customer": "x", "outcome": "won"}, {"customer": "x", "outcome": "renewed"},
            {"customer": "x", "outcome": "renewed", "reading": {"components": {"adoption": 999, "outcomes": True}}}]
    r = calibrate.report([*junk, outcome("ok", "renewed")])
    assert r["total"] == 2 and r["skipped"] == 4 + 1
    row = next(p for p in r["parts"] if p["id"] == "adoption")
    assert row["n_stayed"] == 1                                      # 999 and True were rejected, the real one counted


def test_custom_weights_are_used_only_when_complete_and_sound() -> None:
    assert health.resolve_weights(None)[1] == "default"
    assert health.resolve_weights({"adoption": 1})[1] == "default"
    assert health.resolve_weights({**health.WEIGHTS, "adoption": -1})[1] == "default"
    assert health.resolve_weights({**health.WEIGHTS, "adoption": True})[1] == "default"
    w, src = health.resolve_weights({"adoption": 2, "outcomes": 1, "relationship": 1, "trajectory": 0.5})
    assert src == "calibrated" and sum(w.values()) == pytest.approx(1.0)


def test_calibrated_weights_change_the_reading_and_say_so() -> None:
    base = web.analyze(str(EXAMPLE))["dashboard"]["health"]
    shifted = web.analyze(str(EXAMPLE), health_weights={"adoption": 0.1, "outcomes": 0.1, "relationship": 0.1, "trajectory": 0.7})["dashboard"]["health"]
    assert base["weights"] == "default" and shifted["weights"] == "calibrated"
    assert shifted["score"] != base["score"]
    assert next(c for c in shifted["components"] if c["id"] == "trajectory")["weight"] == pytest.approx(0.7)


def test_the_web_function_round_trips_and_refuses_non_lists() -> None:
    r = json.loads(web.calibrate_json(json.dumps(cohort())))
    assert r["enough"] and r["suggested_weights"]
    assert json.loads(web.calibrate_json("{}"))["total"] == 0
