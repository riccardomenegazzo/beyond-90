"""Each customer team's part: what it owns, where its gaps are, and a message it can act on.

Adoption is not decided in one conversation with the champion. It is decided in a dozen teams that own accounts,
clusters and findings, and most of them never see the TAM's report. This module splits the estate by owner (the
``owner`` of each account, which should match a team id), and for every team lists its accounts and spend, what is not
connected, what is stuck in onboarding and why, the coverage and capabilities missing on its accounts, its critical
findings with no owner or decision, and the dated events that fall on it. Teams are ranked by stake: unconnected spend
first, then critical gaps. Each gets a short message, addressed to its contact when contacts.csv names one, with the
three asks that matter most for that team only.
"""

from __future__ import annotations

from typing import Any, Optional

from .models import CustomerData
from .scoring import classify_finding

SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def digests(data: CustomerData, onboarding: Optional[dict[str, Any]] = None, outlook: Optional[dict[str, Any]] = None,
            stake: Optional[dict[str, Any]] = None, units: str = "accounts") -> dict[str, Any]:
    active = [a for a in data.accounts if a.status == "active"]
    owner_of = {a.id: (a.owner or "unassigned") for a in active}
    total_spend = sum(a.last_spend for a in active) or 0.0
    team_names = {t.id: t.name for t in data.teams}
    contacts: dict[str, list[dict[str, str]]] = {}
    for c in data.contacts:
        if c.team:
            contacts.setdefault(c.team.strip().lower(), []).append({"id": c.id, "name": c.name, "role": c.role})
    onb_rows = {r["id"]: r for r in (onboarding or {}).get("accounts", [])}
    gaps = {r["id"]: r for r in (stake or {}).get("heaviest_accounts", [])}
    window = data.settings.triage_window_days
    teams: dict[str, dict[str, Any]] = {}

    def team(tid: str) -> dict[str, Any]:
        if tid not in teams:
            teams[tid] = {"id": tid, "name": team_names.get(tid, tid.replace("-", " ").title() if tid != "unassigned" else "No owner on record"),
                          "contacts": contacts.get(tid.lower(), []), "accounts": 0, "spend": 0.0, "unconnected": [], "unconnected_spend": 0.0,
                          "blocked": [], "gaps": [], "findings": [], "events": []}
        return teams[tid]

    for a in active:
        t = team(owner_of[a.id])
        t["accounts"] += 1
        t["spend"] += a.last_spend
        if not a.connected:
            t["unconnected"].append(a.id)
            t["unconnected_spend"] += a.last_spend
        r = onb_rows.get(a.id)
        if r and r.get("issue") and r["stage"] != "complete":
            t["blocked"].append({"account": a.id, "stage": r["stage"], "issue": r["issue"]})
        g = gaps.get(a.id)
        if g and g["gap"] != "not connected":
            t["gaps"].append({"account": a.id, "gap": g["gap"]})
    for f in data.findings:
        if f.closed_at is not None or f.account_id not in owner_of or f.severity not in ("critical", "high"):
            continue
        if (data.as_of - f.opened_at).days >= window and classify_finding(f, data.as_of) != "ok":
            team(owner_of[f.account_id])["findings"].append({"id": f.id, "account": f.account_id, "severity": f.severity, "exposure": f.exposure,
                                                             "state": classify_finding(f, data.as_of)})
    fid_owner = {f.id: owner_of.get(f.account_id) for f in data.findings}
    for e in (outlook or {}).get("events", []):
        owners: set[str] = {o for x in e.get("refs", []) if (o := owner_of.get(x) or fid_owner.get(x))}
        for o in sorted(owners):
            team(o)["events"].append({"date": e["date"], "kind": e["kind"], "text": e["text"]})
    titles = {c["issue"]: c["title"] for c in (onboarding or {}).get("causes", [])}
    out = []
    for t in teams.values():
        t["findings"].sort(key=lambda f: (SEV_ORDER[f["severity"]], f["exposure"] != "internet", f["id"]))
        t["events"] = sorted(t["events"], key=lambda e: e["date"])[:6]
        t["spend_share"] = t["spend"] / total_spend if total_spend else 0.0
        t["unconnected_share"] = t["unconnected_spend"] / total_spend if total_spend else 0.0
        crit = sum(1 for f in t["findings"] if f["severity"] == "critical")
        t["stake"] = round(100 * t["unconnected_share"] + 5 * crit + 2 * len(t["blocked"]) + len(t["findings"]) * 0.5, 2)
        t["asks"] = _asks(t, units, titles)
        t["message"] = _message(t, data.name, units)
        out.append(t)
    out.sort(key=lambda t: (-t["stake"], t["id"]))
    return {"teams": out, "unassigned": next((t for t in out if t["id"] == "unassigned"), None) is not None}


def _n(n: int, units: str) -> str:
    return f"{n} {units[:-1] if n == 1 and units.endswith('s') else units}"


FRIENDLY = {"triage_entry": "finding(s) on your {units} reach their triage date without an owner or a decision",
            "acceptance_expiry": "accepted risk(s) on your {units} reach their review date",
            "sla_critical": "critical finding(s) pass their remediation deadline", "sla_high": "high finding(s) pass their remediation deadline",
            "secret_expiry": "a connector credential expires and the connector stops"}


def _asks(t: dict[str, Any], units: str, titles: Optional[dict[str, str]] = None) -> list[str]:
    asks = []
    titles = titles or {}
    if t["unconnected"]:
        asks.append(f"Connect {_n(len(t['unconnected']), units)} ({', '.join(t['unconnected'][:5])}{'…' if len(t['unconnected']) > 5 else ''})"
                    + (f", {t['unconnected_spend']:,.0f} of monthly spend" if t["unconnected_spend"] else "") + ".")
    blocked = [b for b in t["blocked"] if b["issue"] != "not_deployed"]
    if blocked:
        causes = sorted({(lambda x: x[:1].lower() + x[1:])(titles.get(b["issue"], b["issue"].replace("_", " ")).rstrip(".")) for b in blocked})
        asks.append(f"Unblock {len(blocked)} connector{'s' if len(blocked) != 1 else ''} stuck in onboarding: {'; '.join(causes[:3])}.")
    crit = [f for f in t["findings"] if f["severity"] == "critical"]
    if crit:
        asks.append(f"Give {len(crit)} critical finding{'s' if len(crit) != 1 else ''} an owner and a decision ({', '.join(f['id'] for f in crit[:4])}"
                    + (", internet-facing first" if any(f["exposure"] == "internet" for f in crit) else "") + ").")
    elif t["findings"]:
        asks.append(f"Decide on {len(t['findings'])} high finding{'s' if len(t['findings']) != 1 else ''} past the triage date.")
    if t["gaps"] and len(asks) < 3:
        asks.append(f"Close coverage gaps on {_n(len(t['gaps']), units)} ({t['gaps'][0]['account']}: {t['gaps'][0]['gap']}).")
    return asks[:3]


def _message(t: dict[str, Any], customer: str, units: str) -> str:
    who = t["contacts"][0]["name"].split()[0] if t["contacts"] else "team"
    if not t["asks"]:
        return f"Hi {who}, a quick note: nothing on the {t['name']} side needs action this month. Thank you, it shows."
    lines = [f"Hi {who},", "", f"A short note on the {t['name']} part of {customer}'s security platform rollout: {_n(t['accounts'], units)}"
             + (f", {t['spend_share']:.0%} of the cloud spend" if t["spend_share"] else "") + ". "
             + {1: "One thing would make the biggest difference:", 2: "Two things would make the biggest difference:"}.get(len(t["asks"]), "Three things would make the biggest difference:"), ""]
    lines += [f"{i}. {a}" for i, a in enumerate(t["asks"], 1)]
    if t["events"]:
        e = t["events"][0]
        lines += ["", f"Coming up on {e['date']}: {FRIENDLY.get(e['kind'], e['text']).format(units=units)}."]
    lines += ["", "Happy to go through any of it together, whenever suits you.", ""]
    return "\n".join(lines)
