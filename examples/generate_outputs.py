#!/usr/bin/env python3
"""Regenerate the example outputs committed under docs/example/.

They are produced by the real CLI from the mock customers, so they show exactly
what a user gets. A test fails when they drift from the code; run this script to
refresh them:

    python examples/generate_outputs.py
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "src"))

from beyond90.cli import main  # noqa: E402

PORTFOLIO = str(HERE / "portfolio")
NW = str(HERE / "portfolio" / "northwind")
HISTORY = str(HERE / "history" / "northwind-2026-09")
OUT = ROOT / "docs" / "example"

JOBS = {
    "northwind-report.html": ["report", NW, "--since", HISTORY],
    "northwind-qbr.md": ["qbr", NW, "--since", HISTORY, "--quarter", "Q4 2026"],
    "northwind-plan.md": ["plan", NW, "--format", "markdown"],
    "book.html": ["book", PORTFOLIO, "--hours", "8", "--weeks", "12", "--format", "html"],
    "book.md": ["book", PORTFOLIO, "--hours", "8", "--weeks", "12", "--format", "markdown"],
    "radar.md": ["radar", PORTFOLIO, "--threats", str(HERE / "threats.json"), "--format", "markdown"],
    "portfolio.md": ["portfolio", PORTFOLIO],
}


def build(out: Path = OUT) -> dict[str, str]:
    import contextlib
    import io

    out.mkdir(parents=True, exist_ok=True)
    result = {}
    for name, argv in JOBS.items():
        target = out / name
        with contextlib.redirect_stderr(io.StringIO()):
            code = main([*argv, "--out", str(target)] if name != "portfolio.md" else [*argv, "--out", str(target)])
        if code != 0:
            raise SystemExit(f"{name}: exit code {code}")
        result[name] = target.read_text(encoding="utf-8")
    return result


if __name__ == "__main__":
    build()
    print("Wrote", ", ".join(JOBS), "to", OUT)
