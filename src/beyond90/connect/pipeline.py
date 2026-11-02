"""One command from sources to a finished review.

``run`` does, in order: collect the sources, build the data directory, validate and score it, compare it with
the previous run's snapshot (so the change is explained without anyone choosing a file), write the report, the
QBR draft, the success plan, the summary and the JSON, keep a history, save the snapshot, export a workspace file
the browser app can import, decide what deserves an alert and, if configured, send it.

Everything it writes is under the state directory, which holds customer data: keep it private.
"""

from __future__ import annotations

import json
import shutil
import time
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Optional

from ..alerts import compute_alerts, render_message
from ..catalogue import Catalogue
from ..drift import input_drift
from ..loader import DataError, load_customer
from ..provenance import file_hash, input_hash
from ..renewal import compute_renewal
from ..rubric import metrics as rubric_metrics
from ..scoring import compute_score
from ..store import Store
from ..web import analyze
from .config import Config
from .fetch import FetchError, check_url
from .sync import SyncReport, sync

PERSONAL = ("contacts.csv", "commitments.csv")
OUTPUT_FILES = {"report": ("report_html", "report.html"), "qbr": ("qbr_markdown", "qbr.md"), "successplan": ("success_plan_markdown", "success-plan.md"),
                "summary": ("report_markdown", "summary.md"), "roadmap": ("roadmap_markdown", "roadmap.md"), "json": ("score_json", "score.json")}


class PipelineError(Exception):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


@dataclass
class RunResult:
    as_of: date
    sync: SyncReport
    yield_: float
    level: str
    input_hash: str
    since: Optional[str]
    alerts: list[dict[str, str]]
    message: str
    outputs: dict[str, Path] = field(default_factory=dict)
    notified: str = ""


def _snapshots(state: Path, before: date) -> list[Path]:
    out = []
    for p in sorted((state / "snapshots").glob("*")) if (state / "snapshots").exists() else []:
        try:
            if date.fromisoformat(p.name) < before:
                out.append(p)
        except ValueError:
            continue
    return out


def _last_run(state: Path, before: date) -> Optional[dict[str, Any]]:
    f = state / "runs.jsonl"
    if not f.exists():
        return None
    last = None
    for line in f.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if r.get("as_of", "") < before.isoformat():
            last = r
    return last


def workspace_file(data_dir: Path, customer: str, as_of: str, include_personal: bool) -> dict[str, Any]:
    """The same record the browser app saves, so a scheduled run can feed it. The id is the hash of the inputs kept."""
    files = {p.name: p.read_text(encoding="utf-8") for p in sorted(data_dir.iterdir()) if p.suffix in (".csv", ".toml")}
    if not include_personal:
        for n in PERSONAL:
            files.pop(n, None)
    kept = {n: file_hash(t.encode("utf-8")) for n, t in files.items()}
    snap = {"id": input_hash(kept), "customer": customer, "as_of": as_of, "personal_excluded": not include_personal and any((data_dir / n).exists() for n in PERSONAL),
            "saved_on": "", "files": files}
    return {"format": "beyond90-workspace", "version": 1, "exported_with": "pipeline", "snapshots": [snap]}


def _notify(cfg: Config, message: str, alerts: list[dict[str, str]], payload: dict[str, Any], env: Mapping[str, str],
            opener: Optional[urllib.request.OpenerDirector]) -> str:
    n = cfg.notify
    if not n:
        return ""
    if not alerts and not n.get("always", False):
        return "no alerts, nothing sent"
    url = env.get(n["webhook_env"], "")
    if not url:
        return f"environment variable {n['webhook_env']} is not set"
    try:
        check_url(url, cfg.allow_hosts)
        body = json.dumps({"text": message} if n.get("format", "slack") == "slack" else payload).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with (opener or urllib.request.build_opener()).open(req, timeout=cfg.timeout_seconds) as resp:
            resp.read(1024)
        return "sent"
    except (FetchError, OSError) as e:
        return f"not sent: {type(e).__name__}"          # never the URL: it is a secret


def run(cfg: Config, as_of: Optional[date] = None, *, now: Optional[datetime] = None, env: Optional[Mapping[str, str]] = None,
        sleep: Callable[[float], None] = time.sleep, opener: Optional[urllib.request.OpenerDirector] = None, notify: bool = True) -> RunResult:
    import os
    env = os.environ if env is None else env
    now = now or datetime.now(UTC)
    as_of = as_of or now.date()
    state = cfg.state_dir
    rep = sync(cfg, as_of, now=now, env=env, sleep=sleep, opener=opener)
    data_dir = rep.data_dir
    try:
        cat = Catalogue.for_directory(data_dir)
        data, warnings = load_customer(data_dir, cat, require_accounts=True)
    except (DataError, ValueError) as e:
        raise PipelineError(e.errors if isinstance(e, DataError) else [str(e)]) from e

    since_dirs = _snapshots(state, as_of)
    since_dir = since_dirs[-1] if since_dirs else None
    opts = cfg.output_options
    result = analyze(str(data_dir), hours=float(opts.get("hours_per_week", 8)), weeks=int(opts.get("weeks", 26)),
                     realization=float(opts.get("realization", 0.9)), since=str(since_dir) if since_dir else None)
    if not result["ok"]:
        raise PipelineError(result["errors"])

    score = compute_score(data, cat)
    previous = _last_run(state, as_of)
    old = None
    if since_dir:
        try:
            old = load_customer(since_dir, cat)[0]
        except DataError:
            old = None
    drift = input_drift(data, old, cat.terms) if old is not None else None
    prev_score = compute_score(old, cat).to_dict() if old is not None else None
    renewal = compute_renewal(data, score, prev_score)
    met = rubric_metrics(score, data)
    sync_problems = [r.to_dict() for r in rep.problems]
    alerts = compute_alerts(score=score, metrics=met, previous=previous, sync_problems=sync_problems, drift=drift, renewal=renewal, dropped=rep.dropped)
    message = render_message(score.customer, as_of.isoformat(), score, alerts)

    out_dir = state / "out" / as_of.isoformat()
    latest = state / "out" / "latest"
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.rmtree(latest, ignore_errors=True)
    out_dir.mkdir(parents=True)
    outputs: dict[str, Path] = {}
    for name in cfg.outputs:
        key, fname = OUTPUT_FILES[name]
        (out_dir / fname).write_text(result[key], encoding="utf-8")
        outputs[name] = out_dir / fname
    (out_dir / "sync.json").write_text(json.dumps([r.to_dict() for r in rep.results], indent=2), encoding="utf-8")
    (out_dir / "alerts.json").write_text(json.dumps(alerts, indent=2), encoding="utf-8")
    if cfg.export.get("workspace", True):
        ws = workspace_file(data_dir, score.customer, as_of.isoformat(), bool(cfg.export.get("include_personal", False)))
        (out_dir / "workspace.json").write_text(json.dumps(ws, indent=1) + "\n", encoding="utf-8")
        outputs["workspace"] = out_dir / "workspace.json"
    shutil.copytree(out_dir, latest)

    Store(str(state / "history.db")).save(score)
    snap = state / "snapshots" / as_of.isoformat()
    shutil.rmtree(snap, ignore_errors=True)
    shutil.copytree(data_dir, snap)
    record = {"as_of": as_of.isoformat(), "ran_at": now.isoformat(timespec="seconds"), "yield": score.yield_, "level": (score.rubric or {}).get("level"),
              "input_hash": score.provenance.get("input_hash", ""), "critical_unowned": met.get("critical_unowned"),
              "renewal_status": renewal["status"] if renewal else None, "quality_weak": (score.quality or {}).get("weak", 0),
              "alerts": [a["key"] for a in alerts], "sources": {r.name: r.status for r in rep.results}, "warnings": len(warnings)}
    with (state / "runs.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")

    sent = _notify(cfg, message, alerts, {"customer": score.customer, "as_of": as_of.isoformat(), "yield": score.yield_, "level": record["level"], "alerts": alerts}, env, opener) if notify else ""
    return RunResult(as_of, rep, score.yield_, record["level"] or "", record["input_hash"], since_dir.name if since_dir else None, alerts, message, outputs, sent)
