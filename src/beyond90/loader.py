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

import codecs
import csv
import difflib
import io
import math
import re
import tomllib
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any, Optional

from .catalogue import Catalogue, parse_version
from .models import (
    ACCOUNT_STATUSES,
    CONNECTOR_AUTH,
    CONNECTOR_KINDS,
    CONNECTOR_PRIVILEGE,
    CONNECTOR_SCOPES,
    CONNECTOR_STATUSES,
    CONTACT_ROLES,
    DECISIONS,
    DEFAULT_INFLUENCE,
    EXPOSURES,
    INTERACTION_KINDS,
    SEVERITIES,
    UNIVERSE_SOURCES,
    Account,
    Activation,
    Commitment,
    Connector,
    Contact,
    CustomerData,
    Entitlement,
    Finding,
    Interaction,
    InventoryRow,
    Settings,
    Team,
)
from .provenance import SCHEMA_VERSION, hash_directory


class DataError(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


_TRUE = {"true", "yes", "y", "1"}
_FALSE = {"false", "no", "n", "0", ""}


_INVISIBLE = dict.fromkeys([*range(0x202A, 0x202F), *range(0x2066, 0x206A), 0x200E, 0x200F, 0x061C])     # bidirectional controls: they reorder text on screen


def clean_text(raw: str) -> str:
    """Make a free-text value safe to show anywhere: one line, no control or direction-changing characters, and no
    pipe (it would split a Markdown table cell). Everything else is kept as written."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", raw.translate(_INVISIBLE))).strip().replace("|", "\u00a6")


class _Ctx:
    """Collects errors for one file while rows are parsed."""

    def __init__(self, filename: str, errors: list[str]) -> None:
        self.filename = filename
        self.errors = errors
        self.line = 0
        self.adjusted = 0

    def err(self, message: str) -> None:
        self.errors.append(f"{self.filename}:{self.line}: {message}")

    def boolean(self, row: dict[str, Any], key: str, default: bool = False) -> bool:
        raw = (row.get(key) or "").strip().lower()
        if raw in _TRUE:
            return True
        if raw in _FALSE:
            return default if raw == "" else False
        self.err(f"{key}: expected true/false, got {raw!r}")
        return default

    def date_(self, row: dict[str, Any], key: str, required: bool = False) -> Optional[date]:
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

    def number(self, row: dict[str, Any], key: str, default: float = 0.0, minimum: Optional[float] = 0.0) -> float:
        raw = (row.get(key) or "").strip()
        if raw == "":
            return default
        try:
            value = float(raw)
        except ValueError:
            self.err(f"{key}: expected a number, got {raw!r}")
            return default
        if not math.isfinite(value):
            self.err(f"{key}: expected a finite number, got {raw!r}")
            return default
        if minimum is not None and value < minimum:
            self.err(f"{key}: must be >= {minimum:g}, got {value:g}")
            return default
        return value

    def choice(self, row: dict[str, Any], key: str, allowed: tuple[str, ...], required: bool = True) -> str:
        raw = (row.get(key) or "").strip().lower()
        if not raw:
            if required:
                self.err(f"{key}: required, one of {', '.join(allowed)}")
            return ""
        if raw not in allowed:
            self.err(f"{key}: {raw!r} is not one of {', '.join(allowed)}")
            return ""
        return raw

    def text(self, row: dict[str, Any], key: str, required: bool = False) -> str:
        raw = (row.get(key) or "").strip()
        cleaned = clean_text(raw)
        if cleaned != raw:
            self.adjusted += 1
        raw = cleaned
        if required and not raw:
            self.err(f"{key}: required")
        return raw


class _BadFile(Exception):
    pass


def _decode(path: Path) -> tuple[str, str]:
    """Read a text file whatever program wrote it. Returns (text, note); the note is empty for UTF-8.

    Spreadsheet programs write UTF-16 or Windows-1252 as readily as UTF-8. UTF-16 and UTF-8 with a byte-order mark are
    read as they are. A file that is not valid UTF-8 is tried as Windows-1252 and said so, because reading it silently
    would turn accents into the wrong letters without anyone noticing. Anything else, or a file with NUL bytes, is not
    a text file and is refused with a message.
    """
    raw = path.read_bytes()
    note = ""
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        try:
            text = raw.decode("utf-16")
        except UnicodeDecodeError:
            raise _BadFile(f"{path.name}: looks like UTF-16 but is not valid; save it as CSV UTF-8") from None
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = raw.decode("cp1252")
                note = f"{path.name}: not valid UTF-8; read as Windows-1252. Save it as UTF-8 so accents cannot be misread."
            except UnicodeDecodeError:
                raise _BadFile(f"{path.name}: not text in a known encoding (UTF-8, UTF-16 or Windows-1252)") from None
    if "\x00" in text:
        raise _BadFile(f"{path.name}: contains NUL characters, so it is not a CSV or TOML text file")
    return text, note


def _read_csv(
    path: Path,
    required_columns: tuple[str, ...],
    errors: list[str],
    parse: Callable[[dict[str, Any], _Ctx], object],
    notes: Optional[list[str]] = None,
) -> list[Any]:
    if not path.exists():
        return []
    out: list[Any] = []
    try:
        text, note = _decode(path)
    except _BadFile as e:
        errors.append(str(e))
        return []
    if note and notes is not None:
        notes.append(note)
    reader = csv.DictReader(io.StringIO(text, newline=""))
    ctx = _Ctx(path.name, errors)
    try:
        header = [h.strip() for h in (reader.fieldnames or [])]
        missing = [c for c in required_columns if c not in header]
        if missing:
            errors.append(f"{path.name}:1: missing column(s): {', '.join(missing)}")
            return []
        for row in reader:
            ctx.line = reader.line_num
            clean = {(k or "").strip(): (v if isinstance(v, str) else "") for k, v in row.items()}
            if not any(v.strip() for v in clean.values()):
                continue
            item = parse(clean, ctx)
            if item is not None:
                out.append(item)
    except csv.Error as e:
        errors.append(f"{path.name}:{reader.line_num}: malformed CSV: {e}")
        return []
    if notes is not None and ctx.adjusted:
        notes.append(f"{path.name}: {ctx.adjusted} value(s) had line breaks, control characters or '|' replaced, so that tables stay readable.")
    return out


KNOWN_COLUMNS: dict[str, tuple[str, ...]] = {
    "accounts.csv": ("id", "provider", "sources", "connected", "owner", "last_spend", "status", "in_plan", "created_at"),
    "inventory.csv": ("account_id", "resource_type", "count", "inventoried"),
    "activations.csv": ("account_id", "module_id", "active"),
    "findings.csv": ("id", "account_id", "severity", "exposure", "opened_at", "closed_at", "owner", "decision", "decision_reason",
                     "expiry", "previous_severity", "severity_changed_at"),
    "teams.csv": ("id", "name", "has_assets", "active_users", "sso", "role_scoped", "last_access_review"),
    "entitlements.csv": ("unit", "licensed", "used"),
    "contacts.csv": ("id", "name", "role", "team", "influence", "last_contact", "credibility", "reliability", "intimacy", "self_orientation"),
    "commitments.csv": ("id", "contact_id", "description", "promised_on", "due_on", "done_on"),
    "interactions.csv": ("date", "kind", "contact_id", "summary", "next_step", "next_due"),
    "connectors.csv": ("account_id", "kind", "status", "name", "error", "deployed_at", "first_scan_at", "last_success_at", "scope",
                       "regions_expected", "regions_scanned", "permissions_missing", "auth", "secret_expires_on", "privilege"),
}
KNOWN_CUSTOMER_KEYS = ("name", "tier", "arr", "as_of", "schema_version", "profile", "renewal_date")
KNOWN_SETTINGS_KEYS = ("ceiling_version", "baseline_ceiling", "triage_window_days", "new_account_days", "access_review_days",
                       "downgrade_window_days", "mttr_lookback_days", "contact_stale_days", "commitment_lookback_days",
                       "renewal_window_days", "cadence_days", "connector_stale_days", "onboarding_stall_days", "entitlement_target", "sla_days")


def _suggest(name: str, known: tuple[str, ...]) -> str:
    near = difflib.get_close_matches(name, known, n=1, cutoff=0.75)
    return f" (did you mean {near[0]!r}?)" if near else ""


def _unknown_keys(raw: dict[str, Any], known: tuple[str, ...], where: str, warnings: list[str]) -> None:
    """A newer file read by an older engine, or a typo: either way the key does nothing, so say so."""
    for key in raw:
        if key not in known:
            warnings.append(f"{where}: unknown key {key!r} is ignored{_suggest(key, known)}")


def _unknown_columns(path: Path, warnings: list[str]) -> None:
    known = KNOWN_COLUMNS.get(path.name)
    if known is None or not path.exists():
        return
    try:
        header = [h.strip() for h in (next(csv.reader(io.StringIO(_decode(path)[0], newline="")), []) or [])]
    except (_BadFile, csv.Error):
        return                                           # the read of this file reports the problem
    extra = [h for h in header if h and h not in known]
    if extra:
        hints = "; ".join(f"{h!r}{_suggest(h, known)}" for h in extra)
        warnings.append(f"{path.name}: unknown column(s) ignored: {hints}")


def _settings(raw: dict[str, Any], errors: list[str]) -> Settings:
    s = Settings()
    for key in ("ceiling_version", "baseline_ceiling"):
        if key in raw:
            try:
                parse_version(str(raw[key]))
                setattr(s, key, str(raw[key]))
            except ValueError as exc:
                errors.append(f"customer.toml: settings.{key}: {exc}")
    for key in ("triage_window_days", "new_account_days", "access_review_days", "downgrade_window_days", "mttr_lookback_days",
                "contact_stale_days", "commitment_lookback_days", "renewal_window_days", "cadence_days", "connector_stale_days", "onboarding_stall_days"):
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
    if "sla_days" in raw and not isinstance(raw["sla_days"], dict):
        errors.append("customer.toml: settings.sla_days: expected a table such as { critical = 7, high = 30 }")
    elif "sla_days" in raw:
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
    directory: str | Path, catalogue: Optional[Catalogue] = None, *, require_accounts: bool = False
) -> tuple[CustomerData, list[str]]:
    """Return ``(data, warnings)`` or raise :class:`DataError` with all errors.

    With ``require_accounts`` an estate with no active account is an error: an empty list would score 100% on
    every stage ("nothing is missing"), which is the opposite of what it means. ``validate`` and ``init`` do not
    ask for it, because an empty scaffold is a legitimate thing to check.
    """
    base = Path(directory)
    catalogue = catalogue or Catalogue.for_directory(base)
    errors: list[str] = []
    warnings: list[str] = []

    meta_path = base / "customer.toml"
    if not meta_path.exists():
        raise DataError([f"{meta_path}: not found (run `beyond90 init {base}` to scaffold a data directory)"])
    try:
        meta = tomllib.loads(_decode(meta_path)[0])
    except tomllib.TOMLDecodeError as exc:
        raise DataError([f"customer.toml: invalid TOML: {exc}"]) from exc
    except _BadFile as exc:
        raise DataError([str(exc)]) from exc

    for table in ("customer", "settings"):
        if table in meta and not isinstance(meta[table], dict):
            raise DataError([f"customer.toml: [{table}] must be a table, not a single value"])
    cust = meta.get("customer", {})
    schema_version = cust.get("schema_version", SCHEMA_VERSION)
    if not isinstance(schema_version, int) or isinstance(schema_version, bool) or schema_version < 1:
        raise DataError(["customer.toml: customer.schema_version must be a positive integer"])
    if schema_version > SCHEMA_VERSION:
        raise DataError([(f"customer.toml: written for data format {schema_version}, this engine reads format {SCHEMA_VERSION}. "
                         "Upgrade beyond90, or lower schema_version only if you know the files still follow the older format.")])
    _unknown_keys(cust, KNOWN_CUSTOMER_KEYS, "customer.toml [customer]", warnings)
    wanted = cust.get("profile")
    if wanted is not None and catalogue.profile not in (str(wanted), "custom"):
        raise DataError([(f"customer.toml: profile {str(wanted)!r}, but the catalogue in use is {catalogue.profile!r}. "
                         f"Run with --profile {wanted} (or remove the profile line).")])
    _unknown_keys(meta.get("settings", {}), KNOWN_SETTINGS_KEYS, "customer.toml [settings]", warnings)
    name = clean_text(str(cust.get("name", "")))
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
    renewal = cust.get("renewal_date")
    if isinstance(renewal, str):
        try:
            renewal = date.fromisoformat(renewal)
        except ValueError:
            errors.append("customer.toml: customer.renewal_date must be YYYY-MM-DD")
            renewal = None
    if renewal is not None and not isinstance(renewal, date):
        errors.append("customer.toml: customer.renewal_date must be YYYY-MM-DD")
        renewal = None
    arr = cust.get("arr", 0)
    if not isinstance(arr, (int, float)) or isinstance(arr, bool) or arr < 0:
        errors.append("customer.toml: customer.arr must be a non-negative number")
        arr = 0
    settings = _settings(meta.get("settings", {}), errors)

    def parse_account(row: dict[str, Any], c: _Ctx) -> Optional[Account]:
        aid = c.text(row, "id", required=True)
        provider = c.text(row, "provider", required=True).lower()
        sources = tuple(s.strip().lower() for s in row.get("sources", "").replace(",", ";").split(";") if s.strip())
        if not sources:
            c.err(f"sources: at least one of {';'.join(UNIVERSE_SOURCES)} is required")
        elif unknown := [s for s in sources if s not in UNIVERSE_SOURCES]:
            c.err(f"sources: {', '.join(unknown)} is not one of {';'.join(UNIVERSE_SOURCES)}")
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

    accounts = _read_csv(base / "accounts.csv", ("id", "provider", "sources", "connected"), errors, parse_account, warnings)
    if not (base / "accounts.csv").exists():
        errors.append("accounts.csv: not found (required)")
    seen: dict[str, int] = {}
    for a in accounts:
        seen[a.id] = seen.get(a.id, 0) + 1
    for aid, n in seen.items():
        if n > 1:
            errors.append(f"accounts.csv: account id {aid!r} appears {n} times; list each account once and put all sources in the sources column")
    account_ids = set(seen)

    def parse_inventory(row: dict[str, Any], c: _Ctx) -> Optional[InventoryRow]:
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

    inventory = _read_csv(base / "inventory.csv", ("account_id", "resource_type", "count", "inventoried"), errors, parse_inventory, warnings)

    module_ids = {m.id for m in catalogue.modules}

    def parse_activation(row: dict[str, Any], c: _Ctx) -> Optional[Activation]:
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

    activations = _read_csv(base / "activations.csv", ("account_id", "module_id", "active"), errors, parse_activation, warnings)

    def parse_finding(row: dict[str, Any], c: _Ctx) -> Optional[Finding]:
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

    findings = _read_csv(base / "findings.csv", ("id", "account_id", "severity", "opened_at"), errors, parse_finding, warnings)

    def parse_team(row: dict[str, Any], c: _Ctx) -> Optional[Team]:
        tid = c.text(row, "id", required=True)
        if not tid:
            return None
        return Team(
            id=tid, name=c.text(row, "name") or tid, has_assets=c.boolean(row, "has_assets", default=True),
            active_users=int(c.number(row, "active_users")), sso=c.boolean(row, "sso"),
            role_scoped=c.boolean(row, "role_scoped"), last_access_review=c.date_(row, "last_access_review"),
        )

    teams = _read_csv(base / "teams.csv", ("id", "has_assets", "active_users", "sso", "role_scoped"), errors, parse_team, warnings)

    def parse_entitlement(row: dict[str, Any], c: _Ctx) -> Optional[Entitlement]:
        unit = c.text(row, "unit", required=True).lower()
        if not unit:
            return None
        licensed = c.number(row, "licensed")
        if licensed <= 0:
            c.err("licensed: must be greater than zero")
            return None
        return Entitlement(unit, licensed, c.number(row, "used"))

    entitlements = _read_csv(base / "entitlements.csv", ("unit", "licensed", "used"), errors, parse_entitlement, warnings)

    def rating(c: _Ctx, row: dict[str, Any], key: str) -> Optional[float]:
        raw = (row.get(key) or "").strip()
        if not raw:
            return None
        v = c.number(row, key, default=0.0, minimum=1.0)
        if v > 10:
            c.err(f"{key}: ratings go from 1 to 10, got {v:g}")
            return None
        return v if v >= 1 else None

    def parse_contact(row: dict[str, Any], c: _Ctx) -> Optional[Contact]:
        cid = c.text(row, "id", required=True)
        role = c.choice(row, "role", CONTACT_ROLES)
        if not cid or not role:
            return None
        infl_raw = (row.get("influence") or "").strip()
        influence = DEFAULT_INFLUENCE[role]
        if infl_raw:
            if infl_raw in ("1", "2", "3"):
                influence = int(infl_raw)
            else:
                c.err(f"influence: expected 1, 2 or 3, got {infl_raw!r}")
        return Contact(
            id=cid, name=c.text(row, "name") or cid, role=role, team=c.text(row, "team"), influence=influence,
            last_contact=c.date_(row, "last_contact"), credibility=rating(c, row, "credibility"),
            reliability=rating(c, row, "reliability"), intimacy=rating(c, row, "intimacy"),
            self_orientation=rating(c, row, "self_orientation"),
        )

    contacts = _read_csv(base / "contacts.csv", ("id", "role"), errors, parse_contact, warnings)
    contact_ids = {x.id for x in contacts}

    def parse_commitment(row: dict[str, Any], c: _Ctx) -> Optional[Commitment]:
        cid = c.text(row, "id", required=True)
        due = c.date_(row, "due_on", required=True)
        who = c.text(row, "contact_id")
        if who and who not in contact_ids:
            c.err(f"contact_id {who!r} is not in contacts.csv")
            return None
        if not cid or not due:
            return None
        promised, done = c.date_(row, "promised_on"), c.date_(row, "done_on")
        if promised and promised > due:
            c.err("promised_on is after due_on")
        return Commitment(id=cid, description=c.text(row, "description") or cid, due_on=due, contact_id=who, promised_on=promised, done_on=done)

    commitments = _read_csv(base / "commitments.csv", ("id", "due_on"), errors, parse_commitment, warnings)

    def parse_interaction(row: dict[str, Any], c: _Ctx) -> Optional[Interaction]:
        when = c.date_(row, "date", required=True)
        kind = c.choice(row, "kind", INTERACTION_KINDS)
        who = c.text(row, "contact_id")
        if who and who not in contact_ids:
            c.err(f"contact_id {who!r} is not in contacts.csv")
            return None
        if not when or not kind:
            return None
        if when > as_of:
            c.err(f"date {when} is after as_of {as_of}: a log of what happened cannot be in the future (put plans in next_due)")
            return None
        return Interaction(date=when, kind=kind, summary=c.text(row, "summary"), contact_id=who, next_step=c.text(row, "next_step"), next_due=c.date_(row, "next_due"))

    interactions = _read_csv(base / "interactions.csv", ("date", "kind"), errors, parse_interaction, warnings)
    interactions.sort(key=lambda i: (i.date, i.kind, i.summary))

    def parse_connector(row: dict[str, Any], c: _Ctx) -> Optional[Connector]:
        aid = c.text(row, "account_id", required=True)
        kind = c.choice(row, "kind", CONNECTOR_KINDS)
        status = c.choice(row, "status", CONNECTOR_STATUSES)
        if aid and aid not in account_ids:
            c.err(f"account_id {aid!r} is not in accounts.csv")
            return None
        if not aid or not kind or not status:
            return None
        dates = {k: c.date_(row, k) for k in ("deployed_at", "first_scan_at", "last_success_at", "secret_expires_on")}
        for k in ("deployed_at", "first_scan_at", "last_success_at"):
            when = dates[k]
            if when is not None and when > as_of:
                c.err(f"{k} {when} is after as_of {as_of}")
                return None
        dep, first = dates["deployed_at"], dates["first_scan_at"]
        if dep is not None and first is not None and first < dep:
            c.err("first_scan_at is before deployed_at")
        expected = int(c.number(row, "regions_expected"))
        scanned = int(c.number(row, "regions_scanned"))
        if expected and scanned > expected:
            c.err("regions_scanned is larger than regions_expected")
        missing = tuple(sorted({p.strip() for p in (row.get("permissions_missing") or "").split(";") if p.strip()}))
        return Connector(
            account_id=aid, kind=kind, status=status, name=c.text(row, "name"), error=c.text(row, "error")[:2000],
            deployed_at=dates["deployed_at"], first_scan_at=dates["first_scan_at"], last_success_at=dates["last_success_at"],
            scope=c.choice(row, "scope", CONNECTOR_SCOPES, required=False), regions_expected=expected, regions_scanned=scanned,
            permissions_missing=missing, auth=c.choice(row, "auth", CONNECTOR_AUTH, required=False), secret_expires_on=dates["secret_expires_on"],
            privilege=c.choice(row, "privilege", CONNECTOR_PRIVILEGE, required=False),
        )

    connectors = _read_csv(base / "connectors.csv", ("account_id", "kind", "status"), errors, parse_connector, warnings)

    if errors:
        raise DataError(errors)

    for fname in KNOWN_COLUMNS:
        _unknown_columns(base / fname, warnings)

    if require_accounts and not any(a.status == "active" for a in accounts):
        raise DataError(["accounts.csv: no active accounts, so there is nothing to measure. List the accounts you know about (see docs/data-format.md)."])

    if not accounts:
        warnings.append("accounts.csv has no rows: the score has nothing to measure")
    return (
        CustomerData(
            name=name, tier=clean_text(str(cust.get("tier", ""))), arr=float(arr), as_of=as_of, settings=settings,
            accounts=accounts, inventory=inventory, activations=activations, findings=findings,
            teams=teams, entitlements=entitlements, contacts=contacts, commitments=commitments, interactions=interactions, connectors=connectors,
            inputs=hash_directory(base), schema_version=schema_version, renewal_date=renewal,
        ),
        warnings,
    )
