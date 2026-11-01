import json
import shutil
from pathlib import Path

import pytest

from beyond90.cli import main

ROOT = Path(__file__).parent.parent / "examples" / "portfolio"
NW = str(ROOT / "northwind")


def run(capsys, *args):
    code = main(list(args))
    cap = capsys.readouterr()
    return code, cap.out, cap.err


def test_init_then_validate_then_refuse_to_overwrite(tmp_path, capsys):
    d = str(tmp_path / "acme")
    assert run(capsys, "init", d, "--name", "Acme")[0] == 0
    code, out, _ = run(capsys, "validate", d)
    assert code == 0 and "OK: Acme" in out
    assert run(capsys, "init", d)[0] == 1


def test_score_formats(capsys):
    code, out, _ = run(capsys, "score", NW, "--format", "json")
    assert code == 0 and 0 < json.loads(out)["yield"] < 1
    assert "Yield" in run(capsys, "score", NW)[1]
    assert run(capsys, "score", NW, "--format", "markdown", "--no-plan")[1].startswith("# Northwind")
    assert run(capsys, "score", NW, "--format", "html", "--no-plan")[1].startswith("<!doctype html>")


def test_fail_under_exit_code(capsys):
    assert run(capsys, "score", NW, "--fail-under", "0.5")[0] == 0
    code, _, err = run(capsys, "score", NW, "--fail-under", "0.99")
    assert code == 2 and "below --fail-under" in err


def test_ceiling_override_changes_the_score(capsys):
    old = json.loads(run(capsys, "score", NW, "--format", "json", "--ceiling", "2026.1")[1])
    new = json.loads(run(capsys, "score", NW, "--format", "json")[1])
    assert old["yield"] > new["yield"]


def test_store_history_and_no_save(tmp_path, capsys):
    db = str(tmp_path / "h.db")
    assert run(capsys, "score", NW, "--store", db, "--no-save")[0] == 0
    assert run(capsys, "history", "Northwind (mock)", "--store", db)[0] == 1          # nothing saved
    assert run(capsys, "score", NW, "--store", db)[0] == 0
    code, out, _ = run(capsys, "history", "Northwind (mock)", "--store", db)
    assert code == 0 and "2026-10-31" in out


def test_report_and_qbr_write_files(tmp_path, capsys):
    out = tmp_path / "r" / "report.html"
    assert run(capsys, "report", NW, "--out", str(out), "--weeks", "6")[0] == 0
    assert out.read_text().startswith("<!doctype html>")
    q = tmp_path / "qbr.md"
    assert run(capsys, "qbr", NW, "--out", str(q), "--quarter", "Q4 2026", "--weeks", "6")[0] == 0
    assert "Q4 2026" in q.read_text()


def test_actions_filter(capsys):
    code, out, _ = run(capsys, "actions", NW, "--leak", "L4", "--steps")
    assert code == 0 and "[L4]" in out and "[L1]" not in out
    code, out, _ = run(capsys, "actions", NW, "--format", "json")
    assert all(a["leak"] for a in json.loads(out))


def test_portfolio_and_invalid_customer(tmp_path, capsys):
    root = tmp_path / "pf"
    shutil.copytree(ROOT, root)
    code, out, _ = run(capsys, "portfolio", str(root))
    assert code == 0 and "ARR-weighted Yield" in out and "Contoso Bank" in out
    (root / "northwind" / "accounts.csv").write_text("id,provider,sources,connected\na,aws,billing,perhaps\n")
    code, out, _ = run(capsys, "portfolio", str(root), "--strict")
    assert code == 1 and "Skipped (invalid data)" in out
    data = json.loads(run(capsys, "portfolio", str(root), "--format", "json")[1])
    assert "northwind" in data["errors"] and len(data["customers"]) == 2


def test_errors_exit_one_with_a_readable_message(tmp_path, capsys):
    code, _, err = run(capsys, "score", str(tmp_path / "missing"))
    assert code == 1 and "Invalid input" in err


def test_catalogue_lists_modules(capsys):
    code, out, _ = run(capsys, "catalogue", "--ceiling", "2026.1")
    assert code == 0 and "ai_posture" in out and "attack_surface" not in out


def test_version(capsys):
    with pytest.raises(SystemExit) as e:
        main(["--version"])
    assert e.value.code == 0


HIST = str(ROOT.parent / "history" / "northwind-2026-09")


def test_plan_command_text_markdown_and_json(capsys):
    code, out, _ = run(capsys, "plan", NW, "--weeks", "8")
    assert code == 0 and "Checkpoints:" in out and "week" in out
    assert "## Roadmap" in run(capsys, "plan", NW, "--weeks", "4", "--format", "markdown")[1]
    data = json.loads(run(capsys, "plan", NW, "--weeks", "4", "--format", "json")[1])
    assert data["weeks"][0]["week"] == 0 and data["hours_per_week"] == 8.0
    assert run(capsys, "plan", NW, "--hours", "-1")[0] == 1


def test_explain_with_since_dir_and_with_store(tmp_path, capsys):
    code, out, _ = run(capsys, "explain", NW, "--since", HIST)
    assert code == 0 and "The customer moved" in out and "the bar moved" in out
    db = str(tmp_path / "h.db")
    run(capsys, "score", HIST, "--store", db)
    assert run(capsys, "explain", NW, "--store", db)[0] == 0
    assert run(capsys, "explain", NW)[0] == 1                       # needs --since or --store


def test_universe_and_forecast_commands(capsys):
    code, out, _ = run(capsys, "universe", NW)
    assert code == 0 and "no source has seen" in out
    assert json.loads(run(capsys, "universe", NW, "--format", "json")[1])["estimable"] is True
    code, out, _ = run(capsys, "forecast", NW, "--runs", "300")
    assert code == 0 and "Zero critical" in out
    assert json.loads(run(capsys, "forecast", NW, "--format", "json", "--runs", "300", "--seed", "1")[1])["seed"] == 1


def test_report_includes_the_new_sections(tmp_path, capsys):
    out = tmp_path / "r.html"
    assert run(capsys, "report", NW, "--out", str(out), "--since", HIST, "--weeks", "8")[0] == 0
    html = out.read_text()
    for needle in ("What changed since", "How complete is the universe?", "Roadmap", "Zero-critical forecast", "The J-curve"):
        assert needle in html
    assert "<script" not in html.lower()
