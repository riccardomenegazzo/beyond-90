"""How far to trust this number.

A score is only as good as the files behind it. Most wrong adoption figures are not arithmetic
mistakes; they are an export that was stale, a list that came from the platform itself, or a column
that was never filled in. These checks look for that, so the score arrives with its own caveats.

Each check returns a status: ``ok``, ``note`` (worth knowing) or ``weak`` (the number may mislead).
The overall confidence is ``high`` with no weak or note checks, ``low`` with any weak check, and
``medium`` otherwise. Confidence says how much to trust the *inputs*; it does not move the score.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Optional

from .models import INDEPENDENT_SOURCES, CustomerData
from .terms import say

STALE_DAYS = 21


def _check(id: str, status: str, title: str, detail: str) -> dict[str, str]:
    return {"id": id, "status": status, "title": title, "detail": detail}


def assess(data: CustomerData, terms: Optional[Mapping[str, str]] = None) -> dict[str, Any]:
    s = data.settings
    active = [a for a in data.accounts if a.status == "active"]
    connected = [a for a in active if a.connected]
    checks: list[dict[str, str]] = []

    # 1. Where does the denominator come from?
    present = [x for x in INDEPENDENT_SOURCES if any(x in a.sources for a in active)]
    if not active:
        checks.append(_check("universe", "weak", "No accounts", "accounts.csv has no active rows, so nothing is measured."))
    elif not present:
        checks.append(_check("universe", "weak", "The account list is not independent", "No account comes from billing, the organization or SSO. If the list is what the platform already knows, L1 is 100% by construction."))
    elif len(present) == 1:
        checks.append(_check("universe", "note", "One independent source", f"Only {present[0]} is present, so accounts that source misses cannot be estimated. Add a second list (billing, organization or SSO)."))
    else:
        checks.append(_check("universe", "ok", "Independent sources", f"{', '.join(present)} are present."))

    # 2. Is inventory there for the accounts that are connected?
    if connected:
        if not data.inventory:
            checks.append(_check("inventory", "weak", "No inventory", "inventory.csv is missing or empty: L2 is not measured, not zero."))
        else:
            with_rows = {r.account_id for r in data.inventory}
            share = sum(1 for a in connected if a.id in with_rows) / len(connected)
            if share < 0.5:
                checks.append(_check("inventory", "weak", "Inventory covers few connected accounts", f"Only {share:.0%} of connected accounts have inventory rows; L2 reflects the export more than the estate."))
            elif share < 0.9:
                checks.append(_check("inventory", "note", "Inventory is incomplete", f"{share:.0%} of connected accounts have inventory rows."))
            else:
                checks.append(_check("inventory", "ok", "Inventory covers the connected accounts", f"{share:.0%} of connected accounts have rows."))

        # 3. Activations
        if not data.activations:
            checks.append(_check("activations", "weak", "No activations", "activations.csv is missing or empty: L3 is not measured, not zero."))
        else:
            with_acts = {r.account_id for r in data.activations}
            share = sum(1 for a in connected if a.id in with_acts) / len(connected)
            status = "weak" if share < 0.5 else "note" if share < 0.9 else "ok"
            checks.append(_check("activations", status, "Activations cover the connected accounts" if status == "ok" else "Activations are incomplete", f"{share:.0%} of connected accounts have activation rows."))

    # 4. Findings: present, fresh, and filled in
    if data.findings:
        newest = max([f.opened_at for f in data.findings] + [f.closed_at for f in data.findings if f.closed_at])
        age = (data.as_of - newest).days
        if age > STALE_DAYS:
            checks.append(_check("freshness", "weak" if age > 3 * STALE_DAYS else "note", "Findings export looks old", f"The newest finding event is {age} days before {data.as_of}. Is the export current?"))
        else:
            checks.append(_check("freshness", "ok", "Findings are recent", f"The newest finding event is {max(age, 0)} days before {data.as_of}."))
        older = [f for f in data.findings if (data.as_of - f.opened_at).days > s.triage_window_days and f.closed_at is None]
        if len(older) >= 5 and not any(f.owner for f in older) and not any(f.decision for f in older):
            checks.append(_check("columns", "weak", "No finding has an owner or a decision", f"All {len(older)} open findings past the triage window lack both. If the export does not carry these columns, L4 is understated."))
        else:
            checks.append(_check("columns", "ok", "Owner and decision columns are used", "At least some findings carry an owner or a decision, or there are too few to tell."))
    else:
        checks.append(_check("findings", "note", "No findings", "findings.csv is missing or empty: L4 and the outcomes are not measured."))

    # 5. Granularity: with few accounts, one account is a large step.
    if 0 < len(active) < 8:
        checks.append(_check("granularity", "note", "Few accounts", f"With {len(active)} accounts, each one moves L1 by {100 / len(active):.0f} points. Read the percentages as counts."))

    # 6. A forgotten account list: accounts with spend but nothing else.
    silent = [a for a in active if not a.connected and a.last_spend <= 0 and not a.owner]
    if len(silent) >= max(3, len(active) // 4):
        checks.append(_check("orphans", "note", "Many unconnected accounts have no owner and no spend", f"{len(silent)} of {len(active)}. They may be dead accounts that should be marked decommissioned, or they may be the ones that matter."))

    weak = sum(1 for c in checks if c["status"] == "weak")
    note = sum(1 for c in checks if c["status"] == "note")
    confidence = "low" if weak else "medium" if note else "high"
    if terms:
        checks = [{**c, "title": say(c["title"], terms), "detail": say(c["detail"], terms)} for c in checks]
    return {"confidence": confidence, "weak": weak, "notes": note, "checks": checks}
