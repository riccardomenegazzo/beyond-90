"""Renewal readiness: the leading indicators, laid out with their evidence.

Customer-success practice agrees that a renewal is rarely decided at quote time. Months earlier, a few
signals already say how it will go: whether the product is used and the licences are consumed, whether an
executive sponsor exists, whether more than one person knows you, whether you keep your promises, whether the
data lets you speak with confidence. This module lists those signals for one customer, each with status and
evidence, next to the renewal date and the revenue on the line.

It does not predict. With no history of renewals to learn from, a probability would be invented, so the output
is a checklist: ``ready`` (nothing to worry about), ``watch`` or ``at_risk`` (at least one signal needs a
conversation now). The status is the worst measured signal, which is the same rule the maturity ladder uses.
Statuses of signals that could not be measured are ``not measured`` and never count as good news.
"""

from __future__ import annotations

from typing import Any, Optional

from .models import CustomerData

RANK = {"ok": 0, "watch": 1, "risk": 2}


def _signal(id: str, label: str, status: str, detail: str) -> dict[str, str]:
    return {"id": id, "label": label, "status": status, "detail": detail}


def compute_renewal(data: CustomerData, score: Any, previous: Optional[dict] = None) -> Optional[dict[str, Any]]:
    if data.renewal_date is None:
        return None
    days = (data.renewal_date - data.as_of).days
    window = data.settings.renewal_window_days
    state = "passed" if days < 0 else "approaching" if days <= window else "later"
    sig: list[dict[str, str]] = []

    level = (score.rubric or {}).get("level")
    if level:
        sig.append(_signal("adoption", "Adoption level", "risk" if level == "basic" else "watch" if level == "bronze" else "ok",
                           f"Maturity level {level}" + (f"; Yield {score.yield_:.0%}" if score.stages["L1"].has_data else "") + "."))

    if score.entitlements:
        low = min(score.entitlements, key=lambda e: e["utilization"])
        target = data.settings.entitlement_target
        status = "risk" if low["utilization"] < target / 2 else "watch" if low["utilization"] < target else "ok"
        sig.append(_signal("licences", "Licences in use", status, f"The least used is {low['unit']} at {low['utilization']:.0%} of {low['licensed']:g} (target {target:.0%})."))
    else:
        sig.append(_signal("licences", "Licences in use", "not measured", "No entitlements file."))

    rel = score.relationship
    if rel:
        g = rel["gaps"]
        sig.append(_signal("sponsor", "Executive sponsor", "risk" if g["no_executive_sponsor"] else "ok",
                           "No executive sponsor is on record." if g["no_executive_sponsor"] else "An executive sponsor is on record."))
        sig.append(_signal("threads", "More than one relationship", "watch" if g["single_threaded"] else "ok",
                           f"{rel['coverage']['touched_recently']} contact(s) spoken to recently." + (" Single-threaded." if g["single_threaded"] else "")))
        late = g["overdue_commitments"]
        rate = rel["reliability"]["rate"]
        status = "risk" if (rate is not None and rate < 0.5) else "watch" if late else "ok"
        sig.append(_signal("promises", "Promises kept", status,
                           (f"{len(late)} promise(s) past their date. " if late else "") + (f"{rate:.0%} kept on time." if rate is not None else "No promises recorded.")))
        stale = g["stale_key_contacts"]
        sig.append(_signal("contact", "Key contacts reached recently", "watch" if stale else "ok", f"{len(stale)} key contact(s) not spoken to in {data.settings.contact_stale_days} days." if stale else "All key contacts spoken to recently."))
    else:
        sig.append(_signal("relationship", "Relationship", "not measured", "No contacts file."))

    o = score.outcomes
    if o["findings_total"]:
        overdue = (score.rubric or {}).get("checks") and next((c["value"] for c in score.rubric["checks"] if c["metric"] == "critical_overdue"), None)
        status = "watch" if overdue else "ok"
        sig.append(_signal("outcomes", "Critical findings handled", status, f"{o['critical_open']} critical open" + (f", {int(overdue)} past deadline." if overdue else ".")))
    else:
        sig.append(_signal("outcomes", "Critical findings handled", "not measured", "No findings file."))

    if previous is not None and previous.get("yield") is not None:
        drop = (previous["yield"] - score.yield_) * 100
        status = "risk" if drop >= 5 else "watch" if drop >= 2 else "ok"
        sig.append(_signal("trend", "Direction of travel", status, f"Yield moved {-drop:+.1f} points since {previous['as_of']}."))

    q = score.quality or {}
    sig.append(_signal("confidence", "Confidence in the numbers", "watch" if q.get("weak") else "ok",
                       f"{q.get('weak', 0)} weak input check(s)." if q.get("weak") else "Inputs pass the checks that matter."))

    measured = [s for s in sig if s["status"] in RANK]
    worst = max((RANK[s["status"]] for s in measured), default=0)
    status = ("ready", "watch", "at_risk")[worst]
    headroom = [u["label"] for u in (score.views or {}).get("use_cases", []) if u["state"] in ("not started", "early")][:4]
    return {
        "date": data.renewal_date.isoformat(), "days": days, "window_days": window, "state": state, "arr": data.arr, "status": status,
        "arr_at_risk": data.arr if (status == "at_risk" and state in ("approaching", "passed")) else 0.0,
        "signals": sig, "headroom": headroom,
        "not_measured": [s["id"] for s in sig if s["status"] == "not measured"],
    }
