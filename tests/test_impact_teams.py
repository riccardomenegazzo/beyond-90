import re
import shutil
from pathlib import Path

import pytest

from beyond90 import impact
from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.web import analyze

ROOT = Path(__file__).resolve().parent.parent
NW = ROOT / "examples" / "portfolio" / "northwind"
OLD = ROOT / "examples" / "history" / "northwind-2026-09"
CAT = Catalogue.load()


def load(d):
    return load_customer(d, CAT)[0]


@pytest.fixture(scope="module")
def receipt():
    return impact.receipt(load(OLD), load(NW), CAT)


@pytest.fixture(scope="module")
def dash():
    return analyze(str(NW), since=str(OLD))


# ----------------------------------------------------------------------------- value receipt
def test_receipt_counts_what_moved_on_the_demo(receipt):
    assert len(receipt["connected"]["accounts"]) == 7 and receipt["connected"]["spend"] > 0
    assert receipt["findings"]["closed"] == 37 and receipt["findings"]["by_severity"].get("critical") == 4
    assert receipt["capabilities"]["gained"] > 0
    assert receipt["from"] < receipt["to"] and receipt["days"] > 0
    assert receipt["headline"] and receipt["headline"][0].startswith("7 account(s) connected")


def test_receipt_says_followed_not_caused_and_names_what_did_not_move(receipt):
    md = impact.render(receipt)
    assert "followed" in md.lower() and "caused" in md.lower()
    for t in receipt["touches"]["timeline"]:
        assert t["followed_count"] >= len(t["followed_by"]) and len(t["followed_by"]) <= 6
    assert receipt["remaining"], "a receipt must name the gaps that remain"


def test_receipt_against_itself_is_empty_and_honest():
    d = load(NW)
    r = impact.receipt(d, d, CAT)
    assert r["findings"]["closed"] == 0 and not r["connected"]["accounts"] and not r["headline"]
    assert impact.maybe(None, d, CAT) is None


def test_receipt_html_is_self_contained_and_escaped(tmp_path):
    d = tmp_path / "nw"
    shutil.copytree(NW, d)
    p = d / "customer.toml"
    p.write_text(p.read_text().replace('name = "', 'name = "<script>x</script>', 1))
    html = impact.render(impact.receipt(load(OLD), load(d), CAT), html=True)
    assert "<script>x" not in html and "&lt;script&gt;" in html
    assert "Content-Security-Policy" in html and not re.search(r"<script|https?://", html)
    assert html.count("<ul>") == html.count("</ul>") and html.count("<li>") == html.count("</li>")
    assert not re.search(r"</h[12]><li>|</p><li>", html), "every list item sits inside a list"


def test_analyze_exposes_the_receipt_only_with_a_comparison(dash):
    assert dash["dashboard"]["impact"]["findings"]["closed"] == 37
    assert dash["receipt_html"].lower().startswith("<!doctype html>") and dash["receipt_markdown"]
    alone = analyze(str(NW))
    assert alone["dashboard"]["impact"] is None and alone["receipt_html"] == ""


# ----------------------------------------------------------------------------- team digests
def test_teams_are_ranked_by_stake_and_complete(dash):
    teams = dash["dashboard"]["teams"]["teams"]
    assert len(teams) >= 2
    assert [t["stake"] for t in teams] == sorted((t["stake"] for t in teams), reverse=True)
    accounts = load(NW).accounts
    assert sum(t["accounts"] for t in teams) == len(accounts)
    assert all(len(t["asks"]) <= 3 for t in teams)


def test_team_messages_speak_the_customers_language(dash):
    for t in dash["dashboard"]["teams"]["teams"]:
        m = t["message"]
        assert not re.search(r"\bL[1-4]\b|yield|leak|stake|score", m, re.I), m
        assert not re.search(r"\b1 accounts\b|\b1 connectors\b|\b1 findings\b", m)
        if t["contacts"]:
            assert m.startswith(f"Hi {t['contacts'][0]['name'].split()[0]},")


def test_a_team_with_nothing_to_do_is_thanked(dash):
    quiet = [t for t in dash["dashboard"]["teams"]["teams"] if not t["asks"]]
    for t in quiet:
        assert "nothing" in t["message"] and "Thank you" in t["message"]
