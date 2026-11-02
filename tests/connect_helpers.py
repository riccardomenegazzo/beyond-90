"""A fake vendor API and a config builder, shared by the automation tests."""
from __future__ import annotations

import json
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse


class Api:
    """Routes: path -> callable(query dict, headers) -> (status, body, headers). Records every request."""

    def __init__(self) -> None:
        self.routes: dict[str, Callable[[dict, Any], tuple[int, Any, dict]]] = {}
        self.log: list[tuple[str, dict, str]] = []
        self.posts: list[bytes] = []
        api = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _serve(self, method: str) -> None:
                u = urlparse(self.path)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                api.log.append((u.path, q, self.headers.get("Authorization", "")))
                n = int(self.headers.get("Content-Length", 0) or 0)
                if method == "POST":
                    api.posts.append(self.rfile.read(n))
                fn = api.routes.get(u.path)
                status, body, headers = fn(q, self.headers) if fn else (404, {}, {})
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                self._serve("GET")

            def do_POST(self):
                self._serve("POST")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def paged(items: list[dict], size: int = 3, token: Optional[str] = "t0ken", key: str = "data") -> Callable[[dict, Any], tuple[int, Any, dict]]:
    def route(q: dict, headers: Any) -> tuple[int, Any, dict]:
        if token and headers.get("Authorization") != f"Bearer {token}":
            return 401, {}, {}
        cur = int(q.get("cursor", 0))
        nxt = cur + size
        return 200, {key: items[cur:nxt], "next": str(nxt) if nxt < len(items) else None}, {}
    return route


TENANTS = [{"id": f"t{i}", "plat": "aws" if i % 2 else "azure", "up": i % 3 != 0, "team": "retail" if i < 5 else "data", "state": "enabled"} for i in range(1, 9)]
ASSETS = [{"t": f"t{i}", "kind": k, "n": 4, "ok": True} for i in range(1, 9) for k in ("compute", "identity")]
CAPS = [{"t": f"t{i}", "cap": "posture", "on": i % 2 == 0} for i in range(1, 9)]
FINDINGS = [{"k": f"f{i}", "t": "t1", "sev": "CRITICAL" if i < 3 else "low", "opened": "2026-10-01T00:00:00Z", "who": "" if i == 1 else "alice", "triage": "fix"} for i in range(1, 6)]


def config_text(api_base: str, *, extra_sources: str = "", extra: str = "", allow: str = '"127.0.0.1"', customer_extra: str = "") -> str:
    cur = '[source.pagination]\ntype = "cursor"\ncursor_path = "next"\ncursor_param = "cursor"\n'
    auth = '[source.auth]\nenv = "T_TOKEN"\n'
    return f'''
[customer]
name = "Test Co"
arr = 100000
{customer_extra}
[settings]
ceiling_version = "2026.4"
baseline_ceiling = "2026.1"

[security]
allow_hosts = [{allow}]
retries = 2
{extra}

[[source]]
name = "tenants"
type = "http"
url = "{api_base}/tenants"
target = "accounts"
tag = "org"
records = "data"
{auth}{cur}[source.map]
id = "id"
provider = "plat"
owner = "team"
connected = {{ path = "up", transform = "bool" }}
status = {{ path = "state", map = {{ enabled = "active" }}, default = "active" }}

[[source]]
name = "assets"
type = "http"
url = "{api_base}/assets"
target = "inventory"
records = "data"
{auth}{cur}[source.map]
account_id = "t"
resource_type = "kind"
count = "n"
inventoried = {{ path = "ok", transform = "bool" }}

[[source]]
name = "caps"
type = "http"
url = "{api_base}/caps"
target = "activations"
records = "data"
{auth}{cur}[source.map]
account_id = "t"
module_id = "cap"
active = {{ path = "on", transform = "bool" }}

[[source]]
name = "findings"
type = "http"
url = "{api_base}/findings"
target = "findings"
records = "data"
{auth}{cur}[source.map]
id = "k"
account_id = "t"
severity = {{ path = "sev", transform = "lower" }}
opened_at = {{ path = "opened", transform = "date" }}
owner = "who"
decision = "triage"
{extra_sources}
'''


def serve_default(api: Api, token: str = "t0ken") -> None:
    api.routes["/tenants"] = paged(TENANTS, token=token)
    api.routes["/assets"] = paged(ASSETS, token=token)
    api.routes["/caps"] = paged(CAPS, token=token)
    api.routes["/findings"] = paged(FINDINGS, token=token)
