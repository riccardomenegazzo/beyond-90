"""Entry point for the in-browser app (Pyodide) and for anyone who wants every output in one call.

Nothing here reads the network or the clock. The browser app writes the user's files into a
virtual folder, calls `analyze`, and shows what comes back.
"""

from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any

from . import __version__
from .attribution import explain
from .candor import candor_items
from .catalogue import Catalogue
from .forecast import forecast_zero_critical
from .loader import DataError, load_customer
from .planner import build_plan
from .playbooks import generate_actions
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
        data, warnings = load_customer(directory, cat)
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


def analyze_files(files: dict[str, str], **kw: Any) -> dict[str, Any]:
    """Same as `analyze`, from a mapping of file name to text (what a browser has)."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, text in files.items():
            p = (root / Path(name).name)           # flat on purpose: a data directory has no sub-folders
            p.write_text(text, encoding="utf-8")
        result = analyze(str(root), **kw)
    if not result["ok"]:
        # The folder is a throwaway; show file names, and no advice about a command line the user is not using.
        result["errors"] = [re.sub(r"\s*\(run `beyond90 init[^)]*\)", " (see docs/data-format.md for the files it needs)", e.replace(str(root) + "/", "")) for e in result["errors"]]
    return result


def analyze_json(files_json: str, options_json: str = "{}") -> str:
    """JSON in, JSON out: the one function the page calls."""
    files = json.loads(files_json)
    opts = json.loads(options_json)
    return json.dumps(analyze_files(files, **opts), ensure_ascii=False)
