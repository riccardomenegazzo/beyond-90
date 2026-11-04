"""The working rhythm of a TAM with a book: who to talk to this week, what to say, and when a commercial conversation is earned.

A TAM may look after a handful of top customers and a dozen mid-tier ones, each needing a regular touch, a clear
answer to what changed, and the news that matters to them. This module turns what the engine already knows into that
week: a cadence per tier measured against a log of interactions, a preparation brief for each call, the security news
that touches each customer, expansion signals that are only offered when trust has been earned, and an ordered plan
for the week with the hours split by tier.

Nothing here is a new measure of adoption. It reshapes the score, the plan, the relationship and the radar into a
sequence of actions for a person, and every ordering rule is a plain sum of points that is printed with the reason.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from .catalogue import Catalogue
from .models import CustomerData
from .radar import Threat, ThreatReport, threat_radar
from .scoring import Score

TOP_TIERS = {"elite", "strategic", "key", "platinum", "top", "tier 1", "tier1"}
MID_TIERS = {"premium", "enterprise", "gold", "tier 2", "tier2"}
CADENCE = {"top": 7, "mid": 14, "other": 30}
WEIGHT = {"top": 3.0, "mid": 2.0, "other": 1.0}
CALL_HOURS = {"top": 1.5, "mid": 1.0, "other": 0.5}       # a call and its follow-up, before preparation
PREP_HOURS = {"top": 1.0, "mid": 0.5, "other": 0.25}
DUE_SOON_DAYS = 2
SEVERITY_POINTS = {"critical": 20, "high": 12, "medium": 4, "low": 0}


def tier_class(tier: str) -> str:
    t = (tier or "").strip().lower()
    return "top" if t in TOP_TIERS else "mid" if t in MID_TIERS else "other"


def cadence_days(data: CustomerData) -> int:
    return data.settings.cadence_days or CADENCE[tier_class(data.tier)]


# ---------------------------------------------------------------------- cadence

def touch_status(data: CustomerData) -> dict[str, Any]:
    """Days since the last touch against the cadence for this customer's tier. A touch is a logged interaction or a contact's last_contact."""
    today = data.as_of
    dates = [i.date for i in data.interactions] + [c.last_contact for c in data.contacts if c.last_contact]
    last = max(dates) if dates else None
    cad = cadence_days(data)
    since = (today - last).days if last else None
    if last is None:
        state = "never"
    elif since is not None and since > cad:
        state = "overdue"
    elif since is not None and cad - since <= DUE_SOON_DAYS:
        state = "due_soon"
    else:
        state = "ok"
    latest = data.interactions[-1] if data.interactions else None
    follow_up = None
    if latest and latest.next_step:
        follow_up = {"step": latest.next_step, "due": latest.next_due.isoformat() if latest.next_due else "", "overdue": bool(latest.next_due and latest.next_due < today),
                     "from": latest.date.isoformat()}
    lastkind = latest.kind if latest else ""
    return {
        "tier": data.tier, "class": tier_class(data.tier), "cadence_days": cad, "last_touch": last.isoformat() if last else "",
        "days_since": since, "overdue_by": max(0, since - cad) if since is not None else None, "state": state,
        "next_due_in": (cad - since) if since is not None else 0, "follow_up": follow_up, "last_kind": lastkind,
        "last_summary": latest.summary if latest else "",
        "touches_90d": sum(1 for i in data.interactions if (today - i.date).days <= 90),
    }


# ------------------------------------------------------------------- expansion

def trust_gate(data: CustomerData, score: Score) -> dict[str, Any]:
    """A commercial conversation is earned, not scheduled. Say plainly why it is not yet, so the TAM does not have to guess."""
    reasons: list[str] = []
    if score.yield_ < 0.75:
        reasons.append(f"Yield is {score.yield_:.0%}: the customer is not yet using what they own, so adoption comes first.")
    rel = score.relationship or {}
    late = (rel.get("gaps") or {}).get("overdue_commitments") or []
    if late:
        reasons.append(f"{len(late)} promise(s) to the customer are past their date: close them before asking for anything.")
    unowned_crit = sum(1 for f in data.findings if f.closed_at is None and f.severity == "critical" and not f.owner)
    if unowned_crit:
        reasons.append(f"{unowned_crit} critical finding(s) have no owner: that is the conversation to have first.")
    if rel and rel.get("weighted_band") == "fragile":
        reasons.append("The relationship reads as fragile; build trust before a commercial topic.")
    return {"ready": not reasons, "reasons": reasons}


def expansion_signals(data: CustomerData, score: Score, actions: list[Any], exposures: list[dict[str, Any]]) -> dict[str, Any]:
    gate = trust_gate(data, score)
    signals: list[dict[str, Any]] = []
    for e in score.entitlements:
        if e["licensed"] > 0 and e["utilization"] >= 0.9:
            signals.append({"kind": "capacity", "title": f"{e['unit']} at {e['utilization']:.0%} of the licence",
                            "why": "Use is close to the limit, so the customer will need headroom soon.",
                            "evidence": f"{e['used']:g} of {e['licensed']:g} in use.", "ask": "What growth do you expect in the next two quarters?"})
    for a in actions:
        if a.cross_sell:
            signals.append({"kind": a.cross_sell, "title": a.title, "why": a.trust_note or "A capability they could use and do not yet.",
                            "evidence": a.detail, "ask": a.question or "What would make this worth your team's time?"})
    for ex in exposures:
        if ex["uncovered"] and ex["severity"] in ("critical", "high"):
            signals.append({"kind": "threat", "title": f"{ex['id']}: {ex['title']}",
                            "why": f"{ex['uncovered']} of {ex['exposed']} exposed {score.terms['units']} have no mitigating capability switched on.",
                            "evidence": f"Mitigated by: {', '.join(ex['mitigated_by'])}.", "ask": "Is this on your radar, and who owns the response?"})
    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for sig in signals:
        key = (sig["kind"], sig["title"])
        if key not in seen:
            seen.add(key)
            unique.append(sig)
    return {"gate": gate, "signals": unique[:8],
            "say": ("Raise these as questions and outcomes, not as a quote." if gate["ready"] else "Not yet: " + gate["reasons"][0])}


# -------------------------------------------------------------------- advisories

def customer_exposures(data: CustomerData, threats: list[Threat], cat: Catalogue) -> list[dict[str, Any]]:
    """The advisories that touch this customer, worst first. Uses the same matching as the radar."""
    if not threats:
        return []
    out: list[dict[str, Any]] = []
    reports: list[ThreatReport] = threat_radar([(data.name, data)], threats, cat, as_of=data.as_of)
    for rep in reports:
        for c in rep.customers:
            t = rep.threat
            out.append({"id": t.id, "title": t.title, "severity": t.severity, "published": t.published.isoformat() if t.published else "",
                        "age_days": rep.age_days, "summary": t.summary, "url": t.url, "source": t.source, "mitigated_by": t.mitigated_by,
                        "exposed": c.exposed_accounts, "covered": c.covered_accounts, "uncovered": len(c.uncovered_ids), "unknown": len(c.unknown_ids),
                        "uncovered_ids": c.uncovered_ids[:12], "unknown_ids": c.unknown_ids[:12], "yield_gain_points": c.yield_gain_points,
                        "providers": t.providers, "resource_types": t.resource_types, **t.extra})
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(key=lambda e: (order[e["severity"]], -e["uncovered"], e["id"]))
    return out


def news_line(e: dict[str, Any], units: str) -> str:
    """One advisory, said the way a customer can act on it: why it matters now, then where it lands in their estate."""
    head = f"{e['id']} ({e['severity']}): {e['title']}."
    if e.get("kev"):
        head += " Known to be exploited" + (f"; agencies must fix it by {e['kev_due']}" if e.get("kev_due") else "") + "."
    elif e.get("epss") is not None and e["epss"] >= 0.1:
        head += f" Exploit probability {e['epss']:.0%} in the next 30 days."
    if e["exposed"] and e["uncovered"]:
        return head + f" {e['uncovered']} of {e['exposed']} exposed {units} have no mitigating capability on."
    if e["exposed"]:
        return head + f" All {e['exposed']} exposed {units} are covered; say so before they ask."
    return head + f" {e['unknown']} {units} cannot be assessed because inventory is incomplete."


def customer_briefing(customer: str, as_of: str, exposures: list[dict[str, Any]], units: str, limit: int = 5) -> str:
    """A security note the customer can read as it is: the news that touches their estate, worst first, in their terms.

    No internal scores. Each item says whether they are in scope, whether the protection is already on, and what to do."""
    items = sorted(exposures, key=lambda e: (not e.get("kev"), not e["uncovered"], {"critical": 0, "high": 1, "medium": 2, "low": 3}[e["severity"]]))[:limit]
    if not items:
        return ""
    L = [f"# Cloud security briefing for {customer}", "", f"As of {as_of}. The advisories below touch the kinds of resources you run; each says whether you are in scope and what we suggest.", ""]
    for e in items:
        L.append(f"## {e['title']}")
        meta = [e["severity"].capitalize()]
        if e.get("kev"):
            meta.append("known to be exploited" + (f" (fix by {e['kev_due']} for public agencies)" if e.get("kev_due") else ""))
        elif e.get("epss") is not None and e["epss"] >= 0.1:
            meta.append(f"{e['epss']:.0%} chance of exploitation in the next 30 days")
        if e.get("cves"):
            meta.append(", ".join(e["cves"][:3]))
        L += ["", " · ".join(meta) + ".", ""]
        if e.get("summary"):
            L += [e["summary"], ""]
        if not e["exposed"]:
            L.append(f"We found none of the affected resources in your inventoried {units}." + (f" {e['unknown']} {units} are not inventoried yet, so we cannot rule them out." if e["unknown"] else ""))
        elif not e["uncovered"]:
            L.append(f"{e['exposed']} of your {units} are in scope and all of them already have the protection that addresses this. No action is needed.")
        else:
            L.append(f"{e['exposed']} of your {units} are in scope; {e['uncovered']} do not yet have {' or '.join(m.replace('_', ' ') for m in e['mitigated_by'][:2])} switched on. "
                     f"Suggested next step: switch it on for {', '.join(e['uncovered_ids'][:5])}{' and the rest' if e['uncovered'] > 5 else ''}.")
        links = [s for s in e.get("sources", []) if s.get("url")] or ([{"name": e.get("source") or "source", "url": e["url"]}] if e.get("url") else [])
        if links:
            L += ["", "Read more: " + "; ".join(f"[{s['name']}]({s['url']})" for s in links[:3])]
        L.append("")
    return "\n".join(L)


# --------------------------------------------------------------------- the brief

def _say_change(extras: dict[str, Any]) -> str:
    a = extras.get("attribution")
    if not a:
        return ""
    cust, bar = a.customer_points, a.bar_points
    s = f"Yield moved {a.delta_points:+.1f} points since {a.from_as_of}: {cust:+.1f} from the customer's work"
    return s + (f" and {bar:+.1f} from capabilities released since." if abs(bar) >= 0.05 else ".")


def build_prep(data: CustomerData, score: Score, actions: list[Any], extras: dict[str, Any], exposures: list[dict[str, Any]], expansion: dict[str, Any]) -> dict[str, Any]:
    """An agenda for the next call, in the order that earns the customer's attention: what we owe, what changed, what is new, what to ask."""
    touch = touch_status(data)
    items: list[dict[str, Any]] = []

    owed = []
    rel = score.relationship or {}
    for cid in (rel.get("gaps") or {}).get("overdue_commitments") or []:
        c = next((x for x in data.commitments if x.id == cid), None)
        if c:
            owed.append(f"{c.description} (was due {c.due_on.isoformat()})")
    fu = touch["follow_up"]
    if fu and fu["overdue"]:
        owed.append(f"{fu['step']} (from {fu['from']}, was due {fu['due']})")
    if owed:
        items.append({"id": "owed", "title": "Start with what we owe", "why": "Raising our own missed promises first is reliability in the only form the customer can see.", "points": owed})
    elif fu:
        items.append({"id": "followup", "title": "Follow up on the last call", "why": f"Last time ({fu['from']}) you agreed to: {fu['step']}.", "points": [fu["step"]]})

    change = _say_change(extras)
    if change:
        pts = [change]
        a = extras["attribution"]
        for f in sorted(a.factors, key=lambda f: -abs(f.points))[:2]:
            pts.append(f"{f.label}: {f.points:+.1f} pts")
        items.append({"id": "changed", "title": "What changed", "why": "The number only means something against the last conversation.", "points": pts})

    news = sorted([e for e in exposures if e["severity"] in ("critical", "high") or e["uncovered"]], key=lambda e: (not e.get("kev"), not e["uncovered"]))[:3]
    if news:
        items.append({"id": "news", "title": "News that touches them", "why": "Staying ahead of what the customer reads is how a TAM stays useful between reviews.",
                      "points": [news_line(e, score.terms["units"]) for e in news]})

    onb = extras.get("onboarding")
    if onb and onb.get("waves"):
        pts = [f"{w['title']}: {w['count']} {score.terms['units']}, owner {w['owner']}{' (one fix covers them all)' if w['once'] else ''}." for w in onb["waves"][:3]]
        if onb.get("secrets"):
            pts.append(f"{len(onb['secrets'])} connector secret(s) expire within a month or already have.")
        items.append({"id": "onboarding", "title": "Unblock onboarding", "why": "A connector that is stuck is adoption the customer has paid for and cannot see; the fix is usually one guardrail, one consent or one template.", "points": pts})

    look = extras.get("outlook")
    if look and look.get("events"):
        hits = sorted((e for e in look["events"] if e.get("points", 0) < 0 or e["kind"] in ("sla_critical", "secret_expiry")), key=lambda e: e["date"])[:3]
        if hits:
            items.append({"id": "decay", "title": "What breaks if we wait", "why": look["summary"],
                          "points": [f"{e['date']}: {e['text']}" + (f" ({e['points']:+.1f} pts)" if e.get("points") else "") for e in hits]})
    st = extras.get("stake")
    if st and st.get("say"):
        items.append({"id": "stake", "title": "Where the gap matters", "why": "Counting accounts treats a sandbox like production; spend and exposure do not.", "points": st["say"]})

    top = actions[:3]
    if top:
        items.append({"id": "gaps", "title": "Where the score leaks", "why": "Three things, ranked by points per hour, each with an owner.",
                      "points": [f"{a.title} (+{a.effect_points:.1f} pts, {a.effort_hours:.1f} h, owner {a.owner})" for a in top]})

    asks = [a.question for a in actions if a.question][:2]
    if asks:
        items.append({"id": "ask", "title": "Questions worth asking", "why": "Questions learn what the customer needs; statements only show what we know.", "points": asks})

    ren = extras.get("renewal")
    if ren and ren.get("status") in ("at_risk", "watch") and ren.get("days") is not None and ren["days"] <= 180:
        items.append({"id": "renewal", "title": f"Renewal in {ren['days']} days", "why": f"Status: {ren['status'].replace('_', ' ')}.",
                      "points": [s["detail"] for s in ren["signals"] if s["status"] in ("risk", "watch")][:3]})

    if expansion["signals"]:
        items.append({"id": "expansion", "title": "Growth, if it is earned", "why": expansion["say"],
                      "points": [f"{s['title']}: {s['why']}" for s in expansion["signals"][:3]] if expansion["gate"]["ready"] else expansion["gate"]["reasons"]})

    commit = [a.we_commit for a in actions if a.we_commit][:2]
    if commit:
        items.append({"id": "close", "title": "End by agreeing next steps", "why": "A call ends with a date and an owner, or it did not happen.", "points": commit})

    return {"customer": data.name, "as_of": data.as_of.isoformat(), "tier": data.tier, "touch": touch, "items": items}


def render_prep_markdown(prep: dict[str, Any]) -> str:
    t = prep["touch"]
    lines = [f"# Call prep: {prep['customer']}", "",
             f"As of {prep['as_of']}. Tier {prep['tier'] or 'not set'}, cadence {t['cadence_days']} days. "
             + ("Last touch " + t["last_touch"] + f" ({t['days_since']} days ago)." if t["last_touch"] else "No touch on record."), ""]
    if t["last_summary"]:
        lines += [f"Last time: {t['last_summary']}", ""]
    for i, it in enumerate(prep["items"], 1):
        lines += [f"## {i}. {it['title']}", f"_{it['why']}_", ""] + [f"- {p}" for p in it["points"]] + [""]
    lines.append("Derived from the customer's files; nothing here was invented.")
    return "\n".join(lines)


# ------------------------------------------------------------------- the week

@dataclass
class WeekRow:
    key: str
    name: str
    tier: str
    cls: str
    arr: float
    priority: float
    reasons: list[str]
    day: str
    hours: float
    touch: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "name": self.name, "tier": self.tier, "class": self.cls, "arr": self.arr, "priority": round(self.priority, 1),
                "reasons": self.reasons, "day": self.day, "hours": self.hours, "touch": self.touch}


def week_plan(rows: list[dict[str, Any]], hours_per_week: float) -> dict[str, Any]:
    """Order the book for the week. Every point comes with its reason, so the order can be argued with.

    Each row: {key, name, data, score, renewal, exposures, expansion}.
    """
    out: list[WeekRow] = []
    for r in rows:
        data: CustomerData = r["data"]
        touch = touch_status(data)
        cls = touch["class"]
        pts = 0.0
        why: list[str] = []
        if touch["state"] == "never":
            pts += 40
            why.append("no touch on record")
        elif touch["state"] == "overdue":
            pts += 25 + 25 * min(1.0, touch["overdue_by"] / touch["cadence_days"])
            why.append(f"{touch['days_since']} days since the last touch; cadence is {touch['cadence_days']}")
        elif touch["state"] == "due_soon":
            pts += 20
            why.append(f"touch due in {max(0, touch['next_due_in'])} day(s)")
        fu = touch["follow_up"]
        if fu and fu["overdue"]:
            pts += 12
            why.append("a promised follow-up is overdue")
        late = ((r["score"].relationship or {}).get("gaps") or {}).get("overdue_commitments") or []
        if late:
            pts += min(30, 15 * len(late))
            why.append(f"{len(late)} promise(s) past their date")
        ren = r.get("renewal")
        if ren and ren.get("status") in ("at_risk", "watch") and ren.get("days") is not None and ren["days"] <= 120:
            pts += 25 if ren["status"] == "at_risk" else 12
            why.append(f"renewal in {ren['days']} days ({ren['status'].replace('_', ' ')})")
        worst = max((SEVERITY_POINTS[e["severity"]] for e in r.get("exposures", []) if e["uncovered"]), default=0)
        exploited = [e for e in r.get("exposures", []) if e["uncovered"] and e.get("kev")]
        if worst:
            pts += worst + (10 if exploited else 0)
            why.append((f"known exploited {exploited[0]['id']} on uncovered " if exploited else "security news touching uncovered ") + r["score"].terms["units"])
        crit = r["score"].outcomes.get("critical_open", 0)
        unowned = sum(1 for f in data.findings if f.closed_at is None and f.severity == "critical" and not f.owner)
        if unowned:
            pts += 10
            why.append(f"{unowned} critical finding(s) with no owner")
        elif crit:
            pts += 4
        onb = r.get("onboarding")
        if onb and onb.get("has_detail"):
            broken = len(onb.get("listed_but_broken") or [])
            blocked = sum(1 for a in onb["accounts"] if a["issue"] and a["stage"] not in ("complete",) and a["issue"] != "not_deployed")
            if broken:
                pts += min(20, 8 * broken)
                why.append(f"{broken} connector(s) that worked are failing")
            elif blocked:
                pts += min(12, 3 * blocked)
                why.append(f"{blocked} {r['score'].terms['units']} blocked in onboarding")
            if any(sec["days_left"] <= 14 for sec in onb.get("secrets") or []):
                pts += 8
                why.append("a connector secret expires within two weeks")
        look = r.get("outlook")
        if look:
            soon = [e for e in look["events"] if e.get("points", 0) < 0 and (date.fromisoformat(e["date"]) - data.as_of).days <= 7]
            lost = -sum(e["points"] for e in soon)
            if lost >= 0.5:
                pts += min(15, 5 * lost)
                why.append(f"{lost:.1f} points of Yield are lost within a week if nothing is done")
        mult = {"top": 1.0, "mid": 0.85, "other": 0.7}[cls]
        out.append(WeekRow(r["key"], r["name"], data.tier, cls, data.arr, pts * mult + {"top": 6, "mid": 3, "other": 0}[cls], why or ["on cadence, nothing pressing"], "", 0.0, touch))
    out.sort(key=lambda w: (-w.priority, -w.arr, w.name))
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    fixed = sum(PREP_HOURS[w.cls] + CALL_HOURS[w.cls] for w in out)
    spare = max(0.0, hours_per_week - fixed)
    weights = [WEIGHT[w.cls] * (1 + w.priority / 100) for w in out]
    total_w = sum(weights) or 1.0
    for i, w in enumerate(out):
        w.hours = round((PREP_HOURS[w.cls] + CALL_HOURS[w.cls] + spare * weights[i] / total_w) * 2) / 2
        w.day = days[min(4, i * 5 // max(1, len(out)))] if w.touch["state"] != "ok" or w.priority >= 30 else days[min(4, 2 + i % 3)]
    return {"hours_per_week": hours_per_week, "rows": [w.to_dict() for w in out], "fixed_hours": round(fixed, 1), "over_budget": fixed > hours_per_week}


def render_week_markdown(plan: dict[str, Any], as_of: str) -> str:
    lines = [f"# Your week, from {as_of}", "", f"{plan['hours_per_week']:g} hours. Calls and preparation need {plan['fixed_hours']:g} h"
             + ("; **that is more than the budget, so something has to give**." if plan["over_budget"] else "; the rest goes where the points are."), ""]
    for i, r in enumerate(plan["rows"], 1):
        lines.append(f"{i}. **{r['name']}** ({r['tier'] or 'no tier'}), {r['day']}, about {r['hours']:g} h. " + "; ".join(r["reasons"]) + ".")
    lines += ["", "Priority is a sum of points, each with its reason above; change a tier or a cadence in customer.toml and the order changes."]
    return "\n".join(lines)
