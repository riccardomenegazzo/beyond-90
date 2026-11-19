"""The answer kit for tenders: neutral answers per line, with the evidence to attach and what to check."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from beyond90 import estate
from beyond90.loader import DataError
from test_story import NAMES


def test_the_kit_covers_the_lines_and_fits_a_requirement_note() -> None:
    kit = estate.read_answers()
    assert "any" in kit and {"hci", "dr-backup", "object-storage", "file-storage", "edge-sites"} <= set(kit)
    for items in kit.values():
        for a in items:
            assert len(a["answer"]) <= 300, "an answer fits in the note of a requirement"
            assert a["evidence"] and a["check"]


def test_no_vendor_is_named() -> None:
    text = estate.ANSWERS_FILE.read_text(encoding="utf-8")
    assert not NAMES.search(text), NAMES.search(text)


def test_the_page_gets_the_answers_for_its_lines() -> None:
    c = estate.workshop_catalog()
    assert "any" in c["answers"] and "dr-backup" in c["answers"]
    assert set(c["answers"]) <= {"any", *c["lines"]}


GOOD = {"id": "ha", "topic": "High availability", "match": ["high availability"], "answer": "It keeps running.", "evidence": ["The design"], "check": "Check the sizing."}


@pytest.mark.parametrize("data,words", [
    ({"nope": [GOOD]}, "not a product line"),
    ({"hci": []}, "between 1 and 12"),
    ({"hci": [GOOD, GOOD]}, "unique within a line"),
    ({"hci": [{**GOOD, "answer": "x" * 301}]}, "between 3 and 300"),
    ({"hci": [{**GOOD, "match": ["High Availability"]}]}, "lower-case"),
    ({"hci": [{**GOOD, "evidence": []}]}, "one to three items"),
    ({"hci": [{**GOOD, "extra": 1}]}, "each answer has"),
    ([], "keyed by line"),
])
def test_a_bad_kit_is_refused_with_the_reason(tmp_path: Path, data: object, words: str) -> None:
    p = tmp_path / "answers.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(DataError, match=words):
        estate.read_answers(p)


def test_the_command_prints_the_kit_for_a_line_then_for_any_line(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    from beyond90.cli import main

    assert main(["answers", "--profile", "dr-backup"]) == 0
    out = capsys.readouterr().out
    assert out.startswith("# Answer kit: dr-backup") and "# Answer kit: any line" in out and "Check first:" in out
    assert main(["answers", "--format", "json", "--out", str(tmp_path / "kit.json")]) == 0
    assert list(json.loads((tmp_path / "kit.json").read_text(encoding="utf-8"))) == ["any"]
    assert main(["answers", "--profile", "nope"]) == 2

