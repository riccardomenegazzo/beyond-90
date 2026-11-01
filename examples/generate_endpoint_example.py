"""Writes a mock endpoint-protection customer (profile: endpoint) to examples/profiles/endpoint/acme-endpoint.

Everything here is invented. It exists to show that the engine is not tied to cloud: the same four stages
measure agents on sites instead of connectors on cloud accounts.
"""

from __future__ import annotations

import random
from datetime import date, timedelta
from pathlib import Path

AS_OF = date(2026, 10, 31)
OUT = Path(__file__).resolve().parent / "profiles" / "endpoint" / "acme-endpoint"

EXPECTED = {
    "windows": ["workstation", "server", "vdi", "identity_store"],
    "macos": ["workstation"],
    "linux": ["server", "container_host"],
    "mobile": ["mobile"],
}
MODULES = {
    "windows": ["prevention", "edr_telemetry", "ransomware_protection", "vulnerability_assessment", "host_firewall", "device_control",
                "identity_threat_detection", "managed_detection", "ai_assisted_triage", "automated_response"],
    "macos": ["prevention", "edr_telemetry", "ransomware_protection", "vulnerability_assessment", "host_firewall", "device_control",
              "managed_detection", "ai_assisted_triage", "automated_response"],
    "linux": ["prevention", "edr_telemetry", "ransomware_protection", "vulnerability_assessment", "host_firewall", "container_runtime",
              "managed_detection", "ai_assisted_triage", "automated_response"],
    "mobile": ["mobile_threat_defense", "managed_detection"],
}
OWNERS = ["it-ops-emea", "it-ops-amer", "retail-it", "plant-it", "security-ops", "mobile-team"]


def main() -> None:
    r = random.Random(2026)
    OUT.mkdir(parents=True, exist_ok=True)
    sites = []
    for i in range(24):
        provider = r.choices(["windows", "macos", "linux", "mobile"], weights=[10, 5, 6, 3])[0]
        sources = ["billing"] + (["org"] if r.random() < 0.85 else []) + (["sso"] if r.random() < 0.7 else [])
        sites.append({
            "id": f"site-{i + 1:02d}", "provider": provider, "sources": ";".join(sources),
            "connected": r.random() < 0.72, "owner": r.choice(OWNERS), "spend": r.randint(2, 90) * 100,
            "created": (AS_OF - timedelta(days=r.randint(5, 700))).isoformat(),
        })
    rows = ["id,provider,sources,connected,owner,last_spend,status,in_plan,created_at"]
    for s in sites:
        rows.append(f"{s['id']},{s['provider']},{s['sources']},{str(s['connected']).lower()},{s['owner']},{s['spend']},active,{str(r.random() < 0.8).lower()},{s['created']}")
    (OUT / "accounts.csv").write_text("\n".join(rows) + "\n")

    inv = ["account_id,resource_type,count,inventoried"]
    for s in sites:
        if not s["connected"]:
            continue
        for t in EXPECTED[s["provider"]]:
            if r.random() < 0.88:
                inv.append(f"{s['id']},{t},{r.randint(3, 400)},true")
            elif r.random() < 0.5:
                inv.append(f"{s['id']},{t},{r.randint(3, 80)},false")
    (OUT / "inventory.csv").write_text("\n".join(inv) + "\n")

    act = ["account_id,module_id,active"]
    for s in sites:
        if not s["connected"]:
            continue
        for m in MODULES[s["provider"]]:
            base = 0.97 if m in ("prevention", "edr_telemetry") else 0.55
            act.append(f"{s['id']},{m},{str(r.random() < base).lower()}")
    (OUT / "activations.csv").write_text("\n".join(act) + "\n")

    fin = ["id,account_id,severity,exposure,opened_at,closed_at,owner,decision,decision_reason,expiry,previous_severity,severity_changed_at"]
    connected = [s for s in sites if s["connected"]]
    for j in range(46):
        s = r.choice(connected)
        opened = AS_OF - timedelta(days=r.randint(1, 120))
        sev = r.choices(["critical", "high", "medium", "low"], weights=[2, 5, 8, 6])[0]
        closed = opened + timedelta(days=r.randint(1, 30)) if r.random() < 0.55 and opened + timedelta(days=30) < AS_OF else None
        owner = r.choice(OWNERS) if r.random() < 0.65 else ""
        decision = r.choice(["fix", "fix", "accepted_risk"]) if owner and r.random() < 0.8 else ""
        expiry = (AS_OF + timedelta(days=r.randint(20, 120))).isoformat() if decision == "accepted_risk" else ""
        reason = "legacy line-of-business application" if decision == "accepted_risk" else ""
        fin.append(f"d-{j + 1:03d},{s['id']},{sev},{r.choice(['internet', 'internal'])},{opened},{closed or ''},{owner},{decision},{reason},{expiry},,")
    (OUT / "findings.csv").write_text("\n".join(fin) + "\n")

    teams = ["id,name,has_assets,active_users,sso,role_scoped,last_access_review"]
    for o in OWNERS:
        teams.append(f"{o},{o.replace('-', ' ').title()},true,{r.randint(0, 6)},{str(r.random() < 0.6).lower()},{str(r.random() < 0.5).lower()},{(AS_OF - timedelta(days=r.randint(10, 300))).isoformat()}")
    (OUT / "teams.csv").write_text("\n".join(teams) + "\n")
    (OUT / "entitlements.csv").write_text("unit,licensed,used\nagents,12000,7900\nmdr_seats,3000,900\n")
    (OUT / "contacts.csv").write_text(
        "id,name,role,team,influence,last_contact,credibility,reliability,intimacy,self_orientation\n"
        "c1,Dana Reyes,security_leader,security-ops,3,2026-10-20,8,7,6,3\n"
        "c2,Marco Bianchi,champion,it-ops-emea,2,2026-10-27,7,8,7,2\n"
        "c3,Priya Nair,practitioner,retail-it,1,2026-08-02,6,6,4,5\n")
    (OUT / "commitments.csv").write_text(
        "id,contact_id,description,promised_on,due_on,done_on\n"
        "k1,c1,Share the MDR onboarding timeline,2026-09-20,2026-10-05,2026-10-04\n"
        "k2,c2,Review the Linux rollout plan with plant IT,2026-10-01,2026-10-20,\n")
    (OUT / "customer.toml").write_text(
        '[customer]\nname = "Acme Endpoint (mock)"\ntier = "enterprise"\narr = 310000\nas_of = 2026-10-31\nprofile = "endpoint"\n\n'
        '[settings]\nceiling_version = "2026.4"\nbaseline_ceiling = "2026.1"\n')


if __name__ == "__main__":
    main()
