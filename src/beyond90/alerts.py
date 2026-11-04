"""What deserves a message after a run.

An automated pipeline that reports everything every time is ignored within a week. These rules speak only when
something changed or something needs a person: a source could not be read, the level moved, Yield moved by two
points or more, a critical finding with no owner appeared, a renewal turned risky or is a month away, the inputs
look different in a way that suggests an export problem, or the inputs became weak.
"""

from __future__ import annotations

from typing import Any, Optional

ORDER = {"basic": 0, "bronze": 1, "silver": 2, "gold": 3}


def _a(key: str, level: str, text: str) -> dict[str, str]:
    return {"key": key, "level": level, "text": text}


def compute_alerts(*, score: Any, metrics: dict[str, Optional[float]], previous: Optional[dict[str, Any]], sync_problems: list[dict[str, Any]],
                   drift: Optional[dict[str, Any]], renewal: Optional[dict[str, Any]], dropped: Optional[dict[str, int]] = None,
                   onboarding: Optional[dict[str, Any]] = None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for p in sync_problems:
        if p["status"] == "stale":
            out.append(_a(f"stale:{p['name']}", "warn", f"Source {p['name']} could not be read and its data is {p['age_days']} day(s) old: {p['error']}"))
        elif p["status"] == "failed":
            out.append(_a(f"failed:{p['name']}", "warn", f"Source {p['name']} could not be read and has no earlier copy: {p['error']}"))
    for t, n in (dropped or {}).items():
        out.append(_a(f"dropped:{t}", "warn", f"{n} {t} row(s) were dropped because their account is not in the account list. If the list is incomplete, that is the finding."))
    level = (score.rubric or {}).get("level")
    if previous and level and previous.get("level") and previous["level"] != level:
        down = ORDER.get(level, 0) < ORDER.get(previous["level"], 0)
        out.append(_a("level", "warn" if down else "info", f"Maturity level {'fell' if down else 'rose'} from {previous['level']} to {level}."))
    if previous and previous.get("yield") is not None:
        d = (score.yield_ - previous["yield"]) * 100
        if abs(d) >= 2.0:
            out.append(_a("yield", "warn" if d < 0 else "info", f"Yield moved {d:+.1f} points since {previous['as_of']} ({score.yield_:.1%})."))
    cu = metrics.get("critical_unowned")
    if cu and (previous is None or cu > (previous.get("critical_unowned") or 0)):
        out.append(_a("critical_unowned", "warn", f"{int(cu)} open critical finding(s) have no owner."))
    if renewal and renewal["status"] == "at_risk" and (renewal["days"] <= 30 or not previous or previous.get("renewal_status") != "at_risk"):
        out.append(_a("renewal", "warn", f"Renewal on {renewal['date']} ({renewal['days']} days) is at risk: " +
                      ", ".join(s["label"].lower() for s in renewal["signals"] if s["status"] == "risk") + "."))
    if drift:
        for i in drift["items"]:
            if i["status"] == "warn":
                out.append(_a(f"drift:{i['id']}", "warn", i["text"]))
    if onboarding and onboarding.get("has_detail"):
        broken = onboarding.get("listed_but_broken") or []
        before = set((previous or {}).get("broken_connectors") or [])
        new = [b for b in broken if b not in before]
        if new:
            out.append(_a("connectors", "warn", f"{len(new)} connector(s) that worked are now failing: {', '.join(new[:6])}."))
        soon = [s for s in onboarding.get("secrets") or [] if s["days_left"] <= 14]
        if soon:
            out.append(_a("secrets", "warn", f"{len(soon)} connector secret(s) expire within 14 days or already have: " + ", ".join(f"{s['connector']} ({s['expires_on']})" for s in soon[:5]) + "."))
        crit = [x for x in onboarding.get("security") or [] if x["severity"] == "critical"]
        if crit and not (previous and previous.get("connector_critical")):
            out.append(_a("connector_security", "warn", f"{len(crit)} connector(s) have administrative rights at the organization level; they only need to read."))
    weak = (score.quality or {}).get("weak", 0)
    if weak and not (previous and previous.get("quality_weak")):
        out.append(_a("quality", "warn", f"{weak} input check(s) are weak; some figures may mislead."))
    return out


def render_message(customer: str, as_of: str, score: Any, alerts: list[dict[str, str]]) -> str:
    level = (score.rubric or {}).get("level", "")
    head = f"Beyond 90, {customer}, {as_of}: Yield {score.yield_:.1%}" + (f", level {level}" if level else "")
    if not alerts:
        return head + ". Nothing needs attention."
    return head + "\n" + "\n".join(f"- [{a['level']}] {a['text']}" for a in alerts)
