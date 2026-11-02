"""Did the numbers move because the customer did, or because the export changed?

A quarter-on-quarter comparison is only as good as the two exports behind it. A truncated file, a changed filter or a
renamed column can make Yield jump for no reason a customer would recognise, and nothing is more expensive in a
review than defending a number that turns out to be an artefact. These checks compare the two sets of inputs and say
what changed in them, before anyone reads the score.

They look for exactly the things that suggest an artefact: units that disappeared, far fewer inventory rows, open
findings that vanished without being closed, an older date. They are notes to look at, not errors.
"""

from __future__ import annotations

from typing import Any

from .models import CustomerData

REMOVED_SHARE = 0.10
INVENTORY_DROP = 0.25
VANISHED_FINDINGS = 0.10


def _item(id: str, status: str, text: str) -> dict[str, str]:
    return {"id": id, "status": status, "text": text}


def input_drift(new: CustomerData, old: CustomerData, terms: dict[str, str] | None = None) -> dict[str, Any]:
    unit, units = (terms or {}).get("unit", "account"), (terms or {}).get("units", "accounts")
    items: list[dict[str, str]] = []
    if new.as_of <= old.as_of:
        items.append(_item("dates", "warn", f"The comparison file is dated {old.as_of}, which is not before {new.as_of}; the change cannot be read as progress."))

    new_ids = {a.id for a in new.accounts if a.status == "active"}
    old_ids = {a.id for a in old.accounts if a.status == "active"}
    gone_active = old_ids - new_ids
    decommissioned = {a.id for a in new.accounts if a.status != "active"} & gone_active
    vanished = gone_active - decommissioned
    added = new_ids - old_ids
    if old_ids and len(vanished) >= max(3, REMOVED_SHARE * len(old_ids)):
        items.append(_item("vanished_units", "warn", f"{len(vanished)} of {len(old_ids)} {units} in the earlier file are missing now without being marked decommissioned. "
                           "If that is a change of export rather than a change in the estate, Yield moved for the wrong reason."))
    elif vanished:
        items.append(_item("vanished_units", "note", f"{len(vanished)} {unit}(s) from the earlier file are missing now and not marked decommissioned."))
    if added:
        items.append(_item("new_units", "note", f"{len(added)} {unit}(s) are new since {old.as_of}. New, unconnected {units} lower L1 by being counted, which is the point."))

    if old.inventory and len(new.inventory) < (1 - INVENTORY_DROP) * len(old.inventory):
        items.append(_item("inventory_drop", "warn", f"Inventory has {len(new.inventory)} rows against {len(old.inventory)} before. A drop that size is more often a narrower export than a real change."))
    if old.activations and len(new.activations) < (1 - INVENTORY_DROP) * len(old.activations):
        items.append(_item("activation_drop", "warn", f"Activations have {len(new.activations)} rows against {len(old.activations)} before."))

    old_open = {f.id for f in old.findings if f.closed_at is None}
    new_by_id = {f.id: f for f in new.findings}
    vanished_f = {i for i in old_open if i not in new_by_id}
    if old_open and len(vanished_f) >= max(3, VANISHED_FINDINGS * len(old_open)):
        items.append(_item("vanished_findings", "warn", f"{len(vanished_f)} of {len(old_open)} findings that were open before are absent now, neither open nor closed. They may have been dropped from the export."))
    elif vanished_f:
        items.append(_item("vanished_findings", "note", f"{len(vanished_f)} finding(s) that were open before are absent now."))
    reopened = [i for i in old_open if i in new_by_id and new_by_id[i].opened_at != next(f.opened_at for f in old.findings if f.id == i)]
    if reopened:
        items.append(_item("reopened", "note", f"{len(reopened)} finding(s) have a different opening date than before; time-to-fix figures for them are unreliable."))

    status = "warn" if any(i["status"] == "warn" for i in items) else "note" if items else "ok"
    return {"since": old.as_of.isoformat(), "status": status, "items": items}


def md_drift(d: dict[str, Any] | None) -> list[str]:
    if not d:
        return []
    L = [f"## Did the inputs change since {d['since']}?", ""]
    if not d["items"]:
        return L + ["No sign that the two exports differ in ways that would distort the comparison.", ""]
    L += [f"- **{i['status']}**: {i['text']}" for i in d["items"]]
    return L + ["", "*These look for artefacts of the export, not for progress. Check them before presenting the change.*", ""]


def html_drift(d: dict[str, Any] | None) -> str:
    from html import escape as e
    if not d:
        return ""
    body = ("<p>No sign that the two exports differ in ways that would distort the comparison.</p>" if not d["items"]
            else "<ul>" + "".join(f'<li><strong>{e(i["status"])}</strong>: {e(i["text"])}</li>' for i in d["items"]) + "</ul>"
            '<p class="warn">These look for artefacts of the export, not for progress. Check them before presenting the change.</p>')
    return f'<section aria-labelledby="dr"><h2 id="dr">Did the inputs change since {e(d["since"])}?</h2>{body}</section>'
