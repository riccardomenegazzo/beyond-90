"""Read an export whose columns are named your way, and turn it into the files the engine reads.

Most exports a TAM can get do not use this tool's column names: "Subscription ID" instead of ``id``, "Crit" instead of
``critical``, ``03/11/2026`` instead of ``2026-11-03``. This module guesses which column means what (the person confirms
or changes it), then writes the canonical CSV with every value normalised. Nothing is guessed silently: a value that
cannot be read is skipped and counted, and an ambiguous date format is reported.

Two files can be built this way: ``accounts.csv`` and ``findings.csv``.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

from .importers import guess_provider, norm_id
from .models import UNIVERSE_SOURCES

MAX_ROWS = 200_000
SAMPLE_ROWS = 5


class MappingError(ValueError):
    """The file cannot be read as a table, or the mapping is not usable."""


@dataclass(frozen=True)
class Target:
    file: str
    fields: tuple[str, ...]
    required: tuple[str, ...]
    synonyms: Mapping[str, tuple[str, ...]]


ACCOUNTS = Target(
    "accounts.csv",
    ("id", "provider", "connected", "owner", "last_spend", "status", "created_at"),
    ("id",),
    {
        "id": ("id", "accountid", "account", "accountnumber", "subscriptionid", "subscription", "projectid", "project", "cloudaccountid", "cloudaccount"),
        "provider": ("provider", "cloudprovider", "cloud", "csp", "vendor"),
        "connected": ("connected", "isconnected", "onboarded", "onboardingstatus", "connectionstatus", "connectorstatus", "monitored", "covered"),
        "owner": ("owner", "accountowner", "businessowner", "ownerteam", "team", "contact"),
        "last_spend": ("lastspend", "spend", "monthlyspend", "monthlycost", "cost", "charges", "billed", "amount"),
        "status": ("status", "accountstatus", "lifecycle", "state"),
        "created_at": ("createdat", "created", "createddate", "creationdate", "joined"),
    },
)
FINDINGS = Target(
    "findings.csv",
    ("id", "account_id", "severity", "exposure", "opened_at", "closed_at", "owner", "decision"),
    ("id", "account_id", "severity", "opened_at"),
    {
        "id": ("id", "findingid", "issueid", "alertid", "key", "ref", "number"),
        "account_id": ("accountid", "account", "subscriptionid", "subscription", "projectid", "project", "cloudaccountid", "cloudaccount"),
        "severity": ("severity", "sev", "risklevel", "risk", "criticality", "priority"),
        "exposure": ("exposure", "exposed", "public", "publiclyexposed", "internetfacing", "internetexposed", "external", "ispublic", "reachability"),
        "opened_at": ("openedat", "opened", "firstseen", "firstdetected", "detectedat", "detected", "discovered", "createdat", "created", "date"),
        "closed_at": ("closedat", "closed", "resolvedat", "resolved", "fixedat", "fixed", "remediatedat", "resolutiondate"),
        "owner": ("owner", "assignee", "assignedto", "responsible", "team"),
        "decision": ("decision", "disposition", "resolution", "triagestatus", "triage"),
    },
)
TARGETS = {t.file: t for t in (ACCOUNTS, FINDINGS)}

_SEVERITY = {
    "critical": "critical", "crit": "critical", "urgent": "critical", "veryhigh": "critical", "sev0": "critical", "p0": "critical",
    "high": "high", "important": "high", "major": "high", "sev1": "high", "p1": "high",
    "medium": "medium", "moderate": "medium", "med": "medium", "sev2": "medium", "p2": "medium",
    "low": "low", "minor": "low", "info": "low", "informational": "low", "sev3": "low", "p3": "low",
}
_PROVIDER = {"aws": "aws", "amazon": "aws", "amazonwebservices": "aws", "azure": "azure", "microsoft": "azure", "microsoftazure": "azure",
             "gcp": "gcp", "google": "gcp", "googlecloud": "gcp", "googlecloudplatform": "gcp"}
_TRUE = {"true", "yes", "y", "1", "connected", "onboarded", "active", "ok", "monitored", "covered", "enabled", "complete", "completed"}
_FALSE = {"false", "no", "n", "0", "", "notconnected", "disconnected", "pending", "failed", "error", "notonboarded", "none", "unmonitored", "blocked"}
_INTERNET = {"internet", "public", "external", "internetfacing", "exposed", "true", "yes", "y", "1", "publiclyexposed", "reachable"}
_DECISION = {"fix": "fix", "remediate": "fix", "tofix": "fix", "accepted": "accepted_risk", "acceptedrisk": "accepted_risk", "riskaccepted": "accepted_risk",
             "exception": "exception", "waiver": "exception", "waived": "exception", "falsepositive": "false_positive", "fp": "false_positive", "notanissue": "false_positive"}
_GONE = {"decommissioned", "closed", "suspended", "disabled", "deleted", "inactive"}
_NUMERIC_DATE = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})")


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def read_table(text: str) -> tuple[list[str], list[dict[str, str]]]:
    """Headers and rows of a delimited file: comma, semicolon or tab, with or without a byte-order mark."""
    text = text.lstrip("﻿")
    first = text.split("\n", 1)[0]
    delimiter = max((",", ";", "\t"), key=first.count)
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    headers = [(h or "").strip() for h in (reader.fieldnames or [])]
    if not headers or not any(headers):
        raise MappingError("The file has no header row: the first line must name the columns.")
    if len(set(headers)) != len(headers):
        raise MappingError("Two columns have the same name; rename one of them in the file first.")
    rows: list[dict[str, str]] = []
    try:
        for row in reader:
            rows.append({(k or "").strip(): (v or "").strip() for k, v in row.items() if k is not None})
            if len(rows) > MAX_ROWS:
                raise MappingError(f"More than {MAX_ROWS:,} rows: split the file first.")
    except csv.Error as e:
        raise MappingError(f"Malformed CSV near line {reader.line_num}: {e}") from e
    return headers, rows


def _guess(target: Target, headers: list[str]) -> dict[str, Optional[str]]:
    by_key = {_key(h): h for h in headers}
    used: set[str] = set()
    out: dict[str, Optional[str]] = {}
    for field in target.fields:
        out[field] = None
        for syn in target.synonyms[field]:
            h = by_key.get(syn)
            if h is not None and h not in used:
                out[field] = h
                used.add(h)
                break
    return out


def detect(headers: list[str], hint: str = "") -> str:
    """Which file this export most resembles; the file name breaks a tie, and an empty answer means unclear."""
    scored = {name: sum(1 for v in _guess(t, headers).values() if v) for name, t in TARGETS.items()}
    best = max(scored.values())
    if best < 2:
        return ""
    top = [n for n, s in scored.items() if s == best]
    if len(top) == 1:
        return top[0]
    h = hint.lower()
    return "findings.csv" if "finding" in h else "accounts.csv" if "account" in h else ""


def suggest(text: str, target: str = "", hint: str = "") -> dict[str, Any]:
    """Everything the confirmation screen needs: the columns, the guessed mapping and a few rows to look at."""
    headers, rows = read_table(text)
    name = target or detect(headers, hint)
    out: dict[str, Any] = {"headers": headers, "rows": len(rows), "sample": rows[:SAMPLE_ROWS], "target": name}
    if name:
        if name not in TARGETS:
            raise MappingError(f"Cannot build {name}; choose one of {', '.join(TARGETS)}.")
        t = TARGETS[name]
        out.update(fields=list(t.fields), required=list(t.required), mapping=_guess(t, headers))
    return out


# ------------------------------------------------------------------ values

class _Dates:
    """Reads dates in one column: ISO first, then day/month/year; a column where the order cannot be known says so."""

    def __init__(self, values: list[str]) -> None:
        self.day_first = True
        self.ambiguous = False
        pairs = [m.groups() for v in values if (m := _NUMERIC_DATE.match(v))]
        if pairs:
            if any(int(a) > 12 for a, _, _ in pairs):
                self.day_first = True
            elif any(int(b) > 12 for _, b, _ in pairs):
                self.day_first = False
            else:
                self.ambiguous = True

    def read(self, raw: str) -> Optional[date]:
        raw = raw.strip()
        if not raw:
            return None
        if re.match(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}", raw):
            y, m, d = (int(x) for x in re.split(r"[-/.T ]", raw[:10].replace("T", " "))[:3])
        elif m2 := _NUMERIC_DATE.match(raw):
            a, b, y = (int(x) for x in m2.groups())
            d, m = (a, b) if self.day_first else (b, a)
        elif raw.isdigit() and len(raw) >= 9:
            from .importers import _day
            return _day(raw)
        else:
            return None
        try:
            return date(y, m, d)
        except ValueError:
            return None


def _provider(raw: str, account_id: str, default: str) -> str:
    return _PROVIDER.get(_key(raw)) or (raw.strip().lower() if raw.strip() else "") or default or guess_provider(account_id)


@dataclass
class Converted:
    file: str
    csv: str
    rows: int
    skipped: int
    notes: list[str]


def convert(text: str, target: str, mapping: Mapping[str, Optional[str]], defaults: Optional[Mapping[str, str]] = None) -> Converted:
    """The canonical file from the export and the confirmed mapping. ``defaults`` can carry ``provider`` and ``sources``."""
    if target not in TARGETS:
        raise MappingError(f"Cannot build {target}; choose one of {', '.join(TARGETS)}.")
    t = TARGETS[target]
    headers, rows = read_table(text)
    for name, column in mapping.items():
        if name not in t.fields:
            raise MappingError(f"{name!r} is not a field of {target}.")
        if column and column not in headers:
            raise MappingError(f"Column {column!r} is not in the file; it has: {', '.join(headers)}.")
    chosen = [c for c in mapping.values() if c]
    if len(set(chosen)) != len(chosen):
        raise MappingError("The same column is used for two fields.")
    defaults = defaults or {}
    missing = [f for f in t.required if not mapping.get(f) and not (f == "provider" and defaults.get("provider"))]
    if missing:
        raise MappingError(f"Choose a column for: {', '.join(missing)}.")
    notes: list[str] = []

    def col(field: str) -> Optional[str]:
        return mapping.get(field) or None

    if target == "accounts.csv" and not col("connected"):
        notes.append("No column says which accounts are connected, so every account was counted as not connected.")
    dates = {f: _Dates([r.get(col(f) or "", "") for r in rows]) for f in ("opened_at", "closed_at", "created_at") if col(f)}
    for f, d in dates.items():
        if d.ambiguous:
            notes.append(f"Dates in {col(f)!r} could be day/month or month/day; they were read as day/month/year. Check the sample.")
    skipped: dict[str, int] = {}
    adjusted: dict[str, int] = {}

    def skip(why: str) -> None:
        skipped[why] = skipped.get(why, 0) + 1

    def adjust(why: str) -> None:
        adjusted[why] = adjusted.get(why, 0) + 1

    out_rows: list[list[str]] = []
    seen: set[str] = set()
    for r in rows:
        if not any(r.values()):
            continue
        if target == "accounts.csv":
            raw_id = r.get(col("id") or "", "")
            if not raw_id:
                skip("no account id")
                continue
            prov = _provider(r.get(col("provider") or "", ""), raw_id, defaults.get("provider", ""))
            if not prov:
                skip("provider unknown (choose a provider column or a default)")
                continue
            aid = norm_id(prov, raw_id)
            if aid in seen:
                skip("account listed twice (kept the first)")
                continue
            seen.add(aid)
            conn = _key(r.get(col("connected") or "", ""))
            if conn not in _TRUE | _FALSE:
                skip(f"connected value not understood: {r.get(col('connected') or '', '')[:20]!r}")
                continue
            status = "decommissioned" if _key(r.get(col("status") or "", "")) in _GONE else "active"
            created = dates["created_at"].read(r.get(col("created_at") or "", "")) if "created_at" in dates else None
            spend = r.get(col("last_spend") or "", "").replace(",", "")
            if spend:
                try:
                    float(spend)
                except ValueError:
                    spend = ""
                    adjust("spend was not a number and was left empty")
            src = defaults.get("sources") or "manual"
            if src not in UNIVERSE_SOURCES:
                raise MappingError(f"sources must be one of {', '.join(UNIVERSE_SOURCES)}.")
            out_rows.append([aid, prov, src, "true" if conn in _TRUE else "false", r.get(col("owner") or "", ""), spend, status, "", created.isoformat() if created else ""])
        else:
            fid, acc = r.get(col("id") or "", ""), r.get(col("account_id") or "", "")
            sev = _SEVERITY.get(_key(r.get(col("severity") or "", "")))
            opened = dates["opened_at"].read(r.get(col("opened_at") or "", ""))
            if not fid or not acc:
                skip("no finding id or account id")
                continue
            if sev is None:
                skip(f"severity not understood: {r.get(col('severity') or '', '')[:20]!r}")
                continue
            if opened is None:
                skip("opened date missing or not a date")
                continue
            closed = dates["closed_at"].read(r.get(col("closed_at") or "", "")) if "closed_at" in dates else None
            exp_raw = r.get(col("exposure") or "", "") if col("exposure") else ""
            exposure = "internet" if _key(exp_raw) in _INTERNET else "internal"
            dec_raw = r.get(col("decision") or "", "") if col("decision") else ""
            decision = _DECISION.get(_key(dec_raw), "")
            if dec_raw and not decision:
                adjust(f"decision not understood and left empty (for example {dec_raw[:20]!r})")
            out_rows.append([fid, acc, sev, exposure, opened.isoformat(), closed.isoformat() if closed else "", r.get(col("owner") or "", ""), decision])
    header = ["id", "provider", "sources", "connected", "owner", "last_spend", "status", "in_plan", "created_at"] if target == "accounts.csv" else \
        ["id", "account_id", "severity", "exposure", "opened_at", "closed_at", "owner", "decision"]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(out_rows)
    total = sum(skipped.values())
    notes += [f"{n} row(s) skipped: {why}." for why, n in sorted(skipped.items(), key=lambda kv: -kv[1])]
    notes += [f"{n} row(s): {why}." for why, n in sorted(adjusted.items(), key=lambda kv: -kv[1])]
    return Converted(target, buf.getvalue(), len(out_rows), total, notes)
