"""Writes two mock customers, one per extra profile, to examples/profiles/saas/ and examples/profiles/ai/.

Everything here is invented. They show the same engine measuring tenants of business applications (saas)
and AI environments (ai) with their own words and capabilities. The output is deterministic.
"""

from __future__ import annotations

import json
import random
from datetime import date, timedelta
from pathlib import Path

AS_OF = date(2026, 10, 31)
HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "src" / "beyond90" / "data" / "profiles"

CUSTOMERS = {
    "saas": {"dir": "acme-saas", "name": "Acme SaaS (mock)", "arr": 180000, "seed": 4101, "count": 20, "weights": [8, 6, 3, 2, 3],
             "owners": ["it-service-desk", "sales-ops", "people-ops", "security-ops", "engineering-platform"],
             "entitlements": "unit,licensed,used\nseats,2400,1900\nconnected_apps,120,35\n"},
    "ai": {"dir": "orbit-ai", "name": "Orbit AI (mock)", "arr": 260000, "seed": 4102, "count": 16, "weights": [8, 4, 6, 3],
           "owners": ["ml-platform", "data-science", "product-ai", "security-ops", "developer-experience"],
           "entitlements": "unit,licensed,used\nmonitored_endpoints,60,24\nred_team_runs,40,6\n"},
}


def build(profile: str, out: Path) -> None:
    c = CUSTOMERS[profile]
    r = random.Random(c["seed"])
    types = json.loads((DATA / profile / "resource_types.json").read_text())
    mods = json.loads((DATA / profile / "modules.json").read_text())["modules"]
    platforms = list(types["expected"])
    out.mkdir(parents=True, exist_ok=True)
    owners = c["owners"]
    units = []
    for i in range(c["count"]):
        provider = r.choices(platforms, weights=c["weights"])[0]
        sources = ["billing"] + (["org"] if r.random() < 0.85 else []) + (["sso"] if r.random() < 0.7 else [])
        units.append({"id": f"{profile}-{i + 1:02d}", "provider": provider, "sources": ";".join(sources), "connected": r.random() < 0.7,
                      "owner": r.choice(owners), "spend": r.randint(2, 80) * 100, "created": (AS_OF - timedelta(days=r.randint(5, 700))).isoformat()})
    rows = ["id,provider,sources,connected,owner,last_spend,status,in_plan,created_at"]
    for u in units:
        rows.append(f"{u['id']},{u['provider']},{u['sources']},{str(u['connected']).lower()},{u['owner']},{u['spend']},active,{str(r.random() < 0.8).lower()},{u['created']}")
    (out / "accounts.csv").write_text("\n".join(rows) + "\n")

    inv = ["account_id,resource_type,count,inventoried"]
    for u in units:
        if not u["connected"]:
            continue
        for t in types["expected"][u["provider"]]:
            if r.random() < 0.85:
                inv.append(f"{u['id']},{t},{r.randint(2, 300)},true")
            elif r.random() < 0.5:
                inv.append(f"{u['id']},{t},{r.randint(2, 60)},false")
    (out / "inventory.csv").write_text("\n".join(inv) + "\n")

    act = ["account_id,module_id,active"]
    for u in units:
        if not u["connected"]:
            continue
        for m in mods:
            if u["provider"] in m["providers"]:
                base = 0.95 if m.get("on_connect") else 0.5
                act.append(f"{u['id']},{m['id']},{str(r.random() < base).lower()}")
    (out / "activations.csv").write_text("\n".join(act) + "\n")

    fin = ["id,account_id,severity,exposure,opened_at,closed_at,owner,decision,decision_reason,expiry,previous_severity,severity_changed_at,verified_at,reopened,closed_by"]
    connected = [u for u in units if u["connected"]]
    for j in range(40):
        u = r.choice(connected)
        opened = AS_OF - timedelta(days=r.randint(1, 120))
        sev = r.choices(["critical", "high", "medium", "low"], weights=[2, 5, 8, 6])[0]
        closed = opened + timedelta(days=r.randint(1, 30)) if r.random() < 0.55 and opened + timedelta(days=30) < AS_OF else None
        owner = r.choice(owners) if r.random() < 0.65 else ""
        decision = r.choice(["fix", "fix", "accepted_risk"]) if owner and r.random() < 0.8 else ""
        expiry = (AS_OF + timedelta(days=r.randint(20, 120))).isoformat() if decision == "accepted_risk" else ""
        reason = "business process depends on it" if decision == "accepted_risk" else ""
        by = r.choice(["manual", "assisted", "automated"]) if closed else ""
        fin.append(f"x-{j + 1:03d},{u['id']},{sev},{r.choice(['internet', 'internal'])},{opened},{closed or ''},{owner},{decision},{reason},{expiry},,,,,{by}")
    (out / "findings.csv").write_text("\n".join(fin) + "\n")

    teams = ["id,name,has_assets,active_users,sso,role_scoped,last_access_review"]
    for o in owners:
        teams.append(f"{o},{o.replace('-', ' ').title()},true,{r.randint(0, 6)},{str(r.random() < 0.6).lower()},{str(r.random() < 0.5).lower()},{(AS_OF - timedelta(days=r.randint(10, 300))).isoformat()}")
    (out / "teams.csv").write_text("\n".join(teams) + "\n")
    (out / "entitlements.csv").write_text(c["entitlements"])
    (out / "contacts.csv").write_text(
        "id,name,role,team,influence,last_contact,credibility,reliability,intimacy,self_orientation\n"
        f"c1,Dana Reyes,security_leader,security-ops,3,2026-10-20,8,7,6,3\n"
        f"c2,Marco Bianchi,champion,{owners[0]},2,2026-10-27,7,8,7,2\n")
    (out / "commitments.csv").write_text(
        "id,contact_id,description,promised_on,due_on,done_on\n"
        "k1,c1,Share the rollout timeline,2026-09-20,2026-10-05,2026-10-04\n"
        "k2,c2,Review the access plan with the owners,2026-10-01,2026-10-20,\n")
    (out / "customer.toml").write_text(
        f'[customer]\nname = "{c["name"]}"\ntier = "enterprise"\narr = {c["arr"]}\nas_of = 2026-10-31\nprofile = "{profile}"\n\n'
        '[settings]\nceiling_version = "2026.4"\nbaseline_ceiling = "2026.1"\n')


def main() -> None:
    for profile, c in CUSTOMERS.items():
        build(profile, HERE / "profiles" / profile / c["dir"])


if __name__ == "__main__":
    main()
