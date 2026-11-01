"""Report sections for the v0.3 analyses: attribution, universe, forecast, roadmap.

Each section exists in Markdown and HTML form so the two renderers stay in step.
"""

from __future__ import annotations

from html import escape as e
from typing import Optional

from .attribution import Attribution
from .planner import Plan

CHECK = (0.90, 0.95, 0.98)


def pct(v: Optional[float], d: int = 1) -> str:
    return "n/a" if v is None else f"{v * 100:.{d}f}%"


# --------------------------------------------------------------- attribution

def md_attribution(a: Attribution) -> list[str]:
    L = ["## What changed", "", f"Yield {pct(a.yield_from)} on {a.from_as_of} to {pct(a.yield_to)} on {a.to_as_of} ({a.delta_points:+.1f} pts).", "",
         "| Factor | Before | After | Points |", "|---|---|---|---|"]
    for f in a.factors:
        L.append(f"| {f.label} | {pct(f.old)} | {pct(f.new)} | {f.points:+.1f} |")
    L += ["", f"The customer moved {a.customer_points:+.1f} pts; the bar moved {a.bar_points:+.1f} pts. Contributions sum exactly to the change (log-mean Divisia decomposition).", ""]
    if a.bar_points < -0.05 and a.customer_points > 0:
        L += [f"Real progress was partly hidden by new headroom: capabilities released since {a.from_ceiling} raised the denominator.", ""]
    return L


def html_attribution(a: Attribution) -> str:
    W, row, ml, mr = 640, 34, 270, 90
    h = row * len(a.factors) + 28
    scale = max([abs(f.points) for f in a.factors] + [1.0])
    mid = ml + (W - ml - mr) / 2
    half = (W - ml - mr) / 2
    out = [f'<svg viewBox="0 0 {W} {h}" role="img" aria-label="Contribution of each factor to the change in Yield, in points">',
           f'<line x1="{mid}" x2="{mid}" y1="6" y2="{h - 18}" stroke="var(--base)"/>']
    for i, f in enumerate(a.factors):
        y = 10 + i * row
        w = half * abs(f.points) / scale
        x = mid if f.points >= 0 else mid - w
        color = "var(--pos)" if f.points >= 0 else "var(--neg)"
        fill = "url(#hatchbar)" if f.kind == "bar" else color
        out.append(f'<g><title>{e(f.label)}: {f.old:.1%} to {f.new:.1%}, {f.points:+.2f} pts</title>'
                   f'<text x="{ml - 8}" y="{y + 15}" text-anchor="end">{e(f.label)}</text>'
                   f'<rect x="{x:.1f}" y="{y}" width="{max(w, 1):.1f}" height="20" rx="3" fill="{fill}" stroke="{color}" stroke-width="1.5"/>'
                   f'<text x="{(mid + w + 6) if f.points >= 0 else (mid - w - 6):.1f}" y="{y + 15}" text-anchor="{"start" if f.points >= 0 else "end"}" style="font-weight:600">{f.points:+.1f}</text></g>')
    out.append('<defs><pattern id="hatchbar" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--neg)" stroke-width="1.5"/></pattern></defs></svg>')
    note = (f'<p>The customer moved <strong>{a.customer_points:+.1f} pts</strong>; the bar moved <strong>{a.bar_points:+.1f} pts</strong>. '
            'Contributions sum exactly to the change.</p>')
    if a.bar_points < -0.05 and a.customer_points > 0:
        note += f'<p class="warn">Real progress was partly hidden by new headroom: capabilities released since {e(a.from_ceiling)} raised the denominator.</p>'
    table = ('<details><summary>Table view</summary><table><thead><tr><th>Factor</th><th class="n">Before</th><th class="n">After</th><th class="n">Points</th></tr></thead><tbody>'
             + "".join(f'<tr><td>{e(f.label)}</td><td class="n">{pct(f.old)}</td><td class="n">{pct(f.new)}</td><td class="n">{f.points:+.1f}</td></tr>' for f in a.factors)
             + '</tbody></table></details>')
    return (f'<section aria-labelledby="wc"><h2 id="wc">What changed since {e(a.from_as_of)}</h2>'
            f'<p>Yield {pct(a.yield_from)} to {pct(a.yield_to)} ({a.delta_points:+.1f} pts).</p>{"".join(out)}{note}{table}</section>')


# ------------------------------------------------------------------ universe

def md_universe(u: dict) -> list[str]:
    if not u or not u.get("estimable"):
        return []
    L = ["## How complete is the universe?", "",
         f"{u['observed']} accounts are known from {', '.join(u['sources'])}. {u['seen_by_one']} are seen by one source only, {u['seen_by_two']} by two, {u['seen_by_all']} by all.",
         f"Estimated accounts no source has seen: about {u['unseen_estimate']:.1f} (lower bound, {u['method']}). "
         f"Completeness {pct(u['completeness'])} ({u['confidence']} confidence).",
         f"If those accounts are unconnected, L1 would be {pct(u['pessimistic_l1'])} instead of the reported value.", ""]
    L += [f"- Warning: {w}" for w in u["warnings"]]
    return L + ([""] if u["warnings"] else [])


def html_universe(u: dict) -> str:
    if not u or not u.get("estimable"):
        return ""
    rows = "".join(f"<tr><td>Only in {e(s)}</td><td class=\"n\">{n}</td></tr>" for s, n in u["only_in"].items())
    warn = "".join(f'<p class="warn">{e(w)}</p>' for w in u["warnings"])
    return (f'<section aria-labelledby="un"><h2 id="un">How complete is the universe?</h2>'
            f'<p>{u["observed"]} accounts are known. Estimated accounts <strong>no source has seen</strong>: about <strong>{u["unseen_estimate"]:.1f}</strong> '
            f'(lower bound). Completeness {pct(u["completeness"])}, {e(u["confidence"])} confidence.</p>'
            f'<p>If those are unconnected, L1 would be <strong>{pct(u["pessimistic_l1"])}</strong>.</p>'
            f'<table><tbody><tr><td>Seen by one source</td><td class="n">{u["seen_by_one"]}</td></tr><tr><td>Seen by two</td><td class="n">{u["seen_by_two"]}</td></tr>'
            f'<tr><td>Seen by all</td><td class="n">{u["seen_by_all"]}</td></tr>{rows}</tbody></table>{warn}'
            f'<p class="warn">Capture-recapture estimate (Chao 1987). Treat it as a prompt to look for accounts, not as a count.</p></section>')


# ------------------------------------------------------------------ forecast

def _forecast_lines(f: dict) -> list[str]:
    if not f["available"]:
        return [f["reason"]]
    if f["state"] == "zero":
        return [f"Zero critical now. A new critical appears within 30 days with probability {f['p_new_critical_30d']:.0%} and within 90 days {f['p_new_critical_90d']:.0%} "
                f"(about {f['arrivals_per_week']} per week). Typical recovery: {f['median_days_to_recover']} days."]
    p50 = "not within a year" if f["p50_days"] is None else f"{f['p50_days']} days ({f['p50_date']})"
    p90 = "not within a year" if f["p90_days"] is None else f"{f['p90_days']} days ({f['p90_date']})"
    z = f["p_zero_within"]
    L = [f"{f['open_critical']} critical finding(s) open, {f['arrivals_per_week']} new per week.",
         f"Zero critical: median {p50}; 90th percentile {p90}.",
         f"Probability of zero within 30 / 60 / 90 days: {z['30']:.0%} / {z['60']:.0%} / {z['90']:.0%}."]
    if f.get("stuck_beyond_history"):
        L.append(f"{f['stuck_beyond_history']} open finding(s) are older than anything this customer has closed; they are modelled as likely to stay open.")
    return L


def md_forecast(f: Optional[dict]) -> list[str]:
    if f is None:
        return []
    return ["## Zero-critical forecast", ""] + [x + "  " for x in _forecast_lines(f)] + ["", f"Monte Carlo, {f['runs']} runs, seed {f['seed']}, learned from this customer's own history.", ""]


def html_forecast(f: Optional[dict]) -> str:
    if f is None:
        return ""
    body = "".join(f"<p>{e(x)}</p>" for x in _forecast_lines(f))
    return (f'<section aria-labelledby="fc"><h2 id="fc">Zero-critical forecast</h2>{body}'
            f'<p class="warn">Monte Carlo, {f["runs"]} runs, seed {f["seed"]}, learned from this customer\'s own history. It cannot see what the customer will decide to do.</p></section>')


# -------------------------------------------------------------------- roadmap

def md_plan(p: Plan, top: int = 12) -> list[str]:
    L = ["## Roadmap", "", f"{p.hours_per_week:g} hours a week for {p.horizon_weeks} weeks, {p.realization:.0%} of each action assumed to succeed. "
         f"Yield {pct(p.start_yield)} to {pct(p.end_yield)}.", ""]
    ms = ", ".join(f"{k} in week {v}" if v is not None else f"{k} not reached" for k, v in p.milestones.items())
    L += [f"Checkpoints: {ms}.", ""]
    for d in p.dips:
        L.append(f"- Week {d['week']}: Yield dips {d['drop_points']:.1f} pts. {d['cause']}")
    if p.dips:
        L.append("")
    L += ["| Weeks | Action | Hours | Effect when settled |", "|---|---|---|---|"]
    for j in p.jobs[:top]:
        L.append(f"| {j.started_week}-{j.done_week} | {j.title} | {j.hours:g} | +{j.steady_gain_points:.1f} pts |")
    if len(p.jobs) > top:
        L.append(f"| | {len(p.jobs) - top} more | | |")
    L.append("")
    if p.residual:
        L += ["Assumed blocked, needs escalation: " + "; ".join(f"{n} {k}" for k, n in p.residual.items()) + ".", ""]
    L += [f"_{n}_" for n in p.notes] + ([""] if p.notes else [])
    return L


def svg_plan(p: Plan) -> str:
    W, H, ml, mr, mt, mb = 640, 220, 44, 24, 14, 30
    n = max(len(p.weeks) - 1, 1)
    ys = [w.yield_ for w in p.weeks]
    lo = max(0.0, min(ys) - 0.05)
    hi = 1.0
    def x(i: int) -> float:
        return ml + (W - ml - mr) * i / n
    def y(v: float) -> float:
        return mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo))
    out = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Projected Yield by week, from {pct(p.start_yield)} to {pct(p.end_yield)}">']
    for c in CHECK:
        if lo < c < hi:
            out.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(c):.1f}" y2="{y(c):.1f}" stroke="var(--base)" stroke-dasharray="4 3"/>'
                       f'<text class="m" x="{ml - 6}" y="{y(c) + 4:.1f}" text-anchor="end">{int(c * 100)}%</text>')
    out.append(f'<text class="m" x="{ml - 6}" y="{y(lo) + 4:.1f}" text-anchor="end">{lo * 100:.0f}%</text>')
    out.append('<polyline fill="none" stroke="var(--s1)" stroke-width="2.5" points="' + " ".join(f"{x(i):.1f},{y(w.yield_):.1f}" for i, w in enumerate(p.weeks)) + '"/>')
    dip_weeks = {d["week"]: d for d in p.dips}
    for i, w in enumerate(p.weeks):
        d = dip_weeks.get(w.week)
        tip = f"Week {w.week}: Yield {pct(w.yield_)}" + (f" (dip {d['drop_points']:.1f} pts: {d['cause']})" if d else "")
        color = "var(--neg)" if d else "var(--s1)"
        out.append(f'<g><title>{e(tip)}</title><circle cx="{x(i):.1f}" cy="{y(w.yield_):.1f}" r="{5 if d else 3.5}" fill="{color}" style="stroke:var(--surface);stroke-width:2"/></g>')
    for key, wk in p.milestones.items():
        if wk:
            out.append(f'<text x="{x(wk):.1f}" y="{y(p.weeks[wk].yield_) - 10:.1f}" text-anchor="middle" style="font-weight:600">{e(key)}</text>')
    out.append(f'<text class="m" x="{ml}" y="{H - 8}">week 0</text><text class="m" x="{W - mr}" y="{H - 8}" text-anchor="end">week {n}</text></svg>')
    return "".join(out)


def html_plan(p: Plan, top: int = 12) -> str:
    ms = ", ".join(f"{e(k)} in week {v}" if v is not None else f"{e(k)} not reached" for k, v in p.milestones.items())
    dips = "".join(f"<li><strong>Week {d['week']}: Yield dips {d['drop_points']:.1f} pts.</strong> {e(d['cause'])}</li>" for d in p.dips)
    rows = "".join(f'<tr><td class="n">{j.started_week}-{j.done_week}</td><td>{e(j.title)}</td><td class="n">{j.hours:g}</td><td class="n">+{j.steady_gain_points:.1f} pts</td></tr>' for j in p.jobs[:top])
    more = f'<tr><td></td><td>{len(p.jobs) - top} more</td><td></td><td></td></tr>' if len(p.jobs) > top else ""
    resid = ('<p class="warn">Assumed blocked, needs escalation: ' + e("; ".join(f"{n} {k}" for k, n in p.residual.items())) + ".</p>") if p.residual else ""
    notes = "".join(f'<p class="warn">{e(n)}</p>' for n in p.notes)
    return (f'<section aria-labelledby="rm"><h2 id="rm">Roadmap</h2>'
            f'<p>{p.hours_per_week:g} hours a week, {p.realization:.0%} of each action assumed to succeed. Yield {pct(p.start_yield)} to <strong>{pct(p.end_yield)}</strong>. Checkpoints: {ms}.</p>'
            f'{svg_plan(p)}'
            + (f'<h3 style="font-size:14px;margin:12px 0 4px">The J-curve</h3><p class="warn">Connecting an account first lowers the score: it enters L2 and L3 with nothing covered yet. '
               f'These are the weeks to explain to the customer before they happen.</p><ul>{dips}</ul>' if dips else '')
            + f'<table><thead><tr><th class="n">Weeks</th><th>Action</th><th class="n">Hours</th><th class="n">Effect when settled</th></tr></thead><tbody>{rows}{more}</tbody></table>'
            f'{resid}{notes}<p class="warn">A model, not a promise: it rests on the effort figures in the playbook catalogue and the ramp assumptions in simulate.py.</p></section>')


# --------------------------------------------------------------- relationship

def md_relationship(rel: Optional[dict]) -> list[str]:
    if not rel:
        return []
    L = ["## Relationship", "", "Reported next to adoption and never averaged with it: a well-used platform and a sponsor who has stopped answering are different problems.", ""]
    if rel["weighted_trust"] is not None:
        L.append(f"Influence-weighted trust index **{rel['weighted_trust']:.1f}** ({rel['weighted_band']}), from T = (credibility + reliability + intimacy) / self-orientation. "
                 "A framework, not a measurement.")
    r = rel["reliability"]
    if r["rate"] is not None:
        L.append(f"Reliability, measured from promises: {r['on_time']} of {r['due_in_window']} kept on time ({r['rate']:.0%}), {len(r['overdue_open'])} overdue.")
    c = rel["coverage"]
    L += ["", f"Contacts {c['contacts']}, touched recently {c['touched_recently']}, executive sponsor: {c['sponsor'] or 'none on record'}.", ""]
    rated = [p for p in rel["contacts"] if p["rated"]]
    if rated:
        L += ["| Contact | Role | Trust | Band | Where one point helps most | Days since contact |", "|---|---|---|---|---|---|"]
        for p in sorted(rated, key=lambda p: (-p["influence"], p["id"])):
            L.append(f"| {p['name']} | {p['role'].replace('_', ' ')} | {p['trust']:.1f} | {p['band']} | {p['limiting'].replace('_', ' ')} | {p['days_since_contact'] if p['days_since_contact'] is not None else 'never'} |")
        L.append("")
    return L


def html_relationship(rel: Optional[dict]) -> str:
    if not rel:
        return ""
    r = rel["reliability"]
    bits = []
    if rel["weighted_trust"] is not None:
        bits.append(f'<p>Influence-weighted trust index <strong>{rel["weighted_trust"]:.1f}</strong> ({e(rel["weighted_band"])}), from T = (credibility + reliability + intimacy) / self-orientation. A framework, not a measurement.</p>')
    if r["rate"] is not None:
        bits.append(f'<p>Reliability, measured from promises: <strong>{r["on_time"]} of {r["due_in_window"]}</strong> kept on time ({r["rate"]:.0%}); {len(r["overdue_open"])} overdue.</p>')
    c = rel["coverage"]
    bits.append(f'<p>Contacts {c["contacts"]}, touched recently {c["touched_recently"]}, executive sponsor: {e(c["sponsor"] or "none on record")}.</p>')
    rated = sorted((p for p in rel["contacts"] if p["rated"]), key=lambda p: (-p["influence"], p["id"]))
    if rated:
        rows = "".join(f'<tr><td>{e(p["name"])}</td><td>{e(p["role"].replace("_", " "))}</td><td class="n">{p["trust"]:.1f}</td><td>{e(p["band"])}</td>'
                       f'<td>{e(p["limiting"].replace("_", " "))}</td><td class="n">{p["days_since_contact"] if p["days_since_contact"] is not None else "never"}</td></tr>' for p in rated)
        bits.append(f'<table><thead><tr><th>Contact</th><th>Role</th><th class="n">Trust</th><th>Band</th><th>One point helps most in</th><th class="n">Days since contact</th></tr></thead><tbody>{rows}</tbody></table>')
    return ('<section aria-labelledby="rl"><h2 id="rl">Relationship</h2><p class="warn">Reported next to adoption and never averaged with it.</p>' + "".join(bits) + "</section>")


def html_candor(items: Optional[list]) -> str:
    if not items:
        return ""
    lis = "".join(f'<li><strong>{e(i.say)}</strong><br><span class="warn">Evidence: {e(i.evidence)}<br>Why say it: {e(i.why)}</span></li>' for i in items)
    return (f'<section aria-labelledby="cd"><h2 id="cd">What we should say plainly</h2>'
            f'<p class="warn">Each item is supported by the data. Saying these first, before the customer finds them, is what lowers self-orientation.</p><ol>{lis}</ol></section>')
