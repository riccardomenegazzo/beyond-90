"""Read a customer data directory and validate it.

Layout (see docs/data-format.md)::

    customer.toml        required
    accounts.csv         required
    inventory.csv        optional
    activations.csv      optional
    findings.csv         optional
    teams.csv            optional
    entitlements.csv     optional

Validation collects every problem it can find (with file and line) instead of
stopping at the first one, so a TAM can fix a whole export in one pass.
"""

from __future__ import annotations

import csv
import tomllib
from datetime import date
from pathlib import Path
from typing import Callable, Optional

from .catalogue import Catalogue, parse_version
from .models import (
    ACCOUNT_STATUSES,
    DECISIONS,
    EXPOSURES,
    SEVERITIES,
    Account,
    Activation,
    CustomerData,
    Entitlement,
    Finding,
    InventoryRow,
    Settings,
    Team,
)


class DataError(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


_TRUE = {"true", "yes", "y", "1"}
_FALSE = {"false", "no", "n", "0", ""}


class _Ctx:
    """Collects errors for one file while rows are parsed."""

    def __init__(self, filename: str, errors: list[str]) -> None:
        self.filename = filename
        self.errors = errors
        self.line = 0

    def err(self, message: str) -> None:
        self.errors.append(f"{self.filename}:{self.line}: {message}")

    def boolean(self, row: dict, key: str, default: bool = False) -> bool:
        raw = (row.get(key) or "").strip().lower()
        if raw in _TRUE:
            return True
        if raw in _FALSE:
            return default if raw == "" else False
        self.err(f"{key}: expected true/false, got {raw!r}")
        return default

    def date_(self, row: dict, key: str, required: bool = False) -> Optional[date]:
        raw = (row.get(key) or "").strip()
        if not raw:
            if required:
                self.err(f"{key}: required date (YYYY-MM-DD) is empty")
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError:
            self.err(f"{key}: expected YYYY-MM-DD, got {raw!r}")
            return None

    def number(self, row: dict, key: str, default: float = 0.0, minimum: Optional[float] = 0.0) -> float:
        raw = (row.get(key) or "").strip()
        if raw == "":
            return default
        try:
            value = float(raw)
        except ValueError:
            self.err(f"{key}: expected a number, got {raw!r}")
            return default
        if minimum is not None and value < minimum:
            self.err(f"{key}: must be >= {minimum:g}, got {value:g}")
            return default
        return value

    def choice(self, row: dict, key: str, allowed: tuple[str, ...], required: bool = True) -> str:
        raw = (row.get(key) or "").strip().lower()
        if not raw:
            if required:
                self.err(f"{key}: required, one of {', '.join(allowed)}")
            return ""
        if raw not in allowed:
            self.err(f"{key}: {raw!r} is not one of {', '.join(allowed)}")
            return ""
        return raw

    def text(self, row: dict, key: str, required: bool = False) -> str:
        raw = (row.get(key) or "").strip()
        if required and not raw:
            self.err(f"{key}: required")
        return raw


def _read_csv(
    path: Path,
    required_columns: tuple[str, ...],
    errors: list[str],
    parse: Callable[[dict, _Ctx], object],
) -> list:
    if not path.exists():
        return []
    out: list = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        header = [h.strip() for h in (reader.fieldnames or [])]
        missing = [c for c in required_columns if c not in header]
        if missing:
            errors.append(f"{path.name}:1: missing column(s): {', '.join(missing)}")
            return []
        ctx = _Ctx(path.name, errors)
        for row in reader:
            ctx.line = reader.line_num
            clean = {(k or "").strip(): (v or "") for k, v in row.items()}
            if not any(v.strip() for v in clean.values()):
                continue
            item = parse(clean, ctx)
            if item is not None:
                out.append(item)
    return out


def _settings(raw: dict, errors: list[str]) -> Settings:
    s = Settings()
    for key in ("ceiling_version", "baseline_ceiling"):
        if key in raw:
            try:
                parse_version(str(raw[key]))
                setattr(s, key, str(raw[key]))
            except ValueError as exc:
                errors.append(f"customer.toml: settings.{key}: {exc}")
    for key in ("triage_window_days", "new_account_days", "access_review_days", "downgrade_window_days", "mttr_lookback_days"):
        if key in raw:
            value = raw[key]
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                setattr(s, key, value)
            else:
                errors.append(f"customer.toml: settings.{key}: expected a non-negative integer")
    if "entitlement_target" in raw:
        v = raw["entitlement_target"]
        if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v <= 1:
            s.entitlement_target = float(v)
        else:
            errors.append("customer.toml: settings.entitlement_target: expected a number in (0, 1]")
    if "sla_days" in raw:
        sla = dict(s.sla_days)
        for sev, days in raw["sla_days"].items():
            if sev not in SEVERITIES:
                errors.append(f"customer.toml: settings.sla_days.{sev}: unknown severity")
            elif not isinstance(days, int) or isinstance(days, bool) or days <= 0:
                errors.append(f"customer.toml: settings.sla_days.{sev}: expected a positive integer")
            else:
                sla[sev] = days
        s.sla_days = sla
    if parse_version(s.baseline_ceiling) > parse_version(s.ceiling_version):
        errors.append("customer.toml: settings.baseline_ceiling is newer than ceiling_version")
    return s


def load_customer(
    directory: str | Path, catalogue: Optional[Catalogue] = None
) -> tuple[CustomerData, list[str]]:
    """Return ``(data, warnings)`` or raise :class:`DataError` with all errors."""
    base = Path(directory)
    catalogue = catalogue or Catalogue.load()
    errors: list[str] = []
    warnings: list[str] = []

    meta_path = base / "customer.toml"
    if not meta_path.exists():
        raise DataError([f"{meta_path}: not found (run `beyond90 init {base}` to scaffold a data directory)"])
    try:
        meta = tomllib.loads(meta_path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise DataError([f"customer.toml: invalid TOML: {exc}"]) from exc

    cust = meta.get("customer", {})
    name = str(cust.get("name", "")).strip()
    if not name:
        errors.append("customer.toml: customer.name is required")
    as_of = cust.get("as_of")
    if isinstance(as_of, str):
        try:
            as_of = date.fromisoformat(as_of)
        except ValueError:
            errors.append("customer.toml: customer.as_of must be YYYY-MM-DD")
            as_of = None
    if not isinstance(as_of, date):
        errors.append("customer.toml: customer.as_of is required (YYYY-MM-DD)")
        as_of = date.today()
    arr = cust.get("arr", 0)
    if not isinstance(arr, (int, float)) or isinstance(arr, bool) or arr < 0:
        errors.append("customer.toml: customer.arr must be a non-negative number")
        arr = 0
    settings = _settings(meta.get("settings", {}), errors)

    def parse_account(row: dict, c: _Ctx):
        aid = c.text(row, "id", required=True)
        provider = c.text(row, "provider", required=True).lower()
        sources = tuple(s.strip().lower() for s in row.get("sources", "").replace(",", ";").split(";") if s.strip())
        if not sources:
            c.err("sources: at least one of billing;org;sso;manual;plan is required")
        status = c.choice(row, "status", ACCOUNT_STATUSES, required=False) or "active"
        if not aid or not provider:
            return None
        return Account(
            id=aid,
            provider=provider,
            sources=sources,
            connected=c.boolean(row, "connected"),
            owner=c.text(row, "owner"),
            last_spend=c.number(row, "last_spend"),
            status=status,
            in_plan=c.boolean(row, "in_plan"),
            created_at=c.date_(row, "created_at"),
        )

    accounts = _read_csv(base / "accounts.csv", ("id", "provider", "sources", "connected"), errors, parse_account)
    if not (base / "accounts.csv").exists():
        errors.append("accounts.csv: not found (required)")
    seen: dict[str, int] = {}
    for a in accounts:
        seen[a.id] = seen.get(a.id, 0) + 1
    for aid, n in seen.items():
        if n > 1:
            errors.append(f"accounts.csv: account id {aid!r} appears {n} times; list each account once and put all sources in the sources column")
    account_ids = set(seen)

    def parse_inventory(row: dict, c: _Ctx):
        aid = c.text(row, "account_id", required=True)
        rtype = c.text(row, "resource_type", required=True).lower()
        if aid and aid not in account_ids:
            c.err(f"account_id {aid!r} is not in accounts.csv")
            return None
        if rtype and rtype not in catalogue.resource_types:
            warnings.append(f"inventory.csv:{c.line}: resource type {rtype!r} is not in the catalogue and is ignored")
            return None
        if not aid or not rtype:
            return None
        return InventoryRow(aid, rtype, int(c.number(row, "count")), c.boolean(row, "inventoried"))

    inventory = _read_csv(base / "inventory.csv", ("account_id", "resource_type", "count", "inventoried"), errors, parse_inventory)

    module_ids = {m.id for m in catalogue.modules}

    def parse_activation(row: dict, c: _Ctx):
        aid = c.text(row, "account_id", required=True)
        mid = c.text(row, "module_id", required=True).lower()
        if aid and aid not in account_ids:
            c.err(f"account_id {aid!r} is not in accounts.csv")
            return None
        if mid and mid not in module_ids:
            warnings.append(f"activations.csv:{c.line}: module {mid!r} is not in the catalogue and is ignored")
            return None
        if not aid or not mid:
            return None
        return Activation(aid, mid, c.boolean(row, "active"))

    activations = _read_csv(base / "activations.csv", ("account_id", "module_id", "active"), errors, parse_activation)

    def parse_finding(row: dict, c: _Ctx):
        fid = c.text(row, "id", required=True)
        aid = c.text(row, "account_id", required=True)
        if aid and aid not in account_ids:
            c.err(f"account_id {aid!r} is not in accounts.csv")
            return None
        opened = c.date_(row, "opened_at", required=True)
        closed = c.date_(row, "closed_at")
        if opened and closed and closed < opened:
            c.err("closed_at is before opened_at")
        decision = c.choice(row, "decision", DECISIONS, required=False)
        expiry = c.date_(row, "expiry")
        prev = c.choice(row, "previous_severity", SEVERITIES, required=False)
        changed = c.date_(row, "severity_changed_at")
        if prev and not changed:
            c.err("severity_changed_at is required when previous_severity is set")
        severity = c.choice(row, "severity", SEVERITIES)
        exposure = c.choice(row, "exposure", EXPOSURES, required=False) or "internal"
        if not fid or not aid or not opened or not severity:
            return None
        return Finding(
            id=fid, account_id=aid, severity=severity, exposure=exposure, opened_at=opened, closed_at=closed,
            owner=c.text(row, "owner"), decision=decision, decision_reason=c.text(row, "decision_reason"),
            expiry=expiry, previous_severity=prev, severity_changed_at=changed,
        )

    findings = _read_csv(base / "findings.csv", ("id", "account_id", "severity", "opened_at"), errors, parse_finding)

    def parse_team(row: dict, c: _Ctx):
        tid = c.text(row, "id", required=True)
        if not tid:
            return None
        return Team(
            id=tid, name=c.text(row, "name") or tid, has_assets=c.boolean(row, "has_assets", default=True),
            active_users=int(c.number(row, "active_users")), sso=c.boolean(row, "sso"),
            role_scoped=c.boolean(row, "role_scoped"), last_access_review=c.date_(row, "last_access_review"),
        )

    teams = _read_csv(base / "teams.csv", ("id", "has_assets", "active_users", "sso", "role_scoped"), errors, parse_team)

    def parse_entitlement(row: dict, c: _Ctx):
        unit = c.text(row, "unit", required=True).lower()
        if not unit:
            return None
        licensed = c.number(row, "licensed")
        if licensed <= 0:
            c.err("licensed: must be greater than zero")
            return None
        return Entitlement(unit, licensed, c.number(row, "used"))

    entitlements = _read_csv(base / "entitlements.csv", ("unit", "licensed", "used"), errors, parse_entitlement)

    if errors:
        raise DataError(errors)

    if not accounts:
        warnings.append("accounts.csv has no rows: the score has nothing to measure")
    return (
        CustomerData(
            name=name, tier=str(cust.get("tier", "")), arr=float(arr), as_of=as_of, settings=settings,
            accounts=accounts, inventory=inventory, activations=activations, findings=findings,
            teams=teams, entitlements=entitlements,
        ),
        warnings,
    )
