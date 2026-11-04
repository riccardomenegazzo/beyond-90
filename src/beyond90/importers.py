"""Build accounts.csv from the lists you already have, and reconcile them.

The score is only as honest as its universe, and the universe is the union of
several independent lists: what the cloud organization says exists, what
billing says you pay for, what SSO says people can sign in to, and what the
platform says is connected. Each importer reads the native export of one of
those (no credentials, no API calls) and merges it into ``accounts.csv`` by
account id, adding its source. Importing the same file twice changes nothing.

Native formats understood:

* ``aws-org``   ``aws organizations list-accounts --output json``
* ``azure``     ``az account list --output json``
* ``gcp``       ``gcloud projects list --format=json``
* ``csv``       any CSV with an id column (billing exports, SSO assignments, the
                platform's connected-account list), column names given as options
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Optional

from .models import INDEPENDENT_SOURCES, UNIVERSE_SOURCES, Account

HEADER = ["id", "provider", "sources", "connected", "owner", "last_spend", "status", "in_plan", "created_at"]
SOURCES = UNIVERSE_SOURCES


class ImportFormatError(ValueError):
    """The file is not in the format the importer expects."""


@dataclass
class Record:
    id: str
    provider: str
    source: str
    status: str = "active"
    owner: str = ""
    spend: Optional[float] = None
    created_at: Optional[date] = None
    connected: Optional[bool] = None


@dataclass
class MergeResult:
    accounts: list[Account]
    added: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    unchanged: int = 0
    conflicts: list[str] = field(default_factory=list)
    newly_unconnected: list[str] = field(default_factory=list)


# ------------------------------------------------------------------- parsing

def _day(value: Any) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=UTC).date()
    text = str(value).strip()
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        try:
            return datetime.fromtimestamp(float(text), tz=UTC).date()
        except ValueError:
            return None


def _load_json(text: str, what: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ImportFormatError(f"{what}: not valid JSON ({exc.msg} at line {exc.lineno})") from exc


def norm_id(provider: str, raw: str) -> str:
    raw = str(raw).strip()
    if provider == "aws" and raw.isdigit() and len(raw) < 12:
        return raw.zfill(12)
    if provider == "azure":
        return raw.lower().removeprefix("/subscriptions/")
    return raw


def parse_aws_org(text: str) -> list[Record]:
    data = _load_json(text, "aws-org")
    rows = data.get("Accounts") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ImportFormatError("aws-org: expected the output of `aws organizations list-accounts` (an object with an Accounts list)")
    out = []
    for r in rows:
        if "Id" not in r:
            raise ImportFormatError("aws-org: an account has no Id")
        out.append(Record(norm_id("aws", r["Id"]), "aws", "org",
                          "active" if str(r.get("Status", "ACTIVE")).upper() == "ACTIVE" else "decommissioned",
                          created_at=_day(r.get("JoinedTimestamp"))))
    return out


def parse_azure(text: str) -> list[Record]:
    data = _load_json(text, "azure")
    if not isinstance(data, list):
        raise ImportFormatError("azure: expected the output of `az account list` (a JSON list)")
    out = []
    for r in data:
        sid = r.get("id") or r.get("subscriptionId")
        if not sid:
            raise ImportFormatError("azure: a subscription has no id")
        state = str(r.get("state", "Enabled")).lower()
        out.append(Record(norm_id("azure", sid), "azure", "org", "decommissioned" if state in ("disabled", "deleted") else "active"))
    return out


def parse_gcp(text: str) -> list[Record]:
    data = _load_json(text, "gcp")
    if not isinstance(data, list):
        raise ImportFormatError("gcp: expected the output of `gcloud projects list --format=json` (a JSON list)")
    out = []
    for r in data:
        pid = r.get("projectId")
        if not pid:
            raise ImportFormatError("gcp: a project has no projectId")
        labels = r.get("labels") or {}
        out.append(Record(pid, "gcp", "org", "active" if str(r.get("lifecycleState", "ACTIVE")).upper() == "ACTIVE" else "decommissioned",
                          owner=labels.get("owner") or labels.get("team") or "", created_at=_day(r.get("createTime"))))
    return out


def parse_csv(
    text: str,
    *,
    source: str,
    id_column: str,
    provider: Optional[str] = None,
    provider_column: Optional[str] = None,
    owner_column: Optional[str] = None,
    spend_column: Optional[str] = None,
    status_column: Optional[str] = None,
    infer_provider: bool = False,
) -> list[Record]:
    if source not in SOURCES:
        raise ImportFormatError(f"csv: source must be one of {', '.join(SOURCES)}")
    if not provider and not provider_column and not infer_provider:
        raise ImportFormatError("csv: give --provider (aws, azure, gcp, ...) or --provider-column")
    reader = csv.DictReader(io.StringIO(text))
    header = reader.fieldnames or []
    for col in (id_column, provider_column, owner_column, spend_column, status_column):
        if col and col not in header:
            raise ImportFormatError(f"csv: column {col!r} not found; the file has: {', '.join(header)}")
    merged: dict[str, Record] = {}
    for n, row in enumerate(reader, start=2):
        prov = (row[provider_column] if provider_column else provider or "").strip().lower()
        raw = (row.get(id_column) or "").strip()
        if not raw:
            continue
        aid = norm_id(prov, raw) if prov else raw
        spend = None
        if spend_column and (row.get(spend_column) or "").strip():
            try:
                spend = float(row[spend_column].replace(",", ""))
            except ValueError as exc:
                raise ImportFormatError(f"csv:{n}: {spend_column} is not a number: {row[spend_column]!r}") from exc
        status = "active"
        if status_column and (row.get(status_column) or "").strip().lower() in ("decommissioned", "closed", "suspended", "disabled", "deleted", "inactive"):
            status = "decommissioned"
        rec = Record(aid, prov, source, status, (row.get(owner_column) or "").strip() if owner_column else "", spend)
        if aid in merged:                                  # several rows per account (cost lines): sum the spend
            prev = merged[aid]
            prev.spend = (prev.spend or 0.0) + (spend or 0.0) if spend is not None or prev.spend is not None else None
        else:
            merged[aid] = rec
    return list(merged.values())


def guess_provider(raw: str) -> str:
    """Account ids are distinctive enough to tell the provider when nothing else does."""
    raw = raw.strip()
    if raw.isdigit() and len(raw) <= 12:
        return "aws"
    if re.fullmatch(r"[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}", raw):
        return "azure"
    return ""


def resolve_providers(records: list[Record], existing: list[Account]) -> list[Record]:
    """Fill in the provider of records that have none: from accounts.csv first, then from the id's shape."""
    known = {a.id: a.provider for a in existing}
    known_lower = {a.id.lower(): a.provider for a in existing}
    unresolved = []
    for r in records:
        if r.provider:
            continue
        prov = known.get(r.id) or known_lower.get(r.id.lower()) or guess_provider(r.id)
        if not prov:
            unresolved.append(r.id)
            continue
        r.provider = prov
        r.id = norm_id(prov, r.id)
    if unresolved:
        raise ImportFormatError(f"cannot tell the provider of {len(unresolved)} account(s) ({', '.join(unresolved[:5])}); import them with --provider")
    return records


# ------------------------------------------------------------------- merging

def read_accounts(path: Path) -> list[Account]:
    if not path.exists():
        return []
    out = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if not (r.get("id") or "").strip():
                continue
            out.append(Account(
                id=r["id"].strip(), provider=(r.get("provider") or "").strip().lower(),
                sources=tuple(s.strip().lower() for s in (r.get("sources") or "").replace(",", ";").split(";") if s.strip()),
                connected=(r.get("connected") or "").strip().lower() in ("true", "yes", "1"),
                owner=(r.get("owner") or "").strip(), last_spend=float(r.get("last_spend") or 0),
                status=(r.get("status") or "active").strip().lower() or "active",
                in_plan=(r.get("in_plan") or "").strip().lower() in ("true", "yes", "1"),
                created_at=_day(r.get("created_at")),
            ))
    return out


def write_accounts(path: Path, accounts: list[Account]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(HEADER)
        for a in sorted(accounts, key=lambda a: (a.provider, a.id)):
            w.writerow([a.id, a.provider, ";".join(a.sources), str(a.connected).lower(), a.owner,
                        f"{a.last_spend:g}" if a.last_spend else "", a.status, str(a.in_plan).lower(),
                        a.created_at.isoformat() if a.created_at else ""])


def merge(existing: list[Account], records: list[Record], *, authoritative_connected: bool = False) -> MergeResult:
    """Union by account id. Never loses a source; reports disagreements instead of guessing."""
    by_id = {a.id: a for a in existing}
    res = MergeResult(accounts=[])
    seen = set()
    for rec in records:
        seen.add(rec.id)
        cur = by_id.get(rec.id)
        if cur is None:
            by_id[rec.id] = Account(
                id=rec.id, provider=rec.provider, sources=(rec.source,), connected=bool(rec.connected), owner=rec.owner,
                last_spend=rec.spend or 0.0, status=rec.status, created_at=rec.created_at,
            )
            res.added.append(rec.id)
            continue
        new = cur
        if rec.source not in cur.sources:
            new = replace(new, sources=(*cur.sources, rec.source))
        if cur.provider and rec.provider and cur.provider != rec.provider:
            res.conflicts.append(f"{rec.id}: provider is {cur.provider!r} in accounts.csv but {rec.provider!r} in the {rec.source} list")
        elif not cur.provider:
            new = replace(new, provider=rec.provider)
        if rec.owner and not new.owner:
            new = replace(new, owner=rec.owner)
        if rec.spend is not None and rec.spend != new.last_spend:
            new = replace(new, last_spend=rec.spend)
        if rec.created_at and not new.created_at:
            new = replace(new, created_at=rec.created_at)
        if rec.status != new.status:
            res.conflicts.append(f"{rec.id}: status is {new.status!r} in accounts.csv but {rec.status!r} in the {rec.source} list (kept {new.status!r}; fix by hand)")
        if rec.connected is not None and rec.connected != new.connected:
            new = replace(new, connected=rec.connected)
        if new != cur:
            by_id[rec.id] = new
            res.updated.append(rec.id)
        else:
            res.unchanged += 1
    if authoritative_connected:
        for aid, a in list(by_id.items()):
            if aid not in seen and a.connected:
                by_id[aid] = replace(a, connected=False)
                res.newly_unconnected.append(aid)
    res.accounts = list(by_id.values())
    return res


# ------------------------------------------------------------ reconciliation

def reconcile(accounts: list[Account]) -> dict[str, Any]:
    """How the independent lists overlap, and which accounts each one is missing."""
    active = [a for a in accounts if a.status == "active"]
    present = [s for s in INDEPENDENT_SOURCES if any(s in a.sources for a in active)]
    combos: dict[str, int] = {}
    missing: dict[str, list[str]] = {s: [] for s in present}
    for a in active:
        key = "+".join(s for s in present if s in a.sources) or "none of " + "/".join(present)
        combos[key] = combos.get(key, 0) + 1
        for s in present:
            if s not in a.sources:
                missing[s].append(a.id)
    notes = []
    billed_not_org = [a.id for a in active if "billing" in a.sources and "org" in present and "org" not in a.sources and a.last_spend > 0]
    if billed_not_org:
        notes.append(f"{len(billed_not_org)} account(s) are billed but not in the organization hierarchy: the most likely shadow accounts.")
    org_not_billed = [a.id for a in active if "org" in a.sources and "billing" in present and "billing" not in a.sources]
    if org_not_billed:
        notes.append(f"{len(org_not_billed)} account(s) are in the organization but have no billing line: dormant, free-tier or missing from the export.")
    unconnected_billed = sorted((a for a in active if not a.connected and a.last_spend > 0), key=lambda a: -a.last_spend)
    return {
        "sources": present,
        "overlap": dict(sorted(combos.items(), key=lambda kv: (-kv[1], kv[0]))),
        "missing_from": {s: sorted(ids) for s, ids in missing.items()},
        "billed_not_in_org": sorted(billed_not_org),
        "unconnected_by_spend": [(a.id, a.last_spend) for a in unconnected_billed[:10]],
        "notes": notes,
        "accounts": len(active),
    }


def render_reconcile(r: dict[str, Any]) -> str:
    L = [f"{r['accounts']} active accounts; independent sources present: {', '.join(r['sources']) or 'none'}", "", "Seen in:"]
    L += [f"  {k:<28} {n}" for k, n in r["overlap"].items()]
    L.append("")
    for s, ids in r["missing_from"].items():
        if ids:
            L.append(f"Missing from {s}: {len(ids)}" + (f" ({', '.join(ids[:6])}{', ...' if len(ids) > 6 else ''})" if ids else ""))
    L += [f"Note: {n}" for n in r["notes"]]
    if r["unconnected_by_spend"]:
        L.append("\nLargest unconnected accounts by spend: " + ", ".join(f"{i} ({s:,.0f})" for i, s in r["unconnected_by_spend"][:5]))
    return "\n".join(L) + "\n"
