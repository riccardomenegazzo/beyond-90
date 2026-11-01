"""Entry point for the in-browser app (Pyodide) and for anyone who wants every output in one call.

Nothing here reads the network or the clock. The browser app writes the user's files into a
virtual folder, calls `analyze`, and shows what comes back.
"""

from __future__ import annotations

import json
import re
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Optional

from . import __version__
from .attribution import explain
from .book import build_book_plan, render_book_html, render_book_markdown
from .candor import candor_items
from .catalogue import Catalogue
from .forecast import forecast_zero_critical
from .loader import DataError, load_customer
from .planner import build_plan
from .playbooks import generate_actions
from .portfolio import load_portfolio, render_portfolio_markdown
from .provenance import INPUT_FILES, hash_directory, input_hash
from .qbr import render_qbr
from .report import render_html, render_json, render_markdown
from .scoring import compute_score
from .sections import md_plan
from .simulate import RampModel


def analyze(
    directory: str,
    hours: float = 8.0,
    weeks: int = 26,
    realization: float = 0.9,
    ramp_weeks: int = 2,
    quarter: str = "",
    since: str | None = None,
) -> dict[str, Any]:
    """Score one customer directory and return every output as text.

    Returns {"ok": False, "errors": [...]} when the data is invalid, so a caller can show every
    problem at once instead of the first one.
    """
    cat = Catalogue.load()
    try:
        data, warnings = load_customer(directory, cat, require_accounts=True)
        old = load_customer(since, cat)[0] if since else None
    except DataError as e:
        return {"ok": False, "errors": e.errors, "version": __version__}
    score = compute_score(data, cat)
    actions = generate_actions(data, score, cat)
    previous = compute_score(old, cat).to_dict() if old else None
    extras: dict[str, Any] = {}
    if previous:
        extras["attribution"] = explain(score, previous, data, cat)
    if data.findings:
        extras["forecast"] = forecast_zero_critical(data)
    plan = build_plan(data, cat, hours_per_week=hours, horizon_weeks=weeks, realization=realization, ramp=RampModel(ramp_weeks))
    extras["plan"] = plan
    extras["candor"] = candor_items(score, data, cat, plan=plan, forecast=extras.get("forecast"), attribution=extras.get("attribution"))
    summary = score.to_dict()
    return {
        "ok": True,
        "version": __version__,
        "warnings": warnings,
        "provenance": score.provenance,
        "input_hash": score.provenance.get("input_hash", ""),
        "confidence": score.quality.get("confidence", ""),
        "customer": score.customer,
        "as_of": str(score.as_of),
        "yield": score.yield_,
        "reach": (score.reach or {}).get("value") if isinstance(score.reach, dict) else None,
        "actions": len(actions),
        "report_html": render_html(score, actions, None, previous, **extras),
        "report_markdown": render_markdown(score, actions, None, previous, **extras),
        "qbr_markdown": render_qbr(score, actions, previous, quarter, **extras),
        "roadmap_markdown": "\n".join([f"# Roadmap: {plan.customer}", ""] + md_plan(plan, top=12)),
        "score_json": render_json(score, actions, None),
        "summary": {k: summary[k] for k in summary if k in ("customer", "as_of", "yield", "stages")},
    }


def _write(root: Path, files: Mapping[str, str]) -> None:
    for name, text in files.items():
        base = Path(name).name                      # flat on purpose: a data directory has no sub-folders
        if base in INPUT_FILES:                     # anything else is not an input and must not change the fingerprint
            (root / base).write_bytes(text.encode("utf-8"))


def analyze_files(files: Mapping[str, str], since_files: Optional[Mapping[str, str]] = None, **kw: Any) -> dict[str, Any]:
    """Same as `analyze`, from a mapping of file name to text (what a browser has).

    `since_files` is an older snapshot of the same customer; the report then explains what changed.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write(root, files)
        if since_files:
            (root / "since").mkdir()
            _write(root / "since", since_files)
            kw["since"] = str(root / "since")
        result = analyze(str(root), **kw)
    if not result["ok"]:
        # The folder is a throwaway; show file names, and no advice about a command line the user is not using.
        result["errors"] = [re.sub(r"\s*\(run `beyond90 init[^)]*\)", " (see docs/data-format.md for the files it needs)", e.replace(str(root) + "/", "")) for e in result["errors"]]
    return result


def summarize_files(files: Mapping[str, str]) -> dict[str, Any]:
    """The few numbers a history list needs, without rendering anything. Derived data: cheap to rebuild, never stored."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write(root, files)
        try:
            data, _ = load_customer(root, require_accounts=True)
        except DataError as e:
            return {"ok": False, "errors": [m.replace(str(root) + "/", "") for m in e.errors]}
        s = compute_score(data, Catalogue.load())
        return {
            "ok": True, "customer": s.customer, "as_of": s.as_of, "yield": s.yield_, "naive": s.naive,
            "stages": {k: v.value for k, v in s.stages.items()}, "input_hash": s.provenance.get("input_hash", ""),
            "engine": __version__,
        }


def fingerprint_files(files: Mapping[str, str]) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write(root, files)
        return input_hash(hash_directory(root))


def _slug(key: str, taken: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", key).strip("-.") or "customer"
    out, i = base, 2
    while out in taken:
        out, i = f"{base}-{i}", i + 1
    taken.add(out)
    return out


def analyze_book(
    groups: Mapping[str, Mapping[str, str]],
    hours: float = 30.0,
    weeks: int = 26,
    realization: float = 0.9,
    weighting: str = "arr",
    ramp_weeks: int = 2,
    baselines: bool = True,
) -> dict[str, Any]:
    """Several customers at once: the portfolio view and one budget of hours spent where it adds the most weighted Yield.

    `groups` maps a folder name to that customer's files. A group without a customer.toml is ignored; a group
    with invalid data is reported and the others carry on.
    """
    cat = Catalogue.load()
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        names: dict[str, str] = {}
        taken: set[str] = set()
        for key in sorted(groups):
            if "customer.toml" not in {Path(n).name for n in groups[key]}:
                continue
            slug = _slug(key, taken)
            names[slug] = key
            (root / slug).mkdir()
            _write(root / slug, groups[key])
        if not names:
            return {"ok": False, "errors": ["No folder with a customer.toml was found."], "version": __version__}
        pf = load_portfolio(root, cat)
        errors = {names[k]: [m.replace(str(root) + "/", "") for m in v] for k, v in pf.errors.items()}
        customers = []
        keys: dict[str, str] = {}
        for slug in sorted(names):
            if slug in pf.errors:
                continue
            data, _ = load_customer(root / slug, cat, require_accounts=True)
            customers.append((data.name, data))
            keys[data.name] = names[slug]
        if not customers:
            return {"ok": False, "errors": [f"{k}: {v[0]}" for k, v in errors.items()], "version": __version__}
        plan = build_book_plan(customers, cat, hours_per_week=hours, horizon_weeks=weeks, realization=realization, weighting=weighting,
                               ramp=RampModel(ramp_weeks), baselines=baselines)
        by_name = {e.name: e for e in pf.entries}
        return {
            "ok": True,
            "version": __version__,
            "errors": errors,
            "arr_weighted_yield": pf.arr_weighted_yield,
            "weighted_start": plan.weighted_start,
            "weighted_end": plan.weighted_end,
            "customers": [
                {"name": n, "key": keys[n], "arr": by_name[n].arr, "yield": by_name[n].score.yield_, "confidence": by_name[n].score.quality.get("confidence", ""),
                 "planned_yield": next(c.end_yield for c in plan.customers if c.name == n), "hours": next(c.hours for c in plan.customers if c.name == n)}
                for n, _ in customers
            ],
            "patterns": len(pf.patterns(2)),
            "portfolio_markdown": render_portfolio_markdown(pf, top_patterns=10),
            "book_markdown": render_book_markdown(plan),
            "book_html": render_book_html(plan),
        }


def analyze_book_json(groups_json: str, options_json: str = "{}") -> str:
    return json.dumps(analyze_book(json.loads(groups_json), **json.loads(options_json)), ensure_ascii=False)


def analyze_json(files_json: str, options_json: str = "{}") -> str:
    """JSON in, JSON out: the one function the page calls for a full analysis."""
    opts = json.loads(options_json)
    since = opts.pop("since_files", None)
    return json.dumps(analyze_files(json.loads(files_json), since_files=since, **opts), ensure_ascii=False)


def summarize_json(files_json: str) -> str:
    return json.dumps(summarize_files(json.loads(files_json)), ensure_ascii=False)


def fingerprint_json(files_json: str) -> str:
    return fingerprint_files(json.loads(files_json))
