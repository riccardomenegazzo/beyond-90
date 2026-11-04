"""A value receipt: what improved between two snapshots, in the customer's terms, and the work that came before it.

Renewals are argued with outcomes, and outcomes are easy to overstate. This module lists only what the two snapshots
show changed: accounts newly connected and the spend they put under watch, resource types inventoried, capabilities
switched on, findings closed and findings that gained an owner and a decision, the part of the Yield change that came
from the customer's own work (the moving bar is shown apart), promises kept. It then lists the touches logged in the
period and, for each, the outcomes of the same kind that followed within three weeks. It says "followed", never
"caused": a timeline is evidence for a conversation, not proof. And it ends with what did not move.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Optional

from .attribution import explain
from .catalogue import Catalogue
from .models import CustomerData
from .scoring import classify_finding, compute_score
from .stake import weighted

FOLLOW_DAYS = 21
TOPICS = {
    "connections": re.compile(r"connect|onboard|account|subscription|project|stack ?set|role|consent|deploy", re.I),
    "findings": re.compile(r"finding|owner|decision|triage|critical|remediat|risk|exception|vulnerab", re.I),
    "capabilities": re.compile(r"sensor|runtime|module|capabilit|enable|workshop|scan|registry|automation|posture|detection", re.I),
    "coverage": re.compile(r"inventor|resource|registry|asset|coverage", re.I),
}


def _active(d: CustomerData) -> dict[str, Any]:
    return {a.id: a for a in d.accounts if a.status == "active"}


def receipt(old: CustomerData, new: CustomerData, cat: Catalogue) -> dict[str, Any]:
    start, end = old.as_of, new.as_of
    oa, na = _active(old), _active(new)
    newly = sorted(i for i, a in na.items() if a.connected and not (oa.get(i) and oa[i].connected))
    lost = sorted(i for i, a in oa.items() if a.connected and not (na.get(i) and na[i].connected))
    spend_newly = sum(na[i].last_spend for i in newly)
    inv_old = {(r.account_id, r.resource_type) for r in old.inventory if r.inventoried}
    inv_new = {(r.account_id, r.resource_type) for r in new.inventory if r.inventoried}
    act_old = {(r.account_id, r.module_id) for r in old.activations if r.active}
    act_new = {(r.account_id, r.module_id) for r in new.activations if r.active}
    gained_caps = act_new - act_old
    by_module: dict[str, int] = {}
    names = {m.id: m.name for m in cat.modules}
    for _, m in gained_caps:
        by_module[names.get(m, m)] = by_module.get(names.get(m, m), 0) + 1
    closed = [f for f in new.findings if f.closed_at and start < f.closed_at <= end]
    closed_sev: dict[str, int] = {}
    for f in closed:
        closed_sev[f.severity] = closed_sev.get(f.severity, 0) + 1
    exposed_crit_closed = sum(1 for f in closed if f.severity == "critical" and f.exposure == "internet")
    window = new.settings.triage_window_days
    old_f = {f.id: f for f in old.findings}
    decided = [f for f in new.findings if f.closed_at is None and (end - f.opened_at).days >= window and classify_finding(f, end) == "ok"
               and f.id in old_f and old_f[f.id].closed_at is None and classify_finding(old_f[f.id], start) != "ok"]
    s_old, s_new = compute_score(old, cat), compute_score(new, cat)
    att = explain(s_new, s_old.to_dict(), new, cat)
    w_old, w_new = weighted(old, s_old, cat), weighted(new, s_new, cat)
    kept = [c for c in new.commitments if c.done_on and start < c.done_on <= end]
    on_time = [c for c in kept if c.done_on is not None and c.done_on <= c.due_on]
    touches = [i for i in new.interactions if start < i.date <= end]

    # Outcomes with a date, so a touch can be followed by them.
    dated: list[tuple[date, str, str]] = [(f.closed_at, "findings", f"{f.severity} finding {f.id} closed") for f in closed if f.closed_at]
    conn_dates = {c.account_id: c.first_scan_at or c.deployed_at for c in new.connectors if c.kind == "cloud"}
    for i in newly:
        when = conn_dates.get(i)
        if when and start < when <= end:
            dated.append((when, "connections", f"{i} connected"))
    timeline = []
    for t in touches:
        text = f"{t.summary} {t.next_step}"
        kinds = [k for k, rx in TOPICS.items() if rx.search(text)] or list(TOPICS)
        follow = [what for when, kind, what in sorted(dated) if kind in kinds and t.date <= when <= t.date + timedelta(days=FOLLOW_DAYS)]
        timeline.append({"date": t.date.isoformat(), "kind": t.kind, "summary": t.summary, "next_step": t.next_step, "topics": kinds, "followed_by": follow[:6], "followed_count": len(follow)})

    remaining = []
    if s_new.stages["L1"].leaks:
        un = list(s_new.stages["L1"].leaks)
        remaining.append(f"{len(un)} account(s) are still not connected, holding {w_new['unconnected_spend_share']:.0%} of spend.")
    crit_open = sum(1 for f in new.findings if f.closed_at is None and f.severity == "critical")
    if crit_open:
        remaining.append(f"{crit_open} critical finding(s) are still open.")
    top_off = sorted(s_new.stages["L3"].leaks, key=lambda e: -e["inactive"])[:1]
    if top_off:
        remaining.append(f"{top_off[0]['name']} is still off on {top_off[0]['inactive']} account(s).")

    headline = []
    if newly:
        headline.append(f"{len(newly)} account(s) connected" + (f", putting {spend_newly:,.0f} of monthly spend under watch" if spend_newly else ""))
    if closed:
        headline.append(f"{len(closed)} finding(s) closed" + (f", {closed_sev.get('critical', 0)} critical" if closed_sev.get("critical") else ""))
    if decided:
        headline.append(f"{len(decided)} finding(s) gained an owner and a decision")
    if gained_caps:
        headline.append(f"{len(gained_caps)} capability activation(s)")
    return {
        "from": start.isoformat(), "to": end.isoformat(), "days": (end - start).days, "customer": new.name,
        "headline": headline,
        "connected": {"accounts": newly, "spend": spend_newly, "lost": lost},
        "coverage": {"gained": len(inv_new - inv_old), "lost": len(inv_old - inv_new)},
        "capabilities": {"gained": len(gained_caps), "by_module": dict(sorted(by_module.items(), key=lambda kv: -kv[1]))},
        "findings": {"closed": len(closed), "by_severity": closed_sev, "exposed_critical_closed": exposed_crit_closed, "decided": len(decided)},
        "yield": {"from": att.yield_from, "to": att.yield_to, "customer_points": att.customer_points, "bar_points": att.bar_points},
        "weighted": {"from": w_old["value"], "to": w_new["value"]},
        "promises": {"kept": len(kept), "on_time": len(on_time)},
        "touches": {"count": len(touches), "timeline": timeline},
        "remaining": remaining,
    }


def render(r: dict[str, Any], html: bool = False) -> str:
    y = r["yield"]
    md = [f"# What changed: {r['customer']}", "", f"From {r['from']} to {r['to']} ({r['days']} days).", ""]
    md += [f"- {h}." for h in r["headline"]] or ["- No measurable change in this period."]
    md += ["", "## In detail", "",
           f"- Accounts connected: {len(r['connected']['accounts'])}" + (f" ({', '.join(r['connected']['accounts'][:10])})" if r["connected"]["accounts"] else "") + (f"; disconnected since: {', '.join(r['connected']['lost'])}" if r["connected"]["lost"] else "") + ".",
           f"- Resource types newly inventoried: {r['coverage']['gained']}.",
           f"- Capabilities switched on: {r['capabilities']['gained']}" + (" (" + ", ".join(f"{k} {v}" for k, v in list(r["capabilities"]["by_module"].items())[:4]) + ")" if r["capabilities"]["by_module"] else "") + ".",
           f"- Findings closed: {r['findings']['closed']}" + (" (" + ", ".join(f"{v} {k}" for k, v in r["findings"]["by_severity"].items()) + ")" if r["findings"]["by_severity"] else "") + f"; gained an owner and a decision: {r['findings']['decided']}.",
           f"- Adoption: {y['from']:.1%} to {y['to']:.1%}; your teams' work added {y['customer_points']:+.1f} points" + (f", and capabilities released since moved the bar by {y['bar_points']:+.1f}" if abs(y["bar_points"]) >= 0.05 else "") + ".",
           f"- Weighted by spend and exposure: {r['weighted']['from']:.1%} to {r['weighted']['to']:.1%}.",
           f"- Our promises: {r['promises']['kept']} delivered, {r['promises']['on_time']} on time."]
    tl = [t for t in r["touches"]["timeline"] if t["followed_count"]]
    md += ["", "## Work and what followed it", "", f"{r['touches']['count']} touch(es) logged. A touch is listed with outcomes of the same kind in the {FOLLOW_DAYS} days after it: followed, not necessarily caused.", ""]
    md += [f"- {t['date']} {t['kind']}: {(t['summary'] or t['next_step']).rstrip('.')}. Followed by {t['followed_count']}: {'; '.join(t['followed_by'][:4])}." for t in tl] or ["- No outcome with a date followed a logged touch."]
    md += ["", "## What did not move", ""] + ([f"- {x}" for x in r["remaining"]] or ["- Nothing significant."])
    text = "\n".join(md) + "\n"
    if not html:
        return text
    from html import escape as e
    body: list[str] = []
    in_list = False
    for line in md:
        if in_list and not line.startswith("- "):
            body.append("</ul>")
            in_list = False
        if line.startswith("- ") and not in_list:
            body.append("<ul>")
            in_list = True
        if line.startswith("# "):
            body.append(f"<h1>{e(line[2:])}</h1>")
        elif line.startswith("## "):
            body.append(f"<h2>{e(line[3:])}</h2>")
        elif line.startswith("- "):
            body.append(f"<li>{e(line[2:])}</li>")
        elif line:
            body.append(f"<p>{e(line)}</p>")
    if in_list:
        body.append("</ul>")
    css = "body{font:15px/1.55 system-ui,sans-serif;color:#111;max-width:780px;margin:32px auto;padding:0 16px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin-top:26px;border-bottom:1px solid #ddd;padding-bottom:4px}li{margin:4px 0}footer{margin-top:28px;color:#666;font-size:12px}"
    return ("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            f"<title>{e(md[0][2:])}</title><style>{css}</style></head><body>" + "".join(body)
            + "<footer>Prepared with Beyond 90 from two snapshots of the same customer's data.</footer></body></html>\n")


def maybe(old: Optional[CustomerData], new: CustomerData, cat: Catalogue) -> Optional[dict[str, Any]]:
    return receipt(old, new, cat) if old is not None else None
