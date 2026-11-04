import json
import re
from datetime import date
from pathlib import Path

import pytest

from beyond90 import execqbr
from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.web import exec_qbr_files, exec_qbr_json

ROOT = Path(__file__).resolve().parent.parent
NW = ROOT / "examples" / "portfolio" / "northwind"
OLD = ROOT / "examples" / "history" / "northwind-2026-09"
CB = ROOT / "examples" / "portfolio" / "contoso-bank"
CAT = Catalogue.load()


def load(d):
    return load_customer(d, CAT)[0]


def files(d):
    return {p.name: p.read_text() for p in Path(d).iterdir() if p.suffix in (".csv", ".toml")}


@pytest.fixture(scope="module")
def q():
    return execqbr.build([load(NW), load(OLD)], CAT)


def test_quarters():
    assert execqbr.quarter_of(date(2026, 10, 31)) == (date(2026, 10, 1), date(2026, 12, 31), "Q4 2026")
    assert execqbr.quarter_of(date(2026, 2, 3))[:2] == (date(2026, 1, 1), date(2026, 3, 31))
    assert execqbr.default_period(date(2026, 10, 31))[2] == "Q4 2026"
    assert execqbr.label_for(date(2026, 9, 1), date(2026, 11, 30)) == "2026-09-01 to 2026-11-30"


def test_the_quarter_is_compared_with_the_last_snapshot_before_it(q):
    assert q["period"]["label"] == "Q4 2026" and q["baseline"] == "2026-09-30" and q["final"] == "2026-10-31" and q["compared"]
    assert q["snapshots"] == ["2026-09-30", "2026-10-31"]
    assert q["receipt"]["findings"]["closed"] == 37 and len(q["receipt"]["connected"]["accounts"]) == 7
    assert q["headline"][0].startswith("Effective coverage moved from 67% to 73%")


def test_engagement_is_limited_to_the_period(q):
    assert all("2026-10-01" <= m["date"] <= "2026-12-31" for m in q["engagement"]["moments"])
    assert q["engagement"]["touches"] == sum(q["engagement"]["by_kind"].values())


def test_it_asks_for_decisions_and_proposes_priorities(q):
    assert 1 <= len(q["decisions"]) <= 4 and any("spend" in d for d in q["decisions"])
    assert 1 <= len(q["priorities"]) <= 4 and all(p["owner"] for p in q["priorities"])


def test_the_executive_text_has_no_internal_jargon(q):
    for text in (execqbr.render_markdown(q), execqbr.render_html(q)):
        assert not re.search(r"\bYield\b|\bL[1-4]\b|\bbronze\b|\bsilver\b|\bgold\b|maturity level", text), "jargon reached the executive"


def test_the_html_is_self_contained_and_escaped(tmp_path):
    import shutil
    d = tmp_path / "nw"
    shutil.copytree(NW, d)
    p = d / "customer.toml"
    p.write_text(p.read_text().replace('name = "', 'name = "<img src=x onerror=alert(1)>', 1))
    old = tmp_path / "old"
    shutil.copytree(OLD, old)
    po = old / "customer.toml"
    po.write_text(po.read_text().replace('name = "', 'name = "<img src=x onerror=alert(1)>', 1))
    html = execqbr.render_html(execqbr.build([load(d), load(old)], CAT))
    assert "<img" not in html and "&lt;img" in html and "<script" not in html and not re.search(r"https?://", html)
    assert "Content-Security-Policy" in html


def test_a_single_snapshot_is_a_first_point_not_a_change():
    q = execqbr.build([load(NW)], CAT)
    assert not q["compared"] and q["receipt"] is None and "first recorded point" in q["headline"][0]
    assert "<table>" in execqbr.render_html(q)


def test_errors_are_said_plainly():
    with pytest.raises(ValueError, match="no snapshot falls"):
        execqbr.build([load(NW)], CAT, start=date(2025, 1, 1), end=date(2025, 3, 31))
    with pytest.raises(ValueError, match="more than one customer"):
        execqbr.build([load(NW), load(CB)], CAT)
    with pytest.raises(ValueError, match="ends before"):
        execqbr.build([load(NW)], CAT, start=date(2026, 12, 1), end=date(2026, 10, 1))


def test_the_browser_entry_point_takes_files_in_any_order():
    r = exec_qbr_files([files(NW), files(OLD)], "2026-10-01", "2026-12-31")
    assert r["ok"] and r["review"]["compared"] and r["html"].startswith("<!doctype html>") and r["markdown"].startswith("# Northwind")
    assert json.loads(exec_qbr_json(json.dumps({"snapshots": []})))["ok"] is False
    bad = exec_qbr_files([files(NW)], "2025-01-01", "2025-03-31")
    assert not bad["ok"] and "no snapshot falls" in bad["errors"][0]


def test_the_cli_writes_the_review(tmp_path):
    from beyond90 import cli
    out = tmp_path / "review.html"
    assert cli.main(["exec-qbr", str(NW), str(OLD), "--out", str(out)]) == 0
    assert "Decisions we need from you" in out.read_text()
