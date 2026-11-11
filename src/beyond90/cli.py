"""Command line interface."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from . import __version__
from .attribution import explain, render_attribution
from .book import build_book_plan, render_book_html, render_book_json, render_book_markdown, render_book_text
from .candor import candor_items
from .catalogue import Catalogue, available_profiles
from .drift import input_drift
from .exportcsv import actions_csv
from .forecast import forecast_zero_critical, render_forecast
from .importers import (
    ImportFormatError,
    merge,
    parse_aws_org,
    parse_azure,
    parse_csv,
    parse_gcp,
    read_accounts,
    reconcile,
    render_reconcile,
    resolve_providers,
    write_accounts,
)
from .ladder import path_to_next_level
from .loader import DataError, load_customer
from .models import CustomerData
from .planner import Plan, build_plan
from .playbooks import Action, generate_actions
from .portfolio import load_portfolio, render_portfolio_json, render_portfolio_markdown
from .qbr import render_qbr
from .radar import load_threats, release_radar, render_radar_json, render_radar_markdown, render_radar_text, threat_radar
from .renewal import compute_renewal
from .report import pct, render_html, render_json, render_markdown, render_text
from .scoring import Score, compute_score
from .sections import md_plan
from .simulate import RampModel
from .store import Store
from .successplan import render_success_plan
from .universe import render_universe

if TYPE_CHECKING:
    from .connect import Config

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


def _catalogue(args: argparse.Namespace) -> Catalogue:
    """The catalogue for this run: --catalogue-dir, else --profile, else the profile named in the customer's customer.toml."""
    custom, profile = getattr(args, "catalogue_dir", None), getattr(args, "profile", None)
    if getattr(args, "directory", None):
        return Catalogue.for_directory(args.directory, profile=profile, custom_dir=custom)
    if getattr(args, "root", None):
        return Catalogue.for_root(args.root, profile=profile, custom_dir=custom)
    return Catalogue.load(Path(custom)) if custom else Catalogue.load(profile=profile)


def _prepare(args: argparse.Namespace) -> tuple[Catalogue, CustomerData, list[str], Score, list[Action], Optional[list[dict[str, Any]]], Optional[dict[str, Any]]]:
    """Load, score, list actions, and read/write the history store if one was given."""
    cat = _catalogue(args)
    data, warnings = load_customer(args.directory, cat, require_accounts=True)
    score = compute_score(data, cat, getattr(args, "ceiling", None))
    actions = generate_actions(data, score, cat)
    history: Optional[list[dict[str, Any]]] = None
    previous: Optional[dict[str, Any]] = None
    if getattr(args, "store", None):
        store = Store(args.store)
        previous = store.previous(score.customer, score.as_of)
        if not getattr(args, "no_save", False):
            store.save(score)
        history = store.history(score.customer)
    return cat, data, warnings, score, actions, history, previous


def _plan(args: argparse.Namespace, data: CustomerData, cat: Catalogue) -> Plan:
    return build_plan(data, cat, hours_per_week=args.hours, horizon_weeks=args.weeks,
                      realization=args.realization, ramp=RampModel(args.ramp_weeks))


def _extras(args: argparse.Namespace, cat: Catalogue, data: CustomerData, score: Score, previous: Optional[dict[str, Any]]) -> tuple[dict[str, Any], Optional[dict[str, Any]]]:
    """Optional analyses added to reports: attribution, zero-critical forecast, roadmap."""
    extras: dict[str, Any] = {}
    old = None
    if getattr(args, "since", None):
        old, _ = load_customer(args.since, cat)
        previous = compute_score(old, cat).to_dict()
    if previous:
        extras["attribution"] = explain(score, previous, data, cat)
    if data.findings:
        extras["forecast"] = forecast_zero_critical(data)
    if not getattr(args, "no_plan", False):
        extras["plan"] = _plan(args, data, cat)
    extras["renewal"] = compute_renewal(data, score, previous)
    extras["ladder"] = path_to_next_level(score, extras.get("plan"))
    if old is not None:
        extras["drift"] = input_drift(data, old, cat.terms)
    extras["candor"] = candor_items(score, data, cat, plan=extras.get("plan"), forecast=extras.get("forecast"), attribution=extras.get("attribution"))
    return extras, previous


def cmd_init(args: argparse.Namespace) -> int:
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


def cmd_validate(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    data, warnings = load_customer(args.directory, cat)
    print(
        f"OK: {data.name}, as of {data.as_of}: {len(data.accounts)} accounts, {len(data.inventory)} inventory rows, "
        f"{len(data.activations)} activations, {len(data.findings)} findings, {len(data.teams)} teams, {len(data.entitlements)} entitlements."
    )
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    return 0


def cmd_score(args: argparse.Namespace) -> int:
    cat, data, warnings, score, actions, history, previous = _prepare(args)
    fmt = args.format
    if fmt == "json":
        text = render_json(score, actions, history)
    elif fmt in ("markdown", "html"):
        extras, previous = _extras(args, cat, data, score, previous)
        text = (render_markdown if fmt == "markdown" else render_html)(score, actions, history, previous, **extras)
    else:
        text = render_text(score, actions)
    _emit(text, args.out)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if args.fail_under is not None and score.yield_ < args.fail_under:
        print(f"Yield {pct(score.yield_)} is below --fail-under {pct(args.fail_under)}", file=sys.stderr)
        return 2
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    cat, data, _, score, actions, history, previous = _prepare(args)
    extras, previous = _extras(args, cat, data, score, previous)
    _emit(render_html(score, actions, history, previous, **extras), args.out)
    return 0


def cmd_actions(args: argparse.Namespace) -> int:
    _, _, _, _score, actions, _, _ = _prepare(args)
    if args.leak:
        actions = [a for a in actions if a.leak.lower() == args.leak.lower()]
    if args.format == "json":
        _emit(json.dumps([a.to_dict() for a in actions], indent=2, ensure_ascii=False), args.out)
        return 0
    if args.format == "csv":
        _emit(actions_csv(actions, _score.customer), args.out)
        return 0
    lines = []
    for a in actions:
        lines.append(f"[{a.leak}] {a.effect_points:.1f} pts  {a.effort_hours:g} h  {a.title}")
        lines.append(f"    {a.detail}")
        lines.append(f"    owner: {a.owner}   due: {a.due}   done when: {a.success}")
        if args.steps:
            lines += [f"      - {s}" for s in a.steps]
    _emit("\n".join(lines) if lines else "No open actions.", args.out)
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    plan = _plan(args, data, cat)
    if args.format == "json":
        _emit(json.dumps(plan.to_dict(), indent=2, ensure_ascii=False), args.out)
    elif args.format == "markdown":
        _emit("\n".join([f"# Roadmap: {plan.customer}", "", *md_plan(plan, top=args.top)]), args.out)
    else:
        lines = [f"{plan.customer}: {plan.hours_per_week:g} h/week, {plan.horizon_weeks} weeks, {plan.realization:.0%} realization",
                 f"Yield {pct(plan.start_yield)} -> {pct(plan.end_yield)}",
                 "Checkpoints: " + ", ".join(f"{k} " + (f"week {v}" if v is not None else "not reached") for k, v in plan.milestones.items()), ""]
        lines.append(f"{'week':>4} {'yield':>7}  what happened")
        for w in plan.weeks:
            what = "; ".join(w.completed) or "-"
            lines.append(f"{w.week:>4} {pct(w.yield_):>7}  {what[:90]}")
            for ev in w.events:
                lines.append(f"{'':>13}  ! {ev}")
        for d in plan.dips:
            lines.append(f"\nJ-curve: week {d['week']} dips {d['drop_points']:.1f} pts. {d['cause']}")
        if plan.residual:
            lines.append("\nAssumed blocked: " + "; ".join(f"{n} {k}" for k, n in plan.residual.items()))
        lines += [f"\nNote: {n}" for n in plan.notes]
        _emit("\n".join(lines), args.out)
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    score = compute_score(data, cat)
    previous: Optional[dict[str, Any]] = None
    if args.since:
        old, _ = load_customer(args.since, cat)
        previous = compute_score(old, cat).to_dict()
    elif args.store:
        previous = Store(args.store).previous(score.customer, score.as_of)
        if previous is None:
            print(f"No earlier snapshot for {score.customer!r} in {args.store}.", file=sys.stderr)
            return 1
    else:
        print("explain needs --since DIR (an older data directory) or --store DB (with an earlier snapshot)", file=sys.stderr)
        return 1
    att = explain(score, previous, data, cat)
    _emit(json.dumps(att.to_dict(), indent=2) if args.format == "json" else render_attribution(att), args.out)
    return 0


def cmd_book(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    root = Path(args.root)
    dirs = sorted(p for p in root.iterdir() if p.is_dir() and (p / "customer.toml").exists())
    if not dirs:
        print(f"{root}: no customer directories found (each needs a customer.toml)", file=sys.stderr)
        return 1
    customers, skipped = [], {}
    for d in dirs:
        try:
            data, _ = load_customer(d, cat, require_accounts=True)
            customers.append((data.name, data))
        except DataError as exc:
            skipped[d.name] = exc.errors
    for name, errs in skipped.items():
        print(f"skipped {name}: {errs[0]}" + (f" (+{len(errs) - 1} more)" if len(errs) > 1 else ""), file=sys.stderr)
    if not customers:
        return 1
    plan = build_book_plan(customers, cat, hours_per_week=args.hours, horizon_weeks=args.weeks, realization=args.realization,
                           weighting=args.weight, ramp=RampModel(args.ramp_weeks), baselines=not args.no_baselines)
    render = {"text": render_book_text, "markdown": render_book_markdown, "json": render_book_json, "html": render_book_html}[args.format]
    _emit(render(plan), args.out)
    return 1 if skipped and args.strict else 0


def cmd_radar(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    root = Path(args.root)
    dirs = sorted(p for p in root.iterdir() if p.is_dir() and (p / "customer.toml").exists())
    customers = []
    for d in dirs:
        try:
            data, _ = load_customer(d, cat, require_accounts=True)
            customers.append((data.name, data))
        except DataError as exc:
            print(f"skipped {d.name}: {exc.errors[0]}", file=sys.stderr)
    if not customers:
        print(f"{root}: no valid customer directories found", file=sys.stderr)
        return 1
    releases = []
    if args.release or args.since_baseline or not args.threats:
        releases = release_radar(customers, cat, version=args.release, since_baseline=not args.release)
    threats = []
    if args.threats:
        as_of = max(d.as_of for _, d in customers)
        threats = threat_radar(customers, load_threats(args.threats, cat), cat, as_of=as_of)
    render = {"text": render_radar_text, "markdown": render_radar_markdown, "json": render_radar_json}[args.format]
    _emit(render(releases, threats), args.out)
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    base = Path(args.into)
    if not (base / "customer.toml").exists():
        print(f"{base}/customer.toml not found: run `beyond90 init {base}` first", file=sys.stderr)
        return 1
    text = Path(args.file).read_text(encoding="utf-8-sig")
    if args.kind == "aws-org":
        records = parse_aws_org(text)
    elif args.kind == "azure":
        records = parse_azure(text)
    elif args.kind == "gcp":
        records = parse_gcp(text)
    else:
        if not args.id_column:
            print("import csv needs --id-column", file=sys.stderr)
            return 1
        records = parse_csv(
            text, source=args.source or ("platform" if args.connected else "billing"), id_column=args.id_column,
            provider=args.provider, provider_column=args.provider_column, owner_column=args.owner_column,
            spend_column=args.spend_column, status_column=args.status_column,
            infer_provider=bool(args.connected),
        )
        if args.connected:
            for r in records:
                r.connected = True
    path = base / "accounts.csv"
    records = resolve_providers(records, read_accounts(path))
    res = merge(read_accounts(path), records, authoritative_connected=bool(args.connected and args.authoritative))
    print(f"{len(records)} account(s) in {args.file}: {len(res.added)} added, {len(res.updated)} updated, {res.unchanged} unchanged"
          + (f", {len(res.newly_unconnected)} marked unconnected" if res.newly_unconnected else ""))
    for c in res.conflicts:
        print(f"conflict: {c}", file=sys.stderr)
    if args.dry_run:
        print("Dry run: accounts.csv not written.")
    else:
        write_accounts(path, res.accounts)
        print(f"Wrote {path} ({len(res.accounts)} accounts)")
    return 0


def cmd_reconcile(args: argparse.Namespace) -> int:
    accounts = read_accounts(Path(args.directory) / "accounts.csv")
    if not accounts:
        print(f"{args.directory}/accounts.csv is missing or empty", file=sys.stderr)
        return 1
    r = reconcile(accounts)
    _emit(json.dumps(r, indent=2) if args.format == "json" else render_reconcile(r), args.out)
    return 0


def cmd_universe(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    u = compute_score(data, cat).universe
    _emit(json.dumps(u, indent=2) if args.format == "json" else render_universe(u), args.out)
    return 0


def cmd_forecast(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    f = forecast_zero_critical(data, runs=args.runs, horizon_days=args.horizon, seed=args.seed)
    _emit(json.dumps(f, indent=2) if args.format == "json" else render_forecast(f), args.out)
    return 0


def cmd_qbr(args: argparse.Namespace) -> int:
    cat, data, _, score, actions, _, previous = _prepare(args)
    extras, previous = _extras(args, cat, data, score, previous)
    _emit(render_qbr(score, actions, previous, args.quarter or "", **extras), args.out)
    return 0


def cmd_onepager(args: argparse.Namespace) -> int:
    from . import execqbr
    from .onepager import render_onepager

    cat, data, _, _, _, _, _ = _prepare(args)
    _emit(render_onepager(execqbr.build([data], cat)), args.out)
    return 0


def _parse_do(text: str) -> list[dict[str, Any]]:
    """`connect_all,enable:runtime_sensor,fix:unowned` -> scenario steps."""
    steps: list[dict[str, Any]] = []
    for part in (x.strip() for x in text.split(",") if x.strip()):
        head, _, arg = part.partition(":")
        if head in ("connect_all", "enable_all"):
            steps.append({"kind": head})
        elif head == "enable" and arg:
            steps.append({"kind": "enable_module", "module": arg})
        elif head == "fix":
            steps.append({"kind": "fix_findings", "leak": arg or "all"})
        else:
            raise SystemExit(f"beyond90: cannot read step {part!r}; use connect_all, enable_all, enable:<module>, fix or fix:<leak>")
    return steps


def cmd_whatif(args: argparse.Namespace) -> int:
    from . import whatif

    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    ramp = RampModel(args.ramp_weeks)
    try:
        if args.reach is not None:
            result: dict[str, Any] = whatif.reach(data, cat, args.reach)
        else:
            if args.scenarios:
                loaded = json.loads(Path(args.scenarios).read_text(encoding="utf-8"))
                scenarios = loaded if isinstance(loaded, list) else [loaded]
            elif args.do:
                scenarios = [{"name": args.do, "steps": _parse_do(args.do)}]
            else:
                raise SystemExit("beyond90: give --do, --scenarios or --reach")
            result = whatif.run(data, cat, scenarios, ramp)
    except (whatif.ScenarioError, json.JSONDecodeError, OSError) as e:
        raise SystemExit(f"beyond90: {e}") from None
    if args.format == "json":
        _emit(json.dumps(result, indent=2, ensure_ascii=False), args.out)
        return 0
    lines = [f"{result['customer']} ({result['as_of']})"]
    if "path" in result:
        lines.append(f"Target {pct(result['target'])}: Yield {pct(result['start_yield'])} -> {pct(result['end_yield'])}"
                     + ("" if result["reached"] else "  (not reached)"))
        for i, p in enumerate(result["path"], 1):
            lines.append(f"{i:>3}. {p['title']}   +{p['gain_points']:.1f} pts -> {pct(p['yield_after'])}")
        lines += [f"Note: {n}" for n in result["notes"]]
    else:
        for sc in result["scenarios"]:
            lines.append(f"\n{sc['name']}")
            lines.append(f"  today {pct(sc['today']['yield'])}   right after {pct(sc['right_after']['yield'])}   settled {pct(sc['steady']['yield'])}"
                         f"   ({sc['steady']['delta_points']:+.1f} pts)")
            t = sc["touched"]
            lines.append(f"  touches {t['accounts_connected']} accounts to connect, {t['activations_added']} modules to enable, {t['findings_fixed']} findings to repair")
            lines += [f"  Note: {n}" for n in sc["notes"]]
    lines += ["", "Assumptions:"] + [f"  - {a}" for a in result["assumptions"]]
    _emit("\n".join(lines), args.out)
    return 0


def cmd_mcp(args: argparse.Namespace) -> int:
    from .mcp_server import main as serve_mcp

    try:
        return serve_mcp(args.root, args.profile, args.catalogue_dir)
    except ValueError as e:
        raise SystemExit(f"beyond90: {e}") from None


def cmd_successplan(args: argparse.Namespace) -> int:
    cat, data, _, score, actions, _, previous = _prepare(args)
    extras, previous = _extras(args, cat, data, score, previous)
    _emit(render_success_plan(score, actions, extras.get("plan"), owner=args.owner or "", review=args.review), args.out)
    return 0


def cmd_onboarding(args: argparse.Namespace) -> int:
    from . import onboarding
    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    d = onboarding.diagnose(data)
    if args.since:
        old, _ = load_customer(args.since, cat)
        d["delta"] = onboarding.delta(onboarding.diagnose(old), d, old.as_of, data.as_of)
    if args.customer_page:
        page = onboarding.customer_status(d, data.name, data.as_of.isoformat(), cat.terms["units"], d.get("delta"))
        _emit(page["html"] if args.format == "html" else page["markdown"], args.out)
        return 0
    _emit(json.dumps(d, indent=2) if args.format == "json" else onboarding.render_markdown(d, data.name, cat.terms["units"]), args.out)
    return 0


def cmd_triage(args: argparse.Namespace) -> int:
    from . import onboarding
    text = sys.stdin.read() if args.text == "-" else args.text
    r = onboarding.triage(text, args.provider or "", args.kind or "")
    if args.format == "json":
        print(json.dumps(r, indent=2))
        return 0 if r["match"] else 3
    m = r["match"]
    if not m:
        print("No known cause matches this message. Collect the full error, the connector ID and the time, and open a support case.")
        return 3
    print(f"{m['title']}  [{m['id']}, owner: {m['owner']}, about {m['hours']:g} h{', fix once for the organization' if m['scope'] == 'org' else ''}]")
    print(f"\nWhy: {m['why']}\n\nFix:")
    for i, s in enumerate(m["steps"], 1):
        print(f"  {i}. {s}")
    print(f"\nVerify: {m['verify']}")
    for o in r["also"]:
        print(f"\nAlso possible: {o['title']} [{o['id']}]")
    return 0


def cmd_preflight(args: argparse.Namespace) -> int:
    from . import onboarding
    opts = {"providers": [p.strip().lower() for p in args.providers.split(",") if p.strip()], "org": not args.per_account}
    for k in ("kubernetes", "sensor", "cmk", "guardrails", "private_clusters", "pod_security", "proxy"):
        opts[k] = bool(getattr(args, k))
    _emit(onboarding.preflight(opts)["markdown"], args.out)
    return 0


def cmd_receipt(args: argparse.Namespace) -> int:
    from . import impact
    cat = _catalogue(args)
    old, _ = load_customer(args.since, cat)
    new, _ = load_customer(args.directory, cat, require_accounts=True)
    r = impact.receipt(old, new, cat)
    _emit(json.dumps(r, indent=2) if args.format == "json" else impact.render(r, html=args.format == "html"), args.out)
    return 0


def cmd_teams(args: argparse.Namespace) -> int:
    from . import onboarding, outlook, stake, teams
    cat = _catalogue(args)
    data, _ = load_customer(args.directory, cat, require_accounts=True)
    score = compute_score(data, cat)
    d = teams.digests(data, onboarding.diagnose(data), outlook.outlook(data, cat), stake.weighted(data, score, cat), cat.terms["units"])
    if args.format == "json":
        _emit(json.dumps(d, indent=2), args.out)
        return 0
    parts = [f"# Each team's part: {data.name}", ""]
    for t in d["teams"]:
        parts += [f"## {t['name']} ({t['accounts']} {cat.terms['units']}, {t['spend_share']:.0%} of spend)", "", "```", t["message"].rstrip(), "```", ""]
    _emit("\n".join(parts), args.out)
    return 0


def cmd_feeds(args: argparse.Namespace) -> int:
    from . import feeds
    cfg = feeds.default_config()
    if args.sources:
        cfg = json.loads(Path(args.sources).read_text(encoding="utf-8"))
    if args.days:
        cfg["window_days"] = args.days
    previous = None
    if args.previous and Path(args.previous).is_file():
        try:
            previous = json.loads(Path(args.previous).read_text(encoding="utf-8"))
        except ValueError:
            print(f"{args.previous}: not valid JSON; first-seen dates start today", file=sys.stderr)
    feed = feeds.collect(cfg, cat=Catalogue.load(), previous=previous)
    for st in feed["sources"]:
        why = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in (st.get("dropped") or {}).items() if n)
        print(f"{st['id']:>6}  " + (f"{st['kept']} kept of {st['read']}" + (f" (dropped: {why}; newest {st['newest'] or 'n/a'})" if why else "") if st["ok"] else f"not read: {st['error']}"), file=sys.stderr)
    if not any(st["ok"] for st in feed["sources"] if st["id"] != "epss"):
        print("No source could be read; nothing written.", file=sys.stderr)
        return 1
    _emit(feeds.render_markdown(feed) if args.format == "markdown" else json.dumps(feed, indent=1, ensure_ascii=False), args.out)
    return 0


def cmd_exec_qbr(args: argparse.Namespace) -> int:
    from datetime import date as _date

    from . import execqbr
    from .radar import load_threats
    cat = Catalogue.for_directory(args.snapshots[0])
    datas = [load_customer(d, cat, require_accounts=True)[0] for d in args.snapshots]
    threats = load_threats(args.threats, cat) if args.threats else None
    q = execqbr.build(datas, cat, start=_date.fromisoformat(args.from_) if args.from_ else None, end=_date.fromisoformat(args.to) if args.to else None, threats=threats)
    if args.format == "pptx":
        if not args.out:
            print("exec-qbr --format pptx needs --out FILE.pptx", file=sys.stderr)
            return 2
        Path(args.out).write_bytes(execqbr.render_pptx(q))
        return 0
    _emit(json.dumps(q, indent=2) if args.format == "json" else execqbr.render_html(q) if args.format == "html" else execqbr.render_markdown(q), args.out)
    return 0


def cmd_app(args: argparse.Namespace) -> int:
    from . import serve

    source = Path(args.site)
    try:
        serve.run(source, args.host, args.port, tuple(args.name), lambda m: print(m, file=sys.stderr))
    except (ValueError, OSError) as e:
        print(f"beyond90 app: {e}", file=sys.stderr)
        return 2
    return 0


def cmd_history(args: argparse.Namespace) -> int:
    store = Store(args.store)
    rows = store.history(args.customer)
    if not rows:
        print(f"No snapshots for {args.customer!r} in {args.store}. Known customers: {', '.join(store.customers()) or 'none'}", file=sys.stderr)
        return 1
    if args.format == "json":
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


def cmd_portfolio(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    store = Store(args.store) if args.store else None
    pf = load_portfolio(args.root, cat, store)
    if store and not args.no_save:
        for e in pf.entries:
            store.save(e.score)
    render = render_portfolio_json if args.format == "json" else render_portfolio_markdown
    _emit(render(pf, args.min_customers), args.out)
    return 1 if pf.errors and args.strict else 0


def _config(args: argparse.Namespace) -> Config:
    from .connect import ConfigError, load_config
    try:
        return load_config(args.config)
    except ConfigError as e:
        print("Invalid configuration:", file=sys.stderr)
        for line in e.errors:
            print(f"  {line}", file=sys.stderr)
        raise SystemExit(1) from None


def _as_of(args: argparse.Namespace) -> Optional[date]:
    return date.fromisoformat(args.as_of) if getattr(args, "as_of", None) else None


def cmd_check_config(args: argparse.Namespace) -> int:
    import os

    from .connect.schedule import needed_env
    cfg = _config(args)
    print(f"{args.config}: valid. Customer {cfg.customer['name']!r}, state in {cfg.state_dir}.")
    for s in cfg.sources:
        where = s.url.split("?")[0] if s.type == "http" else " ".join(s.argv[:2]) if s.type == "command" else s.path
        print(f"  {s.name:<18} {s.type:<8} -> {s.target:<12} {where}")
    print("Hosts it may reach: " + ", ".join(cfg.allow_hosts) if cfg.allow_hosts else "It reaches no host (no http source).")
    env = needed_env(cfg)
    print("Environment variables it reads: " + (", ".join(env) if env else "none"))
    missing = [n for n in env if n not in os.environ]
    if missing:
        print("Not set here: " + ", ".join(missing))
    return 0


def _print_sync(rep: Any) -> None:
    for r in rep.results:
        extra = f" ({r.error})" if r.error else ""
        age = f", {r.age_days} day(s) old" if r.status == "stale" else ""
        print(f"  {r.name:<18} {r.status:<7} {r.rows:>6} rows{age}{extra}")
    print("  merged: " + ", ".join(f"{t} {n}" for t, n in rep.counts.items()))
    for t, n in rep.dropped.items():
        print(f"  dropped {n} {t} row(s) for accounts that are not in the account list")


def cmd_sync(args: argparse.Namespace) -> int:
    from .connect import SyncError, sync
    cfg = _config(args)
    try:
        rep = sync(cfg, _as_of(args) or date.today())
    except SyncError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"Data directory: {rep.data_dir}")
    _print_sync(rep)
    return 1 if any(r.status == "failed" for r in rep.results) else 0


def cmd_run(args: argparse.Namespace) -> int:
    from .connect import SyncError
    from .connect.pipeline import PipelineError, run
    cfg = _config(args)
    try:
        res = run(cfg, _as_of(args), notify=not args.no_notify)
    except (SyncError, PipelineError) as e:
        print("error:", file=sys.stderr)
        for line in (e.errors if isinstance(e, PipelineError) else [str(e)]):
            print(f"  {line}", file=sys.stderr)
        return 1
    _print_sync(res.sync)
    print(f"Yield {res.yield_:.1%}, level {res.level}" + (f", compared with {res.since}" if res.since else ", no earlier snapshot to compare with"))
    for name, path in res.outputs.items():
        print(f"  {name:<12} {path}")
    print(res.message.split("\n", 1)[1] if "\n" in res.message else res.message)
    if res.notified:
        print(f"Notification: {res.notified}")
    if args.fail_under is not None and res.yield_ < args.fail_under:
        print(f"Yield {res.yield_:.1%} is below --fail-under {args.fail_under:.1%}", file=sys.stderr)
        return 2
    if args.fail_on_alert and any(a["level"] == "warn" for a in res.alerts):
        return 3
    return 0


def cmd_schedule(args: argparse.Namespace) -> int:
    from .connect import schedule as sch
    cfg = _config(args)
    name = Path(args.config).name
    if args.kind == "github":
        text = sch.github_workflow(cfg, name, args.at, args.every, args.install_from)
    elif args.kind == "cron":
        text = sch.cron_line(cfg, name, args.at, args.every)
    else:
        text = sch.systemd_units(cfg, name, args.at, args.every)
    _emit(text, args.out)
    return 0


def cmd_fingerprint(args: argparse.Namespace) -> int:
    from .provenance import hash_directory, input_hash
    files = hash_directory(args.directory)
    if not files:
        print(f"{args.directory}: no input files found", file=sys.stderr)
        return 1
    if args.files:
        for name, h in sorted(files.items()):
            print(f"{h}  {name}")
    print(input_hash(files))
    return 0


def cmd_profiles(args: argparse.Namespace) -> int:
    for name in available_profiles():
        cat = Catalogue.load(profile=name)
        print(f"{name:<10} {cat.description or '(no description)'}")
        print(f"{'':<10} {len(cat.modules)} modules, {len(cat.resource_types)} asset types, platforms: {', '.join(cat.expected)}")
    print("\nUse one with --profile NAME, or set profile = \"NAME\" under [customer] in customer.toml. Write your own with --catalogue-dir (docs/profiles.md).")
    return 0


def cmd_catalogue(args: argparse.Namespace) -> int:
    cat = _catalogue(args)
    ceiling = args.ceiling or cat.version
    lines = [f"Profile {cat.profile}, catalogue version {cat.version}; modules at ceiling {ceiling}:"]
    for m in cat.modules_at(ceiling):
        req = f" (needs {', '.join(m.requires_any)})" if m.requires_any else ""
        lines.append(f"  {m.id:<24} since {m.since}  {m.category:<7} {', '.join(m.providers)}{req}{'  [on by connecting]' if m.on_connect else ''}")
    lines.append("\nExpected resource types per provider:")
    for p, types in cat.expected.items():
        lines.append(f"  {p:<11} {', '.join(types)}")
    _emit("\n".join(lines), None)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="beyond90", description="Adoption score, roadmap and explanations for Technical Account Managers.")
    p.add_argument("--version", action="version", version=f"beyond90 {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser, store: bool = True, ceiling: bool = True) -> None:
        sp.add_argument("directory", help="customer data directory (see docs/data-format.md)")
        sp.add_argument("--profile", help="catalogue profile (see `beyond90 profiles`); default: the one named in customer.toml, else cnapp")
        sp.add_argument("--catalogue-dir", help="directory with custom resource_types.json, modules.json, playbooks.json")
        if ceiling:
            sp.add_argument("--ceiling", help="score against this ceiling version instead of the one in customer.toml")
        if store:
            sp.add_argument("--store", help="SQLite file for snapshot history; the run is saved unless --no-save")
            sp.add_argument("--no-save", action="store_true", help="read the store but do not write this run to it")

    def planning(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--hours", type=float, default=8.0, help="hours per week you can spend on this customer (default 8)")
        sp.add_argument("--weeks", type=int, default=26, help="planning horizon in weeks (default 26)")
        sp.add_argument("--realization", type=float, default=0.9, help="share of each action's units that succeed; the rest is reported as residual (default 0.9)")
        sp.add_argument("--ramp-weeks", type=int, default=2, help="weeks until a newly connected account is fully inventoried (default 2)")

    def analyses(sp: argparse.ArgumentParser) -> None:
        planning(sp)
        sp.add_argument("--since", help="an older data directory of the same customer, to explain what changed")
        sp.add_argument("--no-plan", action="store_true", help="leave the roadmap out")

    sp = sub.add_parser("init", help="scaffold an empty customer data directory")
    sp.add_argument("directory")
    sp.add_argument("--name", help="customer name (default: directory name)")
    sp.set_defaults(func=cmd_init)

    sp = sub.add_parser("validate", help="check a data directory and report every problem")
    common(sp, store=False, ceiling=False)
    sp.set_defaults(func=cmd_validate)

    sp = sub.add_parser("score", help="compute the score")
    common(sp)
    analyses(sp)
    sp.add_argument("--format", choices=["text", "json", "markdown", "html"], default="text")
    sp.add_argument("--out", help="write to this file instead of stdout")
    sp.add_argument("--fail-under", type=float, metavar="YIELD", help="exit with code 2 if Yield is below this fraction (for CI), e.g. 0.9")
    sp.set_defaults(func=cmd_score)

    sp = sub.add_parser("report", help="write the self-contained HTML report")
    common(sp)
    analyses(sp)
    sp.add_argument("--out", default="beyond90-report.html")
    sp.set_defaults(func=cmd_report)

    sp = sub.add_parser("plan", help="simulate a roadmap week by week, including the J-curve")
    common(sp, store=False, ceiling=False)
    planning(sp)
    sp.add_argument("--format", choices=["text", "markdown", "json"], default="text")
    sp.add_argument("--top", type=int, default=12, help="rows of the action table in Markdown")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_plan)

    sp = sub.add_parser("explain", help="attribute the change in Yield: what the customer did and what the bar did")
    common(sp, store=True, ceiling=False)
    sp.add_argument("--since", help="an older data directory of the same customer")
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_explain)

    sp = sub.add_parser("book", help="spend one budget of hours across many customers where it adds the most weighted Yield")
    sp.add_argument("root", help="directory containing one sub-directory per customer")
    sp.add_argument("--catalogue-dir")
    sp.add_argument("--profile")
    sp.add_argument("--hours", type=float, default=30.0, help="hours per week across the whole book (default 30)")
    sp.add_argument("--weeks", type=int, default=26)
    sp.add_argument("--realization", type=float, default=0.9)
    sp.add_argument("--ramp-weeks", type=int, default=2)
    sp.add_argument("--weight", choices=["arr", "equal"], default="arr", help="what the book optimizes: ARR-weighted or equal-weighted Yield")
    sp.add_argument("--no-baselines", action="store_true", help="skip the comparison with equal and ARR-proportional splits (faster)")
    sp.add_argument("--format", choices=["text", "markdown", "json", "html"], default="text")
    sp.add_argument("--strict", action="store_true", help="exit 1 if any customer directory is invalid")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_book)

    sp = sub.add_parser("radar", help="which customers should hear about a release, and which are exposed to a threat")
    sp.add_argument("root", help="directory containing one sub-directory per customer")
    sp.add_argument("--catalogue-dir")
    sp.add_argument("--profile")
    sp.add_argument("--release", help="a catalogue version, e.g. 2026.3: customers where modules released then are relevant and off")
    sp.add_argument("--since-baseline", action="store_true", help="modules released after each customer's baseline ceiling (the default when no --threats)")
    sp.add_argument("--threats", help="a JSON threat feed (see docs/radar.md); nothing is fetched from the network")
    sp.add_argument("--format", choices=["text", "markdown", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_radar)

    sp = sub.add_parser("import", help="merge a native export (AWS Organizations, Azure, GCP, CSV) into accounts.csv")
    sp.add_argument("kind", choices=["aws-org", "azure", "gcp", "csv"])
    sp.add_argument("file")
    sp.add_argument("--into", required=True, help="customer data directory (created with `init`)")
    sp.add_argument("--dry-run", action="store_true")
    g = sp.add_argument_group("csv options")
    g.add_argument("--source", help="billing, org, sso, manual, plan or platform (default billing; platform with --connected)")
    g.add_argument("--id-column")
    g.add_argument("--provider", help="aws, azure, gcp, ... for every row (with --connected it is inferred from accounts.csv or the id's shape)")
    g.add_argument("--provider-column")
    g.add_argument("--owner-column")
    g.add_argument("--spend-column", help="summed per account when an account has several rows")
    g.add_argument("--status-column")
    g.add_argument("--connected", action="store_true", help="the listed accounts are the ones connected to the platform")
    g.add_argument("--authoritative", action="store_true", help="with --connected: accounts not in the file are marked unconnected")
    sp.set_defaults(func=cmd_import)

    sp = sub.add_parser("reconcile", help="how billing, organization and SSO lists overlap; which accounts each one misses")
    sp.add_argument("directory")
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_reconcile)

    sp = sub.add_parser("universe", help="estimate how many accounts no source has seen")
    common(sp, store=False, ceiling=False)
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_universe)

    sp = sub.add_parser("forecast", help="Monte Carlo forecast of when zero critical is reached, and how likely it is to break")
    common(sp, store=False, ceiling=False)
    sp.add_argument("--runs", type=int, default=2000)
    sp.add_argument("--horizon", type=int, default=365, help="days")
    sp.add_argument("--seed", type=int, default=7)
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_forecast)

    sp = sub.add_parser("actions", help="list actions ranked by estimated effect")
    common(sp)
    sp.add_argument("--leak", help="only this leak: L1, L2, L3, L4, Reach, Entitlement")
    sp.add_argument("--steps", action="store_true", help="include playbook steps")
    sp.add_argument("--format", choices=["text", "json", "csv"], default="text", help="csv is ready to import into a ticket tracker")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_actions)

    sp = sub.add_parser("qbr", help="draft a quarterly business review (Markdown)")
    common(sp)
    analyses(sp)
    sp.add_argument("--quarter", help="label for the title, e.g. Q4 2026")
    sp.add_argument("--out", help="write to this file instead of stdout")
    sp.set_defaults(func=cmd_qbr)

    sp = sub.add_parser("onepager", help="a one-page summary for the customer's CISO (HTML; print to PDF for a single A4 page)")
    common(sp)
    sp.add_argument("--out", help="write to this file instead of stdout")
    sp.set_defaults(func=cmd_onepager)

    sp = sub.add_parser("whatif", help="what Yield would be if you did X (including the dip first), or what it takes to reach a target")
    common(sp, store=False)
    sp.add_argument("--do", help="steps to try, comma separated: connect_all, enable_all, enable:<module>, fix, fix:<leak>")
    sp.add_argument("--scenarios", help="JSON file with one scenario or a list of them, compared side by side")
    sp.add_argument("--reach", type=float, help="instead: the steps that reach this Yield (for example 0.9)")
    sp.add_argument("--ramp-weeks", type=int, default=2, help="weeks until a newly connected account is fully inventoried (default 2)")
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_whatif)

    sp = sub.add_parser("mcp", help="a local, read-only MCP server so an AI assistant on this machine can ask about the customers under ROOT")
    sp.add_argument("root", help="directory whose sub-folders are customer data directories")
    sp.add_argument("--profile", help="catalogue profile (see `beyond90 profiles`)")
    sp.add_argument("--catalogue-dir", help="directory with custom resource_types.json, modules.json, playbooks.json")
    sp.set_defaults(func=cmd_mcp)

    sp = sub.add_parser("successplan", help="draft a success plan the customer can sign: outcomes, measures, milestones, owners, risks")
    common(sp)
    analyses(sp)
    sp.add_argument("--owner", help="your name, for the document")
    sp.add_argument("--review", default="every month", help='review cadence, e.g. "every month"')
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_successplan)

    sp = sub.add_parser("onboarding", help="where each account stands in onboarding, why connectors fail, and what to fix first")
    common(sp)
    sp.add_argument("--format", choices=["markdown", "json", "html"], default="markdown")
    sp.add_argument("--since", help="an earlier data directory of the same customer: what moved, and when it will be done")
    sp.add_argument("--customer-page", action="store_true", help="the status page for the customer (Markdown, or --format html)")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_onboarding)

    sp = sub.add_parser("triage", help='explain a connector error message: cause, owner, fix, how to verify (use "-" to read stdin)')
    sp.add_argument("text")
    sp.add_argument("--provider", choices=["aws", "azure", "gcp", "oci", "kubernetes"])
    sp.add_argument("--kind", choices=["cloud", "kubernetes", "sensor", "registry", "code", "logs"])
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.set_defaults(func=cmd_triage)

    sp = sub.add_parser("preflight", help="a checklist for the onboarding kickoff, before any connector exists")
    sp.add_argument("--providers", default="aws", help="comma-separated: aws,azure,gcp,oci")
    sp.add_argument("--per-account", action="store_true", help="the customer will connect account by account, not at the organization level")
    for k, h in (("kubernetes", "clusters will be connected"), ("sensor", "a runtime sensor will be deployed"), ("cmk", "disks use customer-managed keys"),
                 ("guardrails", "SCPs, Azure policies or organization policies are in force"), ("private_clusters", "cluster API servers are private"),
                 ("pod_security", "pod security or admission policies are enforced"), ("proxy", "egress goes through a proxy or TLS inspection")):
        sp.add_argument("--" + k.replace("_", "-"), dest=k, action="store_true", help=h)
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_preflight)

    sp = sub.add_parser("receipt", help="what improved between two snapshots and the work that came before it, for a renewal or a review")
    common(sp)
    sp.add_argument("--since", required=True, help="the earlier data directory of the same customer")
    sp.add_argument("--format", choices=["markdown", "html", "json"], default="markdown")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_receipt)

    sp = sub.add_parser("teams", help="each customer team's part, ranked by stake, with a message it can act on")
    common(sp)
    sp.add_argument("--format", choices=["markdown", "json"], default="markdown")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_teams)

    sp = sub.add_parser("feeds", help="read public cloud security sources into an advisory feed matched by every other command")
    sp.add_argument("--sources", help="a JSON file of sources (default: the public sources in data/feeds.json)")
    sp.add_argument("--previous", help="the last feed, to keep the date each story was first seen")
    sp.add_argument("--days", type=int, help="how far back to keep items (default 60)")
    sp.add_argument("--format", choices=["json", "markdown"], default="json")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_feeds)

    sp = sub.add_parser("app", help="serve the browser app from this machine or your own network (a built site folder or beyond90-site.zip)")
    sp.add_argument("--site", default="beyond90-site.zip", help="the built site: a folder, or the beyond90-site.zip published with each build")
    sp.add_argument("--host", default="127.0.0.1", help="address to listen on (default: this machine only)")
    sp.add_argument("--port", type=int, default=8090)
    sp.add_argument("--name", action="append", default=[], help="a host name the app is reached by, e.g. beyond90.example.internal (repeatable)")
    sp.set_defaults(func=cmd_app)

    sp = sub.add_parser("exec-qbr", help="an executive review (for a CISO) of one customer over a period, from its saved snapshots")
    sp.add_argument("snapshots", nargs="+", help="data directories of the same customer, one per snapshot, in any order")
    sp.add_argument("--from", dest="from_", help="first day of the period (default: the quarter of the latest snapshot)")
    sp.add_argument("--to", help="last day of the period")
    sp.add_argument("--threats", help="an advisory feed, to show the threats that touched the customer")
    sp.add_argument("--format", choices=["html", "pptx", "markdown", "json"], default="html")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_exec_qbr)

    sp = sub.add_parser("history", help="show stored snapshots for a customer")
    sp.add_argument("customer", help="customer name as in customer.toml")
    sp.add_argument("--store", required=True)
    sp.add_argument("--format", choices=["text", "json"], default="text")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_history)

    sp = sub.add_parser("portfolio", help="score every customer directory under a root and find shared patterns")
    sp.add_argument("root", help="directory containing one sub-directory per customer")
    sp.add_argument("--catalogue-dir")
    sp.add_argument("--profile")
    sp.add_argument("--store")
    sp.add_argument("--no-save", action="store_true")
    sp.add_argument("--format", choices=["markdown", "json"], default="markdown")
    sp.add_argument("--min-customers", type=int, default=2, help="show a pattern only if it appears at this many customers (default 2)")
    sp.add_argument("--strict", action="store_true", help="exit 1 if any customer directory is invalid")
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_portfolio)

    sp = sub.add_parser("check-config", help="validate a pipeline configuration and show what it will read and reach; touches nothing")
    sp.add_argument("config")
    sp.set_defaults(func=cmd_check_config)

    sp = sub.add_parser("sync", help="collect every source from beyond90.toml and rebuild the data directory")
    sp.add_argument("config")
    sp.add_argument("--as-of", help="date the data describes (default: today)")
    sp.set_defaults(func=cmd_sync)

    sp = sub.add_parser("run", help="sync, score, compare with the last run, write the reports, keep history, alert: the whole pipeline")
    sp.add_argument("config")
    sp.add_argument("--as-of", help="date the data describes (default: today)")
    sp.add_argument("--no-notify", action="store_true", help="do not send the webhook even if one is configured")
    sp.add_argument("--fail-under", type=float, help="exit 2 if Yield is below this (0 to 1)")
    sp.add_argument("--fail-on-alert", action="store_true", help="exit 3 if any alert has level warn")
    sp.set_defaults(func=cmd_run)

    sp = sub.add_parser("schedule", help="print the file that makes the pipeline run by itself (GitHub Actions, cron or systemd)")
    sp.add_argument("kind", choices=["github", "cron", "systemd"])
    sp.add_argument("config")
    sp.add_argument("--at", default="05:17", help="time of day in UTC, HH:MM")
    sp.add_argument("--every", choices=["hour", "day", "week"], default="day")
    sp.add_argument("--install-from", default="beyond90", help='pip requirement for the workflow, e.g. "beyond90 @ git+https://github.com/OWNER/beyond-90@v0.34.3"')
    sp.add_argument("--out")
    sp.set_defaults(func=cmd_schedule)

    sp = sub.add_parser("fingerprint", help="the hash that names these inputs; reports carry it so a number can be traced to its data")
    sp.add_argument("directory")
    sp.add_argument("--files", action="store_true", help="also list the hash of each file")
    sp.set_defaults(func=cmd_fingerprint)

    sp = sub.add_parser("profiles", help="list the catalogue profiles (cloud, endpoint, ...) and what each covers")
    sp.set_defaults(func=cmd_profiles)

    sp = sub.add_parser("catalogue", help="show modules and expected resource types")
    sp.add_argument("--catalogue-dir")
    sp.add_argument("--profile")
    sp.add_argument("--ceiling")
    sp.set_defaults(func=cmd_catalogue)
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except DataError as exc:
        print("Invalid input:", file=sys.stderr)
        for line in exc.errors:
            print(f"  {line}", file=sys.stderr)
        return 1
    except (FileNotFoundError, NotADirectoryError, ValueError, ImportFormatError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
