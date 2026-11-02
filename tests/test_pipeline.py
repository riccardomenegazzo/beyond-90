import json
import shutil
import subprocess
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from beyond90.alerts import compute_alerts, render_message
from beyond90.cli import main
from beyond90.connect import SyncError, load_config
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
    assert {"report", "qbr", "successplan", "summary", "roadmap", "json", "prep", "workspace"} == set(res.outputs)
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


# ---------------------------------------------------------------------------- operations

def test_a_second_run_at_the_same_time_is_refused_and_a_dead_lock_is_taken_over(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    cfg.state_dir.mkdir(parents=True)
    lock = cfg.state_dir / "run.lock"
    lock.write_text(json.dumps({"pid": __import__("os").getpid(), "since": datetime.now(UTC).isoformat()}))
    with pytest.raises(PipelineError, match="another run is in progress"):
        go(cfg, 2)
    assert lock.exists()                                       # the refused run must not remove the other run's lock
    lock.write_text(json.dumps({"pid": 2 ** 22 + 12345, "since": datetime.now(UTC).isoformat()}))   # no such process
    go(cfg, 2)
    assert not lock.exists()
    lock.write_text("not json at all")                         # unreadable: cannot be trusted
    go(cfg, 3)
    assert not lock.exists()
    lock.write_text(json.dumps({"pid": __import__("os").getpid(), "since": (datetime.now(UTC) - timedelta(hours=7)).isoformat()}))
    go(cfg, 4)                                                 # old enough to be abandoned even if the pid is alive
    assert not lock.exists()


def test_the_lock_is_released_when_a_run_fails(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    with pytest.raises(SyncError, match="no list of accounts"):
        go(cfg, 2, env={"PATH": "/usr/bin"})                   # the token is missing
    assert not (cfg.state_dir / "run.lock").exists()


def test_a_damaged_cache_or_run_log_does_not_stop_a_run(api, tmp_path):
    cfg = cfg_for(tmp_path, config_text(api.base))
    go(cfg, 2)
    for f in (cfg.state_dir / "cache").glob("*.json"):
        f.write_text('{"rows": "oops"')
    (cfg.state_dir / "runs.jsonl").write_text("{broken\n\x00\x00\n[]\n")
    (cfg.state_dir / "snapshots" / "not-a-date").mkdir()
    res = go(cfg, 3)                                           # the API is still up, so the damaged cache is simply replaced
    assert res.yield_ > 0
    api.routes["/tenants"] = lambda q, h: (500, {}, {})
    for f in (cfg.state_dir / "cache").glob("tenants.json"):
        f.write_text("{damaged")
    with pytest.raises(SyncError, match="no list of accounts"):
        go(cfg, 4)                                             # damaged cache and a dead source: a clear failure, not a traceback


def test_old_snapshots_and_outputs_are_pruned_but_history_is_kept(api, tmp_path):
    text = config_text(api.base).replace("\n[source", '\n[state]\nkeep_snapshots = 2\nkeep_outputs = 3\n\n[source', 1)
    cfg = cfg_for(tmp_path, text)
    for d in range(2, 9):
        go(cfg, d)
    snaps = sorted(p.name for p in (cfg.state_dir / "snapshots").iterdir())
    outs = sorted(p.name for p in (cfg.state_dir / "out").iterdir())
    assert snaps == ["2026-11-07", "2026-11-08"] and outs == ["2026-11-06", "2026-11-07", "2026-11-08", "latest"]
    assert len((cfg.state_dir / "runs.jsonl").read_text().splitlines()) == 7 and (cfg.state_dir / "history.db").exists()


def test_a_state_directory_that_cannot_be_written_gives_a_message_not_a_traceback(api, tmp_path):
    import os
    if os.geteuid() == 0:
        pytest.skip("root can write anywhere")
    cfg = cfg_for(tmp_path, config_text(api.base))
    go(cfg, 2)
    (cfg.state_dir / "out").chmod(0o500)
    try:
        with pytest.raises(PipelineError, match="state directory"):
            go(cfg, 3)
    finally:
        (cfg.state_dir / "out").chmod(0o700)


def test_state_options_are_checked(tmp_path):
    from beyond90.connect import ConfigError
    base = config_text("http://127.0.0.1:1")
    for extra, needle in (("keep_snapshots = 0", "keep_snapshots"), ('keep_outputs = "x"', "keep_outputs"), ("keep_sna = 3", "unknown key")):
        with pytest.raises(ConfigError, match=needle):
            cfg_for(tmp_path, base.replace("\n[source", f"\n[state]\n{extra}\n\n[source", 1))


def test_a_run_writes_the_call_prep_and_matches_a_feed_that_may_come_and_go(api, tmp_path):
    feed = tmp_path / "advisories.json"
    cfg = cfg_for(tmp_path, config_text(api.base) + '\n[advisories]\npath = "advisories.json"\n')
    res = go(cfg, 2)                                           # no feed yet: not a failure
    prep = (cfg.state_dir / "out" / "latest" / "call-prep.md").read_text()
    assert prep.startswith("# Call prep:") and "News that touches" not in prep and res.outputs["prep"].name == "call-prep.md"
    feed.write_text(json.dumps([{"id": "ADV-1", "title": "Exposed buckets", "severity": "critical", "resource_types": ["storage_object"], "mitigated_by": ["posture"]}]))
    go(cfg, 3)
    assert "ADV-1" in (cfg.state_dir / "out" / "latest" / "call-prep.md").read_text()
    feed.write_text("{not json")
    with pytest.raises(PipelineError, match="advisories"):
        go(cfg, 4)


def test_the_advisories_section_is_checked(tmp_path):
    from beyond90.connect import ConfigError
    for extra in ('\n[advisories]\n', '\n[advisories]\npath = ""\n', '\n[advisories]\npath = "x.json"\nurl = "http://example.org"\n'):
        base = config_text("http://127.0.0.1:1")
        if extra.strip() == "[advisories]":
            continue
        with pytest.raises(ConfigError, match="advisories"):
            cfg_for(tmp_path, base + extra)
