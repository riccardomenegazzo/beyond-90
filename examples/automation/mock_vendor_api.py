"""A tiny fake vendor API, for trying the pipeline without any real product.

    python examples/automation/mock_vendor_api.py 8765

It serves paginated JSON for tenants, assets, capabilities and findings, and requires `Authorization: Bearer demo-token`.
Everything is invented. Real APIs differ: that is what the `map` tables in beyond90.toml are for.
"""

from __future__ import annotations

import json
import random
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOKEN = "demo-token"


def build(seed: int = 7) -> dict[str, list[dict]]:
    r = random.Random(seed)
    tenants, assets, caps, findings = [], [], [], []
    for i in range(1, 31):
        connected = r.random() < 0.75
        tenants.append({"tenant_id": f"t-{i:03d}", "display_name": f"Tenant {i}", "platform": r.choice(["aws", "azure", "gcp"]),
                        "state": "enabled" if r.random() < 0.95 else "disabled", "agent_connected": connected, "owner_team": r.choice(["retail", "platform", "data", ""]),
                        "created": f"2025-{r.randint(1, 12):02d}-{r.randint(1, 28):02d}T10:00:00Z"})
        if connected:
            for t in ("compute", "storage_object", "network", "identity", "kubernetes"):
                if r.random() < 0.9:
                    assets.append({"tenant": f"t-{i:03d}", "kind": t, "total": r.randint(1, 300), "scanned": r.random() < 0.9})
            for m in ("posture", "vulnerability_scanning", "identity_analysis", "container_security"):
                caps.append({"tenant": f"t-{i:03d}", "capability": m, "enabled": r.random() < 0.7})
    for j in range(1, 41):
        findings.append({"key": f"F-{j:04d}", "tenant": f"t-{r.randint(1, 30):03d}", "sev": r.choice(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
                         "opened": f"2026-{r.randint(8, 10):02d}-{r.randint(1, 28):02d}T09:00:00Z", "closed": None, "assignee": r.choice(["alice", "bob", None]),
                         "triage": r.choice(["fix", "accepted_risk", None])})
    return {"tenants": tenants, "assets": assets, "capabilities": caps, "findings": findings}


DATA = build()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self.send_response(401)
            self.end_headers()
            return
        u = urlparse(self.path)
        name = u.path.strip("/").split("/")[-1]
        if name not in DATA:
            self.send_response(404)
            self.end_headers()
            return
        q = parse_qs(u.query)
        size, cursor = 10, int(q.get("cursor", ["0"])[0])
        items = DATA[name]
        page = items[cursor: cursor + size]
        body = {"data": page, "next": str(cursor + size) if cursor + size < len(items) else None}
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"mock vendor API on http://127.0.0.1:{port}  (token: {TOKEN})")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
