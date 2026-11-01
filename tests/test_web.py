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
    a, b = tmp_path / "a", tmp_path / "b"
    build_site.build(a, fake)
    build_site.build(b, fake)
    assert (a / "beyond90.zip").read_bytes() == (b / "beyond90.zip").read_bytes()
    assert {"index.html", "app.js", "style.css", "demo.json", "beyond90.zip", ".nojekyll"} <= {p.name for p in a.iterdir()}
    import re
    for name in ("index.html", "app.js"):
        urls = re.findall(r"https?://[^\s\"')]+", (a / name).read_text())
        assert all("github.com/riccardomenegazzo" in u for u in urls), (name, urls)       # links only; nothing is fetched from elsewhere
