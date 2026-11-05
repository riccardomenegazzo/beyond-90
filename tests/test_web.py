import json
import sys
from pathlib import Path

import pytest

from beyond90.web import analyze_files, analyze_json

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "examples" / "portfolio" / "northwind"


def demo_files():
    return {p.name: p.read_text(encoding="utf-8") for p in DEMO.iterdir() if p.suffix in (".csv", ".toml")}


def test_demo_runs_and_returns_every_output():
    r = analyze_files(demo_files())
    assert r["ok"] and 0 < r["yield"] < 1 and r["actions"] > 0
    assert r["report_html"].lstrip().lower().startswith("<!doctype html")
    assert r["qbr_markdown"].startswith("# Quarterly business review")
    assert "Roadmap" in r["roadmap_markdown"] and json.loads(r["score_json"])["customer"] == r["customer"]


def test_it_matches_the_cli_for_the_same_directory(tmp_path):
    from beyond90.cli import main
    out = tmp_path / "r.json"
    assert main(["score", str(DEMO), "--format", "json", "--out", str(out)]) == 0
    assert json.loads(out.read_text())["yield"] == pytest.approx(analyze_files(demo_files())["yield"])


def test_every_problem_is_returned_at_once_not_the_first():
    files = demo_files()
    files["accounts.csv"] = "id,provider\n,aws\n"
    r = analyze_files(files)
    assert r["ok"] is False and len(r["errors"]) > 2


def test_error_messages_name_files_not_temporary_paths():
    r = analyze_files({"accounts.csv": "id,provider\n,aws\n"})
    assert r["errors"][0].startswith("customer.toml: not found") and "/tmp" not in r["errors"][0] and "beyond90 init" not in r["errors"][0]


def test_json_wrapper_and_options():
    out = json.loads(analyze_json(json.dumps(demo_files()), json.dumps({"hours": 2, "weeks": 8, "quarter": "Q4 2026"})))
    assert out["ok"] and "Q4 2026" in out["qbr_markdown"]


def test_file_names_cannot_escape_the_temporary_folder(tmp_path):
    files = demo_files()
    files["../../evil.csv"] = "x"
    analyze_files(files)
    assert not (tmp_path.parent / "evil.csv").exists() and not Path("/evil.csv").exists()


def test_site_build_is_reproducible_and_has_no_third_party_urls(tmp_path):
    sys.path.insert(0, str(ROOT / "site"))
    import build_site

    fake = tmp_path / "pyodide"
    fake.mkdir()
    for n in build_site.PYODIDE_FILES:
        (fake / n).write_bytes(b"x")
    font = tmp_path / "font"
    for n in build_site.FONT_FILES:
        (font / n).parent.mkdir(parents=True, exist_ok=True)
        (font / n).write_bytes(b"x")
    a, b = tmp_path / "a", tmp_path / "b"
    build_site.build(a, fake, font=font)
    build_site.build(b, fake, font=font)
    assert (a / "beyond90.zip").read_bytes() == (b / "beyond90.zip").read_bytes()
    assert {"index.html", "app.js", "style.css", "demo.json", "beyond90.zip", ".nojekyll"} <= {p.name for p in a.iterdir()}
    import re
    assert (a / "sw.js").read_text() == (b / "sw.js").read_text() and "beyond90-" in (a / "sw.js").read_text()
    allowed = ("github.com/riccardomenegazzo", "example.com/beyond90-probe", "www.w3.org/2000/svg")   # links, the self-check that proves nothing can leave, the SVG namespace
    for name in ("index.html", "app.js", "engine.js", "store.js", "workspace-core.js", "worker.js", "sw.js", "guide.js", "views.js", "ui.js"):
        urls = re.findall(r"https?://[^\s\"')`]+", (a / name).read_text())
        assert all(any(ok in u for ok in allowed) for u in urls), (name, urls)


HISTORY = ROOT / "examples" / "history" / "northwind-2026-09"


def read_dir(d):
    return {p.name: p.read_text(encoding="utf-8") for p in d.iterdir() if p.suffix in (".csv", ".toml")}


def test_the_fingerprint_is_the_same_whether_you_hash_a_folder_or_a_mapping_of_texts():
    from beyond90.provenance import hash_directory, input_hash
    from beyond90.web import fingerprint_files
    assert fingerprint_files(demo_files()) == input_hash(hash_directory(DEMO))
    noisy = {**demo_files(), "notes.txt": "not an input", "sub/accounts.csv.bak": "x"}
    assert fingerprint_files(noisy) == fingerprint_files(demo_files())                 # files that are not inputs cannot change it
    crlf = {k: v.replace("\n", "\r\n") for k, v in demo_files().items()}
    assert fingerprint_files(crlf) == fingerprint_files(demo_files())                  # nor can the line endings


def test_summary_is_cheap_and_agrees_with_the_full_analysis():
    from beyond90.web import summarize_files
    s, full = summarize_files(demo_files()), analyze_files(demo_files())
    assert s["yield"] == pytest.approx(full["yield"]) and s["input_hash"] == full["input_hash"] and set(s["stages"]) == {"L1", "L2", "L3", "L4"}
    assert summarize_files({"accounts.csv": "id\n"})["ok"] is False


def test_comparing_with_an_older_snapshot_adds_the_explanation():
    plain = analyze_files(demo_files())
    compared = analyze_files(demo_files(), since_files=read_dir(HISTORY))
    assert "What changed" in compared["report_markdown"] and "What changed" not in plain["report_markdown"]
    assert compared["input_hash"] == plain["input_hash"]                              # the older snapshot does not alter the new one's identity
    via_json = json.loads(analyze_json(json.dumps(demo_files()), json.dumps({"since_files": read_dir(HISTORY)})))
    assert via_json["report_markdown"] == compared["report_markdown"]


def test_the_report_footer_says_which_inputs_it_came_from():
    r = analyze_files(demo_files())
    assert (r["input_hash"][:12] in r["report_html"] and r["input_hash"][:12] in r["qbr_markdown"]) or r["input_hash"][:12] in r["report_markdown"]


PORTFOLIO = ROOT / "examples" / "portfolio"


def book_groups():
    return {d.name: read_dir(d) for d in sorted(PORTFOLIO.iterdir()) if d.is_dir()}


def test_a_book_scores_every_customer_and_spends_one_budget_of_hours():
    from beyond90.web import analyze_book
    r = analyze_book(book_groups(), hours=20, weeks=12)
    assert r["ok"] and len(r["customers"]) == 3 and r["weighted_end"] > r["weighted_start"]
    assert sum(c["hours"] for c in r["customers"]) <= 20 * 12 + 1e-6                     # never more than the budget
    assert {c["key"] for c in r["customers"]} == set(book_groups())
    assert "ARR-weighted Yield" in r["portfolio_markdown"] and "hours" in r["book_markdown"].lower() and r["book_html"].startswith("<!doctype html")


def test_a_book_is_deterministic_and_does_not_depend_on_folder_order():
    from beyond90.web import analyze_book
    g = book_groups()
    a = analyze_book(g, hours=15, weeks=8)
    b = analyze_book(dict(reversed(list(g.items()))), hours=15, weeks=8)
    assert a["book_markdown"] == b["book_markdown"] and a["portfolio_markdown"] == b["portfolio_markdown"]


def test_a_book_reports_the_invalid_customer_and_carries_on_with_the_rest():
    from beyond90.web import analyze_book
    g = book_groups()
    g["broken"] = {"customer.toml": '[customer]\nname = "Broken"\n'}
    g["not-a-customer"] = {"notes.csv": "x"}                                            # no customer.toml: ignored, not an error
    r = analyze_book(g, hours=10, weeks=6)
    assert r["ok"] and len(r["customers"]) == 3 and list(r["errors"]) == ["broken"] and "not-a-customer" not in r["errors"]
    assert analyze_book({"x": {"notes.csv": "x"}})["ok"] is False
    assert analyze_book({"b": {"customer.toml": "[customer]\n"}})["ok"] is False        # every customer invalid


def test_folder_names_are_made_safe_and_unique_without_losing_the_customer():
    from beyond90.web import _slug, analyze_book
    taken: set[str] = set()
    assert (_slug("../../etc", taken), _slug("a b", taken), _slug("a b", taken), _slug("***", taken)) == ("etc", "a-b", "a-b-2", "customer")
    g = {"../x/y": read_dir(PORTFOLIO / "northwind"), "z": read_dir(PORTFOLIO / "contoso-bank")}
    assert analyze_book(g, hours=5, weeks=4)["ok"]


def test_the_single_report_carries_the_input_confidence():
    assert analyze_files(demo_files())["confidence"] == "high"
    files = demo_files()
    files["inventory.csv"] = "account_id,resource_type,count,inventoried\n"
    assert analyze_files(files)["confidence"] == "low"
