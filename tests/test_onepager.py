"""The one-page summary: complete, escaped, and self-contained."""

from __future__ import annotations

from pathlib import Path

import pytest

from beyond90 import web
from beyond90.onepager import render_onepager

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "portfolio" / "contoso-bank"


@pytest.fixture(scope="module")
def result() -> dict:
    r = web.analyze(str(EXAMPLE))
    assert r["ok"]
    return r


def test_the_analysis_carries_the_one_pager(result: dict) -> None:
    html = result["onepager_html"]
    assert "effective coverage" in html
    for part in ("Connected", "Visible", "Protected", "Handled"):
        assert part in html
    assert "What we will do next" in html


def test_it_uses_the_customers_words(result: dict) -> None:
    html = result["onepager_html"].lower()
    for jargon in ("yield", "l1", "l2", "maturity", "ladder"):
        assert jargon not in html


def test_it_makes_no_outside_request(result: dict) -> None:
    html = result["onepager_html"]
    assert "default-src 'none'" in html
    assert "<script" not in html and "http://" not in html and "https://" not in html


def test_hostile_text_is_escaped() -> None:
    q = {
        "customer": "<img src=x onerror=alert(1)>", "final": "2026-10-31", "baseline": "2026-10-01", "compared": True,
        "units": "accounts", "first": {"coverage": 0.5}, "last": {"coverage": 0.6, "parts": {"L1": 1, "L2": 1, "L3": 1, "L4": 1}, "connected": 1, "accounts": 2},
        "risk": {"critical_open": 0, "critical_internet": 0, "unconnected_spend_share": 0.0},
        "if_nothing": {"summary": "<script>x</script>"},
        "priorities": [{"title": "<b>t</b>", "owner": "<i>o</i>", "due": "d"}], "decisions": ["<u>d</u>"],
    }
    html = render_onepager(q)
    for raw in ("<img", "<script>x", "<b>t</b>", "<i>o</i>", "<u>d</u>"):
        assert raw not in html
    assert "&lt;img" in html


def test_bars_stay_inside_their_track() -> None:
    q = {
        "customer": "X", "final": "d", "baseline": "d", "compared": False, "units": "accounts", "first": {"coverage": 0},
        "last": {"coverage": 1, "parts": {"L1": 1.7, "L2": -0.2, "L3": 0.5, "L4": 1}, "connected": 0, "accounts": 0},
        "risk": {"critical_open": 0, "critical_internet": 0, "unconnected_spend_share": 0.0},
        "if_nothing": {"summary": ""}, "priorities": [], "decisions": [],
    }
    html = render_onepager(q)
    assert "width:100%" in html and "width:0%" in html and "width:170%" not in html
