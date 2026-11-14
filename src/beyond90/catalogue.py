"""Versioned catalogues: expected resource types per provider, modules, playbooks.

The module catalogue is what makes the bar move: a module has a ``since``
version, and a score computed at ceiling ``V`` only counts modules with
``since <= V``.

A *profile* is a catalogue for one kind of security product: ``cnapp`` (the default) for cloud security
platforms, ``endpoint`` for endpoint protection, and your own through ``--catalogue-dir``. A profile
supplies the asset types to inventory, the capabilities to switch on and, optionally, playbooks that
override the generic ones by id. The four stages and every formula are the same for all of them.
"""

from __future__ import annotations

import hashlib
import json
import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from .provenance import normalize
from .rubric import validate as validate_rubric

DATA_DIR = Path(__file__).parent / "data"
PROFILES_DIR = DATA_DIR / "profiles"
BASE_PROFILE = "cnapp"
DEFAULT_TERMS = {"estate": "cloud", "unit": "account", "units": "accounts"}


def available_profiles() -> list[str]:
    extra = sorted(p.name for p in PROFILES_DIR.iterdir() if p.is_dir()) if PROFILES_DIR.is_dir() else []
    return [BASE_PROFILE, *extra]


def peek_profile(directory: str | Path) -> Optional[str]:
    """The ``profile`` named in a customer's customer.toml, without validating anything else."""
    try:
        meta = tomllib.loads((Path(directory) / "customer.toml").read_text(encoding="utf-8"))
        value = meta.get("customer", {}).get("profile")
        return str(value) if value else None
    except (OSError, tomllib.TOMLDecodeError):
        return None


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
    use_case: str = ""        # the outcome the customer bought it for; see Catalogue.use_cases
    csf: tuple[str, ...] = ()  # NIST CSF 2.0 functions it serves: identify, protect, detect, respond, recover


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
    offer: str = ""               # "new" or "same": is it a new capability for these people (see trust.py)
    question: str = ""            # an open question to ask the customer about this gap
    we_commit: str = ""           # what the TAM promises to bring, with a date


class Catalogue:
    def __init__(
        self,
        resource_types: dict[str, str],
        expected: dict[str, list[str]],
        modules: list[Module],
        playbooks: dict[str, Playbook],
        version: str,
        digest: str = "",
        profile: str = BASE_PROFILE,
        terms: Optional[dict[str, str]] = None,
        description: str = "",
        rubric: Optional[dict[str, Any]] = None,
        use_cases: Optional[dict[str, str]] = None,
        pov_criteria: Optional[list[dict[str, str]]] = None,
    ) -> None:
        self.resource_types = resource_types
        self.expected = expected
        self.modules = modules
        self.playbooks = playbooks
        self.version = version
        self.digest = digest
        self.profile = profile
        self.terms = {**DEFAULT_TERMS, **(terms or {})}
        self.description = description
        self.use_cases = use_cases or {}
        self.pov_criteria = pov_criteria or []   # suggested proof of value criteria for this kind of product (pov.json)
        self.rubric = rubric or {"levels": ["bronze", "silver", "gold"], "checks": []}

    @classmethod
    def for_directory(cls, directory: str | Path, *, profile: Optional[str] = None, custom_dir: str | Path | None = None) -> Catalogue:
        """The catalogue a customer directory asks for: an explicit directory, an explicit profile, the profile named in
        customer.toml, or the default."""
        if custom_dir:
            return cls.load(Path(custom_dir))
        return cls.load(profile=profile or peek_profile(directory))

    @classmethod
    def for_root(cls, root: str | Path, *, profile: Optional[str] = None, custom_dir: str | Path | None = None) -> Catalogue:
        """One catalogue for a folder of customers. Mixing profiles in one portfolio would compare unlike things, so it is refused."""
        if custom_dir or profile:
            return cls.for_directory(root, profile=profile, custom_dir=custom_dir)
        seen = {peek_profile(d) or BASE_PROFILE for d in sorted(Path(root).iterdir()) if (d / "customer.toml").exists()}
        if len(seen) > 1:
            raise ValueError(f"{root}: customers use different profiles ({', '.join(sorted(seen))}); a portfolio compares like with like, so score each profile separately")
        return cls.load(profile=next(iter(seen), BASE_PROFILE))

    @classmethod
    def load(cls, directory: Optional[Path] = None, profile: Optional[str] = None) -> Catalogue:
        profile = profile or BASE_PROFILE
        if directory:
            base, name, overlay = Path(directory), "custom", None
        elif profile == BASE_PROFILE:
            base, name, overlay = DATA_DIR, BASE_PROFILE, None
        else:
            if profile not in available_profiles():
                raise ValueError(f"unknown profile {profile!r}; available: {', '.join(available_profiles())}")
            base, name, overlay = PROFILES_DIR / profile, profile, DATA_DIR
        files = [base / "resource_types.json", base / "modules.json"]
        pb_files = [base / "playbooks.json"] if (base / "playbooks.json").exists() else []
        if overlay is not None:
            pb_files = [overlay / "playbooks.json", *pb_files]
        rubric_file = base / "rubric.json" if (base / "rubric.json").exists() else DATA_DIR / "rubric.json"
        digest = hashlib.sha256(name.encode() + b"".join(normalize(f.read_bytes()) for f in [*files, *pb_files, rubric_file])).hexdigest()
        rubric = json.loads(rubric_file.read_text(encoding="utf-8"))
        pov_file = base / "pov.json"   # never inherited from the base: another kind of product proves other things
        pov = [{"text": str(c["text"]), "how": str(c.get("how", ""))} for c in json.loads(pov_file.read_text(encoding="utf-8"))["criteria"]] if pov_file.exists() else []
        validate_rubric(rubric)
        rt = json.loads(files[0].read_text(encoding="utf-8"))
        mods = json.loads(files[1].read_text(encoding="utf-8"))
        merged: dict[str, dict[str, Any]] = {}
        for f in pb_files:
            for pid, p in json.loads(f.read_text(encoding="utf-8"))["playbooks"].items():
                merged[pid] = {**merged.get(pid, {}), **p}
        pbs = {"playbooks": merged}
        terms = {**DEFAULT_TERMS, **rt.get("terms", {})}

        def say(text: str) -> str:
            for key, value in terms.items():
                text = text.replace("{" + key + "}", value).replace("{" + key.capitalize() + "}", value.capitalize())
            return text

        modules = [
            Module(
                id=m["id"],
                name=m["name"],
                category=m.get("category", "cloud"),
                since=m["since"],
                providers=tuple(m["providers"]),
                requires_any=tuple(m.get("requires_any", [])),
                on_connect=bool(m.get("on_connect", False)),
                use_case=m.get("use_case", ""),
                csf=tuple(m.get("csf", [])),
            )
            for m in mods["modules"]
        ]
        for m in modules:
            parse_version(m.since)
        playbooks = {
            pid: Playbook(
                id=pid,
                leak=p["leak"],
                title=say(p["title"]),
                why=say(p["why"]),
                steps=tuple(say(s) for s in p["steps"]),
                success=say(p["success"]),
                due_days=int(p["due_days"]),
                effort_base=float(p.get("effort", {}).get("base", 1.0)),
                effort_per_unit=float(p.get("effort", {}).get("per_unit", 0.0)),
                offer=p.get("offer", ""),
                question=say(p.get("question", "")),
                we_commit=say(p.get("we_commit", "")),
            )
            for pid, p in pbs["playbooks"].items()
        }
        for provider, types in rt["expected"].items():
            unknown = [t for t in types if t not in rt["types"]]
            if unknown:
                raise ValueError(f"catalogue: provider {provider} expects undefined types {unknown}")
        return cls(rt["types"], rt["expected"], modules, playbooks, rt["version"], digest, name if directory else profile, rt.get("terms"), rt.get("description", ""), rubric, mods.get("use_cases", {}), pov)

    def expected_types(self, provider: str) -> list[str]:
        return list(self.expected.get(provider, []))

    def modules_at(self, ceiling: str) -> list[Module]:
        limit = parse_version(ceiling)
        return [m for m in self.modules if parse_version(m.since) <= limit]

