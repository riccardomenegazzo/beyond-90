"""Renderers: text, Markdown, JSON and a self-contained HTML report.

The HTML report follows docs/design.md: stage colours in a fixed order, the
naive score as a ghost next to the real one, the lost share hatched, direct
labels, a table view for every chart, and light/dark selected from the same
tokens. It needs no JavaScript and loads nothing from the network.
"""

from __future__ import annotations

import json
from html import escape
from typing import Optional

from . import __version__
from .playbooks import Action
from .scoring import CHECKPOINTS, STAGE_NAMES, Score

STAGES = ("L1", "L2", "L3", "L4")


def pct(v: Optional[float], digits: int = 1) -> str:
    return "n/a" if v is None else f"{v * 100:.{digits}f}%"


def pts(v: float) -> str:
    return f"{v * 100:+.1f} pts"


def cumulative(score: Score) -> list[tuple[str, float, float]]:
    """(stage, before, after) for the waterfall."""
    out, prev = [], 1.0
    for sid in STAGES:
        cur = prev * score.stages[sid].value
        out.append((sid, prev, cur))
        prev = cur
    return out


def _delta(score: Score, previous: Optional[dict]) -> Optional[float]:
    return None if not previous else score.yield_ - previous["yield"]


# ---------------------------------------------------------------- JSON / text

def render_json(score: Score, actions: list[Action], history: Optional[list[dict]] = None) -> str:
    payload = score.to_dict()
    payload["actions"] = [a.to_dict() for a in actions]
    if history is not None:
        payload["history"] = history
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def render_text(score: Score, actions: list[Action], top: int = 8) -> str:
    lines = [f"{score.customer}  as of {score.as_of}  ceiling {score.ceiling_version}", ""]
    naive = f"   legacy metric {pct(score.naive)}   gap {(score.naive - score.yield_) * 100:.1f} pts" if score.naive is not None else ""
    lines.append(f"Yield {pct(score.yield_)}{naive}")
    lines.append(f"Against baseline ceiling {score.baseline['ceiling']}: {pct(score.baseline['yield'])}")
    lines.append("")
    for sid in STAGES:
        st = score.stages[sid]
        lines.append(f"  {sid} {st.name:<12} {pct(st.value):>7}   ({st.numerator:g}/{st.denominator:g})" + ("" if st.has_data else "   no data"))
    if score.reach:
        lines.append(f"  Reach {'':<8} {pct(score.reach['value']):>7}   ({score.reach['teams']} teams)")
    t = score.target
    nxt = f", next checkpoint {pct(t['next_checkpoint'], 0)}" if t["next_checkpoint"] else ""
    lines.append(f"\nTarget {pct(t['value'])} ({t['mode']}){nxt}")
    o = score.outcomes
    if o["zero_critical"] is not None:
        lines.append(f"Critical open: {o['critical_open']}   MTTR streak: {o['mttr_streak']}   downgrade suspects: {len(o['reclassification_suspects'])}")
    if actions:
        lines.append(f"\nTop actions ({min(top, len(actions))} of {len(actions)}):")
        for a in actions[:top]:
            lines.append(f"  [{a.leak:<11}] {a.effect_points:>5.1f} pts  {a.title}  (due {a.due}, owner {a.owner})")
    for w in score.warnings:
        lines.append(f"\nNote: {w}")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------- Markdown

def render_markdown(score: Score, actions: list[Action], history: Optional[list[dict]] = None, previous: Optional[dict] = None, top: int = 15) -> str:
    L: list[str] = [f"# {score.customer}: adoption score", ""]
    L.append(f"As of {score.as_of} · ceiling {score.ceiling_version} · baseline {score.baseline['ceiling']}")
    L.append("")
    head = f"**Yield {pct(score.yield_)}**"
    if score.naive is not None:
        head += f" against a legacy metric of {pct(score.naive)} (gap {(score.naive - score.yield_) * 100:.1f} points)"
    d = _delta(score, previous)
    if d is not None:
        head += f"; {pts(d)} since {previous['as_of']}"
    L += [head + ".", ""]
    L += ["| Stage | Pass rate | Count | Meaning |", "|---|---|---|---|"]
    meaning = {
        "L1": "connected / true accounts (billing, organization, SSO)",
        "L2": "inventoried resource types / expected, on connected accounts",
        "L3": "active relevant modules / relevant modules at the ceiling",
        "L4": "findings with owner and decision / findings past triage",
    }
    for sid in STAGES:
        st = score.stages[sid]
        L.append(f"| {sid} {st.name} | {pct(st.value)} | {st.numerator:g} / {st.denominator:g} | {meaning[sid]} |")
    L.append(f"| **Yield** | **{pct(score.yield_)}** | | L1 × L2 × L3 × L4 |")
    L.append("")
    b = score.baseline
    L.append(f"Against the frozen baseline ceiling ({b['ceiling']}), Yield would be {pct(b['yield'])}. The difference is headroom added by releases since then.")
    L.append("")
    if score.reach:
        r = score.reach
        L += ["## Reach", "", f"Reach {pct(r['value'])} across {r['teams']} teams with cloud assets.", ""]
        for k, v in r["components"].items():
            L.append(f"- {k.replace('_', ' ')}: {pct(v)}")
        L.append("")
    if score.entitlements:
        L += ["## Licensed versus used", "", "| Unit | Licensed | Used | Utilization |", "|---|---|---|---|"]
        for e in score.entitlements:
            L.append(f"| {e['unit']} | {e['licensed']:g} | {e['used']:g} | {pct(e['utilization'], 0)}{' (below target)' if e['below_target'] else ''} |")
        L.append("")
    o = score.outcomes
    if o["findings_total"]:
        L += ["## Outcomes", ""]
        L.append(f"- Critical findings open: {o['critical_open']}" + (" (zero critical)" if o["zero_critical"] else ""))
        L.append(f"- MTTR streak (consecutive critical fixes within SLA): {o['mttr_streak']}")
        for k in ("critical", "high", "medium", "low"):
            if k in o["mttr"]:
                L.append(f"- Mean time to remediate, {k}: {o['mttr'][k]['mean_days']:.1f} days (n={o['mttr'][k]['n']})")
        if o["reclassification_suspects"]:
            L.append(f"- Severity downgrades near an SLA deadline: {len(o['reclassification_suspects'])}")
        L.append("")
    if actions:
        L += [f"## Actions (top {min(top, len(actions))} of {len(actions)})", "", "| Effect | Leak | Action | Owner | Due |", "|---|---|---|---|---|"]
        for a in actions[:top]:
            L.append(f"| {a.effect_points:.1f} pts | {a.leak} | {a.title} | {a.owner} | {a.due} |")
        L += ["", "Effect is an estimate that treats each stage in isolation; use it to rank, not to promise.", ""]
    if history:
        L += ["## History", "", "| As of | Ceiling | Yield | Legacy | L1 | L2 | L3 | L4 |", "|---|---|---|---|---|---|---|---|"]
        for h in history:
            L.append(f"| {h['as_of']} | {h['ceiling_version']} | {pct(h['yield'])} | {pct(h['naive'])} | {pct(h['l1'])} | {pct(h['l2'])} | {pct(h['l3'])} | {pct(h['l4'])} |")
        L.append("")
    if score.warnings:
        L += ["## Notes", ""] + [f"- {w}" for w in score.warnings] + [""]
    return "\n".join(L)


# ----------------------------------------------------------------------- HTML

CSS = """
:root{color-scheme:light dark;--surface:#fcfcfb;--page:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--base:#c3c2b7;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--hatch:#86b6ef;--border:rgba(11,11,11,.10);--good:#006300;--crit:#d03b3b}
@media (prefers-color-scheme:dark){:root{--surface:#1a1a19;--page:#0d0d0d;--ink:#f0efec;--ink2:#c3c2b7;--grid:#2c2c2a;--base:#383835;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--hatch:#3987e5;--border:rgba(255,255,255,.10);--good:#0ca30c}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 64px}
header h1{font-size:20px;margin:0 0 4px}header p{margin:0;color:var(--ink2)}
.chip{display:inline-block;border:1px solid var(--border);border-radius:999px;padding:1px 10px;font-size:12px;color:var(--ink2)}
section{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-top:16px}
h2{font-size:16px;margin:0 0 12px}
.hero{display:flex;flex-wrap:wrap;gap:24px;align-items:baseline}
.hero .big{font-size:56px;font-weight:700;line-height:1}
.hero .ghost{font-size:28px;color:var(--muted);border:2px dashed var(--base);border-radius:10px;padding:2px 12px}
.hero .cap{color:var(--ink2);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{border:1px solid var(--border);border-radius:10px;padding:12px;border-top:4px solid var(--c)}
.card .v{font-size:28px;font-weight:700}.card .k{color:var(--ink2);font-size:13px}.card ul{margin:8px 0 0;padding-left:18px;color:var(--ink2);font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
th{color:var(--ink2);font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
details{margin-top:8px}summary{cursor:pointer;color:var(--ink2);font-size:13px}
svg{max-width:100%;height:auto;display:block}svg text{fill:var(--ink);font:12px system-ui,sans-serif}svg .m{fill:var(--muted)}
.s1{fill:var(--s1)}.s2{fill:var(--s2)}.s3{fill:var(--s3)}.s4{fill:var(--s4)}
.warn{color:var(--ink2);font-size:13px}footer{margin-top:24px;color:var(--muted);font-size:12px}
@media print{body{background:#fff}section{break-inside:avoid}}
"""


def _svg_waterfall(score: Score) -> str:
    W, H, ml, mt, mb, mr = 640, 300, 44, 16, 52, 8
    ph = H - mt - mb
    bw, gap = 80, 36
    def y(v: float) -> float:
        return mt + ph * (1 - v)
    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Waterfall of Yield by stage, from 100% to {pct(score.yield_)}">',
             '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
             '<line x1="0" y1="0" x2="0" y2="6" stroke="var(--hatch)" stroke-width="1.5"/></pattern></defs>']
    for t in (0, .25, .5, .75, 1.0):
        parts.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(t):.1f}" y2="{y(t):.1f}" stroke="var(--grid)" stroke-width="1"/>')
        parts.append(f'<text class="m" x="{ml - 6}" y="{y(t) + 4:.1f}" text-anchor="end">{int(t * 100)}%</text>')
    for i, (sid, before, after) in enumerate(cumulative(score)):
        x = ml + 16 + i * (bw + gap)
        cls = f"s{i + 1}"
        st = score.stages[sid]
        tip = f"{sid} {st.name}: {pct(st.value)} pass rate ({st.numerator:g}/{st.denominator:g}); Yield after this stage {pct(after)}"
        parts.append(f'<g><title>{escape(tip)}</title>')
        if before - after > 1e-9:
            parts.append(f'<rect x="{x}" y="{y(before):.1f}" width="{bw}" height="{max(y(after) - y(before), 0):.1f}" rx="4" fill="url(#hatch)" stroke="var(--hatch)" stroke-width="1"/>')
        parts.append(f'<rect class="{cls}" x="{x}" y="{y(after):.1f}" width="{bw}" height="{max(y(0) - y(after), 0):.1f}" rx="4"/>')
        parts.append(f'<text x="{x + bw / 2}" y="{y(after) + 18:.1f}" text-anchor="middle" fill="#fff" style="fill:#fff;font-weight:600">{pct(after)}</text>')
        lost = before - after
        if lost > 1e-9:
            parts.append(f'<text x="{x + bw / 2}" y="{y(before) - 4:.1f}" text-anchor="middle" class="m">-{lost * 100:.1f} pts</text>')
        parts.append(f'<text x="{x + bw / 2}" y="{H - 30}" text-anchor="middle" style="font-weight:600">{sid}</text>')
        parts.append(f'<text x="{x + bw / 2}" y="{H - 14}" text-anchor="middle" class="m">{escape(STAGE_NAMES[sid])}</text>')
        parts.append('</g>')
    parts.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(0)}" y2="{y(0)}" stroke="var(--base)"/></svg>')
    return "".join(parts)


def _svg_checkpoints(score: Score) -> str:
    W, H, lo = 640, 84, 0.60
    x0, x1 = 24, 616
    def x(v: float) -> float:
        return x0 + (x1 - x0) * (min(max(v, lo), 1.0) - lo) / (1 - lo)
    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Yield {pct(score.yield_)} on a track with checkpoints at 90, 95 and 98 percent">',
             f'<line x1="{x0}" x2="{x1}" y1="40" y2="40" stroke="var(--base)" stroke-width="3" stroke-linecap="round"/>']
    for c in (*CHECKPOINTS, 1.0):
        parts.append(f'<line x1="{x(c):.1f}" x2="{x(c):.1f}" y1="32" y2="48" stroke="var(--base)" stroke-width="2"/>')
        if c < 1.0:
            parts.append(f'<text class="m" x="{x(c):.1f}" y="66" text-anchor="middle">{int(c * 100)}%</text>')
    parts.append(f'<text class="m" x="{x0}" y="66" text-anchor="start">{int(lo * 100)}%</text>')
    if score.naive is not None:
        parts.append(f'<g><title>Legacy metric {pct(score.naive)}</title><circle cx="{x(score.naive):.1f}" cy="40" r="7" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="3 2"/></g>')
    parts.append(f'<g><title>Yield {pct(score.yield_)}</title><circle class="s1" cx="{x(score.yield_):.1f}" cy="40" r="8" style="stroke:var(--surface);stroke-width:2"/></g>')
    parts.append(f'<text x="{x(score.yield_):.1f}" y="20" text-anchor="middle" style="font-weight:600">{pct(score.yield_)}</text>')
    parts.append('</svg>')
    return "".join(parts)


def _svg_history(history: list[dict]) -> str:
    W, H, ml, mr, mt, mb = 640, 160, 44, 12, 12, 28
    n = len(history)
    def x(i: int) -> float:
        return ml + (W - ml - mr) * (i / (n - 1))
    ys = [h["yield"] for h in history] + [h["naive"] for h in history if h["naive"] is not None]
    lo, hi = max(0.0, min(ys) - 0.05), min(1.0, max(ys) + 0.05)
    if hi - lo < 0.1:
        hi = min(1.0, lo + 0.1)
    def y(v: float) -> float:
        return mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo))
    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Yield over time">']
    for t in (lo, (lo + hi) / 2, hi):
        parts.append(f'<line x1="{ml}" x2="{W - mr}" y1="{y(t):.1f}" y2="{y(t):.1f}" stroke="var(--grid)"/><text class="m" x="{ml - 6}" y="{y(t) + 4:.1f}" text-anchor="end">{t * 100:.0f}%</text>')
    nv = [(i, h["naive"]) for i, h in enumerate(history) if h["naive"] is not None]
    if len(nv) > 1:
        parts.append('<polyline fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3" points="' + " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in nv) + '"/>')
    parts.append('<polyline fill="none" stroke="var(--s1)" stroke-width="2" points="' + " ".join(f"{x(i):.1f},{y(h['yield']):.1f}" for i, h in enumerate(history)) + '"/>')
    for i, h in enumerate(history):
        parts.append(f'<g><title>{escape(h["as_of"])}: Yield {pct(h["yield"])}</title><circle class="s1" cx="{x(i):.1f}" cy="{y(h["yield"]):.1f}" r="4" style="stroke:var(--surface);stroke-width:2"/></g>')
    parts.append(f'<text class="m" x="{ml}" y="{H - 8}">{escape(history[0]["as_of"])}</text><text class="m" x="{W - mr}" y="{H - 8}" text-anchor="end">{escape(history[-1]["as_of"])}</text></svg>')
    return "".join(parts)


def _leak_summary(score: Score, sid: str) -> list[str]:
    st = score.stages[sid]
    out: list[str] = []
    if sid == "L1":
        for leak in st.leaks[:3]:
            out.append(f"{leak['account_id']} ({leak['provider']}, owner {leak['owner'] or 'unassigned'})")
        if len(st.leaks) > 3:
            out.append(f"+{len(st.leaks) - 3} more")
    elif sid == "L2":
        for leak in st.leaks[:3]:
            out.append(f"{leak['provider']} {leak['resource_type']}: {len(leak['accounts'])} account(s)")
        if len(st.leaks) > 3:
            out.append(f"+{len(st.leaks) - 3} more")
    elif sid == "L3":
        for leak in st.leaks[:3]:
            out.append(f"{leak['name']}: {leak['inactive']} inactive" + (" (new)" if leak["new_since_baseline"] else ""))
        if len(st.leaks) > 3:
            out.append(f"+{len(st.leaks) - 3} more")
    else:
        for leak in st.leaks:
            out.append(f"{leak['kind'].replace('_', ' ')}: {leak['count']}")
    return out or ["No leaks found."]


def render_html(score: Score, actions: list[Action], history: Optional[list[dict]] = None, previous: Optional[dict] = None, top: int = 15) -> str:
    e = escape
    h: list[str] = []
    d = _delta(score, previous)
    delta = f" · {pts(d)} since {e(previous['as_of'])}" if d is not None else ""
    h.append(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
             f'<title>{e(score.customer)}: adoption score</title><style>{CSS}</style></head><body><main>')
    h.append(f'<header><h1>{e(score.customer)}: adoption score</h1><p>As of {e(score.as_of)} <span class="chip">ceiling {e(score.ceiling_version)}</span> '
             f'<span class="chip">baseline {e(score.baseline["ceiling"])}</span>{delta}</p></header>')
    # hero
    h.append('<section aria-labelledby="hero"><h2 id="hero">Yield</h2><div class="hero">')
    h.append(f'<div><div class="big">{pct(score.yield_)}</div><div class="cap">real: L1 × L2 × L3 × L4</div></div>')
    if score.naive is not None:
        h.append(f'<div><div class="ghost" title="Legacy metric: connected / accounts in the onboarding plan">{pct(score.naive)}</div>'
                 f'<div class="cap">legacy metric · gap {(score.naive - score.yield_) * 100:.1f} pts</div></div>')
    t = score.target
    nxt = f", next checkpoint {pct(t['next_checkpoint'], 0)}" if t["next_checkpoint"] else ""
    h.append(f'<div><div class="cap">Target this period</div><div style="font-size:22px;font-weight:600">{pct(t["value"])}</div><div class="cap">{e(t["mode"])}{nxt}</div></div>')
    h.append('</div>')
    h.append(f'<p class="warn">Against the frozen baseline ceiling ({e(score.baseline["ceiling"])}) Yield is {pct(score.baseline["yield"])}. '
             'The difference is headroom added by releases since then; it is not a regression.</p>')
    h.append(_svg_checkpoints(score))
    h.append('</section>')
    # waterfall
    h.append('<section aria-labelledby="wf"><h2 id="wf">Where the score leaks</h2>')
    h.append(_svg_waterfall(score))
    h.append('<details><summary>Table view</summary><table><thead><tr><th>Stage</th><th class="n">Pass rate</th><th class="n">Count</th><th class="n">Yield after</th></tr></thead><tbody>')
    for sid, _, after in cumulative(score):
        st = score.stages[sid]
        h.append(f'<tr><td>{sid} {e(st.name)}</td><td class="n">{pct(st.value)}</td><td class="n">{st.numerator:g} / {st.denominator:g}</td><td class="n">{pct(after)}</td></tr>')
    h.append('</tbody></table></details></section>')
    # stage cards
    h.append('<section aria-labelledby="st"><h2 id="st">Stages</h2><div class="cards">')
    for i, sid in enumerate(STAGES, 1):
        st = score.stages[sid]
        items = "".join(f"<li>{e(x)}</li>" for x in _leak_summary(score, sid))
        h.append(f'<div class="card" style="--c:var(--s{i})"><div class="k">{sid} {e(st.name)}</div><div class="v">{pct(st.value)}</div>'
                 f'<div class="k">{st.numerator:g} of {st.denominator:g}</div><ul>{items}</ul></div>')
    h.append('</div></section>')
    # actions
    if actions:
        h.append(f'<section aria-labelledby="ac"><h2 id="ac">Actions (top {min(top, len(actions))} of {len(actions)})</h2><table><thead><tr>'
                 '<th class="n">Effect</th><th>Leak</th><th>Action</th><th>Owner</th><th>Due</th></tr></thead><tbody>')
        for a in actions[:top]:
            h.append(f'<tr><td class="n">{a.effect_points:.1f} pts</td><td>{e(a.leak)}</td><td><strong>{e(a.title)}</strong><br><span class="warn">{e(a.detail)}</span></td>'
                     f'<td>{e(a.owner)}</td><td>{e(a.due)}</td></tr>')
        h.append('</tbody></table><p class="warn">Effect is an estimate that treats each stage in isolation. Use it to rank.</p></section>')
    # reach, entitlements, outcomes
    if score.reach:
        r = score.reach
        h.append(f'<section aria-labelledby="re"><h2 id="re">Reach {pct(r["value"])}</h2><table><tbody>')
        for k, v in r["components"].items():
            h.append(f'<tr><td>{e(k.replace("_", " "))}</td><td class="n">{pct(v)}</td></tr>')
        h.append(f'</tbody></table><p class="warn">{r["teams"]} teams own cloud assets. Reach is reported next to Yield, not inside it.</p></section>')
    if score.entitlements:
        h.append('<section aria-labelledby="en"><h2 id="en">Licensed versus used</h2><table><thead><tr><th>Unit</th><th class="n">Licensed</th><th class="n">Used</th><th class="n">Utilization</th><th>Status</th></tr></thead><tbody>')
        for x in score.entitlements:
            status = "below target" if x["below_target"] else "on target"
            h.append(f'<tr><td>{e(x["unit"])}</td><td class="n">{x["licensed"]:g}</td><td class="n">{x["used"]:g}</td><td class="n">{pct(x["utilization"], 0)}</td><td>{status}</td></tr>')
        h.append('</tbody></table></section>')
    o = score.outcomes
    if o["findings_total"]:
        h.append('<section aria-labelledby="ou"><h2 id="ou">Outcomes</h2><table><tbody>')
        h.append(f'<tr><td>Critical findings open</td><td class="n">{o["critical_open"]}</td></tr>')
        h.append(f'<tr><td>Consecutive critical fixes within SLA (streak)</td><td class="n">{o["mttr_streak"]}</td></tr>')
        for k in ("critical", "high", "medium", "low"):
            if k in o["mttr"]:
                h.append(f'<tr><td>Mean time to remediate, {k}</td><td class="n">{o["mttr"][k]["mean_days"]:.1f} days (n={o["mttr"][k]["n"]})</td></tr>')
        h.append(f'<tr><td>Severity downgrades near an SLA deadline</td><td class="n">{len(o["reclassification_suspects"])}</td></tr>')
        h.append('</tbody></table></section>')
    if history and len(history) > 1:
        h.append('<section aria-labelledby="hi"><h2 id="hi">History</h2>')
        h.append(_svg_history(history))
        h.append('<details><summary>Table view</summary><table><thead><tr><th>As of</th><th>Ceiling</th><th class="n">Yield</th><th class="n">Legacy</th></tr></thead><tbody>')
        for x in history:
            h.append(f'<tr><td>{e(x["as_of"])}</td><td>{e(x["ceiling_version"])}</td><td class="n">{pct(x["yield"])}</td><td class="n">{pct(x["naive"])}</td></tr>')
        h.append('</tbody></table></details></section>')
    if score.warnings:
        h.append('<section><h2>Notes</h2><ul>' + "".join(f"<li>{e(w)}</li>" for w in score.warnings) + '</ul></section>')
    h.append(f'<footer>Generated by beyond90 {e(__version__)}. Local report: no scripts, no network requests.</footer></main></body></html>')
    return "".join(h)
