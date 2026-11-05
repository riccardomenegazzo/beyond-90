"""An executive QBR built on demand from a customer's history.

Every analysis a TAM runs can be kept as a snapshot of the customer's files. When a review is due, this module
takes all the snapshots of one customer and a period (a quarter, by default the last full one) and writes the
review a CISO reads: where they were, where they are, what it was worth, what we did together, what is exposed
now, what happens if nothing is done, and the few decisions we need. It is built only from what was recorded,
so every number can be traced to a snapshot and a file.

Words are the customer's, not ours: "effective coverage" and its four parts (connected, visible, protected,
handled) instead of internal stage names; no maturity jargon on the slides. The internal score stays in the
TAM's own documents.
"""

from __future__ import annotations

from datetime import date, timedelta
from html import escape
from typing import Any, Optional

from . import impact, onboarding, outlook, rhythm, stake
from .catalogue import Catalogue
from .models import CustomerData
from .playbooks import generate_actions
from .scoring import compute_score

PARTS = {"L1": ("Connected", "accounts and clusters the platform reaches"), "L2": ("Visible", "resource types it can see"),
         "L3": ("Protected", "controls switched on where they apply"), "L4": ("Handled", "findings with an owner or a decision")}


# ------------------------------------------------------------------ periods

def quarter_of(d: date) -> tuple[date, date, str]:
    q = (d.month - 1) // 3
    start = date(d.year, 3 * q + 1, 1)
    end = (date(d.year + (q == 3), (3 * q + 3) % 12 + 1, 1)) - timedelta(days=1)
    return start, end, f"Q{q + 1} {d.year}"


def default_period(latest: date) -> tuple[date, date, str]:
    """The quarter of the latest snapshot: a review held at the end of a quarter covers that quarter, compared with the
    last snapshot saved before it began."""
    return quarter_of(latest)


def label_for(start: date, end: date) -> str:
    s, e, label = quarter_of(start)
    return label if (s, e) == (start, end) else f"{start.isoformat()} to {end.isoformat()}"


# ------------------------------------------------------------------ the review

def _point(d: CustomerData, cat: Catalogue) -> dict[str, Any]:
    s = compute_score(d, cat)
    active = [a for a in d.accounts if a.status == "active"]
    w = stake.weighted(d, s, cat)
    return {"as_of": d.as_of.isoformat(), "coverage": s.yield_, "parts": {k: s.stages[k].value for k in PARTS},
            "weighted": w["value"], "critical_open": s.outcomes.get("critical_open", 0),
            "critical_internet": sum(1 for f in d.findings if f.closed_at is None and f.severity == "critical" and f.exposure == "internet" and f.decision != "false_positive"),
            "accounts": len(active), "connected": sum(1 for a in active if a.connected), "level": (s.rubric or {}).get("level", "")}


def build(snapshots: list[CustomerData], cat: Catalogue, *, start: Optional[date] = None, end: Optional[date] = None,
          threats: Optional[list[Any]] = None) -> dict[str, Any]:
    """The review for one customer over [start, end]. Snapshots may come in any order; one customer only."""
    if not snapshots:
        raise ValueError("no snapshot: save at least one analysis of this customer")
    names = {d.name for d in snapshots}
    if len(names) > 1:
        raise ValueError(f"snapshots of more than one customer: {', '.join(sorted(names))}")
    by_date: dict[date, CustomerData] = {}
    for d in sorted(snapshots, key=lambda d: d.as_of):
        by_date[d.as_of] = d                                       # the same date twice: the later save wins
    snaps = [by_date[k] for k in sorted(by_date)]
    if start is None or end is None:
        start, end, label = default_period(snaps[-1].as_of)
    else:
        label = label_for(start, end)
    if end < start:
        raise ValueError("the period ends before it starts")
    inside = [d for d in snaps if start <= d.as_of <= end]
    if not inside:
        dates = ", ".join(d.as_of.isoformat() for d in snaps[-6:])
        raise ValueError(f"no snapshot falls in {label}; the saved ones are dated {dates}")
    before = [d for d in snaps if d.as_of < start]
    base = before[-1] if before else inside[0]
    final = inside[-1]
    series_src = ([base] if before else []) + inside
    series = [_point(d, cat) for d in series_src]
    first, last = series[0], series[-1]
    compared = base is not final

    receipt = impact.receipt(base, final, cat) if compared else None
    score = compute_score(final, cat)
    units = cat.terms["units"]

    touches = [t for t in final.interactions if start <= t.date <= end]
    kinds: dict[str, int] = {}
    for t in touches:
        kinds[t.kind] = kinds.get(t.kind, 0) + 1
    moments = [{"date": t.date.isoformat(), "kind": t.kind, "summary": t.summary, "next_step": t.next_step} for t in sorted(touches, key=lambda t: t.date)
               if t.kind in ("qbr", "workshop", "escalation", "advisory", "meeting") or t.next_step][-8:]
    delivered = [c for c in final.commitments if c.done_on and start <= c.done_on <= end]
    open_c = [c for c in final.commitments if not c.done_on]
    overdue = [c for c in open_c if c.due_on < final.as_of]

    onb = onboarding.diagnose(final)
    look = outlook.outlook(final, cat)
    w = stake.weighted(final, score, cat)
    exposures = rhythm.customer_exposures(final, threats or [], cat) if threats else []

    actions = sorted(generate_actions(final, score, cat), key=lambda a: -(a.effect_points / max(a.effort_hours, 0.5)))
    priorities = [{"title": a.title, "owner": a.owner if a.owner and a.owner != "unassigned" else "to agree", "due": str(a.due), "effect": round(a.effect_points, 1), "why": a.detail} for a in actions[:4]]

    decisions: list[str] = []
    if w.get("unconnected_spend_share", 0) >= 0.05:
        decisions.append(f"Approve connecting the remaining accounts: {w['unconnected_spend_share']:.0%} of cloud spend is still outside the platform.")
    unowned = sum(1 for f in final.findings if f.closed_at is None and f.severity == "critical" and not f.owner and f.decision != "false_positive")
    if unowned:
        decisions.append(f"Name an owner for {unowned} critical finding(s) that have none; without an owner nothing gets fixed.")
    for wv in onb.get("waves", [])[:2]:
        decisions.append(f"{wv['owner'][0].upper()}{wv['owner'][1:]}: {wv['title'][0].lower()}{wv['title'][1:].rstrip('.')} ({wv['count']} {units}). One change unblocks all of them.")
    if overdue:
        decisions.append(f"Agree new dates for {len(overdue)} commitment(s) that slipped.")

    head = []
    if compared:
        head.append(f"Effective coverage moved from {first['coverage']:.0%} to {last['coverage']:.0%}" + (f" ({(last['coverage'] - first['coverage']) * 100:+.1f} points)" if abs(last['coverage'] - first['coverage']) >= 0.0005 else ""))
        if receipt and receipt["findings"]["closed"]:
            sev = receipt["findings"]["by_severity"]
            head.append(f"{receipt['findings']['closed']} findings closed" + (f", {sev['critical']} of them critical" if sev.get("critical") else ""))
        if receipt and receipt["connected"]["accounts"]:
            head.append(f"{len(receipt['connected']['accounts'])} {units} brought under watch")
    else:
        head.append(f"Effective coverage is {last['coverage']:.0%}; this is the first recorded point, so the next review will show the change")
    if last["critical_open"]:
        head.append(f"{last['critical_open']} critical finding(s) remain open" + (f", {last['critical_internet']} exposed to the internet" if last["critical_internet"] else ""))

    return {
        "customer": final.name, "period": {"from": start.isoformat(), "to": end.isoformat(), "label": label},
        "baseline": base.as_of.isoformat(), "final": final.as_of.isoformat(), "compared": compared,
        "snapshots": [p["as_of"] for p in series], "units": units, "headline": head,
        "series": series, "first": first, "last": last, "receipt": receipt,
        "engagement": {"touches": len(touches), "by_kind": dict(sorted(kinds.items(), key=lambda kv: -kv[1])), "moments": moments,
                       "delivered": [{"what": c.description, "on": c.done_on.isoformat() if c.done_on else "", "on_time": bool(c.done_on and c.done_on <= c.due_on)} for c in delivered],
                       "open": [{"what": c.description, "due": c.due_on.isoformat(), "overdue": c.due_on < final.as_of} for c in open_c][:8]},
        "risk": {"critical_open": last["critical_open"], "critical_internet": last["critical_internet"], "unconnected_spend_share": w.get("unconnected_spend_share", 0.0),
                 "heaviest": w.get("say", [])[:3], "secrets": len(onb.get("secrets", [])), "blocked": sum(1 for r in onb.get("accounts", []) if r.get("issue") and r.get("stage") != "complete")},
        "news": [{"id": e["id"], "title": e["title"], "severity": e["severity"], "kev": bool(e.get("kev")), "exposed": e["exposed"], "uncovered": e["uncovered"], "unknown": e["unknown"]} for e in exposures[:6]],
        "if_nothing": {"summary": _if_nothing(look), "loss_points": look["loss_points"], "first_drop": look["first_drop"]},
        "priorities": priorities, "decisions": decisions[:4],
    }


def _if_nothing(look: dict[str, Any]) -> str:
    """The outlook in a CISO's words: no stage names, no maturity labels."""
    c0, c1 = look["curve"][0], look["curve"][-1]
    if c1["yield"] >= c0["yield"] - 0.0005:
        return "Nothing already dated lowers coverage in the next 90 days."
    s = f"If nothing is done, effective coverage falls from {c0['yield']:.0%} to {c1['yield']:.0%} by {c1['date']}, through events that already have a date: credentials that expire, accepted risks that reach their review, findings that age without an owner."
    fd = look.get("first_drop")
    if fd:
        s += f" The first drop is on {fd['date']}."
    return s


# ------------------------------------------------------------------ rendering

def _pct(v: float) -> str:
    return f"{v:.0%}"


def render_markdown(q: dict[str, Any]) -> str:
    f, la, u = q["first"], q["last"], q["units"]
    L = [f"# {q['customer']}: executive review, {q['period']['label']}", "",
         f"Period {q['period']['from']} to {q['period']['to']}. Built from {len(q['snapshots'])} recorded snapshot(s): {', '.join(q['snapshots'])}.", "",
         "## In one minute", ""] + [f"- {h}." for h in q["headline"]]
    L += ["", "## Where you stand", "", "| | " + (f"{q['baseline']} | " if q["compared"] else "") + f"{q['final']} |", "|---|" + ("---|" if q["compared"] else "") + "---|"]
    rows = [("Effective coverage", "coverage", _pct), ("Weighted by spend and exposure", "weighted", _pct)]
    for label, key, fmt in rows:
        L.append(f"| {label} | " + (f"{fmt(f[key])} | " if q["compared"] else "") + f"{fmt(la[key])} |")
    for k, (name, what) in PARTS.items():
        L.append(f"| {name} ({what}) | " + (f"{_pct(f['parts'][k])} | " if q["compared"] else "") + f"{_pct(la['parts'][k])} |")
    L.append("| Critical findings open | " + (f"{f['critical_open']} | " if q["compared"] else "") + f"{la['critical_open']} |")
    L.append(f"| {u.capitalize()} connected | " + (f"{f['connected']} of {f['accounts']} | " if q["compared"] else "") + f"{la['connected']} of {la['accounts']} |")
    r = q["receipt"]
    if r:
        L += ["", "## What the quarter delivered", ""] + [f"- {h}." for h in r["headline"]] + \
             [f"- Our commitments: {r['promises']['kept']} delivered, {r['promises']['on_time']} on time."]
    e = q["engagement"]
    L += ["", "## Working together", "", f"{e['touches']} recorded touch(es)" + (": " + ", ".join(f"{n} {k}" for k, n in e["by_kind"].items()) if e["by_kind"] else "") + "."]
    L += [f"- {m['date']} {m['kind']}: {m['summary'] or m['next_step']}" for m in e["moments"]]
    if e["open"]:
        L += ["", "Still open on our side:"] + [f"- {c['what']} (due {c['due']}{', late' if c['overdue'] else ''})" for c in e["open"]]
    k = q["risk"]
    L += ["", "## Exposure today", "", f"- {k['critical_open']} critical finding(s) open, {k['critical_internet']} exposed to the internet.",
          f"- {k['unconnected_spend_share']:.0%} of cloud spend is not yet connected."] + [f"- {s}" for s in k["heaviest"]]
    if q["news"]:
        L += ["", "## Threats this quarter that touched you", ""] + [
            f"- {n['title']} ({'known exploited' if n['kev'] else n['severity']}): " + (f"{n['uncovered']} of {n['exposed']} exposed {u} not yet covered." if n["uncovered"] else f"all {n['exposed']} exposed {u} covered." if n["exposed"] else f"{n['unknown']} {u} could not be assessed.") for n in q["news"]]
    L += ["", "## If nothing changes", "", q["if_nothing"]["summary"]]
    L += ["", "## Next quarter", ""] + [f"- {p['title']} (owner {p['owner']}, by {p['due']})" for p in q["priorities"]]
    if q["decisions"]:
        L += ["", "## Decisions we need from you", ""] + [f"{i}. {d}" for i, d in enumerate(q["decisions"], 1)]
    L += ["", "---", "", "Effective coverage is the share of your estate that is connected, visible, protected and whose findings are handled; each part multiplies the others, so a gap anywhere shows."]
    return "\n".join(L) + "\n"


def _chart(series: list[dict[str, Any]]) -> str:
    if len(series) < 2:
        return ""
    W, H, ml, mr, mt, mb = 640, 220, 44, 16, 14, 30
    t = [date.fromisoformat(p["as_of"]).toordinal() for p in series]
    t0, t1 = t[0], max(t[-1], t[0] + 1)

    def x(v: int) -> float:
        return ml + (v - t0) / (t1 - t0) * (W - ml - mr)

    def y(v: float) -> float:
        return mt + (1 - v) * (H - mt - mb)

    g = []
    for v in (0, 0.25, 0.5, 0.75, 1):
        g.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="#e5e7eb"/><text x="{ml - 6}" y="{y(v) + 4:.1f}" text-anchor="end">{v:.0%}</text>')
    for key, color in (("coverage", "#1d4ed8"), ("weighted", "#0f766e")):
        pts = " ".join(f"{x(ti):.1f},{y(p[key]):.1f}" for ti, p in zip(t, series))
        g.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.5"/>')
        g += [f'<circle cx="{x(ti):.1f}" cy="{y(p[key]):.1f}" r="3.5" fill="{color}"/>' for ti, p in zip(t, series)]
    g += [f'<text x="{x(ti):.1f}" y="{H - 8}" text-anchor="middle">{escape(p["as_of"][5:])}</text>' for ti, p in zip(t, series)]
    legend = '<p class="legend"><span style="color:#1d4ed8">&#9632;</span> Effective coverage &nbsp; <span style="color:#0f766e">&#9632;</span> Weighted by spend and exposure</p>'
    return f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Effective coverage over the period">{"".join(g)}</svg>{legend}'


def render_html(q: dict[str, Any]) -> str:
    e = escape
    f, la, u = q["first"], q["last"], q["units"]

    def delta(a: float, b: float, pct: bool = True, lower_better: bool = False) -> str:
        if not q["compared"]:
            return ""
        d = (b - a) * (100 if pct else 1)
        if abs(d) < (0.05 if pct else 0.5):
            return '<span class="d">no change</span>'
        good = (d < 0) if lower_better else (d > 0)
        return f'<span class="d {"up" if good else "down"}">{d:+.1f}{" pts" if pct else ""}</span>'

    tiles = [("Effective coverage", _pct(la["coverage"]), delta(f["coverage"], la["coverage"])),
             ("Weighted by spend and exposure", _pct(la["weighted"]), delta(f["weighted"], la["weighted"])),
             ("Critical findings open", str(la["critical_open"]), delta(f["critical_open"], la["critical_open"], pct=False, lower_better=True)),
             (f"{u.capitalize()} connected", f"{la['connected']} of {la['accounts']}", delta(f["connected"], la["connected"], pct=False))]
    sec: list[str] = []
    sec.append(f'<section class="cover"><p class="kicker">Executive review · {e(q["period"]["label"])}</p><h1>{e(q["customer"])}</h1>'
               f'<p class="sub">{e(q["period"]["from"])} to {e(q["period"]["to"])}</p>'
               f'<div class="tiles">' + "".join(f'<div class="tile"><b>{e(v)}</b><span>{e(k)}</span>{d}</div>' for k, v, d in tiles) + '</div>'
               '<h2>In one minute</h2><ul>' + "".join(f"<li>{e(h)}.</li>" for h in q["headline"]) + '</ul></section>')
    parts = "".join(f'<tr><th scope="row">{e(n)}<small>{e(w)}</small></th>' + (f'<td>{_pct(f["parts"][k])}</td>' if q["compared"] else "") + f'<td>{_pct(la["parts"][k])}</td></tr>' for k, (n, w) in PARTS.items())
    heads = (f'<th scope="col">{e(q["baseline"])}</th>' if q["compared"] else "") + f'<th scope="col">{e(q["final"])}</th>'
    sec.append(f'<section><h2>Where you stand</h2>{_chart(q["series"])}<table><thead><tr><th scope="col">Part of coverage</th>{heads}</tr></thead><tbody>{parts}</tbody></table>'
               '<p class="note">Effective coverage multiplies the four parts: a gap in any one of them shows in the total.</p></section>')
    r = q["receipt"]
    if r:
        sev = r["findings"]["by_severity"]
        sec.append('<section><h2>What the quarter delivered</h2><div class="tiles">'
                   f'<div class="tile"><b>{len(r["connected"]["accounts"])}</b><span>{e(u)} brought under watch</span></div>'
                   f'<div class="tile"><b>{r["findings"]["closed"]}</b><span>findings closed ({sev.get("critical", 0)} critical)</span></div>'
                   f'<div class="tile"><b>{r["findings"]["decided"]}</b><span>findings given an owner or a decision</span></div>'
                   f'<div class="tile"><b>{r["capabilities"]["gained"]}</b><span>protections switched on</span></div></div>'
                   '<ul>' + "".join(f"<li>{e(h)}.</li>" for h in r["headline"]) + f'<li>Our commitments: {r["promises"]["kept"]} delivered, {r["promises"]["on_time"]} on time.</li></ul>'
                   + ('<h3>Still to do</h3><ul>' + "".join(f"<li>{e(x)}</li>" for x in r["remaining"][:4]) + '</ul>' if r["remaining"] else "") + '</section>')
    g = q["engagement"]
    sec.append(f'<section><h2>Working together</h2><p>{g["touches"]} recorded touch(es) in the period' + (": " + e(", ".join(f"{n} {k}" for k, n in g["by_kind"].items())) if g["by_kind"] else "") + '.</p>'
               + ('<ul class="timeline">' + "".join(f'<li><time>{e(m["date"])}</time> <b>{e(m["kind"])}</b> {e(m["summary"] or m["next_step"])}</li>' for m in g["moments"]) + '</ul>' if g["moments"] else "")
               + ('<h3>Open on our side</h3><ul>' + "".join(f'<li>{e(c["what"])} <small>due {e(c["due"])}{" · late" if c["overdue"] else ""}</small></li>' for c in g["open"]) + '</ul>' if g["open"] else "") + '</section>')
    k = q["risk"]
    news = ""
    if q["news"]:
        news = '<h3>Threats this quarter that touched you</h3><ul>' + "".join(
            f'<li><b>{e(n["title"])}</b> <small>{"known exploited" if n["kev"] else e(n["severity"])}</small> · '
            + (f'{n["uncovered"]} of {n["exposed"]} exposed {e(u)} not yet covered' if n["uncovered"] else f'all {n["exposed"]} exposed {e(u)} covered' if n["exposed"] else f'{n["unknown"]} {e(u)} could not be assessed') + '</li>' for n in q["news"]) + '</ul>'
    sec.append(f'<section><h2>Exposure today</h2><div class="tiles"><div class="tile"><b>{k["critical_open"]}</b><span>critical findings open</span></div>'
               f'<div class="tile"><b>{k["critical_internet"]}</b><span>of them exposed to the internet</span></div>'
               f'<div class="tile"><b>{k["unconnected_spend_share"]:.0%}</b><span>of cloud spend not yet connected</span></div></div>'
               + ('<ul>' + "".join(f"<li>{e(s)}</li>" for s in k["heaviest"]) + '</ul>' if k["heaviest"] else "") + news
               + f'<h3>If nothing changes</h3><p>{e(q["if_nothing"]["summary"])}</p></section>')
    sec.append('<section><h2>Next quarter</h2><ol>' + "".join(f'<li><b>{e(p["title"])}</b><small>Owner {e(p["owner"])} · by {e(p["due"])}</small></li>' for p in q["priorities"]) + '</ol>'
               + ('<h2>Decisions we need from you</h2><ol class="ask">' + "".join(f"<li>{e(d)}</li>" for d in q["decisions"]) + '</ol>' if q["decisions"] else "") + '</section>')
    css = ("body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;margin:0;background:#f8fafc}"
           "section{background:#fff;max-width:900px;margin:24px auto;padding:36px 44px;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.08)}"
           ".cover{background:linear-gradient(135deg,#eff6ff,#fff 60%)}h1{font-size:34px;margin:4px 0}h2{font-size:22px;margin:0 0 14px}h3{font-size:16px;margin:22px 0 8px}"
           ".kicker{text-transform:uppercase;letter-spacing:.08em;font-size:12px;color:#1d4ed8;margin:0}.sub{color:#475569;margin:0 0 20px}"
           ".tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}.tile{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px}"
           ".tile b{display:block;font-size:26px}.tile span{color:#475569;font-size:13px}.d{display:block;font-size:12px;color:#64748b}.d.up{color:#047857}.d.down{color:#b91c1c}"
           "table{border-collapse:collapse;width:100%;margin-top:12px}th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left}td{font-variant-numeric:tabular-nums}"
           "th small,li small{display:block;color:#64748b;font-weight:400;font-size:12px}svg{width:100%;height:auto}svg text{font-size:11px;fill:#64748b}"
           ".legend{font-size:12px;color:#475569}.note{color:#64748b;font-size:13px}.timeline time{color:#64748b;font-variant-numeric:tabular-nums}"
           "ol.ask li{margin:8px 0;font-weight:600}li{margin:6px 0}footer{max-width:900px;margin:0 auto 30px;color:#94a3b8;font-size:12px;padding:0 8px}"
           "@media print{body{background:#fff}section{box-shadow:none;page-break-after:always;margin:0 auto}}")
    return ("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            f"<title>{e(q['customer'])}: executive review {e(q['period']['label'])}</title><style>{css}</style></head><body>"
            + "".join(sec) + f"<footer>Built from {len(q['snapshots'])} recorded snapshot(s) ({e(', '.join(q['snapshots']))}). Print to PDF: one page per section.</footer></body></html>\n")


# ------------------------------------------------------------------ as a PowerPoint deck

MINUS = "\u2212"
INK, MUTED, ACCENT, GOOD, BAD, SOFT, LINE = "1B2430", "5B6573", "2E46C8", "1E7F4F", "B4232A", "F3F5F9", "D5DBE8"


def render_pptx(q: dict[str, Any]) -> bytes:
    """The same review as slides to present: one idea per slide, the numbers large, no internal jargon."""
    from .slides import Run, Slide, package

    u, f, la = q["units"], q["first"], q["last"]
    foot = f'{q["customer"]} · Executive review {q["period"]["label"]}'
    slides: list[Slide] = []

    def page(title: str, kicker: str) -> Slide:
        s = Slide(name=title)
        s.rect(0, 0, 13.333, 0.12, ACCENT)
        s.text(0.8, 0.55, 11.7, 0.35, [[Run(kicker, 13, True, ACCENT)]])
        s.text(0.8, 0.9, 11.7, 0.8, [[Run(title, 30, True, INK)]])
        s.text(0.8, 6.95, 9.5, 0.3, [[Run(foot, 11, False, MUTED)]])
        s.text(11.0, 6.95, 1.5, 0.3, [[Run(str(len(slides) + 1), 11, False, MUTED)]], align="r")
        slides.append(s)
        return s

    def tile(s: Slide, x: float, y: float, w: float, value: str, label: str, color: str = ACCENT) -> None:
        s.rect(x, y, w, 1.55, SOFT, radius=True)
        s.text(x + 0.25, y + 0.2, w - 0.5, 0.7, [[Run(value, 34, True, color)]])
        s.text(x + 0.25, y + 0.95, w - 0.5, 0.55, [[Run(label, 13, False, INK)]])

    # 1. cover: who, when, and the four things to remember
    s = Slide(name="Cover")
    s.rect(0, 0, 0.28, 7.5, ACCENT)
    s.text(0.9, 0.9, 11.5, 0.4, [[Run(f'Executive review · {q["period"]["label"]}', 16, True, ACCENT)]])
    s.text(0.9, 1.35, 11.5, 1.1, [[Run(q["customer"], 44, True, INK)]])
    s.text(0.9, 2.45, 11.5, 0.4, [[Run(f'{q["period"]["from"]} to {q["period"]["to"]}' + (f' · compared with {q["baseline"]}' if q["compared"] else ""), 16, False, MUTED)]])
    s.text(0.9, 3.35, 11.5, 0.45, [[Run("In one minute", 20, True, INK)]])
    s.text(0.9, 3.9, 11.5, 2.8, [[Run(h + ".", 20, False, INK)] for h in q["headline"][:5]], bullets=True, space_after=10)
    s.text(0.9, 6.95, 9.5, 0.3, [[Run("Prepared with Beyond 90", 11, False, MUTED)]])
    slides.append(s)

    # 2. where they stand: the four parts of coverage, then and now
    s = page("Where you stand", "Coverage, part by part")
    y = 1.95
    for k, (name, what) in PARTS.items():
        now, then = la["parts"][k], f["parts"][k]
        s.text(0.8, y, 3.3, 0.4, [[Run(name, 20, True, INK)]])
        s.text(0.8, y + 0.42, 3.3, 0.4, [[Run(what, 11, False, MUTED)]])
        s.rect(4.3, y + 0.1, 6.0, 0.26, SOFT)
        if q["compared"]:
            s.rect(4.3, y + 0.1, 6.0 * max(then, 0.005), 0.26, LINE)
        s.rect(4.3, y + 0.46, 6.0, 0.26, SOFT)
        s.rect(4.3, y + 0.46, 6.0 * max(now, 0.005), 0.26, ACCENT)
        delta = (now - then) * 100
        s.text(10.6, y + 0.02, 2.2, 0.45, [[Run(_pct(now), 22, True, INK)]], align="r")
        if q["compared"]:
            s.text(10.6, y + 0.48, 2.2, 0.35, [[Run(("+" if delta >= 0 else MINUS) + f"{abs(delta):.1f} pts since {q['baseline']}", 11, False, GOOD if delta >= 0 else BAD)]], align="r")
        y += 1.08
    if q["compared"]:
        s.text(4.3, 6.35, 6.0, 0.3, [[Run(f"Grey: {q['baseline']}   Blue: {q['final']}", 11, False, MUTED)]])

    # 3. what the quarter delivered
    r = q["receipt"]
    if r:
        s = page("What the quarter delivered", "Results")
        sev = r["findings"]["by_severity"]
        for i, (v, label) in enumerate([(len(r["connected"]["accounts"]), f"{u} brought under watch"), (r["findings"]["closed"], f"findings closed ({sev.get('critical', 0)} critical)"),
                                        (r["findings"]["decided"], "findings given an owner or a decision"), (r["capabilities"]["gained"], "protections switched on")]):
            tile(s, 0.8 + i * 2.98, 1.95, 2.78, str(v), label, GOOD)
        s.text(0.8, 3.85, 11.7, 2.0, [[Run(h + ".", 18, False, INK)] for h in r["headline"][:3]]
               + [[Run(f"Our commitments: {r['promises']['kept']} delivered, {r['promises']['on_time']} on time.", 18, False, INK)]], bullets=True, space_after=8)
        if r["remaining"]:
            s.text(0.8, 5.85, 11.7, 0.9, [[Run("Still to do: ", 13, True, MUTED), Run("; ".join(x.rstrip(".") for x in r["remaining"][:3]) + ".", 13, False, MUTED)]])

    # 4. exposure today
    k = q["risk"]
    s = page("Exposure today", "Risk")
    tile(s, 0.8, 1.95, 3.8, str(k["critical_open"]), "critical findings open", BAD if k["critical_open"] else GOOD)
    tile(s, 4.77, 1.95, 3.8, str(k["critical_internet"]), "of them exposed to the internet", BAD if k["critical_internet"] else GOOD)
    tile(s, 8.74, 1.95, 3.8, f"{k['unconnected_spend_share']:.0%}", "of cloud spend not yet connected", BAD if k["unconnected_spend_share"] > 0.1 else INK)
    body = [[Run(x, 16, False, INK)] for x in k["heaviest"][:2]]
    for n in q["news"][:3]:
        state = (f"{n['uncovered']} of {n['exposed']} exposed {u} not yet covered" if n["uncovered"] else
                 f"all {n['exposed']} exposed {u} covered" if n["exposed"] else f"{n['unknown']} {u} could not be assessed")
        body.append([Run(n["title"], 16, True, INK), Run(f" ({'known exploited' if n['kev'] else n['severity']}): {state}.", 16, False, INK)])
    if body:
        s.text(0.8, 3.9, 11.7, 2.8, body, bullets=True, space_after=8)

    # 5. the two futures: if nothing changes, and the plan
    s = page("Next quarter", "What happens next")
    s.rect(0.8, 1.95, 5.5, 4.6, SOFT, radius=True)
    s.rect(0.8, 1.95, 0.1, 4.6, BAD)
    s.text(1.15, 2.2, 4.9, 0.45, [[Run("If nothing changes", 20, True, BAD)]])
    s.text(1.15, 2.8, 4.9, 3.6, [[Run(q["if_nothing"]["summary"], 15, False, INK)]])
    s.text(6.8, 1.95, 5.8, 0.45, [[Run("The plan", 20, True, ACCENT)]])
    s.text(6.8, 2.55, 5.8, 4.0, [[Run(p["title"], 16, True, INK), Run(f"\n{p['owner']} · by {p['due']}", 12, False, MUTED)] for p in q["priorities"][:4]], bullets=True, space_after=12)

    # 6. the decisions only they can take
    if q["decisions"]:
        s = page("Decisions we need from you", "Asks")
        y = 1.95
        for i, d in enumerate(q["decisions"][:4], 1):
            s.rect(0.8, y, 11.7, 1.05, SOFT, radius=True)
            s.text(1.05, y + 0.2, 0.7, 0.7, [[Run(str(i), 28, True, ACCENT)]])
            s.text(1.8, y + 0.2, 10.4, 0.75, [[Run(d, 17, False, INK)]], anchor="ctr")
            y += 1.2
    return package(slides, foot)
