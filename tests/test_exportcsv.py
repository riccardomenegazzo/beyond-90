"""The action CSV: importable by a tracker and impossible to turn into a formula."""

from __future__ import annotations

import csv
import io

from beyond90.exportcsv import COLUMNS, actions_csv, safe
from beyond90.playbooks import Action


def _action(i: int, title: str = "Connect accounts", **kw: object) -> Action:
    base = {
        "id": f"A{i}", "playbook": "connect accounts", "leak": "L1", "title": title,
        "detail": "Eleven accounts are not connected.", "owner": "Customer", "units": 11.0,
        "effect_points": 7.5, "due": "2026-12-01", "steps": ["Ask for the role", "Run the template"],
        "success": "All accounts connected", "effort_hours": 4.0, "question": "Who owns them?",
        "we_commit": "A template by Friday",
    }
    base.update(kw)
    return Action(**base)  # type: ignore[arg-type]


def _rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def test_header_and_one_row_per_action() -> None:
    rows = _rows(actions_csv([_action(1), _action(2, "Turn protections on")], "Northwind"))
    assert tuple(rows[0]) == COLUMNS
    assert [r["Summary"] for r in rows] == ["Connect accounts", "Turn protections on"]
    assert rows[0]["Customer"] == "Northwind"
    assert rows[0]["Expected effect (pts)"] == "7.5"
    assert "1. Ask for the role" in rows[0]["Description"]
    assert "Who owns them?" in rows[0]["Description"]


def test_priority_follows_rank() -> None:
    rows = _rows(actions_csv([_action(i) for i in range(10)], "X"))
    assert [r["Priority"] for r in rows] == ["High"] * 3 + ["Medium"] * 5 + ["Low"] * 2


def test_no_actions_is_just_the_header() -> None:
    assert actions_csv([], "X").strip().split(",")[0] == "Summary"
    assert _rows(actions_csv([], "X")) == []


def test_formulas_are_neutralised_everywhere() -> None:
    evil = "=HYPERLINK(\"http://x\",\"y\")"
    a = _action(1, evil, owner="+cmd", due="-1", success="@SUM(A1)", detail="\t=1+1")
    row = _rows(actions_csv([a], "=Customer"))[0]
    for col in ("Summary", "Assignee", "Due date", "Done when", "Customer", "Description"):
        assert not row[col].startswith(("=", "+", "-", "@", "\t", "\r")), col
    assert row["Summary"].startswith("'=")


def test_safe_leaves_ordinary_text_alone() -> None:
    assert safe("Connect accounts") == "Connect accounts"
    assert safe(None) == ""
    assert safe("-") == "'-"


def test_labels_are_single_words() -> None:
    row = _rows(actions_csv([_action(1, playbook="Connect all accounts")], "X"))[0]
    assert all(" " not in part for part in row["Labels"].split(" ")), row["Labels"]
    assert "beyond-90" in row["Labels"]
