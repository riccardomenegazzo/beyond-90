"""Stable aliases for the names an assistant should not see, for the MCP server.

``beyond90 mcp ROOT --pseudonyms`` swaps every known customer, person, team and account name in what a tool returns for an
alias (Customer A, Person 1, Team 1, Account 1) and swaps an alias a model sends back into the real name. The table can live
in a file you choose (created readable by you only), so the same name keeps the same alias from one session to the next;
without a file it lives in memory and aliases are assigned in a fixed order.

What this cannot do: it replaces names it was told about (the ones the loader found in the data). A name typed inside a
free-text field it did not list passes through, and an alias is not anonymity: the numbers and the shape of the data can
still point at one customer.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Optional

LABEL = {"customer": "Customer", "person": "Person", "team": "Team", "account": "Account"}
MIN_LENGTH = 3


def _letters(n: int) -> str:
    out = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


class Aliases:
    def __init__(self, path: Optional[str | Path] = None) -> None:
        self.path = Path(path) if path else None
        self.entries: dict[str, tuple[str, str, str]] = {}      # lowercase original -> (alias, kind, original as written)
        self.counts: dict[str, int] = dict.fromkeys(LABEL, 0)
        self._rx: Optional[re.Pattern[str]] = None
        if self.path and self.path.is_file():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            for e in raw.get("entries", []):
                if isinstance(e, dict) and e.get("k") in LABEL and isinstance(e.get("o"), str) and isinstance(e.get("a"), str):
                    self.entries[e["o"].lower()] = (e["a"], e["k"], e["o"])
            self._recount()

    def _recount(self) -> None:
        aliases_by_kind: dict[str, set[str]] = {k: set() for k in LABEL}
        for alias, kind, _ in self.entries.values():
            aliases_by_kind[kind].add(alias)
        self.counts = {k: len(v) for k, v in aliases_by_kind.items()}

    def group(self, kind: str, originals: Iterable[str]) -> Optional[str]:
        """Give every name in ``originals`` one alias (an existing alias of any of them wins). Names shorter than 3 characters are skipped."""
        names = [" ".join(str(o).split()) for o in originals]
        names = [n for n in names if len(n) >= MIN_LENGTH]
        if not names or kind not in LABEL:
            return None
        alias = next((self.entries[n.lower()][0] for n in names if n.lower() in self.entries), None)
        if alias is None:
            idx = self.counts[kind]
            alias = f"{LABEL[kind]} {_letters(idx)}" if kind == "customer" else f"{LABEL[kind]} {idx + 1}"
            self.counts[kind] += 1
        for n in names:
            if n.lower() not in self.entries:
                self.entries[n.lower()] = (alias, kind, n)
                self._rx = None
        return alias

    def _scrub_rx(self) -> Optional[re.Pattern[str]]:
        if self._rx is None and self.entries:
            keys = sorted(self.entries, key=lambda k: (-len(k), k))
            self._rx = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(k) for k in keys) + r")(?!\w)", re.IGNORECASE)
        return self._rx

    def scrub(self, text: str) -> str:
        rx = self._scrub_rx()
        return rx.sub(lambda m: self.entries[m.group(0).lower()][0], text) if rx else text

    def scrub_obj(self, obj: Any) -> Any:
        if isinstance(obj, str):
            return self.scrub(obj)
        if isinstance(obj, list):
            return [self.scrub_obj(x) for x in obj]
        if isinstance(obj, dict):
            return {self.scrub(k) if isinstance(k, str) else k: self.scrub_obj(v) for k, v in obj.items()}
        return obj

    def restore(self, text: str) -> str:
        """An alias in a text back to the first real name it stands for."""
        back: dict[str, str] = {}
        for alias, _, original in self.entries.values():
            back.setdefault(alias.lower(), original)
        if not back:
            return text
        rx = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(a) for a in sorted(back, key=lambda a: (-len(a), a))) + r")(?!\w)", re.IGNORECASE)
        return rx.sub(lambda m: back[m.group(0).lower()], text)

    def restore_obj(self, obj: Any) -> Any:
        if isinstance(obj, str):
            return self.restore(obj)
        if isinstance(obj, list):
            return [self.restore_obj(x) for x in obj]
        if isinstance(obj, dict):
            return {k: self.restore_obj(v) for k, v in obj.items()}
        return obj

    def save(self) -> None:
        if not self.path:
            return
        data = {"entries": [{"o": o, "a": a, "k": k} for a, k, o in sorted(self.entries.values(), key=lambda t: (t[1], t[0], t[2]))]}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)
