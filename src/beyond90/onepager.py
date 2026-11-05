"""A one-page summary for the customer's CISO, built from the executive review.

The same facts as the executive review, cut to what fits on a single A4 page: where coverage stands, in the four
parts a customer recognises, what is exposed, what happens if nothing changes, the next three things we will do and the
decisions we need. No internal stage names and no maturity labels. Printing it to PDF gives exactly one page.
"""

from __future__ import annotations

from html import escape
from typing import Any

from .execqbr import PARTS

_MAX_PRIORITIES = 3
_MAX_DECISIONS = 3


def _pct(v: float) -> str:
    return f"{v:.0%}"


def _bar(value: float) -> str:
    return f'<span class="bar" role="img" aria-label="{_pct(value)}"><i style="width:{max(0.0, min(1.0, value)) * 100:.0f}%"></i></span>'


def render_onepager(q: dict[str, Any]) -> str:
    """Self-contained HTML (no script, no outside request) for one customer, from ``execqbr.build``."""
    e = escape
    la, u, k = q["last"], q["units"], q["risk"]
    moved = ""
    if q["compared"]:
        d = (la["coverage"] - q["first"]["coverage"]) * 100
        moved = f'<span class="{"up" if d >= 0 else "down"}">{d:+.1f} pts since {e(q["baseline"])}</span>'
    parts = "".join(f"<li><span>{e(n)}<small>{e(w)}</small></span>{_bar(la['parts'][key])}<b>{_pct(la['parts'][key])}</b></li>" for key, (n, w) in PARTS.items())
    priorities = "".join(f'<li><b>{e(p["title"])}</b><small>Owner {e(p["owner"])} · by {e(p["due"])}</small></li>' for p in q["priorities"][:_MAX_PRIORITIES])
    decisions = "".join(f"<li>{e(d)}</li>" for d in q["decisions"][:_MAX_DECISIONS])
    ask = f'<h2>Decisions we need from you</h2><ol class="ask">{decisions}</ol>' if decisions else ""
    css = (
        "@page{size:A4;margin:14mm}*{box-sizing:border-box}"
        "body{font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;margin:0;background:#fff}"
        "main{max-width:760px;margin:0 auto;padding:22px 18px}"
        "header{border-bottom:2px solid #1d4ed8;padding-bottom:10px;margin-bottom:14px}"
        "h1{font-size:24px;margin:0}h2{font-size:14px;margin:16px 0 6px;color:#1d4ed8}"
        ".sub{color:#475569;margin:2px 0 0}.up{color:#047857}.down{color:#b91c1c}"
        ".top{display:flex;gap:14px;align-items:stretch}.big{flex:0 0 150px;align-self:flex-start;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}"
        ".big b{display:block;font-size:34px;line-height:1.1}.big span{font-size:12px;color:#475569}"
        "ul,ol{margin:0;padding:0 0 0 18px}li{margin:4px 0}small{display:block;color:#64748b;font-size:11px}"
        "ul.parts{list-style:none;padding:0;flex:1;max-width:520px}ul.parts li{display:grid;grid-template-columns:1fr 140px 40px;gap:8px;align-items:center}"
        ".bar{display:block;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:#1d4ed8}"
        "ul.parts b{text-align:right;font-variant-numeric:tabular-nums}"
        ".cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}"
        "ol.ask li{font-weight:600}footer{margin-top:16px;color:#94a3b8;font-size:11px}"
        "@media(max-width:560px){.top,.cols{display:block}.big{margin-bottom:10px}}"
        "@media print{main{padding:0}}"
    )
    body = (
        f'<main><header><h1>{e(q["customer"])}</h1><p class="sub">Security coverage summary, {e(q["final"])} {moved}</p></header>'
        f'<div class="top"><div class="big"><b>{_pct(la["coverage"])}</b><span>effective coverage</span></div><ul class="parts">{parts}</ul></div>'
        '<p class="sub">Effective coverage multiplies the four parts: a gap in any one of them lowers the total.</p>'
        '<div class="cols"><div><h2>What is exposed</h2><ul>'
        f'<li><b>{k["critical_open"]}</b> critical finding(s) open, <b>{k["critical_internet"]}</b> exposed to the internet</li>'
        f'<li><b>{_pct(k["unconnected_spend_share"])}</b> of cloud spend not yet connected</li>'
        f'<li><b>{la["connected"]}</b> of <b>{la["accounts"]}</b> {e(u)} connected</li></ul>'
        f'<h2>If nothing changes</h2><p>{e(q["if_nothing"]["summary"])}</p></div>'
        f'<div><h2>What we will do next</h2><ol>{priorities}</ol>{ask}</div></div>'
        "<footer>Built from recorded data only. Print to PDF for a single page.</footer></main>"
    )
    return (
        "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        f"<title>{e(q['customer'])}: one-page summary</title><style>{css}</style></head><body>{body}</body></html>\n"
    )
