"""Command line interface."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

from . import __version__
from .catalogue import Catalogue
from .loader import DataError, load_customer
from .playbooks import generate_actions
from .portfolio import load_portfolio, render_portfolio_json, render_portfolio_markdown
from .qbr import render_qbr
from .report import pct, render_html, render_json, render_markdown, render_text
from .scoring import compute_score
from .store import Store

CUSTOMER_TOML = """[customer]
name = "{name}"
tier = ""
arr = 0
as_of = {today}

[settings]
ceiling_version = "{ceiling}"
baseline_ceiling = "{ceiling}"
triage_window_days = 7

[settings.sla_days]
critical = 7
high = 30
medium = 90
low = 180
"""

CSV_HEADERS = {
    "accounts.csv": "id,provider,sources,connected,owner,last_spend,status,in_plan,created_at",
    "inventory.csv": "account_id,resource_type,count,inventoried",
    "activations.csv": "account_id,module_id,active",
    "findings.csv": "id,account_id,severity,exposure,opened_at,closed_at,owner,decision,decision_reason,expiry,previous_severity,severity_changed_at",
    "teams.csv": "id,name,has_assets,active_users,sso,role_scoped,last_access_review",
    "entitlements.csv": "unit,licensed,used",
}


def _emit(text: str, out: Optional[str]) -> None:
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(text, encoding="utf-8")
        print(f"Wrote {out}", file=sys.stderr)
    else:
        sys.stdout.write(text if text.endswith("\n") else text + "\n")


def _catalogue(args) -> Catalogue:
    return Catalogue.load(args.catalogue_dir) if getattr(args, "catalogue_dir", None) else Catalogue.load()


def _prepare(args):
    cat = _catalogue(args)
    data, warnings = load_customer(args.directory, cat)
    score = compute_score(data, cat, getattr(args, "ceiling", None))
    actions = generate_actions(data, score, cat)
    history = previous = None
    if getattr(args, "store", None):
        store = Store(args.store)
        previous = store.previous(score.customer, score.as_of)
        if not getattr(args, "no_save", False):
            store.save(score)
        history = store.history(score.customer)
    return data, warnings, score, actions, history, previous


def cmd_init(args) -> int:
    from datetime import date

    base = Path(args.directory)
    if (base / "customer.toml").exists():
        print(f"{base / 'customer.toml'} already exists; refusing to overwrite", file=sys.stderr)
        return 1
    base.mkdir(parents=True, exist_ok=True)
    cat = Catalogue.load()
    (base / "customer.toml").write_text(
        CUSTOMER_TOML.format(name=args.name or base.name, today=date.today().isoformat(), ceiling=cat.version), encoding="utf-8"
    )
    for name, header in CSV_HEADERS.items():
        path = base / name
        if not path.exists():
            path.write_text(header + "\n", encoding="utf-8")
    print(f"Created {base}/ with customer.toml and empty CSV files. Fill them in, then run: beyond90 validate {base}")
    return 0


def cmd_validate(args) -> int:
    cat = _catalogue(args)
    data, warnings = load_customer(args.directory, cat)
    print(
        f"OK: {data.name}, as of {data.as_of}: {len(data.accounts)} accounts, {len(data.inventory)} inventory rows, "
        f"{len(data.activations)} activations, {len(data.findings)} findings, {len(data.teams)} teams, {len(data.entitlements)} entitlements."
    )
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    return 0


def cmd_score(args) -> int:
    _, warnings, score, actions, history, previous = _prepare(args)
    fmt = args.format
    if fmt == "json":
        text = render_json(score, actions, history)
    elif fmt == "markdown":
        text = render_markdown(score, actions, history, previous)
    elif fmt == "html":
        text = render_html(score, actions, history, previous)
    else:
        text = render_text(score, actions)
    _emit(text, args.out)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if args.fail_under is not None and score.yield_ < args.fail_under:
        print(f"Yield {pct(score.yield_)} is below --fail-under {pct(args.fail_under)}", file=sys.stderr)
        return 2
    return 0


def cmd_report(args) -> int:
    _, _, score, actions, history, previous = _prepare(args)
    _emit(render_html(score, actions, history, previous), args.out)
    return 0


def cmd_actions(args) -> int:
    _, _, score, actions, _, _ = _prepare(args)
    if args.leak:
        actions = [a for a in actions if a.leak.lower() == args.leak.lower()]
    if args.format == "json":
        import json

        _emit(json.dumps([a.to_dict() for a in actions], indent=2, ensure_ascii=False), args.out)
        return 0
    lines = []
    for a in actions:
        lines.append(f"[{a.leak}] {a.effect_points:.1f} pts  {a.title}")
        lines.append(f"    {a.detail}")
        lines.append(f"    owner: {a.owner}   due: {a.due}   done when: {a.success}")
        if args.steps:
            lines += [f"      - {s}" for s in a.steps]
    _emit("\n".join(lines) if lines else "No open actions.", args.out)
    return 0


def cmd_qbr(args) -> int:
    _, _, score, actions, _, previous = _prepare(args)
    _emit(render_qbr(score, actions, previous, args.quarter or ""), args.out)
    return 0


def cmd_history(args) -> int:
    store = Store(args.store)
    rows = store.history(args.customer)
    if not rows:
        print(f"No snapshots for {args.customer!r} in {args.store}. Known customers: {', '.join(store.customers()) or 'none'}", file=sys.stderr)
        return 1
    if args.format == "json":
        import json

        _emit(json.dumps(rows, indent=2), args.out)
        return 0
    lines = [f"{'as of':<12}{'ceiling':<9}{'yield':>8}{'legacy':>8}{'L1':>8}{'L2':>8}{'L3':>8}{'L4':>8}{'crit':>6}"]
    for r in rows:
        crit = "-" if r["critical_open"] is None else str(r["critical_open"])
        lines.append(f"{r['as_of']:<12}{r['ceiling_version']:<9}{pct(r['yield']):>8}{pct(r['naive']):>8}{pct(r['l1']):>8}{pct(r['l2']):>8}{pct(r['l3']):>8}{pct(r['l4']):>8}{crit:>6}")
    ttz = store.time_to_zero(args.customer)
    if ttz:
        lines.append(f"\nTime to zero critical: {ttz['days']} days (first snapshot {ttz['first_snapshot']}, reached {ttz['reached']})")
    _emit("\n".join(lines), args.out)
    return 0


def cmd_portfolio(args) -> int:
    cat = _catalogue(args)
    store = Store(args.store) if args.store else None
    pf = load_portfolio(args.root, cat, store)
    if store and not args.no_save:
        for e in pf.entries:
            store.save(e.score)
    render = render_portfolio_json if args.format == "json" else render_portfolio_markdown
    _emit(render(pf, args.min_customers), args.out)
    return 1 if pf.errors and args.strict else 0


def cmd_catalogue(args) -> int:
    cat = _catalogue(args)
    ceiling = args.ceiling or cat.version
    lines = [f"Catalogue version {cat.version}; modules at ceiling {ceiling}:"]
    for m in cat.modules_at(ceiling):
        req = f" (needs {', '.join(m.requires_any)})" if m.requires_any else ""
        lines.append(f"  {m.id:<24} since {m.since}  {m.category:<7} {', '.join(m.providers)}{req}")
    lines.append("\nExpected resource types per provider:")
    for p, types in cat.expected.items():
        lines.append(f"  {p:<11} {', '.join(types)}")
    _emit("\n".join(lines), None)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="beyond90", description="Adoption score and action plan for Technical Account Managers.")
    p.add_argument("--version", action="version", version=f"beyond90 {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp, store=True, ceiling=True):
        sp.add_argument("directory", help="customer data directory (see docs/data-format.md)")
        sp.add_argument("--catalogue-dir", help="directory with custom resource_types.json, modules.json, playbooks.json")
        if ceiling:
            sp.add_argument("--ceiling", help="score against this ceiling version instead of the one in customer.toml")
        if store:
            sp.add_argument("--store", help="SQLite file for snapshot history; the run is saved unless --no-save")
            sp.add_argument("--no-save", action="store_true", help="read the store but do not write this run to it")

    sp = sub.add_parser("init", help="scaffold an empty customer data directory")
    sp.add_argument("directory")
    sp.add_argument("--name", help="customer name (default: directory name)")
    sp.set_defaults(func=cmd_init)

    sp = sub.add_parser("validate", help="check a data directory and report every problem")
    common(sp, store=False, ceiling=False)
    sp.set_defaults(func=cmd_validate)

    sp = sub.add_parser("score", help="compute the score")
    common(sp)
    sp.add_argument("--format", choices=["text", "json", "markdown", "html"], default="text")
    sp.add_argument("--out", help="write to this file instead of stdout")
    sp.add_argument("--fail-under", type=float, metavar="YIELD", help="exit with code 2 if Yield is below this fraction (for CI), e.g. 0.9")
    sp.set_defaults(func=cmd_score)

    sp = sub.add_parser("report", help="write the self-contained HTML report")
    common(sp)
    sp.add_argument("--out", default="beyond90-report.html")
    sp.set_defaults(func=cmd_report)

    sp = sub.add_parser("actions", help="list actions ranked by estimated effect")
    common(sp)
    sp.add_argument("--leak", help="only this leak: L1, L2, L3, L4, Reach, Entitlement")
    sp.add_argument("--steps", action="store_true", help="include playbook steps")
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_actions)

    sp = sub.add_parser("qbr", help="draft a quarterly business review (Markdown)")
    common(sp)
    sp.add_argument("--quarter", help="label for the title, e.g. Q4 2026")
    sp.add_argument("--out", help="write to this file instead of stdout")
    sp.set_defaults(func=cmd_qbr)

    sp = sub.add_parser("history", help="show stored snapshots for a customer")
    sp.add_argument("customer", help="customer name as in customer.toml")
    sp.add_argument("--store", required=True)
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_history)

    sp = sub.add_parser("portfolio", help="score every customer directory under a root and find shared patterns")
    sp.add_argument("root", help="directory containing one sub-directory per customer")
    sp.add_argument("--catalogue-dir")
    sp.add_argument("--store")
    sp.add_argument("--no-save", action="store_true")
    sp.add_argument("--format", choices=["markdown", "json"], default="markdown")
    sp.add_argument("--min-customers", type=int, default=2, help="show a pattern only if it appears at this many customers (default 2)")
    sp.add_argument("--strict", action="store_true", help="exit 1 if any customer directory is invalid")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_portfolio)

    sp = sub.add_parser("catalogue", help="show modules and expected resource types")
    sp.add_argument("--catalogue-dir")
    sp.add_argument("--ceiling")
    sp.set_defaults(func=cmd_catalogue)
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except DataError as exc:
        print("Invalid input:", file=sys.stderr)
        for line in exc.errors:
            print(f"  {line}", file=sys.stderr)
        return 1
    except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
