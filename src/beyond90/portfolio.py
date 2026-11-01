"""Portfolio view: one directory per customer, scored together.

Patterns that repeat across customers (same playbook at two or more of them)
are the candidates for one-to-many work: a shared playbook, a webinar, a
knowledge article. This is the proactive half of scaled customer success.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .catalogue import Catalogue
from .loader import DataError, load_customer
from .playbooks import Action, generate_actions
from .report import pct, pts
from .scoring import Score, compute_score
from .store import Store


@dataclass
class Entry:
    directory: str
    name: str
    tier: str
    arr: float
    score: Score
    actions: list[Action]
    previous_yield: Optional[float] = None


@dataclass
class Portfolio:
    entries: list[Entry] = field(default_factory=list)
    errors: dict[str, list[str]] = field(default_factory=dict)

    @property
    def arr_weighted_yield(self) -> Optional[float]:
        total = sum(e.arr for e in self.entries)
        if total <= 0:
            return None
        return sum(e.arr * e.score.yield_ for e in self.entries) / total

    def patterns(self, minimum: int = 2) -> list[dict]:
        """Actions that recur across customers.

        L1 actions are keyed by playbook (their ids carry the account owner);
        everything else by the full action id, so "enable runtime sensor" and
        "enable data security" are different patterns.
        """
        seen: dict[str, dict] = defaultdict(lambda: {"customers": set(), "leak": "", "title": ""})
        for e in self.entries:
            for a in e.actions:
                key = a.playbook if a.leak == "L1" else a.id
                p = seen[key]
                p["customers"].add(e.name)
                p["leak"] = a.leak
        out = [
            {"pattern": key, "leak": v["leak"], "customers": sorted(v["customers"]), "count": len(v["customers"])}
            for key, v in seen.items()
            if len(v["customers"]) >= minimum
        ]
        out.sort(key=lambda p: (-p["count"], p["pattern"]))
        return out


def load_portfolio(root: str | Path, cat: Optional[Catalogue] = None, store: Optional[Store] = None) -> Portfolio:
    cat = cat or Catalogue.load()
    pf = Portfolio()
    base = Path(root)
    dirs = sorted(p for p in base.iterdir() if p.is_dir() and (p / "customer.toml").exists())
    if not dirs:
        raise DataError([f"{base}: no customer directories found (each needs a customer.toml)"])
    for d in dirs:
        try:
            data, _ = load_customer(d, cat)
        except DataError as exc:
            pf.errors[d.name] = exc.errors
            continue
        score = compute_score(data, cat)
        prev = store.previous(data.name, data.as_of) if store else None
        pf.entries.append(
            Entry(d.name, data.name, data.tier, data.arr, score, generate_actions(data, score, cat), prev["yield"] if prev else None)
        )
    pf.entries.sort(key=lambda e: (-e.arr, e.name))
    return pf


def render_portfolio_markdown(pf: Portfolio, min_customers: int = 2) -> str:
    L = ["# Portfolio", ""]
    w = pf.arr_weighted_yield
    if w is not None:
        L += [f"ARR-weighted Yield: **{pct(w)}** across {len(pf.entries)} customer(s).", ""]
    L += ["| Customer | ARR | Yield | Legacy | L1 | L2 | L3 | L4 | Change | Top action |", "|---|---|---|---|---|---|---|---|---|---|"]
    for e in pf.entries:
        s = e.score
        change = pts(s.yield_ - e.previous_yield) if e.previous_yield is not None else "-"
        top = e.actions[0].title if e.actions else "-"
        L.append(
            f"| {e.name} | {e.arr:,.0f} | {pct(s.yield_)} | {pct(s.naive)} | {pct(s.stages['L1'].value)} | {pct(s.stages['L2'].value)} | "
            f"{pct(s.stages['L3'].value)} | {pct(s.stages['L4'].value)} | {change} | {top} |"
        )
    L.append("")
    pats = pf.patterns(min_customers)
    if pats:
        L += ["## Patterns across customers (one-to-many candidates)", "", "| Pattern | Leak | Customers | Who |", "|---|---|---|---|"]
        for p in pats:
            L.append(f"| {p['pattern']} | {p['leak']} | {p['count']} | {', '.join(p['customers'])} |")
        L.append("")
    if pf.errors:
        L += ["## Skipped (invalid data)", ""]
        for name, errs in pf.errors.items():
            L.append(f"- {name}: {errs[0]}" + (f" (+{len(errs) - 1} more)" if len(errs) > 1 else ""))
        L.append("")
    return "\n".join(L)


def render_portfolio_json(pf: Portfolio, min_customers: int = 2) -> str:
    payload = {
        "arr_weighted_yield": pf.arr_weighted_yield,
        "customers": [
            {
                "directory": e.directory,
                "name": e.name,
                "tier": e.tier,
                "arr": e.arr,
                "yield": e.score.yield_,
                "naive": e.score.naive,
                "stages": {k: v.value for k, v in e.score.stages.items()},
                "previous_yield": e.previous_yield,
                "top_actions": [a.to_dict() for a in e.actions[:5]],
            }
            for e in pf.entries
        ],
        "patterns": pf.patterns(min_customers),
        "errors": pf.errors,
    }
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
