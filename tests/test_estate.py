"""One customer across several product lines."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from beyond90 import estate, web
from beyond90.cli import main

ROOT = Path(__file__).resolve().parent.parent
HALDEN = ROOT / "examples" / "estates" / "halden-group"


def test_every_line_is_scored_on_its_own_profile() -> None:
    e = estate.analyze_estate_dir(HALDEN)
    assert e["ok"] and not e["errors"]
    assert {ln["profile"] for ln in e["lines"]} == {"hci", "dbaas", "file-storage", "dr-backup"}
    units = {ln["profile"]: ln["units"] for ln in e["lines"]}
    assert units == {"hci": "clusters", "dbaas": "database environments", "file-storage": "file servers", "dr-backup": "sites"}
    assert e["customer"] == "Halden Group (mock)" and e["family"] == "infrastructure"


def test_estate_yield_is_weighted_by_arr() -> None:
    e = estate.analyze_estate_dir(HALDEN)
    total = sum(ln["arr"] for ln in e["lines"])
    assert e["arr"] == total
    assert abs(e["yield"] - sum(ln["yield"] * ln["arr"] for ln in e["lines"]) / total) < 1e-9
    assert e["naive"] is not None and e["naive"] > e["yield"]
    assert e["arr_below"] == sum(ln["arr"] for ln in e["lines"] if ln["yield"] < estate.WEAK)


def test_whitespace_is_the_rest_of_the_family_led_by_what_runs() -> None:
    e = estate.analyze_estate_dir(HALDEN)
    white = [w["profile"] for w in e["whitespace"]]
    assert set(white) == {"kubernetes-platform", "object-storage", "platform-migration"}
    for w in e["whitespace"]:
        assert w["reasons"], "each missing line follows from something in place"
        assert w["opener"] and w["opener"]["stage"] == "value"
        assert w["proof"] and w["proof"]["text"]
    assert [w["weight"] for w in e["whitespace"]] == sorted((w["weight"] for w in e["whitespace"]), reverse=True)


def test_a_solid_line_leaning_on_a_weak_one_is_a_risk() -> None:
    e = estate.analyze_estate_dir(HALDEN)
    by = {ln["profile"]: ln for ln in e["lines"]}
    for r in e["risks"]:
        assert by[r["from"]]["yield"] >= estate.STRONG and by[r["to"]]["yield"] < estate.WEAK
    assert ("hci", "dr-backup") in {(r["from"], r["to"]) for r in e["risks"]}
    states = {(lk["from"], lk["to"]): lk["state"] for lk in e["links"]}
    assert states[("hci", "dr-backup")] == "risk" and states[("hci", "kubernetes-platform")] == "grow"


def test_the_map_puts_the_family_first_and_every_link_on_it() -> None:
    e = estate.analyze_estate_dir(HALDEN)
    on_map = [m["profile"] for m in e["map"]]
    assert on_map[0] == "hci" and set(on_map) == set(estate.FAMILIES["infrastructure"])
    assert all(lk["from"] in on_map and lk["to"] in on_map for lk in e["links"])


def test_links_only_name_known_profiles() -> None:
    from beyond90.catalogue import available_profiles
    known = set(available_profiles())
    for a, b, why in estate.LINKS:
        assert a in known and b in known and why and not why.endswith(".")
    for fam in estate.FAMILIES.values():
        assert set(fam) <= known


def test_the_account_plan_says_what_to_ask_and_where_to_grow() -> None:
    md = estate.analyze_estate_dir(HALDEN)["plan_markdown"]
    assert md.startswith("# Account plan: Halden Group (mock)")
    for heading in ("## Lines in place", "## Where one line puts another at risk", "## Where to grow next", "## Questions for the next meeting"):
        assert heading in md
    assert "Open with:" in md and "A proof to offer:" in md


def test_web_entry_keeps_the_folder_names_and_reports_bad_lines(tmp_path: Path) -> None:
    groups = {}
    for d in sorted(HALDEN.iterdir()):
        groups["My " + d.name] = {f.name: f.read_text(encoding="utf-8") for f in d.iterdir() if f.suffix in (".csv", ".toml")}
    groups["broken line"] = {"customer.toml": '[customer]\nname = "X"\nprofile = "dbaas"\n'}
    res = json.loads(web.analyze_estate_json(json.dumps(groups)))
    assert res["ok"] and res["version"]
    assert {ln["key"] for ln in res["lines"]} == {"My " + d.name for d in HALDEN.iterdir() if d.is_dir()}
    assert "broken line" in res["errors"]


def test_nothing_to_score_is_an_error() -> None:
    res = web.analyze_estate({"empty": {"notes.csv": "a\n"}})
    assert not res["ok"] and res["errors"]


def test_cli_writes_the_plan(tmp_path: Path, capsys) -> None:  # type: ignore[no-untyped-def]
    assert main(["estate", str(HALDEN)]) == 0
    assert "# Account plan: Halden Group (mock)" in capsys.readouterr().out
    out = tmp_path / "estate.json"
    assert main(["estate", str(HALDEN), "--format", "json", "--out", str(out)]) == 0
    assert json.loads(out.read_text())["customer"] == "Halden Group (mock)"
    empty = tmp_path / "none"
    empty.mkdir()
    assert main(["estate", str(empty)]) == 2


def test_a_security_estate_is_compared_with_the_security_family(tmp_path: Path) -> None:
    for profile, folder in (("saas", "acme-saas"), ("identity", "harbor-identity")):
        shutil.copytree(ROOT / "examples" / "profiles" / profile / folder, tmp_path / profile)
    e = estate.analyze_estate_dir(tmp_path)
    assert e["ok"] and e["family"] == "security"
    assert "hci" not in {w["profile"] for w in e["whitespace"]}


def test_workshop_catalog_has_questions_and_proofs_for_every_line() -> None:
    c = estate.workshop_catalog()
    assert set(c["families"]["infrastructure"]) == set(estate.FAMILIES["infrastructure"])
    assert set(c["families"]["security"]) == set(estate.FAMILIES["security"])
    for profile, line in c["lines"].items():
        assert len(line["questions"]) >= 8, profile
        assert any(q["stage"] == "value" for q in line["questions"]), profile
        assert all(q["stage"] in ("value", "L1", "L2", "L3", "L4") for q in line["questions"]), profile
        assert len(line["questions"]) <= 99                       # the page keys answers as profile#index, two digits
    for a, b, _ in c["links"]:
        assert a in c["lines"] and b in c["lines"]


def test_the_page_tests_use_the_shipped_questions() -> None:
    fixture = json.loads((ROOT / "site" / "test" / "workshop-catalog.json").read_text(encoding="utf-8"))
    c = estate.workshop_catalog()
    for profile, line in fixture["lines"].items():
        assert line == c["lines"][profile], f"site/test/workshop-catalog.json is stale for {profile}"


def test_each_risk_comes_with_the_first_step_on_the_weak_line() -> None:
    e = estate.analyze_estate_dir(HALDEN)
    by = {ln["profile"]: ln for ln in e["lines"]}
    for r in e["risks"]:
        assert r["step"] == by[r["to"]]["top_action"]["title"] and r["points"] > 0
    assert "First step:" in e["plan_markdown"]
