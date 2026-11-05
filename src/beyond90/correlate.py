"""Connections: where the separate signals about a customer meet.

Each view of Beyond 90 answers one question: which accounts are not connected, which findings have no owner, which
security story touches which resources. The risk is where they meet: the account a known exploited vulnerability
lands on is the one whose protection is off, whose critical findings face the internet, and whose connector has
been stuck for months. This module builds that picture as a graph and says, in plain words, what it shows.

* **Signals.** Every active account collects signals from the other analyses: not connected, onboarding blocked
  (and why), exposed to a security story without the protection that mitigates it, impossible to assess for one,
  critical or high findings open to the internet, protections off where they apply. Each signal has a weight; an
  account's score is their sum. Its *convergence* counts the independent dimensions that meet on it (visibility,
  threat, findings, protection), so two faces of one gap, such as "not connected" and "onboarding blocked", or
  "exposed" and "its protection is off", count once.
* **Graph.** The accounts that matter most, and what links them: the team that owns each, the stories that reach
  them, the causes that block them, the capabilities they lack, and their worst findings. Small enough to read.
* **Insights.** The few patterns worth a conversation, ranked: accounts where several problems converge, the one
  capability that would close the most exposures, the team that holds most of the risk, the stories nobody can
  assess because the accounts are not connected, and the single change that unblocks a group of accounts. Each
  says why it matters, what to do, who should do it, and which nodes to highlight.

It reads only what the other analyses already computed from the customer's files; nothing is inferred beyond them.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .catalogue import Catalogue
from .models import CustomerData
from .scoring import classify_finding

MAX_ACCOUNTS = 28
MAX_STORIES = 8
MAX_FINDINGS = 16
MAX_MODULES = 6
MAX_BLIND = 12
SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
STORY_WEIGHT = {"critical": 4.0, "high": 3.0, "medium": 1.5, "low": 1.0}

DIMENSION = {"unconnected": "visibility", "blocked": "visibility", "blind": "visibility", "exposed": "threat", "findings": "findings", "protection": "protection"}
DIM_LABEL = {"visibility": "partly invisible to the platform", "threat": "reached by a security story without the protection against it",
             "findings": "carrying critical findings open to the internet", "protection": "missing protections where they apply"}
KIND_LABEL = {"unconnected": "not connected", "blocked": "onboarding blocked", "exposed": "exposed to a security story",
              "blind": "cannot be assessed for a story", "findings": "critical findings open to the internet",
              "protection": "protections off"}


def _names(data: CustomerData) -> dict[str, str]:
    return {t.id: t.name or t.id for t in data.teams}


def build(data: CustomerData, cat: Catalogue, onboarding: dict[str, Any], exposures: list[dict[str, Any]]) -> dict[str, Any]:
    """The graph of what meets where, and the insights it supports."""
    active = {a.id: a for a in data.accounts if a.status == "active"}
    teams = _names(data)
    modules = {m.id: m for m in cat.modules}
    present: dict[str, set[str]] = defaultdict(set)
    for inv in data.inventory:
        if inv.inventoried and inv.count > 0 and inv.account_id in active:
            present[inv.account_id].add(inv.resource_type)
    on = {(x.account_id, x.module_id) for x in data.activations if x.active}
    onb = {r["id"]: r for r in onboarding.get("accounts", [])}
    causes = {c["issue"]: c for c in onboarding.get("causes", [])}

    signals: dict[str, list[dict[str, Any]]] = defaultdict(list)

    def add(acc: str, kind: str, weight: float, text: str, ref: str = "") -> None:
        signals[acc].append({"kind": kind, "weight": weight, "text": text, "ref": ref})

    spend = sorted((a.last_spend for a in active.values()), reverse=True)
    heavy = spend[max(0, len(spend) // 5 - 1)] if spend else 0.0              # the top fifth by spend counts double
    for a in active.values():
        factor = 2.0 if heavy and a.last_spend >= heavy and a.last_spend > 0 else 1.0
        if not a.connected:
            add(a.id, "unconnected", 3.0 * factor, "not connected to the platform")
        row = onb.get(a.id)
        if row and row.get("issue") and row.get("stage") != "complete":
            title = causes.get(row["issue"], {}).get("title", row["issue"].replace("_", " "))
            add(a.id, "blocked", 2.0 * factor, f"onboarding blocked: {title[0].lower()}{title[1:]}", row["issue"])
        missing = [m.id for m in cat.modules if set(m.requires_any) & present[a.id] and a.provider in m.providers and (a.id, m.id) not in on]
        if a.connected and missing:
            add(a.id, "protection", min(1.5, 0.5 * len(missing)), f"{len(missing)} protection(s) off where they apply", ",".join(missing))

    worst: dict[str, list[Any]] = defaultdict(list)
    for f in data.findings:
        if f.closed_at is not None or f.account_id not in active or f.exposure != "internet" or f.decision == "false_positive":
            continue
        if f.severity == "critical" or (f.severity == "high" and classify_finding(f, data.as_of) != "ok"):
            worst[f.account_id].append(f)               # every critical one; a high one only while it has no owner or decision
    for acc, fs in worst.items():
        crit = sum(1 for f in fs if f.severity == "critical")
        weight = min(8.0, 4.0 * crit + 1.5 * (len(fs) - crit))
        high = len(fs) - crit
        what = " and ".join(x for x in (f"{crit} critical" if crit else "", f"{high} high" if high else "") if x)
        add(acc, "findings", weight, f"{what} finding(s) open to the internet")

    stories = []
    for e in exposures:
        w = 5.0 if e.get("kev") else STORY_WEIGHT[e["severity"]]
        for acc in e.get("uncovered_ids", []):
            add(acc, "exposed", w, f"exposed to {e['id']} without {' or '.join(e['mitigated_by'][:2]).replace('_', ' ')}", e["id"])
        for acc in e.get("unknown_ids", []):
            add(acc, "blind", min(2.0, w / 2), f"cannot be assessed for {e['id']}", e["id"])
        dark = [a.id for a in active.values() if not a.connected and (not e.get("providers") or a.provider in e["providers"])]
        for acc in dark:
            add(acc, "blind", min(2.0, w / 2), f"cannot be checked for {e['id']}: not connected", e["id"])
        e = {**e, "unknown_ids": [*e.get("unknown_ids", []), *dark]}
        if e.get("uncovered_ids") or e.get("unknown_ids"):
            stories.append(e)

    scored = []
    for acc, sig in signals.items():
        dims = {DIMENSION[s["kind"]] for s in sig}
        if "threat" in dims:
            dims.discard("protection")                  # exposed already means its protection is off
        scored.append({"id": acc, "score": round(sum(s["weight"] for s in sig), 2), "dims": sorted(dims), "convergence": len(dims), "signals": sig})
    scored.sort(key=lambda r: (-r["convergence"] * 2 - r["score"], r["id"]))
    picked = scored[:MAX_ACCOUNTS]
    keep = {r["id"] for r in picked}

    nodes: dict[str, dict[str, Any]] = {}
    edges: list[dict[str, Any]] = []

    def node(nid: str, **kw: Any) -> None:
        if nid not in nodes:
            nodes[nid] = {"id": nid, **kw}

    def edge(a: str, b: str, kind: str, label: str) -> None:
        edges.append({"source": a, "target": b, "kind": kind, "label": label})

    for r in picked:
        a = active[r["id"]]
        node("acct:" + a.id, type="account", label=a.id, detail=f"{a.provider}, {'connected' if a.connected else 'not connected'}, owner {teams.get(a.owner, a.owner or 'unassigned')}",
             weight=r["score"], convergence=r["convergence"], dims=r["dims"], connected=a.connected, provider=a.provider, signals=[s["text"] for s in r["signals"]][:8])
        owner = a.owner or "unassigned"
        node("team:" + owner, type="team", label=teams.get(owner, "No owner on record" if owner == "unassigned" else owner), detail="owner team", weight=0.0)
        nodes["team:" + owner]["weight"] += r["score"]
        edge("team:" + owner, "acct:" + a.id, "owns", "owns")

    story_ids = {e["id"] for e in sorted(stories, key=lambda e: (not e.get("kev"), SEV_RANK[e["severity"]], -len(e.get("uncovered_ids", []))))[:MAX_STORIES]}
    for e in stories:
        if e["id"] not in story_ids:
            continue
        reach = [x for x in e.get("uncovered_ids", []) if x in keep]
        blind = [x for x in e.get("unknown_ids", []) if x in keep]
        if not reach and not blind:
            continue
        node("story:" + e["id"], type="story", label=e["id"], detail=e["title"], weight=(5.0 if e.get("kev") else STORY_WEIGHT[e["severity"]]) * (len(reach) + 0.5 * len(blind)),
             severity=e["severity"], kev=bool(e.get("kev")), mitigated_by=e["mitigated_by"], url=e.get("url", ""))
        for x in reach:
            edge("story:" + e["id"], "acct:" + x, "exposes", "reaches, not covered")
        for x in blind[:MAX_BLIND]:
            edge("story:" + e["id"], "acct:" + x, "blind", "cannot be assessed")

    for r in picked:
        for s in r["signals"]:
            if s["kind"] == "blocked":
                c = causes.get(s["ref"], {})
                node("cause:" + s["ref"], type="cause", label=c.get("title", s["ref"]), detail=f"fixed by {c.get('owner', 'the account owner')}", weight=0.0, owner=c.get("owner", ""))
                nodes["cause:" + s["ref"]]["weight"] += 2.0
                edge("cause:" + s["ref"], "acct:" + r["id"], "blocks", "blocks onboarding")

    need: dict[str, set[str]] = defaultdict(set)                     # module -> picked accounts missing it
    for r in picked:
        for s in r["signals"]:
            if s["kind"] == "protection":
                for m in s["ref"].split(","):
                    need[m].add(r["id"])
    story_mods = {m for n in nodes.values() if n["type"] == "story" for m in n["mitigated_by"]}
    ranked_mods = sorted(need, key=lambda m: (m not in story_mods, -len(need[m]), m))[:MAX_MODULES]
    for m in ranked_mods:
        node("mod:" + m, type="capability", label=modules[m].name if m in modules else m.replace("_", " "), detail=f"off on {len(need[m])} of these accounts", weight=float(len(need[m])))
        for acc in sorted(need[m]):
            edge("acct:" + acc, "mod:" + m, "missing", "protection off")
        for n in list(nodes.values()):
            if n["type"] == "story" and m in n["mitigated_by"]:
                edge("mod:" + m, n["id"], "mitigates", "would cover")

    fs_all = sorted(((f, acc) for acc, fs in worst.items() if acc in keep for f in fs), key=lambda x: (SEV_RANK[x[0].severity], x[0].opened_at, x[0].id))[:MAX_FINDINGS]
    for f, acc in fs_all:
        node("find:" + f.id, type="finding", label=f.id, detail=f"{f.severity}, open to the internet since {f.opened_at.isoformat()}, owner {f.owner or 'none'}",
             weight=4.0 if f.severity == "critical" else 2.0, severity=f.severity, owned=bool(f.owner))
        edge("find:" + f.id, "acct:" + acc, "on", "open on")

    insights = _insights(picked, nodes, edges, need, story_mods, causes, teams, active, data, onboarding)
    deg: dict[str, int] = defaultdict(int)
    for e in edges:
        deg[e["source"]] += 1
        deg[e["target"]] += 1
    for n in nodes.values():
        n["degree"] = deg[n["id"]]
        n["weight"] = round(float(n["weight"]), 2)
        n.pop("mitigated_by", None)
    return {"nodes": list(nodes.values()), "edges": edges, "insights": insights,
            "stats": {"accounts_with_signals": len(scored), "accounts_shown": len(picked), "converging": sum(1 for r in scored if _converges(r)),
                      "stories": len(stories), "kinds": KIND_LABEL}}


def _converges(r: dict[str, Any]) -> bool:
    """Two independent problems among visibility, threat and findings; a protection that is off is detail, not a problem of its own."""
    return len({"visibility", "threat", "findings"} & set(r["dims"])) >= 2


def _insights(picked: list[dict[str, Any]], nodes: dict[str, dict[str, Any]], edges: list[dict[str, Any]], need: dict[str, set[str]], story_mods: set[str],
              causes: dict[str, dict[str, Any]], teams: dict[str, str], active: dict[str, Any], data: CustomerData, onboarding: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    owner_of = {aid: (a.owner or "unassigned") for aid, a in active.items()}

    def owner_name(aid: str) -> str:
        o = owner_of[aid]
        return teams.get(o, "no team on record" if o == "unassigned" else o)

    for r in picked:
        if not _converges(r):
            continue
        aid = r["id"]
        related = ["acct:" + aid, "team:" + owner_of[aid]] + [e["source"] if e["target"] == "acct:" + aid else e["target"] for e in edges if "acct:" + aid in (e["source"], e["target"])]
        parts = [DIM_LABEL[k] for k in r["dims"] if k != "protection"]
        out.append({"id": "converge:" + aid, "kind": "convergence", "score": r["score"] + 4 * r["convergence"],
                    "title": f"{aid}: {len(parts)} separate problems meet on one account",
                    "text": f"{aid} is {', '.join(parts[:-1])} and {parts[-1]}. Each is a gap on its own; together they make it one of the most exposed accounts here. In detail: " + "; ".join(s["text"] for s in r["signals"][:4]) + ".",
                    "action": f"Take {aid} to {owner_name(aid)} as one item, not {r['convergence']} separate tickets.", "owner": owner_name(aid),
                    "nodes": sorted(set(related) & set(nodes))})
        if sum(1 for i in out if i["kind"] == "convergence") >= 3:
            break

    for m, accs in sorted(need.items(), key=lambda kv: (kv[0] not in story_mods, -len(kv[1]))):
        if "mod:" + m not in nodes:
            continue
        covered = [e["target"] for e in edges if e["source"] == "mod:" + m and e["kind"] == "mitigates"]
        exposed_accs = {e["target"] for e in edges if e["source"] in covered and e["kind"] == "exposes"} & {"acct:" + a for a in accs}
        if not covered or not exposed_accs:
            continue
        kev = sum(1 for s in covered if nodes[s].get("kev"))
        name = nodes["mod:" + m]["label"]
        out.append({"id": "lever:" + m, "kind": "leverage", "score": 6 * len(covered) + 2 * len(exposed_accs) + 4 * kev,
                    "title": f"Switching on {name} closes {len(exposed_accs)} exposed account(s)" if len(covered) == 1 else f"One capability covers {len(covered)} security stories: {name}",
                    "text": f"{name} is off on {len(accs)} of the accounts that matter here, and it is the protection against "
                            + (nodes[covered[0]]["label"] + (", known to be exploited" if kev else "") if len(covered) == 1 else f"{len(covered)} security stories" + (f", {kev} of them known to be exploited" if kev else ""))
                            + f". Switching it on where it is missing covers {len(exposed_accs)} exposed account(s) at once.",
                    "action": f"Propose enabling {name} on {', '.join(sorted(a for a in accs)[:5])}{' and the rest' if len(accs) > 5 else ''}.",
                    "owner": "you, with the account owners", "nodes": sorted({"mod:" + m, *covered, *exposed_accs})})
        break

    total = sum(r["score"] for r in picked) or 1.0
    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in picked:
        by_team[owner_of[r["id"]]].append(r)
    if len(by_team) > 1:
        team, rows = max(by_team.items(), key=lambda kv: sum(r["score"] for r in kv[1]))
        share = sum(r["score"] for r in rows) / total
        if share >= 0.25 and len(rows) >= 3:
            name = teams.get(team, "accounts with no owner" if team == "unassigned" else team)
            out.append({"id": "team:" + team, "kind": "concentration", "score": 20 * share + len(rows),
                        "title": f"{share:.0%} of what needs attention sits with {name}",
                        "text": f"{len(rows)} of the accounts that matter here belong to {name}. One conversation with them moves more than any other.",
                        "action": "Book a working session with " + (name if team != "unassigned" else "the customer to name owners for these accounts") + ".",
                        "owner": name, "nodes": sorted({"team:" + team, *("acct:" + r["id"] for r in rows)} & set(nodes))})

    for s in sorted((n for n in nodes.values() if n["type"] == "story"), key=lambda n: (not n.get("kev"), SEV_RANK[n["severity"]])):
        blind = [e["target"] for e in edges if e["source"] == s["id"] and e["kind"] == "blind"]
        stuck = [b for b in blind if not nodes[b]["connected"]]
        if len(stuck) < 2:
            continue
        why = sorted({e["source"] for e in edges if e["target"] in stuck and e["kind"] == "blocks"}, key=lambda c: -sum(1 for e in edges if e["source"] == c))
        reasons = "; ".join(nodes[c]["label"].rstrip(".") for c in why[:2])
        out.append({"id": "blind:" + s["id"], "kind": "blind_spot", "score": 3 * len(stuck) + (6 if s.get("kev") else 2),
                    "title": f"Nobody can tell whether {s['label']} touches {len(stuck)} account(s)",
                    "text": f"{s['label']} ({s['detail'].rstrip('.')}) may reach {len(stuck)} account(s) that are not connected, so nobody can check them."
                            + (f" The most common reasons: {reasons}." if reasons else "") + " Until they are connected, this is a blind spot, not a clean bill of health.",
                    "action": "Unblock these connectors first, then look again.", "owner": ", ".join(sorted({nodes[c].get("owner") or "account owners" for c in why})) or "account owners",
                    "nodes": sorted({s["id"], *stuck, *why})})
        break

    waves = onboarding.get("waves", [])
    if waves:
        w = waves[0]
        cause = "cause:" + w.get("issue", "")
        blocked = sorted({e["target"] for e in edges if e["source"] == cause})
        if cause in nodes and len(blocked) >= 2:
            out.append({"id": "unblock:" + w["issue"], "kind": "root_cause", "score": 2 * len(blocked) + 3,
                        "title": f"One change unblocks {len(blocked)} accounts",
                        "text": f"{w['title']} blocks {len(blocked)} of the accounts that matter here. It is one fix, made once.",
                        "action": f"Ask {w['owner']} for this change.", "owner": w["owner"], "nodes": sorted({cause, *blocked})})

    out.sort(key=lambda i: -i["score"])
    for i in out:
        i["score"] = round(i["score"], 1)
    return out[:6]
