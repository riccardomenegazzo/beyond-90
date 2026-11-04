"""Quarterly business review draft.

Two structures, one on top of the other:

* the **Pyramid Principle** inside the answer: the answer first, three
  supporting reasons, the evidence under each;
* the five stages of building trust in *The Trusted Advisor* around it:
  engage (a shared agenda sent in advance, with room for the customer's items),
  listen (open questions before any answer), frame (the answer), envision (where
  we are aiming and how we will know), commit (decisions asked, and what we
  commit to deliver).

The draft is written from the score only; the TAM adds the customer's own goals
and wins before presenting it. The last section is for the TAM alone.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional

from .attribution import Attribution
from .candor import CandorItem, render_candor_markdown
from .ladder import describe
from .planner import Plan
from .playbooks import Action
from .report import pct, pts
from .scoring import STAGE_NAMES, Score
from .sections import md_plan, md_renewal, rubric_headline

LEAK_LABEL = {
    "L1": "Accounts outside the platform",
    "L2": "Resource types we cannot see",
    "L3": "Controls that are not switched on",
    "L4": "Findings with no owner or decision",
    "Reach": "Teams that do not use it yet",
    "Entitlement": "Licensed capacity that is not in use",
    "Relationship": "People we need to know better",
}


def render_qbr(score: Score, actions: list[Action], previous: Optional[dict[str, Any]] = None, quarter: str = "", *,
               attribution: Optional[Attribution] = None, forecast: Optional[dict[str, Any]] = None, plan: Optional[Plan] = None,
               candor: Optional[list[CandorItem]] = None, renewal: Optional[dict[str, Any]] = None, ladder: Optional[dict[str, Any]] = None, drift: Optional[dict[str, Any]] = None) -> str:
    title = f"Quarterly business review: {score.customer}" + (f", {quarter}" if quarter else "")
    yield_actions = [a for a in actions if a.leak != "Relationship"]
    by_leak: dict[str, list[Action]] = defaultdict(list)
    for a in yield_actions:
        by_leak[a.leak].append(a)
    ranked = sorted(by_leak.items(), key=lambda kv: (-sum(a.effect_points for a in kv[1]), -len(kv[1]), kv[0]))
    ranked = [(k, v) for k, v in ranked if v][:3]
    top_gain = sum(sum(a.effect_points for a in v) for k, v in ranked)
    projected = min(1.0, score.yield_ + top_gain / 100.0)
    o = score.outcomes

    L = [f"# {title}", "", (f"_As of {score.as_of}, ceiling {score.ceiling_version}. Draft generated from the score; add the customer's goals and wins before presenting. "
         "The last section is for you alone: remove it before sharing._"), ""]

    # Engage: a shared agenda, sent in advance, with room for theirs.
    L += ["## Agenda to share in advance", "",
          "1. Your priorities, and what has changed on your side since we last met (your items first)",
          "2. Where adoption really stands, and why it moved",
          "3. What we should say plainly" if candor else "3. What we are seeing in your estate",
          "4. Where we are aiming, and how we will know we got there",
          "5. Decisions, and who does what by when", "",
          "Your items to add: ______________________________", ""]

    # Listen: open questions before any answer.
    asked = [a for a in yield_actions if a.question][:4]
    L += ["## Listen first", "", "Questions to ask before presenting anything (open ones; let them answer in their own terms):", "",
          "- What has changed on your side that I should know about, and what would make this review worth your time?"]
    L += [f"- {a.question}  _(on: {a.title.rsplit(' (', 1)[0] if a.title.endswith(')') else a.title})_" for a in asked]
    L.append("")

    # Frame: the answer.
    L += ["## The answer", ""]
    real = f"Real adoption is **{pct(score.yield_)}**"
    if score.naive is not None and score.naive > score.yield_ + 1e-9:
        real += f", not the {pct(score.naive)} the legacy metric shows"
    real += "."
    L.append(real)
    if attribution:
        L.append(f"It moved {attribution.delta_points:+.1f} points since {attribution.from_as_of}: the customer moved {attribution.customer_points:+.1f}, "
                 f"the bar moved {attribution.bar_points:+.1f}" + (" (new capabilities raised the denominator)." if attribution.bar_points < -0.05 else "."))
    elif previous:
        L.append(f"It moved {pts(score.yield_ - previous['yield'])} since {previous['as_of']}.")
    if plan and plan.jobs:
        first = next(((k, v) for k, v in plan.milestones.items() if v is not None), None)
        L.append(f"At {plan.hours_per_week:g} hours a week the plan reaches **{pct(plan.end_yield)}** in {len(plan.weeks) - 1} weeks"
                 + (f", with the {first[0]} checkpoint in week {first[1]}." if first else "."))
        if plan.dips:
            d = plan.dips[0]
            L.append(f"**Expect a dip first:** in week {d['week']} Yield falls {d['drop_points']:.1f} points because newly connected {score.terms.get('units', 'accounts')} enter the score with nothing covered yet. "
                     "That is the cost of seeing them, not a regression.")
    elif ranked:
        L.append(f"Acting on the three biggest gaps below is worth an estimated {top_gain:.1f} points and would take it to about **{pct(projected)}**.")
        if score.target["next_checkpoint"]:
            L.append(f"The next checkpoint is {pct(score.target['next_checkpoint'], 0)}.")
    else:
        L.append("No open gaps were found at this ceiling. The job now is to keep the level as the estate grows and the product ships.")
    if score.rubric and score.rubric.get("checks"):
        L += ["", rubric_headline(score.rubric)]
        L += describe(ladder) if ladder else []
        if score.rubric["blocking"]:
            L.append("")
            L += [f"- {c['title']}." for c in score.rubric["blocking"][:3]]
            L.append("")
    u = score.universe
    if u and u.get("estimable") and u["unseen_estimate"] >= 1:
        L.append(f"One caveat: about {u['unseen_estimate']:.0f} {score.terms.get('unit', 'account')}(s) are probably known to no source at all; if they are unconnected, L1 is {pct(u['pessimistic_l1'])}.")
    L.append("")

    if ranked:
        L += ["## Three reasons", ""]
        for i, (leak, items) in enumerate(ranked, 1):
            gain = sum(a.effect_points for a in items)
            label = LEAK_LABEL.get(leak, leak).replace("Accounts", score.terms.get("units", "accounts").capitalize())
            L.append(f"{i}. **{label}.** {len(items)} open action(s)" + (f", worth about {gain:.1f} points" if gain else "") + ".")
            for a in items[:3]:
                L.append(f"   - {a.title}: {a.detail}")
        L.append("")

    L += ["## Evidence", "", "| Stage | Pass rate | Count |", "|---|---|---|"]
    for sid in ("L1", "L2", "L3", "L4"):
        st = score.stages[sid]
        L.append(f"| {sid} {STAGE_NAMES[sid]} | {pct(st.value)} | {st.numerator:g} / {st.denominator:g} |" if st.has_data else f"| {sid} {STAGE_NAMES[sid]} | not measured | |")
    L.append(f"| **Yield** | **{pct(score.yield_)}** | |")
    L.append("")
    if score.baseline["ceiling"] != score.ceiling_version:
        L += [(f"Against the baseline ceiling ({score.baseline['ceiling']}) Yield is {pct(score.baseline['yield'])}. "
              "The gap is new capability released since then: more headroom, not a step back."), ""]
    if o["findings_total"]:
        line = f"Critical findings open: {o['critical_open']}."
        if o["zero_critical"]:
            line += " Zero critical status."
        line += f" Consecutive critical fixes within SLA: {o['mttr_streak']}."
        if "critical" in o["mttr"]:
            line += f" Critical findings took a median of {o['mttr']['critical']['median_days']:g} days to fix, and one in ten took {o['mttr']['critical']['p90_days']:g} or more."
        L += [line, ""]
    if score.reach:
        L += [f"Reach: {pct(score.reach['value'])} across {score.reach['teams']} teams with {score.terms.get('estate', 'cloud')} assets.", ""]
    low = [e for e in score.entitlements if e["below_target"]]
    if low:
        L += ["Licensed capacity below target: " + "; ".join(f"{e['unit']} {e['used']:g}/{e['licensed']:g} ({e['utilization']:.0%})" for e in low) + ".", ""]

    if score.views:
        thin = [u for u in score.views["use_cases"] if u["state"] != "deep"][:6]
        L += ["## Where adoption is thin, by what it is for" if thin else "## Adoption by what it is for", "", "| Use case | In use | State | Biggest gap |", "|---|---|---|---|"]
        L += [f"| {u['label']} | {u['active']} of {u['relevant']} ({u['rate']:.0%}) | {u['state']} | {u['biggest_gap'] or '-'} |" for u in (thin or score.views['use_cases'][:3])]
        L.append("")
        if score.views["csf"]["note"]:
            L += [score.views["csf"]["note"], ""]

    L += render_candor_markdown(candor or [], limit=5)

    # Envision: what are we aiming for, what will it look like, how will we know.
    L += ["## Where we are aiming", "",
          f"- **What we are aiming for:** {pct(score.target['value'])} this period"
          + (f", with {pct(score.target['next_checkpoint'], 0)} as the next checkpoint" if score.target["next_checkpoint"] else ", holding the level")
          + ". Ninety is a checkpoint, not the finish: the denominators grow as you grow and as the product ships.",
          f"- **What it will look like:** every {score.terms.get('unit', 'account')} you pay for is connected, every resource type is visible, the relevant controls are on, and every finding has an owner and a decision.",
          "- **How we will know:** the same four pass rates, on the same independent denominators, each quarter, with the change split between what you did and what the product added.", ""]
    L += ["## Plan for next quarter", "", "| Action | Owner | Due | Done when |", "|---|---|---|---|"]
    for a in yield_actions[:5]:
        L.append(f"| {a.title} | {a.owner} | {a.due} | {a.success} |")
    L.append("")
    if plan and plan.jobs:
        L += md_plan(plan, top=8)
    if forecast and forecast.get("available"):
        if forecast["state"] == "open":
            z = forecast["p_zero_within"]
            L += ["## Zero critical", "", (f"{forecast['open_critical']} critical finding(s) are open and {forecast['arrivals_per_week']} new ones arrive per week. "
                  f"Probability of reaching zero within 30 / 60 / 90 days: {z['30']:.0%} / {z['60']:.0%} / {z['90']:.0%} on the current pace."), ""]
        else:
            L += ["## Zero critical", "", (f"Zero critical today. A new critical appears within 30 days with probability {forecast['p_new_critical_30d']:.0%}; "
                  f"staying at zero means closing each one within about {forecast['median_days_to_recover']} days."), ""]

    # Commit: what we ask, and what we promise.
    L += ["## Decisions we need today", ""]
    if ranked:
        for a in [items[0] for _, items in ranked]:
            L.append(f"- Name an owner and a date for: {a.title}.")
    else:
        L.append("- None. Confirm the next review date.")
    L.append("")
    promises = [a for a in yield_actions if a.we_commit][:3]
    L += ["## What we commit to", "", "Small, specific, on time:", ""]
    L += [f"- We will {a.we_commit}." for a in promises]
    L += ["- We will send you a written recap within two working days, and tell you early if any date is going to move.", ""]

    # For the TAM only.
    L += ["---", "", "## For you only: remove before sharing", ""]
    if renewal:
        L += [line.replace("## Renewal readiness", "### Renewal readiness") for line in md_renewal(renewal)]
    rel = score.relationship
    if rel:
        L += ["### The relationship", ""]
        if rel["weighted_trust"] is not None:
            L.append(f"Influence-weighted trust index {rel['weighted_trust']:.1f} ({rel['weighted_band']}). It is a prompt for a conversation with a colleague, not a measurement: "
                     "you are a poor judge of your own self-orientation.")
        r = rel["reliability"]
        if r["rate"] is not None:
            L.append(f"Reliability, measured: {r['on_time']} of {r['due_in_window']} promises due in the last period were kept on time ({r['rate']:.0%})"
                     + (f"; {len(r['overdue_open'])} are overdue." if r["overdue_open"] else "."))
        g = rel["gaps"]
        who = {p["id"]: p["name"] for p in rel["contacts"]}
        if g["no_executive_sponsor"]:
            L.append("- No executive sponsor is on record.")
        if g["stale_key_contacts"]:
            L.append(f"- Key contacts you have not spoken to recently: {', '.join(who[i] for i in g['stale_key_contacts'])}.")
        if g["single_threaded"]:
            L.append("- You depend on fewer than two recent contacts.")
        if g["teams_without_a_contact"]:
            L.append(f"- Teams with {score.terms.get('estate', 'cloud')} assets and no contact: {', '.join(g['teams_without_a_contact'][:6])}.")
        for comp, ids in g["weak_by_component"].items():
            L.append(f"- Weakest lever for {', '.join(who[i] for i in ids)}: {comp.replace('_', ' ')}.")
        L.append("")
    typed = [a for a in actions if a.cross_sell]
    if typed:
        L += ["### Expansion, as a trusted advisor", "",
              ("Each of these is an expansion of some kind. They feel different to the customer, so they are approached differently (EXPAND: new capability, people who trust you; "
              "BROADEN: same service, new people; DIVERSIFY: new capability and new people)."), ""]
        seen = set()
        for a in typed[:8]:
            L.append(f"- **{a.cross_sell.upper()}**: {a.title}.")
            if a.cross_sell not in seen:
                L.append(f"  {a.trust_note}")
                seen.add(a.cross_sell)
        L.append("")
    L += ["### Before you walk in", "",
          "- Send the agenda in advance and ask them to add to it. Start the meeting by reading it back.",
          "- Listen and say back what you heard until they say 'yes, exactly'. Only then frame.",
          "- Take a point of view and say it plainly, as a proposal, not a verdict.",
          "- Give away at least one idea that has nothing to do with renewal or expansion.",
          "- Say 'I don't know' quickly when you do not.", ""]
    return "\n".join(L)
