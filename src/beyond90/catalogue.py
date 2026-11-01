"""Versioned catalogues: expected resource types per provider, modules, playbooks.

The module catalogue is what makes the bar move: a module has a ``since``
version, and a score computed at ceiling ``V`` only counts modules with
``since <= V``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

DATA_DIR = Path(__file__).parent / "data"


@lru_cache(maxsize=256)
def parse_version(value: str) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in str(value).strip().split("."))
    except ValueError as exc:
        raise ValueError(f"invalid version {value!r}: expected numbers separated by dots, e.g. 2026.4") from exc


@dataclass(frozen=True)
class Module:
    id: str
    name: str
    category: str
    since: str
    providers: tuple[str, ...]
    requires_any: tuple[str, ...]
    on_connect: bool = False  # switched on by connecting the account, no extra work (agentless modules)


@dataclass(frozen=True)
class Playbook:
    id: str
    leak: str
    title: str
    why: str
    steps: tuple[str, ...]
    success: str
    due_days: int
    effort_base: float = 1.0      # hours, used by the planner
    effort_per_unit: float = 0.0  # hours per account / finding / team


class Catalogue:
    def __init__(
        self,
        resource_types: dict[str, str],
        expected: dict[str, list[str]],
        modules: list[Module],
        playbooks: dict[str, Playbook],
        version: str,
    ) -> None:
        self.resource_types = resource_types
        self.expected = expected
        self.modules = modules
        self.playbooks = playbooks
        self.version = version

    @classmethod
    def load(cls, directory: Optional[Path] = None) -> Catalogue:
        base = Path(directory) if directory else DATA_DIR
        rt = json.loads((base / "resource_types.json").read_text(encoding="utf-8"))
        mods = json.loads((base / "modules.json").read_text(encoding="utf-8"))
        pbs = json.loads((base / "playbooks.json").read_text(encoding="utf-8"))
        modules = [
            Module(
                id=m["id"],
                name=m["name"],
                category=m.get("category", "cloud"),
                since=m["since"],
                providers=tuple(m["providers"]),
                requires_any=tuple(m.get("requires_any", [])),
                on_connect=bool(m.get("on_connect", False)),
            )
            for m in mods["modules"]
        ]
        for m in modules:
            parse_version(m.since)
        playbooks = {
            pid: Playbook(
                id=pid,
                leak=p["leak"],
                title=p["title"],
                why=p["why"],
                steps=tuple(p["steps"]),
                success=p["success"],
                due_days=int(p["due_days"]),
                effort_base=float(p.get("effort", {}).get("base", 1.0)),
                effort_per_unit=float(p.get("effort", {}).get("per_unit", 0.0)),
            )
            for pid, p in pbs["playbooks"].items()
        }
        for provider, types in rt["expected"].items():
            unknown = [t for t in types if t not in rt["types"]]
            if unknown:
                raise ValueError(f"catalogue: provider {provider} expects undefined types {unknown}")
        return cls(rt["types"], rt["expected"], modules, playbooks, rt["version"])

    def expected_types(self, provider: str) -> list[str]:
        return list(self.expected.get(provider, []))

    def modules_at(self, ceiling: str) -> list[Module]:
        limit = parse_version(ceiling)
        return [m for m in self.modules if parse_version(m.since) <= limit]

    def module(self, module_id: str) -> Optional[Module]:
        return next((m for m in self.modules if m.id == module_id), None)
