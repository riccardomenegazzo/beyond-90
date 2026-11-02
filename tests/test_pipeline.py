import json
import shutil
import subprocess
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from beyond90.alerts import compute_alerts, render_message
from beyond90.cli import main
from beyond90.connect import load_config
from beyond90.connect.pipeline import PipelineError, run, workspace_file
from beyond90.connect.schedule import cron_line, github_workflow, needed_env, systemd_units
from connect_helpers import FINDINGS, Api, config_text, paged, serve_default

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 11, 2, 6, 0, tzinfo=UTC)
ENV = {"T_TOKEN": "t0ken", "PATH": "/usr/bin:/bin"}


@pytest.fixture
def api():
    a = Api()
    serve_default(a)
    yield a
    a.stop()


def cfg_for(tmp_path, text):
    p = tmp_path / "beyond90.toml"
    p.write_text(text)
    return load_config(p)


def go(cfg, day, **kw):
    return run(cfg, date(2026, 11, day), now=NOW + timedelta(days=day - 2), env=kw.pop("env", ENV), sleep=lambda s: None, **kw)


def test_one_run_collects_scores_writes_everything_and_keeps_history(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base, customer_extra="renewal_date = 2027-03-31"))
    res = go(cfg, 2)
    out = cfg.state_dir / "out"
    assert (out / "2026-11-02" / "report.html").read_text().startswith("<!doctype html") and (out / "latest" / "qbr.md").exists()
    assert {"report", "qbr", "successplan", "summary", "roadmap", "json", "workspace"} == set(res.outputs)
    assert (cfg.state_dir / "history.db").exists() and (cfg.state_dir / "snapshots" / "2026-11-02" / "accounts.csv").exists()
    rec = json.loads((cfg.state_dir / "runs.jsonl").read_text().splitlines()[-1])
    assert rec["as_of"] == "2026-11-02" and rec["input_hash"] == res.input_hash and rec["sources"]["tenants"] == "ok"
    assert 0 < res.yield_ < 1 and res.since is None
    assert "Derived from inputs" in (out / "latest" / "summary.md").read_text()


def test_the_next_run_finds_the_previous_snapshot_by_itself_and_explains_the_change(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    go(cfg, 2)
    caps = [dict(c, on=True) for c in json.loads(json.dumps(__import__("connect_helpers").CAPS))]
    api.routes["/caps"] = paged(caps)
    res = go(cfg, 9)
    assert res.since == "2026-11-02"
    summary = (cfg.state_dir / "out" / "latest" / "summary.md").read_text()
    assert "## What changed" in summary and "Did the inputs change since 2026-11-02" in summary
    assert res.yield_ > json.loads((cfg.state_dir / "runs.jsonl").read_text().splitlines()[0])["yield"]


def test_a_run_while_a_source_is_down_still_finishes_and_says_so(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    go(cfg, 2)
    api.routes["/findings"] = lambda q, h: (500, {}, {})
    res = go(cfg, 3)
    assert any(a["key"] == "stale:findings" and a["level"] == "warn" for a in res.alerts) and "findings" in res.message
    assert json.loads((cfg.state_dir / "runs.jsonl").read_text().splitlines()[-1])["sources"]["findings"] == "stale"


def test_alerts_speak_only_when_something_changed(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    first = go(cfg, 2)
    assert any(a["key"] == "critical_unowned" for a in first.alerts)                 # f1 is critical and unowned
    quiet = go(cfg, 3)
    assert not any(a["key"] == "critical_unowned" for a in quiet.alerts)             # same fact, already said
    fixed = [dict(f, who="alice") for f in FINDINGS]
    api.routes["/findings"] = paged(fixed)
    assert go(cfg, 4).alerts == [] or all(a["level"] == "info" for a in go(cfg, 4).alerts)


def test_the_webhook_receives_the_alerts_and_the_secret_url_never_appears_in_output(api, tmp_path):
    hook = Api()
    hook.routes["/hook"] = lambda q, h: (200, {}, {})
    try:
        cfg = cfg_for(tmp_path, config_text(api.base, extra='\n[notify]\nwebhook_env = "HOOK_URL"\nformat = "slack"\n').replace('allow_hosts = ["127.0.0.1"]', 'allow_hosts = ["127.0.0.1"]'))
        env = {**ENV, "HOOK_URL": f"{hook.base}/hook?secret=SHH"}
        res = go(cfg, 2, env=env)
        assert res.notified == "sent" and len(hook.posts) == 1
        body = json.loads(hook.posts[0])
        assert "critical" in body["text"] and "Test Co" in body["text"]
        assert "SHH" not in json.dumps([res.message, res.notified]) and "SHH" not in (cfg.state_dir / "runs.jsonl").read_text()
        assert go(cfg, 2, env=env, notify=False).notified == ""
        api.routes["/findings"] = lambda q, h: (500, {}, {})                       # a stale source is an alert, so a message would go out
        assert "not set" in go(cfg, 5, env=ENV).notified
    finally:
        hook.stop()


def test_a_webhook_on_a_host_that_is_not_allowed_is_not_called(api, tmp_path):
    other = Api()
    other.routes["/h"] = lambda q, h: (200, {}, {})
    try:
        cfg = cfg_for(tmp_path, config_text(api.base, extra='\n[notify]\nwebhook_env = "HOOK_URL"\n'))
        res = go(cfg, 2, env={**ENV, "HOOK_URL": f"http://localhost:{other.port}/h"})
        assert res.notified.startswith("not sent") and other.posts == []
    finally:
        other.stop()


def test_nothing_is_sent_when_there_is_nothing_to_say(api, tmp_path):
    hook = Api()
    hook.routes["/hook"] = lambda q, h: (200, {}, {})
    try:
        cfg = cfg_for(tmp_path, config_text(api.base, extra='\n[notify]\nwebhook_env = "HOOK_URL"\n'))
        env = {**ENV, "HOOK_URL": f"{hook.base}/hook"}
        go(cfg, 2, env=env)
        n = len(hook.posts)
        res = go(cfg, 3, env=env)
        assert "no alerts" in res.notified and len(hook.posts) == n
    finally:
        hook.stop()


def test_invalid_data_from_a_source_stops_the_run_with_the_reasons(api, tmp_path):
    api.routes["/findings"] = paged([dict(FINDINGS[0], sev="catastrophic")])
    cfg = cfg_for(tmp_path, config_text(api.base))
    with pytest.raises(PipelineError) as e:
        go(cfg, 2)
    assert "severity" in str(e.value)


def node_check(ws_path: Path) -> str:
    code = (f"import {{ readFileSync }} from 'node:fs'; import * as W from '{ROOT}/site/workspace-core.js';"
            f"const p = W.parseWorkspace(readFileSync('{ws_path}', 'utf8')); const r = await W.acceptSnapshots(p.snapshots); console.log(r.ok.length, r.rejected);")
    return subprocess.run(["node", "--input-type=module", "-e", code], capture_output=True, text=True, check=True).stdout.strip()


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_workspace_file_a_run_writes_is_accepted_by_the_browser_apps_own_checks(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    (cfg.state_dir / "manual").mkdir(parents=True)
    (cfg.state_dir / "manual" / "contacts.csv").write_text("id,name,role\nc1,Dana,champion\n")
    go(cfg, 2)
    ws = cfg.state_dir / "out" / "latest" / "workspace.json"
    doc = json.loads(ws.read_text())
    assert doc["format"] == "beyond90-workspace" and doc["snapshots"][0]["personal_excluded"] is True and "contacts.csv" not in doc["snapshots"][0]["files"]
    assert node_check(ws) == "1 0"                                                  # content hash matches the name, in JavaScript too


def test_personal_files_are_included_in_the_workspace_only_when_asked(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    (cfg.state_dir / "manual").mkdir(parents=True)
    (cfg.state_dir / "manual" / "contacts.csv").write_text("id,name,role\nc1,Dana,champion\n")
    go(cfg, 2)
    d = cfg.state_dir / "data"
    assert "contacts.csv" not in workspace_file(d, "x", "2026-11-02", False)["snapshots"][0]["files"]
    assert "contacts.csv" in workspace_file(d, "x", "2026-11-02", True)["snapshots"][0]["files"]


# ---------------------------------------------------------------------------- alerts (unit)

class S:
    yield_ = 0.70
    rubric = {"level": "bronze"}
    quality = {"weak": 0}


def alert(**kw):
    base = dict(score=S(), metrics={"critical_unowned": 0}, previous=None, sync_problems=[], drift=None, renewal=None)
    base.update(kw)
    return {a["key"]: a for a in compute_alerts(**base)}


def test_level_and_yield_moves_are_alerts_in_the_right_direction():
    prev = {"level": "silver", "yield": 0.75, "as_of": "2026-10-01"}
    got = alert(previous=prev)
    assert got["level"]["level"] == "warn" and "fell from silver to bronze" in got["level"]["text"] and got["yield"]["level"] == "warn"
    got = alert(previous={"level": "basic", "yield": 0.60, "as_of": "x"})
    assert got["level"]["level"] == "info" and got["yield"]["level"] == "info"
    assert alert(previous={"level": "bronze", "yield": 0.69, "as_of": "x"}) == {}


def test_renewal_alerts_on_a_change_or_when_close():
    r = {"status": "at_risk", "days": 100, "date": "2027-02-01", "signals": [{"label": "Executive sponsor", "status": "risk"}]}
    assert "renewal" in alert(renewal=r)
    assert "renewal" not in alert(renewal=r, previous={"renewal_status": "at_risk", "level": "bronze", "yield": 0.7})
    assert "renewal" in alert(renewal={**r, "days": 20}, previous={"renewal_status": "at_risk", "level": "bronze", "yield": 0.7})


def test_a_message_says_nothing_needs_attention_when_it_does_not():
    assert render_message("Acme", "2026-11-02", S(), []).endswith("Nothing needs attention.")
    assert "- [warn] x" in render_message("Acme", "2026-11-02", S(), [{"key": "k", "level": "warn", "text": "x"}])


# ---------------------------------------------------------------------------- schedule and CLI

def test_schedule_templates_name_the_secrets_they_need_and_hold_none(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base, extra='\n[notify]\nwebhook_env = "HOOK_URL"\n'))
    assert needed_env(cfg) == ["HOOK_URL", "T_TOKEN"]
    wf = github_workflow(cfg, "beyond90.toml", "04:30", "day", "beyond90 @ git+https://example.invalid/x@v1")
    assert 'cron: "30 4 * * *"' in wf and "secrets.T_TOKEN" in wf and "secrets.HOOK_URL" in wf and "t0ken" not in wf and "beyond90 run beyond90.toml" in wf
    assert "actions/cache@v4" in wf and "private repository" in wf and "beyond90 @ git+https://example.invalid/x@v1" in wf
    assert cron_line(cfg, at="06:05", every="hour").split(" cd ")[0].endswith("5 * * * *")
    assert "OnCalendar=Mon 03:00" in systemd_units(cfg, at="03:00", every="week") and "EnvironmentFile" in systemd_units(cfg)
    with pytest.raises(ValueError):
        cron_line(cfg, at="25:99")


def test_the_cli_end_to_end(api, tmp_path, monkeypatch, capsys):
    p = tmp_path / "beyond90.toml"
    p.write_text(config_text(api.base))
    monkeypatch.setenv("T_TOKEN", "t0ken")
    assert main(["check-config", str(p)]) == 0 and "valid" in capsys.readouterr().out
    assert main(["sync", str(p), "--as-of", "2026-11-02"]) == 0 and "merged: accounts 8" in capsys.readouterr().out
    assert main(["run", str(p), "--as-of", "2026-11-02"]) == 0
    out = capsys.readouterr().out
    assert "Yield" in out and "report" in out
    assert main(["run", str(p), "--as-of", "2026-11-03", "--fail-under", "0.99"]) == 2
    assert main(["run", str(p), "--as-of", "2026-11-04", "--fail-on-alert"]) in (0, 3)
    capsys.readouterr()
    assert main(["schedule", "github", str(p)]) == 0 and "workflow_dispatch" in capsys.readouterr().out
    monkeypatch.delenv("T_TOKEN")
    assert main(["sync", str(p), "--as-of", "2026-11-05"]) in (0, 1)
    bad = tmp_path / "bad.toml"
    bad.write_text('[customer]\nname = "x"\n')
    with pytest.raises(SystemExit) as ex:
        main(["check-config", str(bad)])
    assert ex.value.code == 1 and "at least one [[source]]" in capsys.readouterr().err
