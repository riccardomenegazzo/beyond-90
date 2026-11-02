"""Templates that make the pipeline run by itself.

The pipeline is one command; scheduling is the host's job, and every host has a scheduler. These produce the
file for GitHub Actions, cron or systemd. None of them contains a secret: tokens are environment variables the
host supplies, and the templates list exactly which ones the configuration needs.
"""

from __future__ import annotations

from .config import Config


def needed_env(cfg: Config) -> list[str]:
    names: set[str] = set()
    for s in cfg.sources:
        if s.auth.get("env"):
            names.add(s.auth["env"])
        names.update(s.env)
    if cfg.notify.get("webhook_env"):
        names.add(cfg.notify["webhook_env"])
    return sorted(names)


def _cron(at: str, every: str) -> str:
    try:
        h, m = (int(x) for x in at.split(":"))
    except ValueError:
        raise ValueError("--at must be HH:MM (UTC)") from None
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError("--at must be HH:MM (UTC)")
    return {"hour": f"{m} * * * *", "day": f"{m} {h} * * *", "week": f"{m} {h} * * 1"}[every]


def github_workflow(cfg: Config, config_name: str = "beyond90.toml", at: str = "05:17", every: str = "day", install: str = "beyond90") -> str:
    env = needed_env(cfg)
    env_block = "\n".join(f"          {n}: ${{{{ secrets.{n} }}}}" for n in env) or "          {}"
    return f"""name: Beyond 90
# Runs the pipeline on a schedule. The state (history, snapshots, the last good copy of each source) is kept
# in the Actions cache so each run can explain what changed since the one before. It holds customer data:
# use a private repository, and treat the artifact the same way.
on:
  schedule:
    - cron: "{_cron(at, every)}"
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: beyond90
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -m pip install "{install}"
      - uses: actions/cache@v4
        with:
          path: state
          key: beyond90-state-${{{{ github.run_id }}}}
          restore-keys: beyond90-state-
      - name: Run
        run: beyond90 run {config_name}
        env:
{env_block}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: beyond90-latest
          path: state/out/latest
          retention-days: 14
"""


def cron_line(cfg: Config, config_name: str = "beyond90.toml", at: str = "05:17", every: str = "day") -> str:
    env = needed_env(cfg)
    note = ("# Needs these variables in the environment of the job: " + ", ".join(env) + "\n") if env else ""
    return f"{note}{_cron(at, every)} cd {cfg.base_dir} && beyond90 run {config_name} >> state/cron.log 2>&1\n"


def systemd_units(cfg: Config, config_name: str = "beyond90.toml", at: str = "05:17", every: str = "day") -> str:
    h, m = at.split(":")
    cal = {"hour": f"*:{m}", "day": f"{h}:{m}", "week": f"Mon {h}:{m}"}[every]
    env = needed_env(cfg)
    envline = "EnvironmentFile=/etc/beyond90.env  # " + ", ".join(env) + "\n" if env else ""
    return f"""# /etc/systemd/system/beyond90.service
[Unit]
Description=Beyond 90 pipeline

[Service]
Type=oneshot
WorkingDirectory={cfg.base_dir}
{envline}ExecStart=/usr/bin/env beyond90 run {config_name}

# /etc/systemd/system/beyond90.timer
[Unit]
Description=Run Beyond 90 on a schedule

[Timer]
OnCalendar={cal}
Persistent=true

[Install]
WantedBy=timers.target
"""
