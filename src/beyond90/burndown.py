"""How fast risk is being retired: what is open, how old, how long fixes take, and whether the customer is at zero.

Coverage (Yield) says what is connected and decided. This says whether the findings that matter are going away.
It reads only the findings already loaded and rebuilds the past from their open and close dates, so it needs no history file.

Everything it reports is plain arithmetic on dates:

* open now, by severity, and how many of them are past a target age (the SLA targets are printed, and are a default
  the customer should replace with its own: critical 7 days, high 30, medium 90, low 180);
* age buckets of what is open;
* time to fix: the mean days from opened to closed for findings closed in the last 90 days, with the count behind it
  (no figure when fewer than 3 closed, because a mean of one or two is an anecdote);
* a six-month flow: opened, closed and how many critical and high were still open at each month end;
* whether the customer is at zero critical findings now, since when, or when it last was.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Optional

from .models import CLOSED_BY, CustomerData, Finding

SEVERITIES = ("critical", "high", "medium", "low")
DEFAULT_SLA = {"critical": 7, "high": 30, "medium": 90, "low": 180}
BUCKETS = (("0-7", 0, 7), ("8-30", 8, 30), ("31-90", 31, 90), ("91+", 91, 10**9))
MTTR_WINDOW_DAYS = 90
MTTR_MIN = 3
MONTHS = 6
CLOSURE_DAYS = 180


def _open_on(f: Finding, day: date) -> bool:
    return f.opened_at <= day and (f.closed_at is None or f.closed_at > day)


def _month_end(year: int, month: int) -> date:
    nxt = date(year + (month == 12), month % 12 + 1, 1)
    return nxt - timedelta(days=1)


def _months_back(end: date, n: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    y, m = end.year, end.month
    for _ in range(n):
        out.append((y, m))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out[::-1]


def _zero_critical(findings: list[Finding], today: date) -> dict[str, Any]:
    crit = [f for f in findings if f.severity == "critical"]
    now_open = sum(1 for f in crit if _open_on(f, today))
    if not crit:
        return {"now": True, "never_had": True, "since": None, "days": None, "last_zero": None}
    events = sorted({d for f in crit for d in (f.opened_at, f.closed_at) if d is not None and d <= today})
    zero_from: Optional[date] = None
    last_zero: Optional[date] = None
    for d in events:
        n = sum(1 for f in crit if _open_on(f, d))
        if n == 0:
            zero_from = d
            last_zero = d
        else:
            zero_from = None
    if now_open == 0:
        return {"now": True, "never_had": False, "since": str(zero_from) if zero_from else None,
                "days": (today - zero_from).days if zero_from else None, "last_zero": str(last_zero) if last_zero else None}
    return {"now": False, "never_had": False, "since": None, "days": None, "last_zero": str(last_zero) if last_zero else None}


def build(data: CustomerData, sla: Optional[dict[str, int]] = None) -> dict[str, Any]:
    today = data.as_of
    targets = {**data.settings.sla_days, **(sla or {})}
    findings = list(data.findings)
    opened = [f for f in findings if _open_on(f, today)]

    open_by = {s: sum(1 for f in opened if f.severity == s) for s in SEVERITIES}
    aging = {s: {name: 0 for name, _, _ in BUCKETS} for s in SEVERITIES}
    past = dict.fromkeys(SEVERITIES, 0)
    for f in opened:
        age = (today - f.opened_at).days
        for name, lo, hi in BUCKETS:
            if lo <= age <= hi:
                aging[f.severity][name] += 1
                break
        if age > targets.get(f.severity, 10**9):
            past[f.severity] += 1

    since = today - timedelta(days=MTTR_WINDOW_DAYS)
    mttr: dict[str, dict[str, Any]] = {}
    for s in SEVERITIES:
        done = [(f.closed_at - f.opened_at).days for f in findings if f.severity == s and f.closed_at and since <= f.closed_at <= today]
        mttr[s] = {"days": round(sum(done) / len(done), 1) if len(done) >= MTTR_MIN else None, "n": len(done)}

    flow = []
    for y, m in _months_back(today, MONTHS):
        start, end = date(y, m, 1), min(_month_end(y, m), today)
        flow.append({
            "month": f"{y:04d}-{m:02d}",
            "opened": sum(1 for f in findings if start <= f.opened_at <= end),
            "closed": sum(1 for f in findings if f.closed_at and start <= f.closed_at <= end),
            "open_critical": sum(1 for f in findings if f.severity == "critical" and _open_on(f, end)),
            "open_high": sum(1 for f in findings if f.severity == "high" and _open_on(f, end)),
        })

    horizon = today - timedelta(days=CLOSURE_DAYS)
    raised = [f for f in findings if f.severity in ("critical", "high") and (f.opened_at >= horizon or _open_on(f, today))]
    closed_f = [f for f in raised if f.closed_at is not None and f.closed_at <= today]
    tracks = any(f.verified_at is not None or f.reopened for f in findings)
    closure = {
        "window_days": CLOSURE_DAYS, "raised": len(raised), "with_owner": sum(1 for f in raised if f.owner),
        "with_decision": sum(1 for f in raised if f.decision), "closed": len(closed_f), "tracks_verification": tracks,
        "verified": sum(1 for f in closed_f if f.verified_at is not None) if tracks else None,
        "reopened": sum(1 for f in closed_f if f.reopened) if tracks else None,
        "recurrence_rate": round(sum(1 for f in closed_f if f.reopened) / len(closed_f), 3) if tracks and closed_f else None,
    }

    # How the fixes of the window were made, when the customer records it: by hand, with a tool's help, or with no one involved.
    won = [f for f in findings if f.closed_at is not None and horizon <= f.closed_at <= today]
    rungs: dict[str, Any] = {}
    for rung in CLOSED_BY:
        grp = [f for f in won if f.closed_by == rung]
        days = [(f.closed_at - f.opened_at).days for f in grp if f.closed_at]
        rungs[rung] = {"n": len(grp), "mean_days": round(sum(days) / len(days), 1) if len(days) >= 3 else None}
    tracked = sum(r["n"] for r in rungs.values())
    automation = {"window_days": CLOSURE_DAYS, "closed": len(won), "tracked": tracked, "rungs": rungs,
                  "automated_share": round(rungs["automated"]["n"] / tracked, 3) if tracked else None}

    # What needs a person's decision now: every open critical or high finding, plus any open medium past its target age.
    matter = [f for f in opened if f.severity in ("critical", "high") or (f.severity == "medium" and (today - f.opened_at).days > targets.get("medium", 10**9))]
    focus = {"raw": len(opened), "matter": len(matter), "share": round(len(matter) / len(opened), 3) if opened else None,
             "rule": "Open critical and high findings, and open medium findings older than their target age."}

    urgent = sorted((f for f in opened if f.severity in ("critical", "high")), key=lambda f: (f.opened_at, f.id))[:5]
    return {
        "as_of": str(today),
        "sla_days": targets,
        "sla_is_default": targets == DEFAULT_SLA,
        "open": open_by,
        "open_total": sum(open_by.values()),
        "aging": aging,
        "past_sla": past,
        "past_sla_total": sum(past.values()),
        "mttr": mttr,
        "mttr_window_days": MTTR_WINDOW_DAYS,
        "flow": flow,
        "closure": closure,
        "focus": focus,
        "automation": automation,
        "zero_critical": _zero_critical(findings, today),
        "unowned_urgent": sum(1 for f in opened if f.severity in ("critical", "high") and not f.owner),
        "oldest_urgent": [{"id": f.id, "account_id": f.account_id, "severity": f.severity, "age_days": (today - f.opened_at).days, "owner": f.owner} for f in urgent],
        "note": (("The target ages are the default, not necessarily the customer's own: set theirs in customer.toml (settings.sla_days) before you quote a figure. "
                  if targets == DEFAULT_SLA else "Target ages are the ones set for this customer. ")
                 + "Time to fix is shown only when at least 3 findings closed in the window."),
    }
