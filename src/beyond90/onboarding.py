"""Where onboarding stalls, account by account, and what unblocks it.

Most of the gap between "bought" and "used" opens in the first weeks, while the connectors that let the platform read an
account are being deployed. The failures are few and repetitive: a guardrail denies the read role, a trust policy names
the wrong external ID, admin consent was never granted, an API is disabled, a pod security level blocks the sensor. Each
has a known cause, a known owner and a known fix, but the error a customer sees rarely says which.

This module reads ``connectors.csv`` (what the platform reports for each connector) next to ``accounts.csv`` and:

* places every account on a stage: discovered, deployed, authenticated, authorized, scanning, complete;
* classifies each error with a catalogue of causes (``data/connector_issues.json``) and gives the fix, the owner and how to verify;
* measures time to connect and time to first scan, and finds accounts stuck at one stage;
* groups the blocked accounts into waves where one fix unblocks many (a guardrail, a management group, a stack set);
* reviews the connectors themselves as an attack surface (STRIDE): admin rights, long-lived secrets, a role without an external ID;
* lists secrets that are about to expire, the most common cause of a connector that worked and then stopped.

Without ``connectors.csv`` it falls back to accounts.csv: discovered versus connected, and the time since discovery.
Nothing here changes Yield; it explains the part of L1 that is still in flight.
"""

from __future__ import annotations

import json
import re
from datetime import date
from functools import lru_cache
from importlib import resources
from statistics import median
from typing import Any, Optional

from .models import Account, Connector, CustomerData

STAGES = ("discovered", "deployed", "authenticated", "authorized", "scanning", "complete")
STAGE_LABEL = {"discovered": "Discovered", "deployed": "Connector deployed", "authenticated": "Signs in", "authorized": "Can read",
               "scanning": "First scan done", "complete": "Complete and fresh"}
SECRET_AUTH = {"access_key", "sp_secret", "sa_key", "token"}
EXPIRY_WARN_DAYS = 30

# Causes that come from the data's shape rather than from an error message.
GENERIC: dict[str, dict[str, Any]] = {
    "not_deployed": {"title": "No connector deployed yet", "stage": "deployed", "scope": "account", "owner": "account owner", "hours": 0.75,
                     "why": "The account is known but nobody has deployed the connector into it.",
                     "steps": ["Agree who owns the account and when the connector goes in.", "Prefer an organization-level deployment so this account, and the next ones, are covered without a ticket each."],
                     "verify": "The account shows a connector in the platform."},
    "deploy_org": {"title": "Deploy once at the organization level", "stage": "deployed", "scope": "org", "owner": "cloud platform team", "hours": 3,
                   "why": "Several accounts of the same provider are waiting for the connector. Deploying it per account is slow and leaves every new account uncovered until someone notices.",
                   "steps": ["AWS: a stack set targeting the organization root or the units in scope, with automatic deployment to new accounts.",
                             "Azure: role assignments at the tenant root management group, and consent once for the directory.",
                             "Google Cloud: role bindings at the organization or the top folder for the connector's service account.",
                             "Kubernetes: deploy the connector and sensor with the same chart and values through the pipeline that creates clusters."],
                   "verify": "An account created after the change is connected without anyone asking."},
    "disabled": {"title": "The connector is disabled", "stage": "deployed", "scope": "account", "owner": "account owner", "hours": 0.25,
                 "why": "Someone switched the connector off, often during an incident or a cost review, and nobody switched it back.",
                 "steps": ["Ask why it was disabled; if the account is retired, mark it decommissioned instead.", "Otherwise enable it again."],
                 "verify": "The connector is enabled and scanning."},
    "never_scanned": {"title": "Deployed, but no scan has completed", "stage": "scanning", "scope": "account", "owner": "vendor support", "hours": 1,
                      "why": "The connector passed its checks but the first scan never finished. In large accounts the first scan takes longer; past a couple of days something is wrong.",
                      "steps": ["Check the scan's status in the platform for partial errors.", "Open a support case with the connector ID if nothing explains it."],
                      "verify": "A first scan completes."},
    "stale": {"title": "The connector stopped reporting", "stage": "complete", "scope": "account", "owner": "account owner", "hours": 1,
              "why": "It worked, then the last successful scan got old. The usual causes are an expired secret, a role or binding removed by a cleanup, or a new guardrail.",
              "steps": ["Read the most recent error for the connector.", "Check for changes to the role, the binding or the guardrails since the last success."],
              "verify": "A scan succeeds again."},
    "regions_partial": {"title": "Only part of the account is scanned", "stage": "complete", "scope": "account", "owner": "cloud platform team", "hours": 0.5,
                        "why": "Some regions, projects or subscriptions inside the scope answer and others do not, so findings there are missing without anyone seeing an error.",
                        "steps": ["Compare the regions or projects expected with those scanned.", "Enable the missing ones, or remove them from the connector's scope if they are not in use."],
                        "verify": "Scanned equals expected."},
    "permissions_missing": {"title": "The connector is missing read permissions", "stage": "authorized", "scope": "account", "owner": "IAM team", "hours": 0.5,
                            "why": "The connector signs in but some read actions are denied, so parts of the inventory are empty.",
                            "steps": ["Attach the vendor's current read-only policy; older templates lack permissions for newer services.", "Re-run the permission check in the platform."],
                            "verify": "The platform reports no missing permissions."},
    "secret_expired": {"title": "The connector's secret has expired", "stage": "authenticated", "scope": "account", "owner": "identity team", "hours": 0.5,
                       "why": "The credential the connector signs in with passed its expiry date; the connector stops on that day.",
                       "steps": ["Rotate it now, and move to a federated credential, a certificate or a role that has no secret to expire."],
                       "verify": "The connector signs in, and no secret is left to expire."},
    "unclassified": {"title": "An error that is not in the catalogue", "stage": "deployed", "scope": "account", "owner": "vendor support", "hours": 1,
                     "why": "The message did not match a known cause.",
                     "steps": ["Collect the full error, the connector ID and the time.", "Open a support case; if the cause turns out to be common, add it to the catalogue."],
                     "verify": "The cause is known and fixed."},
}


@lru_cache(maxsize=1)
def catalogue() -> dict[str, Any]:
    raw = json.loads(resources.files("beyond90").joinpath("data/connector_issues.json").read_text(encoding="utf-8"))
    compiled = []
    for it in raw["issues"]:
        compiled.append({**it, "kinds": it.get("kinds", []), "_re": [re.compile(p, re.I) for p in it["patterns"]]})
    return {"version": raw["version"], "issues": compiled}


def issue(issue_id: str) -> dict[str, Any]:
    if issue_id in GENERIC:
        return {"id": issue_id, **GENERIC[issue_id]}
    for it in catalogue()["issues"]:
        if it["id"] == issue_id:
            return {k: v for k, v in it.items() if k != "_re"}
    raise KeyError(issue_id)


PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def checks_for(issue_id: str, context: Optional[dict[str, str]] = None) -> list[str]:
    """Read-only commands that confirm the cause. Known values are filled in; the rest stay as <placeholders> to fill."""
    try:
        cmds = issue(issue_id).get("checks", [])
    except KeyError:
        return []
    ctx = {k: v for k, v in (context or {}).items() if v and re.fullmatch(r"[A-Za-z0-9_.:/@-]{1,128}", v)}   # nothing that could become shell syntax
    return [PLACEHOLDER.sub(lambda m: ctx.get(m.group(1), f"<{m.group(1).replace('_', '-')}>"), c) for c in cmds]


def _matches(text: str, provider: str, kind: str) -> list[dict[str, Any]]:
    out = []
    for it in catalogue()["issues"]:
        if it["providers"] and provider and provider not in it["providers"]:
            continue
        if it["kinds"] and kind and kind not in it["kinds"]:
            continue
        if not it["kinds"] and kind in ("kubernetes", "sensor") and it["providers"]:
            continue                                  # a cloud-account cause does not explain a cluster error
        if any(r.search(text) for r in it["_re"]):
            out.append({k: v for k, v in it.items() if k != "_re"})
    return out


def triage(text: str, provider: str = "", kind: str = "") -> dict[str, Any]:
    """Classify one error message. The first match is the answer; others are listed because messages often carry two causes."""
    text = (text or "")[:4000]
    found = _matches(text, provider.lower(), kind.lower()) if text.strip() else []
    if not found and text.strip() and provider:
        found = _matches(text, "", kind.lower())           # the provider may have been guessed wrong
    if found:
        found[0] = {**found[0], "checks": checks_for(found[0]["id"])}
    return {"match": found[0] if found else None, "also": found[1:4], "catalogue": catalogue()["version"]}


def _previous(stage: str) -> str:
    i = STAGES.index(stage)
    return STAGES[max(0, i - 1)]


def _days(a: Optional[date], b: Optional[date]) -> Optional[int]:
    return (b - a).days if a and b else None


def _account_row(a: Account, conns: list[Connector], data: CustomerData, have_file: bool) -> dict[str, Any]:
    today, s = data.as_of, data.settings
    cloud = [c for c in conns if c.kind == "cloud"]
    c = cloud[0] if cloud else None
    row: dict[str, Any] = {"id": a.id, "provider": a.provider, "owner": a.owner, "listed_connected": a.connected, "created_at": a.created_at.isoformat() if a.created_at else "",
                           "connector": None, "issue": None, "error": "", "detail": have_file, "extensions": []}
    since: Optional[date] = a.created_at
    if c is None:
        if a.connected:
            row["stage"] = "complete"
        else:
            row["stage"], row["issue"] = "discovered", "not_deployed"
    else:
        row["connector"] = {"name": c.name, "status": c.status, "scope": c.scope, "auth": c.auth, "privilege": c.privilege,
                            "deployed_at": c.deployed_at.isoformat() if c.deployed_at else "", "first_scan_at": c.first_scan_at.isoformat() if c.first_scan_at else "",
                            "last_success_at": c.last_success_at.isoformat() if c.last_success_at else "", "regions": [c.regions_scanned, c.regions_expected],
                            "permissions_missing": list(c.permissions_missing), "secret_expires_on": c.secret_expires_on.isoformat() if c.secret_expires_on else ""}
        row["error"] = c.error
        since = c.last_success_at or c.first_scan_at or c.deployed_at or a.created_at
        stale = c.last_success_at is not None and (today - c.last_success_at).days > s.connector_stale_days
        expired = c.secret_expires_on is not None and c.secret_expires_on < today
        if c.status == "disabled":
            row["stage"], row["issue"] = "discovered", "disabled"
        elif c.status == "error" or (c.error and c.status != "ok"):
            m = triage(c.error, a.provider, "cloud")["match"]
            if m:
                row["issue"], row["stage"] = m["id"], _previous(m["stage"])
            elif expired:
                row["issue"], row["stage"] = "secret_expired", "deployed"
            elif c.permissions_missing:
                row["issue"], row["stage"] = "permissions_missing", "authenticated"
            else:
                row["issue"] = "unclassified"
                row["stage"] = "scanning" if c.first_scan_at else "deployed"
        elif expired:
            row["issue"], row["stage"] = "secret_expired", "deployed"
        elif c.status == "pending" or not c.first_scan_at:
            age = _days(c.deployed_at, today)
            row["stage"] = "authorized" if c.deployed_at else "discovered"
            row["issue"] = "never_scanned" if age is not None and age > s.connector_stale_days else None
            if not c.deployed_at:
                row["issue"] = "not_deployed"
        elif c.permissions_missing:
            row["stage"], row["issue"] = "authenticated", "permissions_missing"
        elif stale:
            row["stage"], row["issue"] = "scanning", "stale"
        elif c.status == "partial" or (c.regions_expected and c.regions_scanned < c.regions_expected):
            m = triage(c.error, a.provider, "cloud")["match"] if c.error else None
            row["stage"], row["issue"] = "scanning", (m["id"] if m and m["stage"] == "complete" else "regions_partial")
        else:
            row["stage"] = "complete"
    for x in conns:
        if x.kind == "cloud":
            continue
        ok = x.status == "ok" and not (x.last_success_at and (today - x.last_success_at).days > s.connector_stale_days)
        m = None if ok else triage(x.error, "", x.kind)["match"]
        row["extensions"].append({"kind": x.kind, "name": x.name, "status": x.status, "ok": ok, "error": x.error,
                                  "issue": (m["id"] if m else (None if ok else ("stale" if x.status == "ok" else "unclassified")))})
    row["days_in_stage"] = _days(since, today) if row["stage"] != "complete" else 0
    row["stalled"] = row["stage"] != "complete" and row["days_in_stage"] is not None and row["days_in_stage"] > s.onboarding_stall_days
    row["time_to_deploy"] = _days(a.created_at, c.deployed_at) if c else None
    row["time_to_first_scan"] = _days(c.deployed_at, c.first_scan_at) if c else None
    return row


def security_review(data: CustomerData) -> list[dict[str, Any]]:
    """The connectors as an attack surface. A read-only connector with no stored secret is the goal."""
    out = []
    provider = {a.id: a.provider for a in data.accounts}
    for c in data.connectors:
        where = f"{c.account_id}{' / ' + c.name if c.name else ''}"
        if c.privilege == "admin":
            sev = "critical" if c.scope in ("organization", "management_group") else "high"
            out.append({"connector": where, "severity": sev, "stride": "Elevation of privilege", "title": "The connector can change what it only needs to read",
                        "fix": "Replace the administrative policy with the vendor's read-only one; keep write permissions, if any are needed for remediation, in a separate, opt-in role."})
        if c.auth in SECRET_AUTH:
            out.append({"connector": where, "severity": "medium", "stride": "Spoofing", "title": "A long-lived secret signs the connector in",
                        "fix": "Move to a role with an external ID, a federated credential or a certificate, so there is no shared secret to leak or to expire."})
        if c.auth == "role" and provider.get(c.account_id) == "aws" and c.kind == "cloud":
            out.append({"connector": where, "severity": "high", "stride": "Spoofing (confused deputy)", "title": "The role is trusted without an external ID",
                        "fix": "Add the sts:ExternalId condition with this tenant's value, so another customer of the same vendor cannot have the vendor assume your role."})
        if c.kind == "sensor" and c.privilege == "admin" and c.scope == "cluster":
            out.append({"connector": where, "severity": "medium", "stride": "Elevation of privilege", "title": "The sensor's cluster role can write",
                        "fix": "A sensor needs to read the API and observe the host; bind it to a read-only cluster role."})
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(key=lambda f: (order[f["severity"]], f["connector"]))
    return out


def secrets(data: CustomerData) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for c in data.connectors:
        if c.secret_expires_on is None:
            continue
        left = (c.secret_expires_on - data.as_of).days
        if left <= EXPIRY_WARN_DAYS:
            rows.append({"connector": f"{c.account_id}{' / ' + c.name if c.name else ''}", "account_id": c.account_id, "expires_on": c.secret_expires_on.isoformat(),
                         "days_left": left, "state": "expired" if left < 0 else "expiring", "auth": c.auth})
    rows.sort(key=lambda r: r["days_left"])
    return rows


def waves(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group the blocked accounts by cause. A cause fixed once at the organization level unblocks every account it holds back."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        if r["issue"] and r["stage"] != "complete" or r["issue"] in ("regions_partial", "stale") or (r["issue"] and r["issue"].startswith("aws_kms")):
            key = (r["issue"], r["provider"] if r["issue"] == "not_deployed" else "")
            groups.setdefault(key, []).append(r)
    out = []
    for (iid, prov), members in groups.items():
        info = issue(iid)
        n = len(members)
        if iid == "not_deployed" and n >= 3:
            info = issue("deploy_org")
            iid_out = "deploy_org"
        else:
            iid_out = iid
        once = info["scope"] == "org"
        hours = float(info["hours"]) if once else round(float(info["hours"]) * n, 2)
        first = sorted(members, key=lambda m: m["id"])[0]
        ctx = {"account": first["id"].split("/")[0], "namespace": "", "cluster": first["id"].split("/")[1] if "/" in first["id"] else ""}
        out.append({"issue": iid_out, "title": info["title"] + (f" ({prov})" if prov else ""), "accounts": sorted(m["id"] for m in members), "count": n,
                    "checks": checks_for(iid_out, ctx),
                    "owner": info["owner"], "hours": hours, "once": once, "steps": info["steps"], "verify": info["verify"], "why": info["why"],
                    "per_hour": round(n / max(hours, 0.25), 2)})
    out.sort(key=lambda w: (-float(w["per_hour"]), -int(w["count"]), str(w["issue"])))
    return out


def _stats(values: list[int]) -> dict[str, Any]:
    v = sorted(x for x in values if x is not None and x >= 0)
    if not v:
        return {"n": 0, "median": None, "p90": None}
    return {"n": len(v), "median": median(v), "p90": v[min(len(v) - 1, int(round(0.9 * (len(v) - 1))))]}


def diagnose(data: CustomerData) -> dict[str, Any]:
    by_acc: dict[str, list[Connector]] = {}
    for c in data.connectors:
        by_acc.setdefault(c.account_id, []).append(c)
    have_file = bool(data.connectors)
    active = [a for a in data.accounts if a.status == "active"]
    rows = [_account_row(a, by_acc.get(a.id, []), data, have_file) for a in active]
    order = {s: i for i, s in enumerate(STAGES)}
    rows.sort(key=lambda r: (r["stage"] == "complete", order[r["stage"]], -(r["days_in_stage"] or 0), r["id"]))
    funnel = [{"stage": s, "label": STAGE_LABEL[s], "reached": sum(1 for r in rows if order[r["stage"]] >= order[s])} for s in STAGES]
    causes: dict[str, int] = {}
    for r in rows:
        if r["issue"]:
            causes[r["issue"]] = causes.get(r["issue"], 0) + 1
        for e in r["extensions"]:
            if e["issue"]:
                causes[e["issue"]] = causes.get(e["issue"], 0) + 1
    cause_list = [{"issue": k, "title": issue(k)["title"], "count": v, "owner": issue(k)["owner"]} for k, v in sorted(causes.items(), key=lambda kv: (-kv[1], kv[0]))]
    healthy = sum(1 for r in rows if r["stage"] == "complete" or (r["stage"] == "scanning" and r["issue"] in ("regions_partial",)))
    listed = sum(1 for a in active if a.connected)
    broken_listed = [r["id"] for r in rows if r["listed_connected"] and r["stage"] not in ("complete", "scanning")]
    ext = [dict(e, account_id=r["id"]) for r in rows for e in r["extensions"]]
    return {
        "has_detail": have_file,
        "stages": [{"id": s, "label": STAGE_LABEL[s]} for s in STAGES],
        "accounts": rows,
        "funnel": funnel,
        "causes": cause_list,
        "time_to_deploy": _stats([r["time_to_deploy"] for r in rows]),
        "time_to_first_scan": _stats([r["time_to_first_scan"] for r in rows]),
        "stalled": [r["id"] for r in rows if r["stalled"]],
        "healthy_l1": healthy / len(rows) if rows else 1.0,
        "listed_l1": listed / len(rows) if rows else 1.0,
        "listed_but_broken": broken_listed,
        "extensions": {"total": len(ext), "failing": [e for e in ext if not e["ok"]]},
        "waves": waves(rows + [{"id": f"{e['account_id']}/{e['name'] or e['kind']}", "provider": e["kind"], "issue": e["issue"], "stage": "deployed"} for e in ext if e["issue"]]),
        "security": security_review(data),
        "secrets": secrets(data),
        "catalogue": catalogue()["version"],
    }


def render_markdown(d: dict[str, Any], customer: str, units: str = "accounts") -> str:
    lines = [f"# Onboarding: {customer}", ""]
    f = {x["stage"]: x["reached"] for x in d["funnel"]}
    total = f["discovered"]
    lines.append(f"{f['complete']} of {total} {units} are connected, scanned and fresh. " + (f"{len(d['stalled'])} are stuck at one stage for more than a week." if d["stalled"] else ""))
    if d["listed_but_broken"]:
        lines.append(f"{len(d['listed_but_broken'])} of the {units} counted as connected have a failing connector: {', '.join(d['listed_but_broken'][:8])}.")
    lines += ["", "## Unblock in this order", ""]
    for i, w in enumerate(d["waves"], 1):
        lines.append(f"{i}. **{w['title']}**: {w['count']} {units}, about {w['hours']:g} h, owner {w['owner']}{' (fix once)' if w['once'] else ''}.")
        lines += [f"   - {s}" for s in w["steps"]]
        lines.append(f"   - Verify: {w['verify']}")
    if d["secrets"]:
        lines += ["", "## Secrets that expire soon", ""] + [f"- {s['connector']}: {s['state']} ({s['expires_on']}, {s['days_left']} days)" for s in d["secrets"]]
    if d["security"]:
        lines += ["", "## Connector security review", ""] + [f"- **{x['severity']}** {x['connector']}: {x['title']} ({x['stride']}). {x['fix']}" for x in d["security"]]
    lines += ["", f"Causes from the connector catalogue {d['catalogue']}. Check each fix against your vendor's documentation."]
    return "\n".join(lines)


# ----------------------------------------------------------------------------- pre-flight

PREFLIGHT_KEYS = ("providers", "org", "kubernetes", "sensor", "cmk", "guardrails", "private_clusters", "pod_security", "proxy")


def preflight(opts: dict[str, Any]) -> dict[str, Any]:
    """A checklist for the kickoff call, before any connector exists. Asks only what changes the plan."""
    prov = [p for p in (opts.get("providers") or []) if p in ("aws", "azure", "gcp", "oci")]
    org = bool(opts.get("org", True))
    sections: list[dict[str, Any]] = []
    people = ["Someone who can deploy at the organization level for each cloud in scope" if org else "An administrator for each account to be connected",
              "The owner of the guardrails (SCPs, Azure policies, organization policies), so an exception can be agreed in the meeting"]
    if "azure" in prov:
        people.append("For directory consent on Azure: a Global or Privileged Role Administrator")
    if opts.get("kubernetes") or opts.get("sensor"):
        people.append("The platform team that owns the clusters and the chart pipeline")
    sections.append({"title": "Who must be in the room", "items": people})
    access = []
    if "aws" in prov:
        access.append("AWS: " + ("trusted access for stack sets in the organization, and the stack targeting the root or the units in scope with automatic deployment" if org else "permission to create the read-only role in each account") + "; the role trusts the vendor with this tenant's external ID.")
    if "azure" in prov:
        access.append("Azure: admin consent for the connector's application; read roles at the tenant root management group" + ("" if org else " or each subscription") + "; directory read for identity analysis.")
    if "gcp" in prov:
        access.append("Google Cloud: a host project with the asset and resource manager APIs enabled; read-only roles at the organization" + (" or top folder" if org else " or project") + " for the connector's identity; prefer federation over a key.")
    if "oci" in prov:
        access.append("Oracle Cloud: a read-only policy for the connector's group at the tenancy root.")
    if not access:
        access.append("Choose the clouds in scope to see what access is needed.")
    sections.append({"title": "Access to prepare", "items": access})
    guard = []
    if opts.get("guardrails"):
        guard += ["List the guardrails that deny read actions or restrict regions, and agree a narrow exception for the connector's identity before deployment day."]
        if "gcp" in prov:
            guard.append("Google Cloud: check the service-account-key and domain-restricted-sharing constraints; plan federation or a customer-ID exception.")
        if "azure" in prov:
            guard.append("Azure: check conditional access policies that apply to workload identities.")
    if opts.get("cmk"):
        guard.append("Disks encrypted with customer-managed keys: agree a key policy that lets the scanner create grants for snapshot copies, or record the gap.")
    guard.append("Agree which regions, projects or subscriptions are in scope, so the platform does not report errors for unused ones.")
    sections.append({"title": "Guardrails to check before the day", "items": guard})
    if opts.get("kubernetes") or opts.get("sensor"):
        k = ["Deploy the connector and the sensor with the same chart and values, through the pipeline that creates clusters, so new clusters are covered."]
        if opts.get("private_clusters"):
            k.append("Private API servers: use the in-cluster connector that dials out; do not open the API server.")
        if opts.get("pod_security"):
            k.append("Pod security or admission policies: the sensor needs a privileged DaemonSet; give its namespace the privileged level, and a narrow policy exception for its service account only.")
        if opts.get("proxy"):
            k.append("Egress proxy or TLS inspection: allow the vendor's host names, set the proxy in the chart, add the company CA bundle or exempt the vendor's hosts.")
        if opts.get("sensor"):
            k.append("Check node images and kernel versions against the sensor's support list; serverless node types need the sidecar or serverless option.")
        sections.append({"title": "Clusters and sensors", "items": k})
    sections.append({"title": "Security of the connectors themselves", "items": [
        "Read-only policies only; any remediation permissions in a separate, opt-in role.",
        "No long-lived secrets where a role, federation or certificate is possible; where a secret remains, record its expiry date and the owner of the rotation.",
        "On AWS, the external ID condition is set; on Azure, the application's permissions are reviewed at consent."]})
    sections.append({"title": "Done means", "items": [
        "Every account in scope reaches 'complete and fresh', and an account created after the day is covered without a ticket.",
        "Nothing is stuck at one stage for more than a week; whatever is stuck has an owner and a date.",
        "Secrets and certificates that can expire are listed with their dates."]})
    md = ["# Onboarding pre-flight checklist", ""]
    for sec in sections:
        md += [f"## {sec['title']}", ""] + [f"- [ ] {i}" for i in sec["items"]] + [""]
    return {"sections": sections, "markdown": "\n".join(md).rstrip() + "\n"}


# ----------------------------------------------------------------------------- progress over time

def delta(old: dict[str, Any], new: dict[str, Any], old_as_of: date, new_as_of: date) -> dict[str, Any]:
    """What moved between two diagnoses: accounts forward and back, causes fixed and new, and the pace to the end."""
    order = {s: i for i, s in enumerate(STAGES)}
    before = {r["id"]: r for r in old["accounts"]}
    forward, back, arrived, finished = [], [], [], []
    for r in new["accounts"]:
        o = before.get(r["id"])
        if o is None:
            arrived.append(r["id"])
            continue
        a, b = order[o["stage"]], order[r["stage"]]
        if b > a:
            forward.append({"id": r["id"], "from": o["stage"], "to": r["stage"]})
            if r["stage"] == "complete":
                finished.append(r["id"])
        elif b < a:
            back.append({"id": r["id"], "from": o["stage"], "to": r["stage"], "issue": r["issue"]})
    oc = {c["issue"]: c["count"] for c in old["causes"]}
    nc = {c["issue"]: c["count"] for c in new["causes"]}
    fixed = [{"issue": k, "title": issue(k)["title"], "count": v - nc.get(k, 0)} for k, v in oc.items() if v > nc.get(k, 0)]
    appeared = [{"issue": k, "title": issue(k)["title"], "count": v - oc.get(k, 0)} for k, v in nc.items() if v > oc.get(k, 0)]
    complete_old = next(f["reached"] for f in old["funnel"] if f["stage"] == "complete")
    complete_new = next(f["reached"] for f in new["funnel"] if f["stage"] == "complete")
    total = new["funnel"][0]["reached"]
    days = max(1, (new_as_of - old_as_of).days)
    per_week = (complete_new - complete_old) / days * 7
    remaining = total - complete_new
    forecast = None
    if remaining == 0:
        forecast = {"state": "done"}
    elif per_week > 0:
        weeks = remaining / per_week
        forecast = {"state": "on_track", "weeks": round(weeks, 1), "date": date.fromordinal(new_as_of.toordinal() + int(round(weeks * 7))).isoformat()}
    else:
        forecast = {"state": "stalled"}
    return {"since": old_as_of.isoformat(), "days": days, "forward": forward, "back": back, "arrived": arrived, "finished": finished,
            "complete_before": complete_old, "complete_now": complete_new, "per_week": round(per_week, 2), "remaining": remaining, "forecast": forecast,
            "fixed": sorted(fixed, key=lambda x: -x["count"]), "appeared": sorted(appeared, key=lambda x: -x["count"]),
            "newly_broken": [b for b in new["listed_but_broken"] if b not in set(old["listed_but_broken"])]}


# ----------------------------------------------------------------------------- the page for the customer

VENDOR_SIDE = {"vendor support"}


def customer_status(d: dict[str, Any], customer: str, as_of: str, units: str = "accounts", change: Optional[dict[str, Any]] = None,
                    coming: Optional[list[dict[str, Any]]] = None) -> dict[str, str]:
    """An onboarding status the customer can read: what is done, what waits on whom, what to run to check. No internal scoring."""
    f = {x["stage"]: x["reached"] for x in d["funnel"]}
    total, done = f["discovered"], f["complete"]
    theirs = [w for w in d["waves"] if w["owner"] not in VENDOR_SIDE]
    ours = [w for w in d["waves"] if w["owner"] in VENDOR_SIDE]
    md = [f"# Onboarding status: {customer}", "", f"As of {as_of}.", "", f"**{done} of {total} {units}** are connected, scanned and up to date."]
    if change:
        md.append(f"Since {change['since']}: {len(change['finished'])} completed, {len(change['forward'])} moved forward" + (f", {len(change['back'])} went back" if change["back"] else "") + ".")
        fc = change["forecast"]
        if fc and fc["state"] == "on_track":
            md.append(f"At the pace of the last {change['days']} days, every {units[:-1] if units.endswith('s') else units} in scope is complete around **{fc['date']}**.")
    if d["listed_but_broken"]:
        md.append(f"{len(d['listed_but_broken'])} connector(s) that were working have stopped: {', '.join(d['listed_but_broken'])}.")
    md += ["", "## Waiting on your teams", ""]
    if not theirs:
        md.append("Nothing.")
    for i, w in enumerate(theirs, 1):
        md += [f"### {i}. {w['title']}", "", f"Who: {w['owner']}. Affects {w['count']} {units}: {', '.join(w['accounts'][:12])}{' and more' if w['count'] > 12 else ''}." + (" One change fixes all of them." if w["once"] else ""), "", w["why"], ""]
        md += [f"{k}. {s}" for k, s in enumerate(w["steps"], 1)]
        if w.get("checks"):
            md += ["", "To check (read-only):", "", "```"] + w["checks"] + ["```"]
        md += ["", f"Done when: {w['verify']}", ""]
    md += ["## On our side", ""] + ([f"- {w['title']} ({w['count']} {units}): we are following up with support." for w in ours] or ["Nothing open."])
    soon = [e for e in (coming or []) if e["kind"] in ("secret_expiry", "acceptance_expiry", "sla_critical")][:8]
    if soon:
        md += ["", "## Coming up if nothing changes", ""] + [f"- {e['date']}: {e['text']}" for e in soon]
    if d["secrets"]:
        md += ["", "## Credentials to rotate", ""] + [f"- {s['connector']}: {'expired on' if s['state'] == 'expired' else 'expires on'} {s['expires_on']}." for s in d["secrets"]]
    if d["security"]:
        md += ["", "## Recommendations for the connectors", ""] + [f"- {x['connector']}: {x['title'].lower()}. {x['fix']}" for x in d["security"]]
    md += ["", "Prepared with Beyond 90 from the connector list. Check each step against your vendor's documentation."]
    text = "\n".join(md) + "\n"
    return {"markdown": text, "html": _html(customer, as_of, done, total, units, change, theirs, ours, d, soon)}


def _html(customer: str, as_of: str, done: int, total: int, units: str, change: Optional[dict[str, Any]], theirs: list[dict[str, Any]], ours: list[dict[str, Any]], d: dict[str, Any],
          soon: Optional[list[dict[str, Any]]] = None) -> str:
    from html import escape as e
    pct = round(100 * done / total) if total else 100
    parts = [f"<h1>Onboarding status: {e(customer)}</h1><p class=m>As of {e(as_of)}</p>",
             f"<div class=bar role=img aria-label='{done} of {total} complete'><i style='width:{pct}%'></i></div><p><b>{done} of {total} {e(units)}</b> are connected, scanned and up to date ({pct}%).</p>"]
    if change:
        fc = change["forecast"] or {}
        parts.append(f"<p>Since {e(change['since'])}: {len(change['finished'])} completed, {len(change['forward'])} moved forward" + (f", {len(change['back'])} went back" if change["back"] else "") + "."
                     + (f" At the recent pace, complete around <b>{e(fc['date'])}</b>." if fc.get("state") == "on_track" else "") + "</p>")
    if d["listed_but_broken"]:
        parts.append(f"<p class=warn>{len(d['listed_but_broken'])} connector(s) that were working have stopped: {e(', '.join(d['listed_but_broken']))}.</p>")
    parts.append("<h2>Waiting on your teams</h2>")
    if not theirs:
        parts.append("<p>Nothing.</p>")
    for w in theirs:
        checks = ("<p class=m>To check (read-only):</p><pre>" + e("\n".join(w["checks"])) + "</pre>") if w.get("checks") else ""
        parts.append(f"<section><h3>{e(w['title'])}</h3><p class=m>{e(w['owner'])} · {w['count']} {e(units)}{' · one change fixes all' if w['once'] else ''}</p><p>{e(w['why'])}</p><ol>"
                     + "".join(f"<li>{e(s)}</li>" for s in w["steps"]) + f"</ol>{checks}<p><b>Done when:</b> {e(w['verify'])}</p><p class=m>{e(', '.join(w['accounts']))}</p></section>")
    parts.append("<h2>On our side</h2>" + ("<ul>" + "".join(f"<li>{e(w['title'])} ({w['count']}): we are following up with support.</li>" for w in ours) + "</ul>" if ours else "<p>Nothing open.</p>"))
    if soon:
        parts.append("<h2>Coming up if nothing changes</h2><ul>" + "".join(f"<li>{e(x['date'])}: {e(x['text'])}</li>" for x in soon) + "</ul>")
    if d["secrets"]:
        parts.append("<h2>Credentials to rotate</h2><ul>" + "".join(f"<li>{e(s['connector'])}: {'expired on' if s['state'] == 'expired' else 'expires on'} {e(s['expires_on'])}</li>" for s in d["secrets"]) + "</ul>")
    if d["security"]:
        parts.append("<h2>Recommendations for the connectors</h2><ul>" + "".join(f"<li><b>{e(x['connector'])}</b>: {e(x['title'].lower())}. {e(x['fix'])}</li>" for x in d["security"]) + "</ul>")
    css = ("body{font:15px/1.55 system-ui,sans-serif;color:#111;max-width:820px;margin:32px auto;padding:0 16px}h1{font-size:26px;margin:0}h2{font-size:18px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px}"
           "h3{font-size:15px;margin:18px 0 2px}.m{color:#555;font-size:13px;margin:2px 0}.bar{height:12px;background:#e6e6e2;border-radius:6px;overflow:hidden;margin:14px 0 6px}.bar i{display:block;height:100%;background:#1a7f4a}"
           "pre{background:#f4f4f1;border:1px solid #ddd;border-radius:8px;padding:10px;white-space:pre-wrap;font-size:12.5px}.warn{color:#9a3412}section{break-inside:avoid}footer{margin-top:32px;color:#666;font-size:12px}")
    return ("<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            f"<title>Onboarding status: {e(customer)}</title><style>{css}</style></head><body>" + "".join(parts)
            + "<footer>Prepared with Beyond 90 from the connector list. Check each step against your vendor's documentation.</footer></body></html>\n")
