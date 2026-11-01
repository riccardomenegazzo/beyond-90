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
    assert (a / "sw.js").read_text() == (b / "sw.js").read_text() and "beyond90-" in (a / "sw.js").read_text()
    allowed = ("github.com/riccardomenegazzo", "example.com/beyond90-probe")        # links, and the self-check that proves nothing can leave
    for name in ("index.html", "app.js", "engine.js", "store.js", "workspace-core.js", "worker.js", "sw.js"):
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
    assert r["input_hash"][:12] in r["report_html"] and r["input_hash"][:12] in r["qbr_markdown"] or r["input_hash"][:12] in r["report_markdown"]
