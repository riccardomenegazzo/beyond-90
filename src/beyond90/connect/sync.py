"""Collect every source, merge, and write the data directory.

The data directory is the system of record the engine reads; sync rebuilds it from the sources. Rules:

* **A failing source never empties the data.** If a source cannot be reached, the last good rows are used and the
  source is reported as stale with its age. Only a source with no good copy at all is missing, and a customer with
  no list of accounts at all is an error, because nothing can be scored without it.
* **A mapping that reads nothing is a failure, not an empty file.** If a required column comes out empty for every
  record, the path is wrong; the source is treated as failed.
* **Hand-kept data survives.** Rows in ``state/manual/<target>.csv`` are merged last (for accounts the source tag
  "manual" is added), and a target no source feeds is copied from there whole (contacts and commitments are usually
  kept by hand).
* **The write is atomic.** The new directory is built beside the old one and swapped in, so a crash never leaves a
  half-written customer.
"""

from __future__ import annotations

import csv
import json
import os
import shutil
import time
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Optional

from ..loader import KNOWN_COLUMNS
from .config import KEYS_OF, REQUIRED, TARGETS, Config
from .fetch import FetchError, fetch_source
from .mapping import MapError, map_records


class SyncError(Exception):
    pass


@dataclass
class SourceResult:
    name: str
    target: str
    status: str                    # ok, stale, failed
    rows: int = 0
    fetched_at: str = ""
    age_days: int = 0
    error: str = ""
    empty_columns: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class SyncReport:
    as_of: date
    results: list[SourceResult]
    data_dir: Path
    counts: dict[str, int]
    dropped: dict[str, int] = field(default_factory=dict)

    @property
    def problems(self) -> list[SourceResult]:
        return [r for r in self.results if r.status != "ok"]


def _truthy(v: str) -> bool:
    return v.strip().lower() in ("true", "yes", "y", "1")


def _key(target: str, row: dict[str, str]) -> tuple[str, ...]:
    cols = KEYS_OF.get(target, ("id",))
    return tuple(row.get(c, "") for c in cols)


def _merge(target: str, batches: list[tuple[list[dict[str, str]], dict[str, Any]]]) -> list[dict[str, str]]:
    """batches: (rows, extras) in source order. extras: tag, connected_if_listed."""
    out: dict[tuple[str, ...], dict[str, str]] = {}
    tags: dict[tuple[str, ...], set[str]] = {}
    conn: dict[tuple[str, ...], bool] = {}
    for rows, extra in batches:
        for r in rows:
            k = _key(target, r)
            if not all(k):
                continue
            cur = out.setdefault(k, {})
            for col, v in r.items():
                if v == "":
                    continue
                if extra.get("override") or col not in cur or cur[col] == "" or target != "accounts":
                    cur[col] = v                       # hand-kept rows win; so do later sources, except for accounts, where the first value stays
            if target == "accounts":
                if extra.get("tag"):
                    tags.setdefault(k, set()).add(extra["tag"])
                if extra.get("connected_if_listed") or _truthy(r.get("connected", "")):
                    conn[k] = True
    if target == "accounts":
        for k, row in out.items():
            row["sources"] = ";".join(sorted(tags.get(k, set())))
            row["connected"] = "true" if conn.get(k) else "false"
    return [out[k] for k in sorted(out)]


def _write_csv(path: Path, target: str, rows: list[dict[str, str]]) -> None:
    known = list(KNOWN_COLUMNS[f"{target}.csv"])
    present = {c for r in rows for c in r}
    cols = [c for c in known if c in present or c in REQUIRED[target]]
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def _toml_value(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    if isinstance(v, (int, float)):
        return repr(v)
    return json.dumps(str(v), ensure_ascii=False)


def customer_toml(cfg: Config, as_of: date) -> str:
    c = dict(cfg.customer)
    lines = ["[customer]"]
    for k in ("name", "tier", "arr", "profile", "renewal_date", "schema_version"):
        if k in c:
            lines.append(f"{k} = {_toml_value(c[k])}")
    lines.append(f"as_of = {as_of.isoformat()}")
    flat = {k: v for k, v in cfg.settings.items() if not isinstance(v, dict)}
    nested = {k: v for k, v in cfg.settings.items() if isinstance(v, dict)}
    if flat or nested:
        lines += ["", "[settings]"] + [f"{k} = {_toml_value(v)}" for k, v in flat.items()]
        for k, d in nested.items():
            lines += ["", f"[settings.{k}]"] + [f"{kk} = {_toml_value(vv)}" for kk, vv in d.items()]
    return "\n".join(lines) + "\n"


def _read_manual(dir_: Path, target: str) -> list[dict[str, str]]:
    p = dir_ / f"{target}.csv"
    if not p.exists():
        return []
    with p.open(newline="", encoding="utf-8-sig") as fh:
        return [{k.strip(): (v or "").strip() for k, v in r.items() if k} for r in csv.DictReader(fh)]


def sync(cfg: Config, as_of: date, *, now: Optional[datetime] = None, env: Optional[Mapping[str, str]] = None,
         sleep: Callable[[float], None] = time.sleep, opener: Optional[urllib.request.OpenerDirector] = None, write: bool = True) -> SyncReport:
    now = now or datetime.now(UTC)
    state = cfg.state_dir
    cache_dir = state / "cache"
    manual_dir = state / "manual"
    if write:
        cache_dir.mkdir(parents=True, exist_ok=True)
    results: list[SourceResult] = []
    by_target: dict[str, list[tuple[list[dict[str, str]], dict[str, Any]]]] = {t: [] for t in TARGETS}
    for s in cfg.sources:
        cache_file = cache_dir / f"{s.name}.json"
        rows: Optional[list[dict[str, str]]] = None
        res = SourceResult(s.name, s.target, "ok")
        try:
            recs = fetch_source(s, cfg, env=env, sleep=sleep, opener=opener)
            mapped, empty = map_records(recs, s.mapping)
            res.empty_columns = {c: n for c, n in empty.items() if mapped and n == len(mapped)}
            dead = [c for c in REQUIRED[s.target] if c in res.empty_columns]
            if dead:
                raise MapError(f"required column(s) {', '.join(dead)} came out empty for all {len(mapped)} records: check the path in map")
            rows, res.rows, res.fetched_at = mapped, len(mapped), now.isoformat(timespec="seconds")
            if write:
                cache_file.write_text(json.dumps({"fetched_at": res.fetched_at, "rows": mapped}), encoding="utf-8")
        except (FetchError, MapError) as e:
            res.error = str(e)
            if cache_file.exists():
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
                rows, res.rows, res.fetched_at, res.status = cached["rows"], len(cached["rows"]), cached["fetched_at"], "stale"
                res.age_days = max(0, (now - datetime.fromisoformat(cached["fetched_at"])).days)
            else:
                res.status = "failed"
        results.append(res)
        if rows is not None:
            by_target[s.target].append((rows, {"tag": s.tag, "connected_if_listed": s.connected_if_listed}))

    merged: dict[str, list[dict[str, str]]] = {}
    for t in TARGETS:
        manual = _read_manual(manual_dir, t)
        if not by_target[t] and not manual:
            continue
        batches = list(by_target[t])
        if manual:
            batches.append((manual, {"tag": "manual" if t == "accounts" else "", "override": True}))
        merged[t] = _merge(t, batches)
    if not merged.get("accounts"):
        why = "; ".join(f"{r.name}: {r.error}" for r in results if r.error) or "no source produced any account"
        raise SyncError(f"there is no list of accounts to score ({why})")

    known_ids = {r["id"] for r in merged["accounts"]}
    dropped: dict[str, int] = {}
    for t in ("inventory", "activations", "findings"):
        if t in merged:
            keep = [r for r in merged[t] if r.get("account_id", "") in known_ids]
            if len(keep) != len(merged[t]):
                dropped[t] = len(merged[t]) - len(keep)
            merged[t] = keep

    data_dir = state / "data"
    if write:
        tmp = state / "data.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        (tmp / "customer.toml").write_text(customer_toml(cfg, as_of), encoding="utf-8")
        for t, rows in merged.items():
            _write_csv(tmp / f"{t}.csv", t, rows)
        old = state / "data.old"
        shutil.rmtree(old, ignore_errors=True)
        if data_dir.exists():
            os.replace(data_dir, old)
        os.replace(tmp, data_dir)
        shutil.rmtree(old, ignore_errors=True)
    return SyncReport(as_of, results, data_dir, {t: len(r) for t, r in merged.items()}, dropped)
