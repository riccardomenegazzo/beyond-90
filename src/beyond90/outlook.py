"""If nothing is done: the same estate, scored on future dates, with the dated events that move it.

A score describes today. But much of what will lower it next month is already in the data and already dated: a client
secret expires, an accepted risk reaches its review date, unowned findings age into the triage window, a critical
finding passes its deadline, a promise falls due, the cadence for a call runs out, the renewal arrives. None of these
needs a forecast model: they happen by the calendar unless somebody acts.

``outlook`` moves ``as_of`` forward and scores the estate again, applying only those known, dated changes (a connector
whose secret expires stops counting as connected). It lists every event with its date and, where the score moves, by
exactly how much on that day. It never invents new findings or new accounts: the real future will add those on top,
so this is the floor of what waiting costs, not a prediction.
"""

from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import date, timedelta
from typing import Any

from .catalogue import Catalogue
from .models import CustomerData
from .rhythm import touch_status
from .scoring import compute_score, stage_l1, stage_l2, stage_l3, stage_l4

CHECKPOINTS = (0, 7, 14, 30, 60, 90)
SCORE_KINDS = {"secret_expiry", "acceptance_expiry", "triage_entry"}


def project(data: CustomerData, day: date) -> CustomerData:
    """The estate as it will be on ``day`` if nobody changes anything."""
    broken = {c.account_id for c in data.connectors if c.kind == "cloud" and c.secret_expires_on is not None and data.as_of <= c.secret_expires_on < day}
    accounts = [replace(a, connected=False) if a.id in broken and a.connected else a for a in data.accounts]
    return replace(data, as_of=day, accounts=accounts, findings=list(data.findings), connectors=list(data.connectors))


def _stages(data: CustomerData, cat: Catalogue) -> dict[str, float]:
    ceiling = data.settings.ceiling_version
    return {"L1": stage_l1(data).value, "L2": stage_l2(data, cat).value, "L3": stage_l3(data, cat, ceiling, details=False).value, "L4": stage_l4(data).value}


def _y(st: dict[str, float]) -> float:
    return st["L1"] * st["L2"] * st["L3"] * st["L4"]


def events(data: CustomerData, end: date) -> list[dict[str, Any]]:
    """Every dated change between today (excluded) and ``end`` (included) that the data already knows about."""
    start, s = data.as_of, data.settings
    out: list[dict[str, Any]] = []

    def add(day: date, kind: str, text: str, refs: list[str], who: str) -> None:
        if start < day <= end:
            out.append({"date": day.isoformat(), "kind": kind, "text": text, "refs": refs, "who": who})

    for c in data.connectors:
        if c.secret_expires_on:
            add(c.secret_expires_on + timedelta(days=1), "secret_expiry", f"The credential of the {c.kind} connector for {c.account_id} expires; the connector stops on that day.", [c.account_id], "customer")
    by_day: dict[tuple[date, str], list[str]] = {}
    for f in data.findings:
        if f.closed_at is not None:
            continue
        if f.decision == "accepted_risk" and f.expiry and f.expiry >= start:
            by_day.setdefault((f.expiry + timedelta(days=1), "acceptance_expiry"), []).append(f.id)
        enters = f.opened_at + timedelta(days=s.triage_window_days)
        if enters > start and (not f.owner or not f.decision):
            by_day.setdefault((enters, "triage_entry"), []).append(f.id)
        if f.severity in ("critical", "high"):
            due = f.opened_at + timedelta(days=s.sla_days[f.severity])
            if due >= start:
                by_day.setdefault((due + timedelta(days=1), f"sla_{f.severity}"), []).append(f.id)
    texts = {"acceptance_expiry": "accepted risk(s) reach their review date and count as expired acceptances",
             "triage_entry": "finding(s) without an owner or a decision leave the triage window and start counting in L4",
             "sla_critical": "critical finding(s) pass their remediation deadline", "sla_high": "high finding(s) pass their remediation deadline"}
    for (day, kind), ids in sorted(by_day.items()):
        add(day, kind, f"{len(ids)} {texts[kind]}.", sorted(ids), "customer")
    for k in data.commitments:
        if k.done_on is None:
            add(k.due_on + timedelta(days=1), "commitment", f"Our promise is overdue: {k.description}.", [k.id], "us")
    t = touch_status(data)
    if t["last_touch"]:
        add(date.fromisoformat(t["last_touch"]) + timedelta(days=t["cadence_days"] + 1), "cadence", f"The touch cadence ({t['cadence_days']} days) runs out.", [], "us")
    if data.renewal_date:
        add(data.renewal_date, "renewal", "Renewal date.", [], "both")
    out.sort(key=lambda e: (e["date"], e["kind"]))
    return out


def outlook(data: CustomerData, cat: Catalogue, horizon: int = 90) -> dict[str, Any]:
    end = data.as_of + timedelta(days=horizon)
    evs = events(data, end)
    today = _stages(data, cat)
    # The exact effect of each day with score-moving events: score the day before and the day itself.
    days = sorted({date.fromisoformat(e["date"]) for e in evs if e["kind"] in SCORE_KINDS})
    for d in days:
        before = _stages(project(data, d - timedelta(days=1)), cat)
        after = _stages(project(data, d), cat)
        moved = round((_y(after) - _y(before)) * 100, 2)
        stages = {k: round((after[k] - before[k]) * 100, 2) for k in after if abs(after[k] - before[k]) > 1e-9}
        for e in evs:
            if e["date"] == d.isoformat() and e["kind"] in SCORE_KINDS:
                e["points"], e["stages"] = moved, stages
    curve = []
    for k in CHECKPOINTS:
        if k > horizon:
            continue
        d = data.as_of + timedelta(days=k)
        p = project(data, d)
        st = _stages(p, cat)
        entry: dict[str, Any] = {"day": k, "date": d.isoformat(), "yield": _y(st), "stages": st}
        if k in (0, 30, 60, 90):
            sc = compute_score(p, cat)
            entry["level"] = (sc.rubric or {}).get("level", "")
        curve.append(entry)
    drops = [e for e in evs if e.get("points", 0) < 0]
    worst = min(drops, key=lambda e: e["points"]) if drops else None
    level_change = next(((c["date"], c["level"]) for c in curve if c.get("level") and c["level"] != curve[0].get("level")), None)
    end_y = curve[-1]["yield"]
    summary = (f"If nothing is done, Yield goes from {_y(today):.1%} to {end_y:.1%} by {curve[-1]['date']}."
               + (f" The largest single drop is on {worst['date']} ({worst['points']:+.1f} points): {worst['text']}" if worst else " Nothing already dated lowers it.")
               + (f" The maturity level changes to {level_change[1]} around {level_change[0]}." if level_change else ""))
    return {"horizon_days": horizon, "curve": curve, "events": evs, "summary": summary,
            "first_drop": drops[0] if drops else None, "loss_points": round((end_y - _y(today)) * 100, 2),
            "note": "Only changes already dated in the data are applied; new findings and new accounts will come on top."}


def ics(evs: list[dict[str, Any]], customer: str) -> str:
    """The events as a calendar file, so they land where the work is planned."""
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", " ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Beyond 90//outlook//EN", "CALSCALE:GREGORIAN"]
    for i, e in enumerate(evs):
        day = e["date"].replace("-", "")
        nxt = (date.fromisoformat(e["date"]) + timedelta(days=1)).isoformat().replace("-", "")
        effect = f" ({e['points']:+.1f} pts)" if e.get("points") else ""
        lines += ["BEGIN:VEVENT", f"UID:b90-{day}-{i}-{hashlib.sha256((customer + e['kind'] + e['date']).encode()).hexdigest()[:12]}@beyond90", f"DTSTAMP:{day}T080000Z",
                  f"DTSTART;VALUE=DATE:{day}", f"DTEND;VALUE=DATE:{nxt}", f"SUMMARY:{esc(customer + ': ' + e['text'][:120] + effect)}",
                  f"DESCRIPTION:{esc(e['text'] + (' Refs: ' + ', '.join(e['refs'][:20]) if e['refs'] else ''))}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
