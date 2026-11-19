"""What else a customer weighs: shipped per family, checked on load, honest about when the other choice wins."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from beyond90 import estate
from beyond90.loader import DataError
from test_story import NAMES


def test_the_infrastructure_family_ships_the_usual_alternatives() -> None:
    alts = estate.read_alternatives()
    ids = [a["id"] for a in alts["infrastructure"]]
    assert ids == ["renew", "public_cloud", "other_platform", "three_tier", "build_own", "wait"]
    for a in alts["infrastructure"]:
        assert a["fits_them"], "each one says when the other choice is the better one"
        assert all(q.endswith("?") for q in a["ask"])


def test_lines_add_what_is_particular_to_them_and_ids_are_unique_across_the_file() -> None:
    alts = estate.read_alternatives()
    assert [a["id"] for a in alts["dr-backup"]] == ["keep_backup", "draas"]
    assert all(k in estate.FAMILIES or any(k in m for m in estate.FAMILIES.values()) for k in alts)
    ids = [a["id"] for items in alts.values() for a in items]
    assert len(ids) == len(set(ids))
    for items in alts.values():
        assert all(a["fits_them"] and a["prove"] for a in items)


def test_no_vendor_is_named() -> None:
    text = estate.ALTERNATIVES_FILE.read_text(encoding="utf-8")
    assert not NAMES.search(text), NAMES.search(text)


def test_the_page_gets_them_for_the_families_it_has() -> None:
    c = estate.workshop_catalog()
    assert "infrastructure" in c["alternatives"] and "edge-sites" in c["alternatives"] and "security" not in c["alternatives"]
    assert c["alternatives"]["infrastructure"][0]["name"] == "Renew the current platform"


def _write(tmp_path: Path, data: object) -> Path:
    p = tmp_path / "alternatives.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


GOOD = {"id": "wait", "name": "Do nothing", "why": "No budget.", "ask": ["What happens at the end date?"], "fits_us": "A date.", "fits_them": "No date.", "prove": "The cost of waiting."}


@pytest.mark.parametrize("data,words", [
    ({"nope": [GOOD, {**GOOD, "id": "renew"}]}, "neither a family"),
    ({"infrastructure": [GOOD]}, "between 2 and 8"),
    ({"infrastructure": [GOOD, GOOD]}, "unique"),
    ({"infrastructure": [GOOD, {**GOOD, "id": "Renew"}]}, "unique"),
    ({"infrastructure": [GOOD, {**GOOD, "id": "renew", "ask": ["Not a question"]}]}, "question mark"),
    ({"infrastructure": [GOOD, {**GOOD, "id": "renew", "why": "x" * 201}]}, "between 3 and 200"),
    ({"infrastructure": [GOOD, {**GOOD, "id": "renew", "extra": 1}]}, "each alternative has"),
    ([], "keyed by family"),
])
def test_a_bad_file_is_refused_with_the_reason(tmp_path: Path, data: object, words: str) -> None:
    with pytest.raises(DataError, match=words):
        estate.read_alternatives(_write(tmp_path, data))


def test_the_command_prints_them_for_the_line_in_the_conversation(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    from beyond90.cli import main

    assert main(["alternatives", "--profile", "service-provider-cloud"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("# What else they weigh: infrastructure")
    assert "## Renew the current platform" in out and "It is the better choice when:" in out
    assert "# What else they weigh: service-provider-cloud" in out and "## Resell a public cloud instead" in out
    assert main(["alternatives", "--format", "json", "--out", str(tmp_path / "alts.json")]) == 0
    assert json.loads((tmp_path / "alts.json").read_text(encoding="utf-8"))[0]["id"] == "renew"
    assert main(["alternatives", "--profile", "nope"]) == 2
    assert main(["alternatives", "--family", "nope"]) == 2
    assert main(["alternatives", "--family", "security"]) == 1, "no alternatives ship for that family yet"
