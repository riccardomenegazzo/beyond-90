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

from . import __version__, dashboard, onboarding, outlook, rhythm, stake
from .attribution import explain
from .book import build_book_plan, render_book_html, render_book_markdown
from .candor import candor_items
from .catalogue import Catalogue
from .drift import input_drift
from .forecast import forecast_zero_critical
from .ladder import path_to_next_level
from .loader import DataError, load_customer
from .planner import build_plan
from .playbooks import generate_actions
from .portfolio import load_portfolio, render_portfolio_markdown
from .provenance import INPUT_FILES, hash_directory, input_hash
from .qbr import render_qbr
from .radar import parse_threats
from .renewal import compute_renewal
from .report import render_html, render_json, render_markdown
from .scoring import compute_score
from .sections import md_plan
from .simulate import RampModel
from .successplan import render_success_plan


def analyze(
    directory: str,
    hours: float = 8.0,
    weeks: int = 26,
    realization: float = 0.9,
    ramp_weeks: int = 2,
    quarter: str = "",
    since: str | None = None,
    advisories: Any = None,
) -> dict[str, Any]:
    """Score one customer directory and return every output as text.

    Returns {"ok": False, "errors": [...]} when the data is invalid, so a caller can show every
    problem at once instead of the first one.
    """
    try:
        cat = Catalogue.for_directory(directory)
        data, warnings = load_customer(directory, cat, require_accounts=True)
        old = load_customer(since, cat)[0] if since else None
        skipped: list[str] = []
        threats = parse_threats(advisories, cat, "the advisories", skipped) if advisories else []
        if skipped:
            warnings = [*warnings, f"{len(skipped)} advisory(ies) do not apply to the {cat.profile} catalogue and were skipped: {', '.join(skipped[:5])}."]
    except DataError as e:
        return {"ok": False, "errors": e.errors, "version": __version__}
    except ValueError as e:
        return {"ok": False, "errors": [str(e)], "version": __version__}
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
    extras["renewal"] = compute_renewal(data, score, previous)
    extras["ladder"] = path_to_next_level(score, plan)
    if old is not None:
        extras["drift"] = input_drift(data, old, cat.terms)
    extras["candor"] = candor_items(score, data, cat, plan=plan, forecast=extras.get("forecast"), attribution=extras.get("attribution"))
    exposures = rhythm.customer_exposures(data, threats, cat)
    expansion = rhythm.expansion_signals(data, score, actions, exposures)
    onb = onboarding.diagnose(data)
    look = outlook.outlook(data, cat)
    weighted = stake.weighted(data, score, cat)
    if old is not None:
        onb["delta"] = onboarding.delta(onboarding.diagnose(old), onb, old.as_of, data.as_of)
    status = onboarding.customer_status(onb, score.customer, str(score.as_of), cat.terms["units"], onb.get("delta"), coming=[e for e in look["events"] if e["who"] == "customer"])
    prep = rhythm.build_prep(data, score, actions, {**extras, "onboarding": onb, "outlook": look, "stake": weighted}, exposures, expansion)
    rh = {"touch": prep["touch"], "prep": prep, "prep_markdown": rhythm.render_prep_markdown(prep), "exposures": exposures, "expansion": expansion}
    summary = score.to_dict()
    return {
        "ok": True,
        "version": __version__,
        "warnings": warnings,
        "provenance": score.provenance,
        "input_hash": score.provenance.get("input_hash", ""),
        "confidence": score.quality.get("confidence", ""),
        "level": score.rubric.get("level", ""),
        "level_provisional": bool(score.rubric.get("provisional")),
        "profile": cat.profile,
        "customer": score.customer,
        "as_of": str(score.as_of),
        "yield": score.yield_,
        "reach": (score.reach or {}).get("value") if isinstance(score.reach, dict) else None,
        "actions": len(actions),
        "prep_markdown": rh["prep_markdown"],
        "onboarding_markdown": onboarding.render_markdown(onb, score.customer, cat.terms["units"]),
        "onboarding_status_markdown": status["markdown"],
        "onboarding_status_html": status["html"],
        "outlook_ics": outlook.ics(look["events"], score.customer),
        "dashboard": dashboard.build(data, score, cat, plan, {**extras, "rhythm": rh, "onboarding": onb, "outlook": look, "stake": weighted}, actions),
        "report_html": render_html(score, actions, None, previous, **extras),
        "report_markdown": render_markdown(score, actions, None, previous, **extras),
        "qbr_markdown": render_qbr(score, actions, previous, quarter, **extras),
        "success_plan_markdown": render_success_plan(score, actions, plan),
        "roadmap_markdown": "\n".join([f"# Roadmap: {plan.customer}", ""] + md_plan(plan, top=12)),
        "score_json": render_json(score, actions, None),
        "summary": {k: summary[k] for k in summary if k in ("customer", "as_of", "yield", "stages")},
    }


def plan_files(files: Mapping[str, str], hours: float = 8.0, weeks: int = 26, realization: float = 0.9, ramp_weeks: int = 2) -> dict[str, Any]:
    """Only the plan, for the what-if sliders: same model as the report, none of the rendering."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write(root, files)
        try:
            cat = Catalogue.for_directory(root)
            data, _ = load_customer(root, cat, require_accounts=True)
        except (DataError, ValueError) as e:
            return {"ok": False, "errors": e.errors if isinstance(e, DataError) else [str(e)]}
        plan = build_plan(data, cat, hours_per_week=hours, horizon_weeks=weeks, realization=realization, ramp=RampModel(ramp_weeks))
        return {"ok": True, "plan": dashboard.plan_data(plan)}


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
            cat = Catalogue.for_directory(root)
            data, _ = load_customer(root, cat, require_accounts=True)
        except DataError as e:
            return {"ok": False, "errors": [m.replace(str(root) + "/", "") for m in e.errors]}
        except ValueError as e:
            return {"ok": False, "errors": [str(e)]}
        s = compute_score(data, cat)
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
    week_hours: float = 30.0,
    advisories: Any = None,
) -> dict[str, Any]:
    """Several customers at once: the portfolio view and one budget of hours spent where it adds the most weighted Yield.

    `groups` maps a folder name to that customer's files. A group without a customer.toml is ignored; a group
    with invalid data is reported and the others carry on.
    """
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
        try:
            cat = Catalogue.for_root(root)
        except ValueError as e:                                  # customers of different profiles do not belong in one portfolio
            return {"ok": False, "errors": [str(e).replace(str(root), "the folder")], "version": __version__}
        try:
            threats = parse_threats(advisories, cat, "the advisories", []) if advisories else []
        except ValueError as e:
            return {"ok": False, "errors": [str(e)], "version": __version__}
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
        week_rows, preps, onb_summary = [], {}, {}
        for n, d in customers:
            ent = by_name[n]
            expo = rhythm.customer_exposures(d, threats, cat)
            exp = rhythm.expansion_signals(d, ent.score, ent.actions, expo)
            ren = compute_renewal(d, ent.score, None)
            onb = onboarding.diagnose(d)
            onb_summary[keys[n]] = {"name": n, "complete": next(f["reached"] for f in onb["funnel"] if f["stage"] == "complete"), "total": len([a for a in d.accounts if a.status == "active"]),
                                    "healthy_l1": onb["healthy_l1"], "listed_l1": onb["listed_l1"], "stalled": len(onb["stalled"]), "causes": onb["causes"], "secrets": len(onb["secrets"]),
                                    "security": len(onb["security"]), "top_wave": onb["waves"][0] if onb["waves"] else None}
            look = outlook.outlook(d, cat)
            onb_summary[keys[n]]["loss_points_90d"] = look["loss_points"]
            onb_summary[keys[n]]["first_drop"] = look["first_drop"]
            prep = rhythm.build_prep(d, ent.score, ent.actions, {"renewal": ren, "onboarding": onb, "outlook": look, "stake": stake.weighted(d, ent.score, cat)}, expo, exp)
            preps[keys[n]] = {"markdown": rhythm.render_prep_markdown(prep), "prep": prep, "exposures": expo, "expansion": exp}
            week_rows.append({"key": keys[n], "name": n, "data": d, "score": ent.score, "renewal": ren, "exposures": expo, "expansion": exp, "onboarding": onb, "outlook": look})
        week = rhythm.week_plan(week_rows, week_hours)
        as_of = max(d.as_of for _, d in customers).isoformat()
        return {
            "ok": True,
            "version": __version__,
            "errors": errors,
            "week": week,
            "week_markdown": rhythm.render_week_markdown(week, as_of),
            "preps": preps,
            "onboarding": {"customers": onb_summary, "shared": _shared_causes(onb_summary)},
            "advisories": len(threats),
            "arr_weighted_yield": pf.arr_weighted_yield,
            "weighted_start": plan.weighted_start,
            "weighted_end": plan.weighted_end,
            "profile": cat.profile,
            "customers": [
                {"name": n, "key": keys[n], "arr": by_name[n].arr, "yield": by_name[n].score.yield_, "confidence": by_name[n].score.quality.get("confidence", ""),
                 "stages": {k: by_name[n].score.stages[k].value for k in ("L1", "L2", "L3", "L4")}, "level": by_name[n].score.rubric.get("level", ""),
                 "critical_open": by_name[n].score.outcomes.get("critical_open", 0), "naive": by_name[n].score.naive,
                 "planned_yield": next(c.end_yield for c in plan.customers if c.name == n), "hours": next(c.hours for c in plan.customers if c.name == n)}
                for n, _ in customers
            ],
            "patterns": len(pf.patterns(2)),
            "portfolio_markdown": render_portfolio_markdown(pf, top_patterns=10),
            "book_markdown": render_book_markdown(plan),
            "book_html": render_book_html(plan),
        }


def _shared_causes(summary: dict[str, Any]) -> list[dict[str, Any]]:
    """Causes found at two customers or more: one write-up, one fix pattern, used many times."""
    seen: dict[str, dict[str, Any]] = {}
    for s in summary.values():
        for c in s["causes"]:
            e = seen.setdefault(c["issue"], {"issue": c["issue"], "title": c["title"], "customers": [], "accounts": 0})
            e["customers"].append(s["name"])
            e["accounts"] += c["count"]
    return sorted((e for e in seen.values() if len(e["customers"]) >= 2), key=lambda e: (-len(e["customers"]), -e["accounts"], e["issue"]))


def analyze_book_json(groups_json: str, options_json: str = "{}") -> str:
    return json.dumps(analyze_book(json.loads(groups_json), **json.loads(options_json)), ensure_ascii=False)


def analyze_json(files_json: str, options_json: str = "{}") -> str:
    """JSON in, JSON out: the one function the page calls for a full analysis."""
    opts = json.loads(options_json)
    since = opts.pop("since_files", None)
    return json.dumps(analyze_files(json.loads(files_json), since_files=since, **opts), ensure_ascii=False)


def triage_json(text: str, options_json: str = "{}") -> str:
    o = json.loads(options_json)
    return json.dumps(onboarding.triage(text, str(o.get("provider", "")), str(o.get("kind", ""))), ensure_ascii=False)


def preflight_json(options_json: str) -> str:
    return json.dumps(onboarding.preflight(json.loads(options_json)), ensure_ascii=False)


def plan_json(files_json: str, options_json: str = "{}") -> str:
    return json.dumps(plan_files(json.loads(files_json), **json.loads(options_json)), ensure_ascii=False)


def summarize_json(files_json: str) -> str:
    return json.dumps(summarize_files(json.loads(files_json)), ensure_ascii=False)


def fingerprint_json(files_json: str) -> str:
    return fingerprint_files(json.loads(files_json))
