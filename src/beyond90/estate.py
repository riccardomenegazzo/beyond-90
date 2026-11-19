"""One customer, every product line: the estate view.

A presales or account team that sells a portfolio meets the same customer on several lines: the platform, its
databases, its files, its recovery, its containers. Each line is scored on its own profile, with its own units
and stages; this module puts the lines side by side and answers three questions:

- how much of what was sold is really working, line by line and across the estate;
- where one line puts another at risk (the platform is adopted but not recoverable);
- which line to open next, why it follows from what the customer already runs, and how to start the conversation.

Everything here is computed from the customer's files and the profiles shipped with the engine. The links
between lines are generic statements about infrastructure, true of any vendor; no product is named.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Optional

from .catalogue import BASE_PROFILE, Catalogue, peek_profile
from .loader import DataError, load_customer
from .playbooks import generate_actions
from .report import pct
from .scoring import compute_score
from .words import n_of

# The lines a portfolio is drawn from. A customer's estate is compared with the family most of its lines belong to.
FAMILIES: dict[str, list[str]] = {
    # The order is also the map's: the first line sits in the middle, the others go round it so that linked lines are near.
    "infrastructure": ["hci", "dbaas", "dr-backup", "hybrid-cloud", "object-storage", "file-storage", "euc", "kubernetes-platform", "private-ai", "microsegmentation", "platform-migration", "cloud-operations", "edge-sites", "service-provider-cloud"],
    "security": ["cnapp", "identity", "saas", "siem", "endpoint", "ai"],
}

LABELS: dict[str, str] = {
    "hci": "Platform (hyperconverged)", "dbaas": "Databases as a service", "file-storage": "File storage",
    "object-storage": "Object storage", "kubernetes-platform": "Kubernetes platform", "dr-backup": "Disaster recovery and backup",
    "cnapp": "Cloud security", "identity": "Identity security", "saas": "SaaS security", "siem": "Security monitoring",
    "endpoint": "Endpoint protection", "ai": "AI security", "platform-migration": "Platform migration", "private-ai": "AI on own infrastructure", "hybrid-cloud": "Hybrid and sovereign cloud", "euc": "Virtual desktops", "microsegmentation": "Network microsegmentation", "cloud-operations": "Cloud operations and self-service", "edge-sites": "Edge and branch sites", "service-provider-cloud": "Multi-tenant cloud for service providers",
}

# (from, to, why): once the first line runs, the second follows. Read as "because <from> is in place, <why>".
LINKS: list[tuple[str, str, str]] = [
    ("hci", "dr-backup", "workloads now run on the platform, and losing a site would still mean rebuilding them by hand"),
    ("hci", "dbaas", "databases already run on the platform, but are still provisioned, patched and copied by hand"),
    ("hci", "file-storage", "file servers still run as separate machines next to the platform"),
    ("hci", "kubernetes-platform", "application teams that want containers can get clusters on the platform they already run"),
    ("dbaas", "dr-backup", "point-in-time recovery protects a database, not the site it runs on"),
    ("file-storage", "dr-backup", "snapshots kept on the same system do not survive the loss of that system"),
    ("file-storage", "object-storage", "cold files can move to cheaper object storage without changing anything for users"),
    ("kubernetes-platform", "dr-backup", "stateful workloads need their volumes in the recovery plan"),
    ("kubernetes-platform", "object-storage", "workload backups and application data need an S3 target"),
    ("dr-backup", "object-storage", "immutable copies need a target that an administrator cannot delete from"),
    ("platform-migration", "hci", "migrated workloads need a platform that is ready to run them, protected and monitored, before the first wave"),
    ("platform-migration", "dr-backup", "recovery must work on the new platform before the old one is switched off"),
    ("hci", "platform-migration", "machines still on the old platform keep its licences and its risks alive"),
    ("hci", "hybrid-cloud", "the same platform in a public or sovereign cloud gives recovery and room to grow without rewriting anything"),
    ("hci", "euc", "virtual desktops can run on the platform already in place, next to the applications they use"),
    ("hci", "private-ai", "AI models can run next to the data the platform already holds, under the same operations"),
    ("kubernetes-platform", "private-ai", "AI applications and agents are containers, and need GPUs, models and data close by"),
    ("private-ai", "object-storage", "training data, models and retrieval indexes need scalable storage the organisation controls"),
    ("hybrid-cloud", "dr-backup", "a cloud cluster is only a recovery site once failover to it is tested"),
    ("dr-backup", "hybrid-cloud", "a recovery site in the cloud avoids building and paying for a second data centre"),
    ("platform-migration", "hybrid-cloud", "some workloads can move to a cloud cluster first, buying time for the data centre"),
    ("euc", "dr-backup", "desktops are how people work during an outage, so they belong in the recovery plan"),
    ("euc", "file-storage", "user profiles and shared drives need fast, protected file storage"),
    ("hci", "microsegmentation", "workloads on the platform can be separated by labels, without re-addressing the network"),
    ("microsegmentation", "dr-backup", "a recovery site needs the same policies, or it becomes the way in"),
    ("dr-backup", "microsegmentation", "a compromised machine must be contained before it is recovered, or the recovery brings the attacker back"),
    ("euc", "microsegmentation", "desktops are where attacks start, and should reach only what their users need"),
    ("hci", "cloud-operations", "a platform run by hand caps how many clusters one team can look after"),
    ("cloud-operations", "kubernetes-platform", "the self-service catalog is where teams will ask for clusters next"),
    ("cloud-operations", "dbaas", "databases are the request teams wait longest for, and the first catalog item worth automating"),
    ("hybrid-cloud", "cloud-operations", "placement decisions need private and public costs compared on the same basis"),
    ("hci", "edge-sites", "the same platform at the sites removes a second set of skills and tools"),
    ("edge-sites", "dr-backup", "a site's copy at the core is what brings it back after a disaster"),
    ("edge-sites", "private-ai", "data that cannot leave a site needs its inference to run there"),
    ("hci", "service-provider-cloud", "a provider, or an IT team serving many companies in a group, can open the same clusters to tenants, kept apart and metered"),
    ("platform-migration", "service-provider-cloud", "a provider leaving a platform has tenants to move, each one a migration"),
    ("service-provider-cloud", "dr-backup", "recovery is the first service tenants pay for beyond machines"),
    ("service-provider-cloud", "kubernetes-platform", "tenants ask for Kubernetes next, and pay for it"),
    ("service-provider-cloud", "microsegmentation", "tenants sharing infrastructure need policies that keep their machines apart inside their own networks"),
    ("cnapp", "identity", "cloud findings keep leading back to identities nobody governs"),
    ("cnapp", "siem", "cloud detections need somewhere to be correlated and answered"),
    ("identity", "saas", "the same identities sign in to business applications nobody reviews"),
    ("endpoint", "siem", "endpoint alerts need to meet the other sources to tell a story"),
    ("cnapp", "ai", "AI workloads are appearing in the same cloud accounts"),
]

STAGES = {"L1": "connected", "L2": "seen", "L3": "switched on", "L4": "decided"}

WEAK = 0.6      # below this, a line is not yet doing what was sold
STRONG = 0.7    # from this, a line is solid enough to build the next one on


def _lower(text: str) -> str:
    return text[:1].lower() + text[1:]


def label(profile: str, cat: Optional[Catalogue] = None) -> str:
    if profile in LABELS:
        return LABELS[profile]
    return (cat.description.split(":")[0] if cat and cat.description else profile).strip() or profile


def _line(key: str, directory: Path) -> dict[str, Any]:
    profile = peek_profile(directory) or BASE_PROFILE
    cat = Catalogue.load(profile=profile)
    data, warnings = load_customer(directory, cat, require_accounts=True)
    score = compute_score(data, cat)
    actions = generate_actions(data, score, cat)
    measured = {k: s.value for k, s in score.stages.items() if s.has_data}
    weakest = min(measured, key=lambda k: measured[k]) if measured else ""
    e2e = score.end_to_end or {}
    ask = next((q for q in cat.discovery if q.get("stage") == weakest), None) or next((q for q in cat.discovery if q.get("stage") == "value"), None)
    top = actions[0] if actions else None
    return {
        "key": key, "profile": profile, "label": label(profile, cat), "customer": data.name, "as_of": str(data.as_of), "arr": data.arr,
        "yield": score.yield_, "naive": score.naive, "stages": {k: s.value for k, s in score.stages.items()},
        "stage_names": dict(STAGES), "weakest": weakest,
        "unit": cat.terms["unit"], "units": cat.terms["units"], "through": e2e.get("through"), "total": e2e.get("total"),
        "critical_open": score.outcomes.get("critical_open", 0), "warnings": warnings,
        "top_action": {"title": top.title, "points": top.effect_points, "owner": top.owner, "due": top.due, "stage": top.leak} if top else None,
        "actions": len(actions), "question": ask, "proof": cat.pov_criteria[0] if cat.pov_criteria else None,
    }


def _whitespace(lines: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    have = {ln["profile"] for ln in lines}
    family = max(FAMILIES, key=lambda f: (len(have & set(FAMILIES[f])), f == "infrastructure"))
    by_profile = {ln["profile"]: ln for ln in lines}
    out = []
    for profile in FAMILIES[family]:
        if profile in have:
            continue
        reasons = [{"from": src, "from_label": by_profile[src]["label"], "why": why, "strength": by_profile[src]["yield"]}
                   for src, dst, why in LINKS if dst == profile and src in by_profile]
        try:
            cat = Catalogue.load(profile=profile)
        except ValueError:
            continue
        opener = next((q for q in cat.discovery if q.get("stage") == "value"), None)
        # A line that follows from several solid lines comes first; a line that follows from nothing still shows, last.
        weight = sum(r["strength"] * (1.0 if r["strength"] >= STRONG else 0.5) for r in reasons)
        out.append({"profile": profile, "label": label(profile, cat), "units": cat.terms["units"], "reasons": reasons, "weight": round(weight, 4),
                    "opener": opener, "proof": cat.pov_criteria[0] if cat.pov_criteria else None, "description": cat.description})
    out.sort(key=lambda w: (-w["weight"], w["label"]))
    return family, out


def _risks(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A solid line that leans on a weak one: what is sold works, what it depends on does not yet."""
    by_profile = {ln["profile"]: ln for ln in lines}
    out = []
    for src, dst, why in LINKS:
        a, b = by_profile.get(src), by_profile.get(dst)
        if not a or not b or a["yield"] < STRONG or b["yield"] >= WEAK:
            continue
        out.append({"from": src, "to": dst, "from_label": a["label"], "to_label": b["label"], "from_yield": a["yield"], "to_yield": b["yield"],
                    "why": why, "text": f"{a['label']} is at {pct(a['yield'])}, but {_lower(b['label'])} is at {pct(b['yield'])}: {why}.",
                    "gap": a["yield"] - b["yield"], "step": (b["top_action"] or {}).get("title", ""),
                    "points": (b["top_action"] or {}).get("points", 0.0)})
    out.sort(key=lambda r: -r["gap"])
    return out


def analyze_estate_dir(root: str | Path) -> dict[str, Any]:
    """Every sub-folder of `root` with a customer.toml is one product line of the same customer."""
    base = Path(root)
    dirs = sorted(p for p in base.iterdir() if p.is_dir() and (p / "customer.toml").exists())
    lines, errors = [], {}
    for d in dirs:
        try:
            lines.append(_line(d.name, d))
        except (DataError, ValueError) as exc:
            errors[d.name] = getattr(exc, "errors", None) or [str(exc)]
    if not lines:
        return {"ok": False, "errors": [f"{k}: {v[0]}" for k, v in errors.items()] or ["No folder with a customer.toml was found."]}
    names = Counter(ln["customer"] for ln in lines)
    customer = names.most_common(1)[0][0]
    total_arr = sum(ln["arr"] for ln in lines)
    weight = (lambda ln: ln["arr"] / total_arr) if total_arr else (lambda ln: 1.0 / len(lines))
    estate_yield = sum(ln["yield"] * weight(ln) for ln in lines)
    naive_lines = [ln for ln in lines if ln["naive"] is not None]
    naive_w = sum(weight(ln) for ln in naive_lines)
    estate_naive = sum(ln["naive"] * weight(ln) for ln in naive_lines) / naive_w if naive_w else None
    family, white = _whitespace(lines)
    risks = _risks(lines)
    lines.sort(key=lambda ln: (-ln["arr"], ln["label"]))
    weakest = min(lines, key=lambda ln: ln["yield"])
    below = [ln for ln in lines if ln["yield"] < WEAK]
    arr_below = sum(ln["arr"] for ln in below)
    headline = (f"{customer} runs {n_of(len(lines), 'line')} of the {family} portfolio. Across them, {pct(estate_yield)} of what was sold is really working"
                + (f", against the {pct(estate_naive)} the usual numbers report" if estate_naive is not None else "") + ". "
                + (f"{weakest['label']} is the weakest, at {pct(weakest['yield'])}." if len(lines) > 1 else ""))
    result = {
        "ok": True, "customer": customer, "other_names": sorted(n for n in names if n != customer), "family": family,
        "as_of": max(ln["as_of"] for ln in lines), "arr": total_arr, "yield": estate_yield, "naive": estate_naive,
        "arr_below": arr_below, "below": [ln["key"] for ln in below], "headline": headline,
        "lines": lines, "whitespace": white, "risks": risks, "errors": errors,
    }
    have = {ln["profile"] for ln in lines}
    risky = {(r["from"], r["to"]) for r in risks}
    result["map"] = [{"profile": p, "label": label(p), "present": p in have} for p in FAMILIES[family]] + \
        [{"profile": ln["profile"], "label": ln["label"], "present": True} for ln in lines if ln["profile"] not in FAMILIES[family]]
    result["links"] = [{"from": a, "to": b, "why": why, "state": "risk" if (a, b) in risky else "ok" if b in have else "grow"}
                       for a, b, why in LINKS if a in have and (b in FAMILIES[family] or b in have)]
    result["plan_markdown"] = render_plan_markdown(result)
    return result


def render_plan_markdown(e: dict[str, Any]) -> str:
    """The account plan: what is working, what to fix, where to grow, and what to ask next. Ready to paste."""
    out = [f"# Account plan: {e['customer']}", "", f"Data as of {e['as_of']}. {e['headline']}", ""]
    out += ["## Lines in place", "", "| Line | Yield | Usual number | Weakest stage | End to end | Next action |", "|---|---|---|---|---|---|"]
    for ln in e["lines"]:
        e2e = f"{ln['through']} of {n_of(ln['total'], ln['unit'], ln['units'])}" if ln["total"] else "-"
        act = f"{ln['top_action']['title']} (+{ln['top_action']['points']:.1f} pts)" if ln["top_action"] else "-"
        weak = f"{ln['weakest']} {STAGES.get(ln['weakest'], '')}".strip() if ln["weakest"] else "-"
        out.append(f"| {ln['label']} | {pct(ln['yield'])} | {pct(ln['naive']) if ln['naive'] is not None else '-'} | {weak} | {e2e} | {act} |")
    out.append("")
    if e["risks"]:
        out += ["## Where one line puts another at risk", ""]
        out += [f"- {r['text']}" + (f" First step: {r['step']} (+{r['points']:.1f} pts on {_lower(r['to_label'])})." if r["step"] else "") for r in e["risks"]]
        out.append("")
    if e["whitespace"]:
        out += ["## Where to grow next", ""]
        for w in e["whitespace"]:
            out.append(f"### {w['label']}")
            out.append("")
            if w["reasons"]:
                out += [f"- {r['from_label']} runs here (Yield {pct(r['strength'])}): {r['why']}." for r in w["reasons"]]
            else:
                out.append("- Nothing in place leads here yet; worth a question, not a proposal.")
            if w["opener"]:
                out.append(f"- Open with: \"{w['opener']['q']}\"")
            if w["proof"]:
                out.append(f"- A proof to offer: {w['proof']['text']}.")
            out.append("")
    out += ["## Questions for the next meeting", ""]
    for ln in e["lines"]:
        if ln["question"]:
            out.append(f"- {ln['label']}: {ln['question']['q']}")
    out += ["", "_Computed by Beyond 90 from the customer's files. Each line is scored on its own profile; the estate figure weights lines by ARR._", ""]
    return "\n".join(out)


ALTERNATIVES_FILE = Path(__file__).resolve().parent / "data" / "alternatives.json"
ALT_ID = re.compile(r"^[a-z][a-z_]{1,29}$")
ALT_LIMITS = {"name": 60, "why": 200, "fits_us": 240, "fits_them": 240, "prove": 200}


def read_alternatives(path: Path = ALTERNATIVES_FILE) -> dict[str, list[dict[str, Any]]]:
    """What else a customer weighs, per family of product lines: why they consider it, what to ask, when each choice
    fits, and how to prove it. Written for the conversation, not against anyone: each says when the other choice wins."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise DataError([f"{path.name}: {e}"]) from e
    if not isinstance(data, dict):
        raise DataError([f"{path.name}: expected an object keyed by family"])
    out: dict[str, list[dict[str, Any]]] = {}
    for family, items in data.items():
        if family not in FAMILIES:
            raise DataError([f"{path.name}: {family!r} is not a family of product lines"])
        if not isinstance(items, list) or not 2 <= len(items) <= 8:
            raise DataError([f"{path.name}: {family}: between 2 and 8 alternatives"])
        seen: set[str] = set()
        for a in items:
            if not isinstance(a, dict) or set(a) != {"id", *ALT_LIMITS, "ask"}:
                raise DataError([f"{path.name}: {family}: each alternative has id, name, why, ask, fits_us, fits_them and prove"])
            if not isinstance(a["id"], str) or not ALT_ID.match(a["id"]) or a["id"] in seen:
                raise DataError([f"{path.name}: {family}: ids are short, lower case and unique ({a.get('id')!r})"])
            seen.add(a["id"])
            for k, most in ALT_LIMITS.items():
                if not isinstance(a[k], str) or not 3 <= len(a[k]) <= most:
                    raise DataError([f"{path.name}: {a['id']}.{k}: between 3 and {most} characters"])
            ask = a["ask"]
            if not isinstance(ask, list) or not 1 <= len(ask) <= 3 or not all(isinstance(q, str) and 10 <= len(q) <= 200 and q.endswith("?") for q in ask):
                raise DataError([f"{path.name}: {a['id']}.ask: one to three questions, each ending with a question mark"])
        out[family] = items
    return out


def workshop_catalog() -> dict[str, Any]:
    """What a discovery workshop needs, for every profile that ships discovery questions: built into the page once."""
    from .catalogue import available_profiles

    lines: dict[str, Any] = {}
    for profile in available_profiles():
        cat = Catalogue.load(profile=profile)
        if not cat.discovery:
            continue
        lines[profile] = {"label": label(profile, cat), "description": cat.description, "units": cat.terms["units"],
                          "questions": [{"stage": q["stage"], "q": q["q"], "why": q.get("why", ""), "need": q.get("need", ""), "how": q.get("how", ""),
                                         **{k: q[k] for k in ("role", "core", "listen", "probe") if k in q}} for q in cat.discovery],
                          "proof": [{"text": c["text"], "how": c.get("how", "")} for c in cat.pov_criteria], "readiness": list(cat.pov_readiness), "story": cat.story}
    families = {name: [p for p in members if p in lines] for name, members in FAMILIES.items()}
    alternatives = {k: v for k, v in read_alternatives().items() if families.get(k)}
    return {"families": families, "links": [list(x) for x in LINKS if x[0] in lines and x[1] in lines], "lines": lines, "alternatives": alternatives}

