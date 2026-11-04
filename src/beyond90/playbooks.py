"""Turn every gap into an action.

Each action is tied to a playbook in the catalogue and carries

* an *isolated* estimate of how many points of Yield it is worth (units closed
  / stage denominator, times the other stages): a quick ranking aid;
* ``ops``: the concrete changes it makes to the data, which the simulator
  (``simulate.py``) applies to compute the *exact* effect, including how
  connecting an account first lowers other stages;
* ``effort_hours``: the planner's cost model (``base + per_unit x units``, from
  the playbook catalogue; edit it to match how you actually work).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import timedelta
from typing import Any, Optional

from .catalogue import Catalogue
from .models import CustomerData
from .scoring import Score
from .trust import NOTES, classify

ENTITLEMENT_LABELS = {
    "workloads": "workloads",
    "sensors": "runtime sensors",
    "code_seats": "code seats",
    "defend_gb": "log ingestion (GB/month)",
}


@dataclass
class Action:
    id: str
    playbook: str
    leak: str
    title: str
    detail: str
    owner: str
    units: float
    effect_points: float
    due: str
    steps: list[str] = field(default_factory=list)
    success: str = ""
    effort_hours: float = 0.0
    ops: list[dict[str, Any]] = field(default_factory=list[Any])
    cross_sell: str = ""      # expand, broaden or diversify; empty when it is not an expansion
    trust_note: str = ""
    question: str = ""        # an open question worth asking the customer about this gap
    we_commit: str = ""       # what the TAM promises to bring, with a date

    def to_dict(self, with_ops: bool = True) -> dict[str, Any]:
        d = asdict(self)
        if not with_ops:
            d.pop("ops")
        return d


def _others(score: Score, stage: str) -> float:
    p = 1.0
    for sid, st in score.stages.items():
        if sid != stage:
            p *= st.value
    return p


def _effect(score: Score, stage: str, units: float) -> float:
    den = score.stages[stage].denominator
    if den <= 0:
        return 0.0
    return round(100.0 * min(units / den, 1.0) * _others(score, stage), 2)


def _short(ids: list[str], n: int = 8) -> str:
    shown = ", ".join(ids[:n])
    return shown + (f" (+{len(ids) - n} more)" if len(ids) > n else "")


def generate_actions(data: CustomerData, score: Score, cat: Optional[Catalogue] = None) -> list[Action]:
    cat = cat or Catalogue.load()
    pb = cat.playbooks
    u = cat.terms["unit"]
    actions: list[Action] = []

    contact_teams = {c.team.strip().lower() for c in data.contacts if c.team.strip()}
    owner_of = {a.id: a.owner for a in data.accounts}

    def add(pid: str, key: str, detail: str, owner: str, units: float, effect: float,
            title: Optional[str] = None, ops: Optional[list[dict[str, Any]]] = None, people: Optional[list[str]] = None) -> None:
        p = pb[pid]
        kind = classify(p.offer, people or [], contact_teams, bool(data.contacts))
        actions.append(
            Action(
                id=f"{pid}:{key}",
                playbook=pid,
                leak=p.leak,
                title=title or p.title,
                detail=detail,
                owner=owner or "unassigned",
                units=units,
                effect_points=effect,
                due=(data.as_of + timedelta(days=p.due_days)).isoformat(),
                steps=list(p.steps),
                success=p.success,
                effort_hours=round(p.effort_base + p.effort_per_unit * units, 2),
                ops=ops or [],
                cross_sell=kind,
                trust_note=NOTES.get(kind, ""),
                question=p.question,
                we_commit=p.we_commit,
            )
        )

    # L1: group unconnected accounts by owner.
    l1 = score.stages["L1"]
    by_owner: dict[str, list[dict[str, Any]]] = {}
    for leak in l1.leaks:
        by_owner.setdefault(leak["owner"] or "unassigned", []).append(leak)
    for owner, items in sorted(by_owner.items()):
        spend = sum(i["last_spend"] for i in items)
        ids = [i["account_id"] for i in items]
        add(
            "l1_connect_account",
            owner,
            f"{len(items)} {u}(s) not connected, last spend {spend:,.0f}: {_short(ids)}.",
            owner,
            len(items),
            _effect(score, "L1", len(items)),
            title=f"Connect {len(items)} {u}(s) owned by {owner}",
            ops=[{"op": "connect", "accounts": ids}],
            people=[] if owner == "unassigned" else [owner],
        )
    recent_cut = data.as_of - timedelta(days=data.settings.new_account_days)
    recent = [i for i in l1.leaks if i["created_at"] and i["created_at"] >= recent_cut.isoformat()]
    if recent:
        add(
            "l1_auto_onboarding",
            "recent",
            f"{len(recent)} unconnected {u}(s) were created in the last {data.settings.new_account_days} days: "
            f"{_short([r['account_id'] for r in recent])}.",
            "",
            0,
            0.0,
        )

    # L2: one action per provider/resource type.
    for leak in score.stages["L2"].leaks:
        n = len(leak["accounts"])
        add(
            "l2_enable_inventory",
            f"{leak['provider']}:{leak['resource_type']}",
            f"{leak['resource_type']} is not inventoried on {n} connected {leak['provider']} {u}(s): {_short(leak['accounts'])}.",
            "",
            n,
            _effect(score, "L2", n),
            title=f"Inventory {leak['resource_type']} on {leak['provider']} ({n} {u}(s))",
            ops=[{"op": "inventory", "resource_type": leak["resource_type"], "accounts": list(leak["accounts"])}],
        )

    # L3: one action per module; new-release modules get the adoption playbook.
    for leak in score.stages["L3"].leaks:
        pid = "l3_new_release_adoption" if leak["new_since_baseline"] else "l3_enable_module"
        add(
            pid,
            leak["module"],
            f"{leak['name']} (since {leak['since']}) is relevant on {leak['relevant']} {u}(s) and inactive on "
            f"{leak['inactive']}: {_short(leak['accounts'])}.",
            "",
            leak["inactive"],
            _effect(score, "L3", leak["inactive"]),
            title=f"{'Adopt' if leak['new_since_baseline'] else 'Enable'} {leak['name']} on {leak['inactive']} {u}(s)",
            ops=[{"op": "enable", "module": leak["module"], "accounts": list(leak["accounts"])}],
            people=[owner_of.get(a, "") for a in leak["accounts"]],
        )

    # L4: per kind of leak.
    kind_to_pb = {
        "unowned": "l4_assign_owners",
        "no_decision": "l4_record_decisions",
        "accepted_without_expiry": "l4_review_accepted_risks",
        "expired_acceptance": "l4_review_accepted_risks",
    }
    kind_text = {
        "unowned": "have no owner",
        "no_decision": "have an owner but no decision",
        "accepted_without_expiry": "are accepted risks with no expiry",
        "expired_acceptance": "are accepted risks whose expiry has passed",
    }
    kind_ops = {
        "unowned": lambda ids: [{"op": "own", "findings": ids}, {"op": "decide", "findings": ids}],
        "no_decision": lambda ids: [{"op": "decide", "findings": ids}],
        "accepted_without_expiry": lambda ids: [{"op": "set_expiry", "findings": ids}],
        "expired_acceptance": lambda ids: [{"op": "set_expiry", "findings": ids}],
    }
    for leak in score.stages["L4"].leaks:
        add(
            kind_to_pb[leak["kind"]],
            leak["kind"],
            f"{leak['count']} finding(s) past the {data.settings.triage_window_days}-day triage window {kind_text[leak['kind']]}.",
            "",
            leak["count"],
            _effect(score, "L4", leak["count"]),
            title=f"{pb[kind_to_pb[leak['kind']]].title} ({leak['count']})",
            ops=kind_ops[leak["kind"]](list(leak["ids"])),
        )
    suspects = score.outcomes["reclassification_suspects"]
    if suspects:
        add(
            "l4_review_reclassifications",
            "downgrades",
            f"{len(suspects)} severity downgrade(s) landed within {data.settings.downgrade_window_days} days of an SLA deadline: "
            f"{_short([s['finding_id'] for s in suspects])}.",
            "",
            len(suspects),
            0.0,
        )

    # Reach.
    reach = score.reach
    if reach:
        team_pb = {
            "no_active_user": "reach_onboard_team",
            "no_sso": "reach_enable_sso",
            "no_scoped_role": "reach_scope_roles",
            "stale_access_review": "reach_access_review",
        }
        for gap, ids in reach["gaps"].items():
            if ids:
                add(team_pb[gap], gap, f"{len(ids)} of {reach['teams']} team(s) with {score.terms.get('estate', 'cloud')} assets: {_short(ids)}.", "", len(ids), 0.0, people=ids)

    # Relationship (reported next to Yield, not inside it).
    rel = score.relationship
    if rel:
        g = rel["gaps"]
        if g["no_executive_sponsor"]:
            add("rel_find_sponsor", "sponsor", "No executive sponsor is recorded among the contacts.", "", 1, 0.0)
        if g["stale_key_contacts"]:
            ids = g["stale_key_contacts"]
            add("rel_reconnect", "stale", f"{len(ids)} key contact(s) not spoken to in {data.settings.contact_stale_days} days: {_short(ids)}.", "", len(ids), 0.0)
        if g["single_threaded"]:
            add("rel_widen", "single", f"Only {rel['coverage']['touched_recently']} contact(s) touched in the last {data.settings.contact_stale_days} days.", "", 1, 0.0)
        if g["teams_without_a_contact"]:
            ids = g["teams_without_a_contact"]
            add("rel_introduce", "teams", f"{len(ids)} team(s) with {score.terms.get('estate', 'cloud')} assets and no contact: {_short(ids)}.", "", len(ids), 0.0, people=ids)
        if g["overdue_commitments"]:
            ids = g["overdue_commitments"]
            add("rel_close_commitments", "overdue", f"{len(ids)} commitment(s) past their date: {_short(ids)}.", "", len(ids), 0.0)
        for comp, ids in g["weak_by_component"].items():
            add(f"rel_improve_{comp}", comp, f"The component that would help most for {len(ids)} influential contact(s): {_short(ids)}.", "", len(ids), 0.0)

    # Entitlements.
    for e in score.entitlements:
        if e["below_target"]:
            label = ENTITLEMENT_LABELS.get(e["unit"], e["unit"])
            add(
                "ent_adoption_gap",
                e["unit"],
                f"{label}: {e['used']:g} of {e['licensed']:g} in use ({e['utilization']:.0%}), target {e['target']:.0%}; "
                f"{e['unused']:g} unused.",
                "",
                e["unused"],
                0.0,
                title=f"Close the {label} utilization gap",
            )

    actions.sort(key=lambda a: (-a.effect_points, a.leak, a.id))
    return actions
