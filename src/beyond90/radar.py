"""Which customers should hear about this, and what should they do?

Two of a TAM's recurring jobs are to tell customers about new capabilities and
to watch for emerging threats. Both are the same question asked of a portfolio:
for this thing, who is exposed, who already has the control on, who does not,
and what is that worth?

* **Release radar.** For a module released at version ``V``: the customers where
  it is relevant (the resource types it needs are present) and still off, the
  accounts involved, and the exact Yield each would gain by switching it on.
* **Threat radar.** From a feed you provide (a JSON file; nothing is fetched):
  the customers with inventoried resources the threat affects, how many of those
  accounts already have a mitigating module active, and how many are *unknown*
  because the affected type was never inventoried (an L2 leak is also a threat
  blind spot). Ranked by severity x ARR x the share left uncovered.

Both use the same data the score uses, so what the radar says is consistent with
what the report says.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from typing import Optional

from .catalogue import Catalogue, parse_version
from .loader import clean_text
from .models import SEVERITIES, CustomerData
from .simulate import apply_ops, quick_yield

SEVERITY_WEIGHT = {"critical": 4, "high": 3, "medium": 2, "low": 1}


# -------------------------------------------------------------------- releases

@dataclass
class ReleaseExposure:
    customer: str
    arr: float
    relevant_accounts: int
    inactive_accounts: int
    inactive_ids: list[str]
    yield_gain_points: float
    already_on: int


@dataclass
class ReleaseReport:
    module_id: str
    name: str
    since: str
    customers: list[ReleaseExposure] = field(default_factory=list)

    @property
    def total_arr(self) -> float:
        return sum(c.arr for c in self.customers)


def release_radar(
    customers: list[tuple[str, CustomerData]],
    cat: Catalogue,
    *,
    version: Optional[str] = None,
    since_baseline: bool = False,
) -> list[ReleaseReport]:
    """Modules released at ``version``, or (``since_baseline``) after each customer's own baseline ceiling."""
    reports: dict[str, ReleaseReport] = {}
    for name, d in customers:
        ceiling = d.settings.ceiling_version
        baseline = parse_version(d.settings.baseline_ceiling)
        present: dict[str, set[str]] = {}
        for r in d.inventory:
            if r.inventoried and r.count > 0:
                present.setdefault(r.account_id, set()).add(r.resource_type)
        on = {(a.account_id, a.module_id) for a in d.activations if a.active}
        base_yield = quick_yield(d, cat)
        for m in cat.modules_at(ceiling):
            if version is not None and m.since != version:
                continue
            if version is None and not (since_baseline and parse_version(m.since) > baseline):
                continue
            relevant = [a for a in d.accounts if a.status == "active" and a.connected and a.provider in m.providers
                        and (not m.requires_any or present.get(a.id, set()) & set(m.requires_any))]
            if not relevant:
                continue
            inactive = [a.id for a in relevant if (a.id, m.id) not in on]
            after, _ = apply_ops(d, [{"op": "enable", "module": m.id, "accounts": inactive}], cat) if inactive else (d, [])
            gain = (quick_yield(after, cat) - base_yield) * 100 if inactive else 0.0
            rep = reports.setdefault(m.id, ReleaseReport(m.id, m.name, m.since))
            rep.customers.append(ReleaseExposure(name, d.arr, len(relevant), len(inactive), inactive, round(gain, 2), len(relevant) - len(inactive)))
    for rep in reports.values():
        rep.customers.sort(key=lambda c: (-(c.arr * c.yield_gain_points), -c.arr, c.customer))
    return sorted(reports.values(), key=lambda r: (tuple(-x for x in parse_version(r.since)), r.module_id))


# --------------------------------------------------------------------- threats

@dataclass
class Threat:
    id: str
    title: str
    severity: str
    published: Optional[date]
    resource_types: list[str]
    providers: list[str]
    mitigated_by: list[str]
    source: str = ""
    summary: str = ""
    url: str = ""
    extra: dict = field(default_factory=dict)       # kev, epss, cves, sources, kind, severity_why, first_seen: from `beyond90 feeds`


KIND_NAMES = ("vulnerability", "exploited", "incident", "technique", "change", "advisory")


def _extra(t: dict) -> dict:
    """The enrichment a collected feed carries, each field checked, because all of it ends up on a page."""
    e: dict = {}
    if t.get("kev") is True:
        e["kev"] = True
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(t.get("kev_due", ""))):
            e["kev_due"] = t["kev_due"]
        if t.get("ransomware") is True:
            e["ransomware"] = True
    try:
        v = float(t["epss"]) if t.get("epss") is not None else None
        if v is not None and 0.0 <= v <= 1.0:
            e["epss"] = v
    except (TypeError, ValueError):
        pass
    cves = [str(c).upper() for c in t.get("cves", []) if isinstance(c, str) and re.fullmatch(r"CVE-\d{4}-\d{4,7}", c, re.I)][:20]
    if cves:
        e["cves"] = cves
    srcs = []
    for s in t.get("sources", [])[:8] if isinstance(t.get("sources"), list) else []:
        if isinstance(s, dict) and s.get("name"):
            u = str(s.get("url", ""))
            srcs.append({"name": clean_text(str(s["name"]))[:80], "url": u if re.match(r"^https?://[^\s<>\"']+$", u) else ""})
    if srcs:
        e["sources"] = srcs
    plats = [str(x).lower() for x in t.get("platforms", []) if isinstance(x, str) and re.fullmatch(r"[a-z0-9_-]{1,24}", x.lower())][:8] if isinstance(t.get("platforms"), list) else []
    if plats:
        e["platforms"] = plats
    if t.get("kind") in KIND_NAMES:
        e["kind"] = t["kind"]
    if t.get("severity_why"):
        e["severity_why"] = clean_text(str(t["severity_why"]))[:200]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(t.get("first_seen", ""))):
        e["first_seen"] = t["first_seen"]
    return e


@dataclass
class ThreatExposure:
    customer: str
    arr: float
    exposed_accounts: int
    covered_accounts: int
    uncovered_ids: list[str]
    unknown_ids: list[str]
    urgency: float
    yield_gain_points: float


@dataclass
class ThreatReport:
    threat: Threat
    customers: list[ThreatExposure] = field(default_factory=list)
    age_days: Optional[int] = None


def load_threats(path: str | Path, cat: Catalogue) -> list[Threat]:
    """Read a threat feed. Errors name the entry and the field."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: not valid JSON ({exc.msg} at line {exc.lineno})") from exc
    return parse_threats(raw, cat, str(path))


def parse_threats(raw: object, cat: Catalogue, path: str = "the feed", skipped: Optional[list[str]] = None) -> list[Threat]:
    """The feed as already-parsed JSON. Text fields are cleaned and a link is kept only if it is http(s), because both end up on a page.

    With ``skipped`` given, an entry that names resource types or modules this catalogue does not have is left out and its id
    appended to the list, instead of failing the feed: one feed can serve customers of different profiles. Malformed entries still fail.
    """
    items = raw.get("threats") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        raise ValueError(f"{path}: expected a list of threats, or an object with a 'threats' list")
    modules = {m.id for m in cat.modules}
    out, errors, seen = [], [], set()
    for i, t in enumerate(items, start=1):
        tid = str(t.get("id", "")).strip()
        where = f"threat #{i} ({tid or 'no id'})"
        if not tid:
            errors.append(f"{where}: id is required")
        elif tid in seen:
            errors.append(f"{where}: duplicate id")
        seen.add(tid)
        sev = str(t.get("severity", "")).lower()
        if sev not in SEVERITIES:
            errors.append(f"{where}: severity must be one of {', '.join(SEVERITIES)}")
        types = list(t.get("resource_types", []))
        bad_types = [x for x in types if x not in cat.resource_types]
        if skipped is not None and tid and types and bad_types and len(bad_types) == len(types):
            skipped.append(tid)
            continue
        if not types or bad_types:
            errors.append(f"{where}: resource_types must be a non-empty list from the catalogue" + (f" (unknown: {', '.join(bad_types)})" if bad_types else ""))
        mit = list(t.get("mitigated_by", []))
        bad_mods = [x for x in mit if x not in modules]
        if not mit or bad_mods:
            errors.append(f"{where}: mitigated_by must be a non-empty list of module ids" + (f" (unknown: {', '.join(bad_mods)})" if bad_mods else ""))
        pub = None
        if t.get("published"):
            try:
                pub = date.fromisoformat(str(t["published"]))
            except ValueError:
                errors.append(f"{where}: published must be YYYY-MM-DD")
        url = str(t.get("url", "")).strip()
        out.append(Threat(clean_text(tid), clean_text(str(t.get("title", tid)))[:300], sev, pub, types, [p.lower() for p in t.get("providers", [])], mit,
                          clean_text(str(t.get("source", "")))[:120], clean_text(str(t.get("summary", "")))[:600], url if re.match(r"^https?://[^\s<>\"']+$", url) else "", _extra(t)))
    if errors:
        raise ValueError("invalid threat feed:\n  " + "\n  ".join(errors))
    return out


def threat_radar(customers: list[tuple[str, CustomerData]], threats: list[Threat], cat: Catalogue, *, as_of: Optional[date] = None) -> list[ThreatReport]:
    reports = []
    for th in threats:
        rep = ThreatReport(th, age_days=(as_of - th.published).days if as_of and th.published else None)
        for name, d in customers:
            inv: dict[str, dict[str, tuple[bool, int]]] = {}
            for r in d.inventory:
                inv.setdefault(r.account_id, {})[r.resource_type] = (r.inventoried, r.count)
            on = {(a.account_id, a.module_id) for a in d.activations if a.active}
            exposed = covered = 0
            uncovered, unknown = [], []
            for a in d.accounts:
                if a.status != "active" or not a.connected or (th.providers and a.provider not in th.providers):
                    continue
                rows = inv.get(a.id, {})
                expected = [t for t in th.resource_types if t in cat.expected_types(a.provider)]
                if any(rows.get(t, (False, 0))[0] and rows[t][1] > 0 for t in th.resource_types):
                    exposed += 1
                    if any((a.id, m) in on for m in th.mitigated_by):
                        covered += 1
                    else:
                        uncovered.append(a.id)
                elif any(not rows.get(t, (False, 0))[0] for t in expected):
                    unknown.append(a.id)
            if not exposed and not unknown:
                continue
            share = len(uncovered) / exposed if exposed else 0.0
            urgency = SEVERITY_WEIGHT[th.severity] * d.arr * share
            gain = 0.0
            if uncovered:
                best = th.mitigated_by[0]
                after, _ = apply_ops(d, [{"op": "enable", "module": best, "accounts": uncovered}], cat)
                gain = (quick_yield(after, cat) - quick_yield(d, cat)) * 100
            rep.customers.append(ThreatExposure(name, d.arr, exposed, covered, uncovered, unknown, urgency, round(gain, 2)))
        rep.customers.sort(key=lambda c: (-c.urgency, -c.arr, c.customer))
        reports.append(rep)
    reports.sort(key=lambda r: (-SEVERITY_WEIGHT[r.threat.severity], -sum(c.urgency for c in r.customers), r.threat.id))
    return reports


# ------------------------------------------------------------------- rendering

def _ids(ids: list[str], n: int = 5) -> str:
    return ", ".join(ids[:n]) + (f" (+{len(ids) - n} more)" if len(ids) > n else "")


def render_radar_markdown(releases: list[ReleaseReport], threats: list[ThreatReport]) -> str:
    L = ["# Radar", ""]
    if releases:
        L += ["## New capabilities: who should hear about them", ""]
        for r in releases:
            L += [f"### {r.name} (released {r.since})", "",
                  f"Relevant and switched off at {len(r.customers)} customer(s), {r.total_arr:,.0f} ARR.", "",
                  "| Customer | ARR | Relevant accounts | Off | Yield if switched on |", "|---|---|---|---|---|"]
            for rc in r.customers:
                L.append(f"| {rc.customer} | {rc.arr:,.0f} | {rc.relevant_accounts} | {rc.inactive_accounts} | +{rc.yield_gain_points:.1f} pts |")
            L.append("")
    if threats:
        L += ["## Threats: who is exposed and uncovered", ""]
        for t in threats:
            th = t.threat
            age = f", published {th.published} ({t.age_days} days ago)" if t.age_days is not None else ""
            L += [f"### {th.id}: {th.title}", "", f"Severity {th.severity}{age}. Affects {', '.join(th.resource_types)}; mitigated by {', '.join(th.mitigated_by)}."
                  + (f" Source: {th.source}." if th.source else ""), ""]
            if not t.customers:
                L += ["No customer has connected resources of this kind.", ""]
                continue
            L += ["| Customer | ARR | Exposed accounts | Covered | Uncovered | Unknown | Yield if mitigated |", "|---|---|---|---|---|---|---|"]
            for c in t.customers:
                L.append(f"| {c.customer} | {c.arr:,.0f} | {c.exposed_accounts} | {c.covered_accounts} | {len(c.uncovered_ids)} | {len(c.unknown_ids)} | +{c.yield_gain_points:.1f} pts |")
            L += ["", "Unknown means the affected resource type was never inventoried on that account: the exposure cannot be ruled out. Fix the inventory gap first.", ""]
            first = t.customers[0]
            if first.uncovered_ids:
                L += [f"Start with {first.customer}: enable {th.mitigated_by[0]} on {_ids(first.uncovered_ids)}.", ""]
    if not releases and not threats:
        L.append("Nothing to report.")
    return "\n".join(L) + "\n"


def render_radar_text(releases: list[ReleaseReport], threats: list[ThreatReport]) -> str:
    L: list[str] = []
    for r in releases:
        L.append(f"{r.name} (released {r.since}): off where relevant at {len(r.customers)} customer(s), {r.total_arr:,.0f} ARR")
        L += [f"   {rc.customer:<26} {rc.inactive_accounts:>4} of {rc.relevant_accounts:<4} accounts off   +{rc.yield_gain_points:.1f} pts   ARR {rc.arr:,.0f}" for rc in r.customers]
    for t in threats:
        th = t.threat
        L.append(f"\n[{th.severity.upper()}] {th.id}: {th.title}" + (f" ({t.age_days} days old)" if t.age_days is not None else ""))
        for c in t.customers:
            L.append(f"   {c.customer:<26} exposed {c.exposed_accounts:>3}  uncovered {len(c.uncovered_ids):>3}  unknown {len(c.unknown_ids):>3}   +{c.yield_gain_points:.1f} pts if mitigated")
        if not t.customers:
            L.append("   no customer has connected resources of this kind")
    return "\n".join(L).strip() + "\n" if L else "Nothing to report.\n"


def render_radar_json(releases: list[ReleaseReport], threats: list[ThreatReport]) -> str:
    return json.dumps({"releases": [asdict(r) for r in releases], "threats": [asdict(t) for t in threats]}, indent=2, sort_keys=True, default=str) + "\n"
