"""The action plan as a CSV a ticket system can import.

One action per row, in the order the plan ranks them. The column names are the ones the common
trackers recognise on import (summary, description, assignee, due date, priority, labels), so the
file maps with no changes.

A spreadsheet or a ticket tool may treat a cell that starts with ``=``, ``+``, ``-``, ``@``, a tab
or a carriage return as a formula. Every text cell is therefore written so that it cannot start a
formula, whatever the customer's data contained.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence

from .playbooks import Action

COLUMNS = (
    "Summary",
    "Description",
    "Assignee",
    "Due date",
    "Priority",
    "Labels",
    "Customer",
    "Expected effect (pts)",
    "Effort (hours)",
    "Done when",
    "Action id",
)
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
_HIGH, _MEDIUM = 3, 8  # the first 3 actions are High, the next 5 Medium, the rest Low


def safe(cell: object) -> str:
    """Text that no spreadsheet will run: a leading apostrophe is the established neutraliser."""
    text = "" if cell is None else str(cell)
    return "'" + text if text.startswith(_FORMULA_START) else text


def _priority(rank: int) -> str:
    return "High" if rank < _HIGH else "Medium" if rank < _MEDIUM else "Low"


def _label(text: str) -> str:
    """Trackers split labels on spaces, so a label is a single word."""
    return "-".join("".join(c for c in text.lower() if c.isalnum() or c == "-").split()) or "action"


def _description(a: Action) -> str:
    parts = [a.detail]
    if a.steps:
        parts.append("Steps:\n" + "\n".join(f"{i}. {s}" for i, s in enumerate(a.steps, 1)))
    if a.question:
        parts.append(f"Ask the customer: {a.question}")
    if a.we_commit:
        parts.append(f"We commit to: {a.we_commit}")
    return "\n\n".join(p for p in parts if p)


def actions_csv(actions: Sequence[Action], customer: str) -> str:
    """The CSV text, with a header row. No open actions gives the header alone."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(COLUMNS)
    for rank, a in enumerate(actions):
        writer.writerow([
            safe(a.title),
            safe(_description(a)),
            safe(a.owner),
            safe(a.due),
            _priority(rank),
            safe(" ".join(_label(x) for x in ("beyond-90", a.leak, a.playbook) if x)),
            safe(customer),
            f"{a.effect_points:.1f}",
            f"{a.effort_hours:g}",
            safe(a.success),
            safe(a.id),
        ])
    return out.getvalue()
