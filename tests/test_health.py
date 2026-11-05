"""The health indicator: explainable, honest about what it could not measure, and led by its weakest part."""

from __future__ import annotations

from pathlib import Path

import pytest

from beyond90 import health, web

EXAMPLES = Path(__file__).resolve().parent.parent / "examples" / "portfolio"


def _health(name: str) -> dict:
    r = web.analyze(str(EXAMPLES / name))
    assert r["ok"]
    return r["dashboard"]["health"]


def test_the_example_customers_are_ordered_sensibly() -> None:
    good, weak = _health("contoso-bank"), _health("fabrikam-labs")
    assert good["score"] > weak["score"]
    assert good["band"] == "healthy" and weak["band"] == "at risk"


def test_every_part_has_a_reason_and_the_shares_add_up() -> None:
    h = _health("northwind")
    assert [c["id"] for c in h["components"]] == list(health.WEIGHTS)
    assert all(c["reason"] for c in h["components"])
    assert sum(c["share"] for c in h["components"]) == pytest.approx(1.0, abs=0.01)
    assert "hypothesis" in h["note"]


def test_the_band_follows_the_weakest_part() -> None:
    assert health._band(90, 80) == "healthy"
    assert health._band(90, 45) == "watch"       # a strong average does not hide a weak part
    assert health._band(90, 20) == "at risk"
    assert health._band(60, 90) == "watch"
    assert health._band(40, 90) == "at risk"


def test_a_part_that_cannot_be_measured_is_left_out_not_counted_as_good(tmp_path: Path) -> None:
    import re
    import shutil

    shutil.copytree(EXAMPLES / "contoso-bank", tmp_path / "c")
    toml = tmp_path / "c" / "customer.toml"
    toml.write_text(re.sub(r"(?m)^renewal_date.*\n", "", toml.read_text()))
    r = web.analyze(str(tmp_path / "c"))
    h = r["dashboard"]["health"]
    rel = next(c for c in h["components"] if c["id"] == "relationship")
    assert rel["value"] is None and rel["share"] == 0.0 and h["measured"] == 3
    assert sum(c["share"] for c in h["components"]) == pytest.approx(1.0, abs=0.01)


def test_exposed_critical_findings_cost_more_than_internal_ones() -> None:
    from datetime import date

    from beyond90.models import Finding

    def data(exposure: str):
        class D:
            findings = [Finding("F", "a", "critical", exposure, date(2026, 1, 1))]
        return D()

    assert health._outcomes(data("internet"))[0] < health._outcomes(data("internal"))[0]
    assert health._outcomes(type("E", (), {"findings": []})())[0] is None


def test_the_health_reaches_the_page_data() -> None:
    h = _health("contoso-bank")
    assert h["measured"] == 4 and h["of"] == 4 and h["weakest"] in health.WEIGHTS
