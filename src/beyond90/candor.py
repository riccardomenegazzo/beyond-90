"""What to say plainly.

Most customer reviews are built to look good. Trust is built the other way round:
the advisor who volunteers the worse number, names the option that costs them
revenue, warns about the dip before it happens and says "I don't know" has shown,
in a way no claim can, that their attention is on the customer and not on
themselves. In *The Trusted Advisor*'s terms these are the cheapest ways to lower
self-orientation and to raise credibility (tell the whole truth, do not
exaggerate, say quickly when you do not know).

This module reads the score and lists, with the evidence, the things a TAM should
say plainly to the customer in the next review. Each item says what to say, why it
is true, and why saying it matters. It never invents a problem: an item appears
only when the data supports it, and an account in good shape gets an empty list.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

from .attribution import Attribution
from .catalogue import Catalogue
from .models import CustomerData
from .planner import Plan
from .scoring import Score


@dataclass
class CandorItem:
    kind: str
    say: str
    evidence: str
    why: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


def _pct(v: float) -> str:
    return f"{v * 100:.0f}%" if abs(v * 100 - round(v * 100)) < 0.05 else f"{v * 100:.1f}%"


def not_relevant_modules(data: CustomerData, cat: Catalogue) -> list[tuple[str, str, str]]:
    """Modules at the ceiling that apply to none of the customer's connected accounts: (id, name, what it needs)."""
    present: dict[str, set[str]] = {}
    for r in data.inventory:
        if r.inventoried and r.count > 0:
            present.setdefault(r.account_id, set()).add(r.resource_type)
    connected = [a for a in data.accounts if a.status == "active" and a.connected]
    if not connected or not data.inventory:
        return []
    out = []
    for m in cat.modules_at(data.settings.ceiling_version):
        if not m.requires_any:
            continue
        hit = any(a.provider in m.providers and present.get(a.id, set()) & set(m.requires_any) for a in connected)
        if not hit:
            out.append((m.id, m.name, " or ".join(m.requires_any)))
    return out


def candor_items(
    score: Score,
    data: CustomerData,
    cat: Catalogue,
    *,
    plan: Optional[Plan] = None,
    forecast: Optional[dict[str, Any]] = None,
    attribution: Optional[Attribution] = None,
) -> list[CandorItem]:
    items: list[CandorItem] = []
    unit, units = cat.terms["unit"], cat.terms["units"]

    if score.naive is not None and score.naive - score.yield_ >= 0.10:
        l1 = score.stages["L1"]
        items.append(CandorItem(
            "legacy_overstates",
            f"The figure we have been reporting, {_pct(score.naive)}, overstates adoption. The real figure is {_pct(score.yield_)}.",
            f"The legacy figure counts only {units} that were in the onboarding plan. The full universe is {l1.denominator:g} {units}, and gaps in "
            "inventory, controls and findings come on top.",
            "Volunteering a worse number than the one on the dashboard is the clearest sign you are not managing their impression of you.",
        ))

    unused = [e for e in score.entitlements if e["below_target"]]
    if unused:
        said = "; ".join(f"{e['used']:g} of {e['licensed']:g} {e['unit']} ({_pct(e['utilization'])})" for e in unused)
        items.append(CandorItem(
            "unused_licence",
            f"You are using {said}. Either we help you put the rest to work, or you may want to pay for less.",
            "Utilization against targets of " + ", ".join(sorted({_pct(e['target']) for e in unused})) + ".",
            "Naming the option of a smaller purchase shows your attention is on their outcome, not on your revenue.",
        ))

    u = score.universe
    if u and u.get("estimable") and u["unseen_estimate"] >= 1:
        items.append(CandorItem(
            "hidden_accounts",
            f"We think around {u['unseen_estimate']:.0f} {unit}(s) are known to none of our lists. If they are unconnected, the real L1 is {_pct(u['pessimistic_l1'])}.",
            f"{u['seen_by_one']} of {u['observed']} known {units} appear in only one of billing, the organization and SSO ({u['method']}).",
            "Saying what you cannot see is part of credibility; the alternative is a number that looks more certain than it is.",
        ))

    if plan and plan.dips:
        d = plan.dips[0]
        items.append(CandorItem(
            "j_curve",
            f"Around week {d['week']} the score will dip by about {d['drop_points']:.1f} points before it recovers. "
            f"Newly connected {units} enter it with nothing covered yet.",
            d["cause"],
            "Bad news given in advance is reliability; the same news explained afterwards sounds like an excuse.",
        ))

    for sid in ("L2", "L3"):
        st = score.stages[sid]
        if not st.has_data:
            what = "inventory" if sid == "L2" else "module activation"
            items.append(CandorItem(
                f"not_measured_{sid.lower()}",
                f"We cannot yet say how {sid} stands, because we do not have your {what} data.",
                st.notes[0] if st.notes else "",
                "Saying quickly and directly that you do not know is worth more than an estimate you cannot defend.",
            ))

    sus = score.outcomes["reclassification_suspects"]
    if sus:
        items.append(CandorItem(
            "downgrades",
            f"{len(sus)} severity downgrade(s) landed within days of an SLA deadline. Until we understand why, remediation times may look better than they are.",
            "Findings: " + ", ".join(s["finding_id"] for s in sus[:5]) + (" and more" if len(sus) > 5 else "") + ".",
            "Questioning your own good numbers before the customer does is what makes the rest of your numbers believable.",
        ))

    if forecast and forecast.get("available") and forecast.get("state") == "open":
        slow = forecast["p50_days"] is None or forecast["p50_days"] > 90
        if slow:
            when = "not within a year" if forecast["p50_days"] is None else f"about {forecast['p50_days']} days"
            items.append(CandorItem(
                "zero_critical_far",
                f"At the current pace, zero critical findings is {when} away, not weeks.",
                f"{forecast['open_critical']} open, {forecast['arrivals_per_week']} new per week"
                + (f", {forecast['stuck_beyond_history']} older than anything ever closed." if forecast.get("stuck_beyond_history") else "."),
                "Laying out the real challenge and the risks, instead of promising the moon, is what makes people believe the rest of the plan.",
            ))

    if attribution and attribution.bar_points < -0.05 < attribution.customer_points:
        items.append(CandorItem(
            "bar_moved",
            f"Part of the drop is the product, not you: capabilities released since {attribution.from_ceiling} lowered the score by {abs(attribution.bar_points):.1f} points "
            f"while your own work added {attribution.customer_points:.1f}.",
            "Exact decomposition of the change (log-mean Divisia), L3 split at the previous ceiling.",
            "Giving credit where it is due, and saying where the cause is on your side of the table, costs nothing and is remembered.",
        ))

    rel = score.relationship
    if rel and rel["reliability"]["overdue_open"]:
        n = len(rel["reliability"]["overdue_open"])
        items.append(CandorItem(
            "overdue_commitments",
            f"We owe you {n} thing(s) that are past their date. Here is what they are and when you will have them.",
            "Commitments: " + ", ".join(rel["reliability"]["overdue_open"][:5]) + ".",
            "Raising your own missed promises before the customer does is reliability in the only form they can see.",
        ))

    skip = not_relevant_modules(data, cat)
    if skip:
        names = ", ".join(n for _, n, _ in skip[:3])
        needs = "; ".join(f"{n} needs {r}" for _, n, r in skip[:3])
        items.append(CandorItem(
            "not_recommending",
            f"We are not recommending {names} for you: nothing in your estate calls for it.",
            needs + ".",
            "Telling a customer what they do not need is the strongest evidence that what you do recommend is for them.",
        ))
    return items


def render_candor_markdown(items: list[CandorItem], limit: Optional[int] = None) -> list[str]:
    if not items:
        return []
    L = ["## What we should say plainly", "",
         "Each of these is supported by the data. Saying them first, before the customer finds them, is what lowers self-orientation.", ""]
    shown = items if limit is None else items[:limit]
    for i, it in enumerate(shown, 1):
        L += [f"{i}. **{it.say}**", f"   - Evidence: {it.evidence}", f"   - Why say it: {it.why}"]
    if len(shown) < len(items):
        L += ["", f"({len(items) - len(shown)} more in the full report. In a review, five is plenty.)"]
    return [*L, ""]
