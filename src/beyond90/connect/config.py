"""The pipeline configuration (beyond90.toml): customer, sources, safety limits, outputs.

A configuration holds no secrets. A source that needs a token names the environment variable that carries it.
Every problem is reported at once, with the nearest valid name when a key looks like a typo.
"""

from __future__ import annotations

import copy
import difflib
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..loader import KNOWN_COLUMNS
from ..models import UNIVERSE_SOURCES
from .mapping import MapError, validate_spec

TARGETS = ("accounts", "inventory", "activations", "findings", "teams", "entitlements", "contacts", "commitments", "interactions", "connectors")
REQUIRED = {
    "accounts": ("id", "provider"),
    "inventory": ("account_id", "resource_type", "count", "inventoried"),
    "activations": ("account_id", "module_id", "active"),
    "findings": ("id", "account_id", "severity", "opened_at"),
    "teams": ("id", "has_assets", "active_users", "sso", "role_scoped"),
    "entitlements": ("unit", "licensed", "used"),
    "contacts": ("id", "role"),
    "commitments": ("id", "due_on"),
    "interactions": ("date", "kind"),
    "connectors": ("account_id", "kind", "status"),
}
KEYS_OF = {"inventory": ("account_id", "resource_type"), "activations": ("account_id", "module_id"), "entitlements": ("unit",), "connectors": ("account_id", "kind", "name")}
SOURCE_KEYS = {"name", "type", "target", "tag", "preset", "argv", "url", "path", "format", "records", "map", "auth", "headers", "pagination",
               "connected_if_listed", "env", "timeout_seconds", "delimiter"}
OUTPUTS = ("report", "qbr", "successplan", "summary", "roadmap", "json", "prep", "status", "receipt", "briefing")
TOP_KEYS = {"customer", "settings", "state", "security", "source", "notify", "export", "outputs", "advisories"}

PRESETS: dict[str, dict[str, Any]] = {
    "aws-org": {
        "type": "command", "argv": ["aws", "organizations", "list-accounts", "--output", "json"], "format": "json", "records": "Accounts",
        "target": "accounts", "tag": "org", "env": ["AWS_PROFILE", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"],
        "map": {"id": "Id", "provider": {"const": "aws"}, "owner": "Name",
                "status": {"path": "Status", "map": {"active": "active", "suspended": "decommissioned", "pending_closure": "decommissioned"}, "default": "active"},
                "created_at": {"path": "JoinedTimestamp", "transform": "date"}},
    },
    "azure-accounts": {
        "type": "command", "argv": ["az", "account", "list", "--all", "--output", "json"], "format": "json", "records": "",
        "target": "accounts", "tag": "org", "env": ["AZURE_CONFIG_DIR", "AZURE_SUBSCRIPTION_ID"],
        "map": {"id": "id", "provider": {"const": "azure"}, "owner": "name",
                "status": {"path": "state", "map": {"enabled": "active", "disabled": "decommissioned", "warned": "active", "pastdue": "active"}, "default": "active"}},
    },
    "gcp-projects": {
        "type": "command", "argv": ["gcloud", "projects", "list", "--format=json"], "format": "json", "records": "",
        "target": "accounts", "tag": "org", "env": ["CLOUDSDK_CONFIG", "CLOUDSDK_CORE_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"],
        "map": {"id": "projectId", "provider": {"const": "gcp"}, "owner": "name",
                "status": {"path": "lifecycleState", "map": {"active": "active", "delete_requested": "decommissioned"}, "default": "active"},
                "created_at": {"path": "createTime", "transform": "date"}},
    },
}


class ConfigError(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


@dataclass
class Source:
    name: str
    type: str
    target: str
    tag: str = ""
    argv: list[str] = field(default_factory=list)
    url: str = ""
    path: str = ""
    format: str = "json"
    records: str = ""
    mapping: dict[str, Any] = field(default_factory=dict)
    auth: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    pagination: dict[str, Any] = field(default_factory=dict)
    connected_if_listed: bool = False
    env: list[str] = field(default_factory=list)
    timeout_seconds: float = 30.0
    delimiter: str = ","


@dataclass
class Config:
    base_dir: Path
    customer: dict[str, Any]
    settings: dict[str, Any]
    state_dir: Path
    allow_hosts: list[str]
    max_bytes: int
    timeout_seconds: float
    retries: int
    sources: list[Source]
    notify: dict[str, Any]
    export: dict[str, Any]
    outputs: list[str]
    output_options: dict[str, Any] = field(default_factory=dict)
    advisories_path: Optional[Path] = None
    keep_snapshots: int = 180
    keep_outputs: int = 30


def _suggest(key: str, known: Any) -> str:
    near = difflib.get_close_matches(key, list(known), n=1, cutoff=0.7)
    return f" (did you mean {near[0]!r}?)" if near else ""


def _merge_preset(raw: dict[str, Any], errors: list[str], where: str) -> dict[str, Any]:
    name = raw.get("preset")
    if name is None:
        return raw
    if name not in PRESETS:
        errors.append(f"{where}: unknown preset {name!r}; available: {', '.join(sorted(PRESETS))}")
        return raw
    merged = copy.deepcopy(PRESETS[name])
    for k, v in raw.items():
        if k == "map" and isinstance(v, dict):
            merged["map"] = {**merged.get("map", {}), **v}
        else:
            merged[k] = v
    return merged


def _source(raw: dict[str, Any], i: int, security: dict[str, Any], errors: list[str]) -> Optional[Source]:
    where = f"source #{i + 1}" + (f" ({raw['name']})" if isinstance(raw.get("name"), str) else "")
    raw = _merge_preset(raw, errors, where)
    n0 = len(errors)
    for k in raw:
        if k not in SOURCE_KEYS:
            errors.append(f"{where}: unknown key {k!r}{_suggest(k, SOURCE_KEYS)}")
    name, typ, target = str(raw.get("name") or ""), str(raw.get("type") or ""), str(raw.get("target") or "")
    if not isinstance(name, str) or not name.strip():
        errors.append(f"{where}: name is required")
    if typ not in ("http", "command", "file"):
        errors.append(f"{where}: type must be http, command or file")
    if target not in TARGETS:
        errors.append(f"{where}: target must be one of {', '.join(TARGETS)}")
    if errors[n0:]:
        return None
    mapping = raw.get("map", {})
    if not isinstance(mapping, dict) or not mapping:
        errors.append(f"{where}: map is required (which column each field feeds)")
        return None
    known = set(KNOWN_COLUMNS[f"{target}.csv"])
    for col, spec in mapping.items():
        if col not in known:
            errors.append(f"{where}: map column {col!r} is not a column of {target}.csv{_suggest(col, known)}")
        try:
            validate_spec(col, spec)
        except MapError as e:
            errors.append(f"{where}: {e}")
    supplied = set(mapping) | ({"sources", "connected"} if target == "accounts" else set())
    missing = [c for c in REQUIRED[target] if c not in supplied]
    if missing:
        errors.append(f"{where}: map must supply {', '.join(missing)} for {target}.csv")
    tag = raw.get("tag", "")
    if target == "accounts" and tag not in UNIVERSE_SOURCES:
        errors.append(f"{where}: tag is required for accounts: one of {', '.join(UNIVERSE_SOURCES)}")
    s = Source(
        name=name, type=typ, target=target, tag=tag, argv=list(raw.get("argv", [])), url=raw.get("url", ""), path=raw.get("path", ""),
        format=raw.get("format", "json"), records=raw.get("records", ""), mapping=mapping, auth=dict(raw.get("auth", {})),
        headers=dict(raw.get("headers", {})), pagination=dict(raw.get("pagination", {})), connected_if_listed=bool(raw.get("connected_if_listed", False)),
        env=list(raw.get("env", [])), timeout_seconds=float(raw.get("timeout_seconds", security["timeout_seconds"])), delimiter=raw.get("delimiter", ","),
    )
    if s.format not in ("json", "csv"):
        errors.append(f"{where}: format must be json or csv")
    if typ == "command":
        if not s.argv or not all(isinstance(a, str) for a in s.argv):
            errors.append(f"{where}: argv must be a list of strings (no shell is used)")
    elif typ == "http":
        _check_http(s, where, security, errors)
    elif typ == "file" and not s.path:
        errors.append(f"{where}: path is required for a file source")
    return s if len(errors) == n0 else None


def _check_http(s: Source, where: str, security: dict[str, Any], errors: list[str]) -> None:
    from urllib.parse import urlparse
    if not s.url:
        errors.append(f"{where}: url is required for an http source")
        return
    u = urlparse(s.url)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        errors.append(f"{where}: url must be https (plain http is allowed only for localhost)")
    if u.hostname not in security["allow_hosts"]:
        errors.append(f"{where}: host {u.hostname!r} is not in [security] allow_hosts")
    if s.auth:
        extra = set(s.auth) - {"header", "env", "prefix"}
        if extra or "env" not in s.auth:
            errors.append(f"{where}: auth is {{ header = ..., env = NAME_OF_VARIABLE, prefix = ... }}; the token itself never goes in the file")
    for k in s.headers:
        if k.lower() in ("authorization", "x-api-key", "api-key", "cookie") or "token" in k.lower():
            errors.append(f"{where}: put secret header {k!r} under auth (an environment variable), not in headers")
    p = s.pagination
    if p:
        kind = p.get("type")
        need = {"link_header": (), "cursor": ("cursor_path", "cursor_param"), "page": ("page_param",), "offset": ("offset_param", "limit_param", "limit")}
        if kind not in need:
            errors.append(f"{where}: pagination.type must be one of {', '.join(need)}")
        else:
            for k in need[kind]:
                if k not in p:
                    errors.append(f"{where}: pagination {kind} needs {k}")


def load_config(path: str | Path) -> Config:
    path = Path(path)
    errors: list[str] = []
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError([f"{path}: not found"]) from None
    except tomllib.TOMLDecodeError as e:
        raise ConfigError([f"{path}: invalid TOML: {e}"]) from e
    for k in raw:
        if k not in TOP_KEYS:
            errors.append(f"unknown section {k!r}{_suggest(k, TOP_KEYS)}")
    cust = raw.get("customer", {})
    if not isinstance(cust.get("name"), str) or not cust.get("name", "").strip():
        errors.append("[customer] name is required")
    if "as_of" in cust:
        errors.append("[customer] as_of is set by each run (today, or --as-of); remove it from the file")
    sec = raw.get("security", {})
    security: dict[str, Any] = {
        "allow_hosts": [str(h) for h in sec.get("allow_hosts", [])],
        "max_bytes": int(sec.get("max_bytes", 20_000_000)),
        "timeout_seconds": float(sec.get("timeout_seconds", 30)),
        "retries": int(sec.get("retries", 2)),
    }
    sources: list[Source] = []
    raw_sources = raw.get("source", [])
    if not isinstance(raw_sources, list) or not raw_sources:
        errors.append("at least one [[source]] is required")
        raw_sources = []
    for i, r in enumerate(raw_sources):
        s = _source(r, i, security, errors)
        if s:
            sources.append(s)
    names = [s.name for s in sources]
    for dup in {n for n in names if names.count(n) > 1}:
        errors.append(f"source name {dup!r} is used more than once")
    if sources and not any(s.target == "accounts" for s in sources):
        errors.append("no source feeds accounts; the list of units to cover is the one thing a score cannot do without")
    if errors:
        raise ConfigError(errors)
    out_cfg = raw.get("outputs", {})
    if not isinstance(out_cfg, dict):
        errors.append("[outputs] must be a table")
    else:
        for k in out_cfg:
            if k not in ("make", "hours_per_week", "weeks", "realization"):
                errors.append(f"[outputs] unknown key {k!r}{_suggest(k, ('make', 'hours_per_week', 'weeks', 'realization'))}")
        for o in out_cfg.get("make", []):
            if o not in OUTPUTS:
                errors.append(f"[outputs] make: unknown output {o!r}; available: {', '.join(OUTPUTS)}")
    adv = raw.get("advisories", {})
    if adv and (not isinstance(adv, dict) or set(adv) - {"path"} or not isinstance(adv.get("path"), str) or not adv["path"].strip()):
        errors.append("[advisories] path is required: where the JSON advisory feed is (relative to this file); nothing else is allowed in this section")
    notify = raw.get("notify", {})
    if notify and not notify.get("webhook_env"):
        errors.append("[notify] webhook_env is required: the name of the environment variable that holds the webhook URL")
    state = raw.get("state", {})
    for key in state:
        if key not in ("dir", "keep_snapshots", "keep_outputs"):
            errors.append(f"[state] {key}: unknown key{_suggest(key, ('dir', 'keep_snapshots', 'keep_outputs'))}")
    for key in ("keep_snapshots", "keep_outputs"):
        if key in state and (not isinstance(state[key], int) or isinstance(state[key], bool) or state[key] < 1):
            errors.append(f"[state] {key}: expected a whole number of at least 1")
    if errors:
        raise ConfigError(errors)
    return Config(
        base_dir=path.resolve().parent, customer=dict(cust), settings=dict(raw.get("settings", {})),
        state_dir=(path.resolve().parent / state.get("dir", "state")), allow_hosts=security["allow_hosts"], max_bytes=security["max_bytes"],
        timeout_seconds=security["timeout_seconds"], retries=security["retries"], sources=sources, notify=dict(raw.get("notify", {})),
        export=dict(raw.get("export", {})), outputs=list(raw.get("outputs", {}).get("make", list(OUTPUTS))),
        output_options={k: v for k, v in raw.get("outputs", {}).items() if k != "make"},
        advisories_path=(path.resolve().parent / adv["path"]) if adv else None, keep_snapshots=int(state.get("keep_snapshots", 180)), keep_outputs=int(state.get("keep_outputs", 30)),
    )
