"""Snapshot history in a local SQLite file (standard library only).

One snapshot per customer per ``as_of`` date: running the score again for the
same day replaces that day's row, so history is deterministic and re-runs are
safe.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Any, Optional

from .scoring import Score

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    customer TEXT NOT NULL,
    as_of TEXT NOT NULL,
    ceiling_version TEXT NOT NULL,
    yield REAL NOT NULL,
    naive REAL,
    l1 REAL NOT NULL,
    l2 REAL NOT NULL,
    l3 REAL NOT NULL,
    l4 REAL NOT NULL,
    reach REAL,
    critical_open INTEGER,
    payload TEXT NOT NULL,
    PRIMARY KEY (customer, as_of)
);
"""


class Store:
    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        with closing(self._connect()) as con:
            con.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.path)
        con.row_factory = sqlite3.Row
        return con

    def save(self, score: Score) -> None:
        d = score.to_dict()
        with closing(self._connect()) as con, con:
            con.execute(
                "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    score.customer,
                    score.as_of,
                    score.ceiling_version,
                    score.yield_,
                    score.naive,
                    score.stages["L1"].value,
                    score.stages["L2"].value,
                    score.stages["L3"].value,
                    score.stages["L4"].value,
                    score.reach["value"] if score.reach else None,
                    score.outcomes["critical_open"] if score.outcomes["findings_total"] else None,
                    json.dumps(d, sort_keys=True),
                ),
            )

    def customers(self) -> list[str]:
        with closing(self._connect()) as con:
            return [r[0] for r in con.execute("SELECT DISTINCT customer FROM snapshots ORDER BY customer")]

    def history(self, customer: str) -> list[dict[str, Any]]:
        with closing(self._connect()) as con:
            rows = con.execute(
                "SELECT as_of, ceiling_version, yield, naive, l1, l2, l3, l4, reach, critical_open "
                "FROM snapshots WHERE customer = ? ORDER BY as_of",
                (customer,),
            ).fetchall()
        return [dict(r) for r in rows]

    def previous(self, customer: str, before: date | str) -> Optional[dict[str, Any]]:
        """Latest stored snapshot strictly before ``before``, as the full payload."""
        with closing(self._connect()) as con:
            row = con.execute(
                "SELECT payload FROM snapshots WHERE customer = ? AND as_of < ? ORDER BY as_of DESC LIMIT 1",
                (customer, str(before)),
            ).fetchone()
        return json.loads(row["payload"]) if row else None

    def time_to_zero(self, customer: str) -> Optional[dict[str, Any]]:
        """Days from the first snapshot to the first one with zero open critical findings."""
        hist = [h for h in self.history(customer) if h["critical_open"] is not None]
        if not hist:
            return None
        first = date.fromisoformat(hist[0]["as_of"])
        for h in hist:
            if h["critical_open"] == 0:
                reached = date.fromisoformat(h["as_of"])
                return {"first_snapshot": hist[0]["as_of"], "reached": h["as_of"], "days": (reached - first).days}
        return None
