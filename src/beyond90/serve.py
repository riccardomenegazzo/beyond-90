"""Serve the browser app from your own machine or network: `beyond90 app`.

For teams that cannot use the public site, or want it inside their own network. It serves a built site (a folder, or
the `beyond90-site.zip` published with every build) read-only, with the page's Content Security Policy sent as a
header too, plus anti-framing, no-sniff, no-referrer and isolation headers. Only GET and HEAD; paths are confined to
the site; requests naming another host are refused (DNS rebinding). It listens on 127.0.0.1 unless told otherwise.

The app itself still talks only to this origin: the server never receives customer data, it only hands out files.
"""

from __future__ import annotations

import mimetypes
import posixpath
import re
import zipfile
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlsplit

TYPES = {".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json",
         ".webmanifest": "application/manifest+json", ".css": "text/css", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml",
         ".png": "image/png", ".woff2": "font/woff2", ".zip": "application/zip", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8"}


class Site:
    """A built site, from a folder or from its zip, read-only."""

    def __init__(self, source: Path) -> None:
        self.files: dict[str, bytes] = {}
        if source.is_file() and zipfile.is_zipfile(source):
            with zipfile.ZipFile(source) as z:
                names = [n for n in z.namelist() if not n.endswith("/")]
                prefix = _common_prefix(names)
                for n in names:
                    rel = n[len(prefix):]
                    if _safe(rel):
                        self.files[rel] = z.read(n)
        elif source.is_dir():
            root = source.resolve()
            for p in root.rglob("*"):
                if p.is_file() and not p.is_symlink():
                    self.files[p.relative_to(root).as_posix()] = p.read_bytes()
        else:
            raise ValueError(f"{source}: expected a built site folder or beyond90-site.zip")
        if "index.html" not in self.files:
            raise ValueError(f"{source}: no index.html; build the site first (site/build_site.py) or download beyond90-site.zip")
        meta = re.search(rb'http-equiv="Content-Security-Policy" content="([^"]+)"', self.files["index.html"])
        self.policy = (meta.group(1).decode() if meta else "default-src 'self'") + "; frame-ancestors 'none'"

    def get(self, path: str) -> Optional[bytes]:
        return self.files.get(path)


def _common_prefix(names: list[str]) -> str:
    """A zip made of a folder holds `folder/...`: serve what is inside it."""
    tops = {n.split("/", 1)[0] for n in names}
    return next(iter(tops)) + "/" if len(tops) == 1 and all("/" in n for n in names) else ""


def _safe(rel: str) -> bool:
    return bool(rel) and not rel.startswith("/") and ".." not in rel.split("/") and "\\" not in rel


def handler(site: Site, hosts: set[str]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "Beyond90"
        sys_version = ""

        def log_message(self, format: str, *args: object) -> None:
            pass                                                         # file names only, and no customer data: nothing worth logging

        def _headers(self, status: int, ctype: str, length: int) -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Security-Policy", site.policy)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=()")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

        def _deny(self, status: int, text: str) -> None:
            body = text.encode()
            self._headers(status, "text/plain; charset=utf-8", len(body))
            if self.command != "HEAD":
                self.wfile.write(body)

        def _serve(self) -> None:
            if _hostname(self.headers.get("Host", "")) not in hosts:
                return self._deny(421, "Unknown host")
            path = unquote(urlsplit(self.path).path)
            rel = posixpath.normpath(path).lstrip("/")
            rel = "index.html" if rel in ("", ".") else rel
            body = site.get(rel) if _safe(rel) else None
            if body is None:
                return self._deny(404, "Not found")
            ext = posixpath.splitext(rel)[1].lower()
            self._headers(200, TYPES.get(ext) or mimetypes.guess_type(rel)[0] or "application/octet-stream", len(body))
            if self.command != "HEAD":
                self.wfile.write(body)

        do_GET = _serve
        do_HEAD = _serve

        def _refuse(self) -> None:
            self._deny(405, "Read-only")

        do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _refuse

    return Handler


def make_server(source: Path, host: str = "127.0.0.1", port: int = 8090, names: tuple[str, ...] = ()) -> ThreadingHTTPServer:
    site = Site(source)
    allowed = {"127.0.0.1", "localhost", "[::1]", *(n.lower() for n in names)}
    if host not in ("0.0.0.0", "::", ""):                              # noqa: S104 - compared, not bound
        allowed.add(host.lower())
    return ThreadingHTTPServer((host, port), handler(site, allowed))


def _hostname(header: str) -> str:
    """The name a request was sent to, without the port: a container or a proxy may publish any port."""
    h = header.strip().lower()
    return h if h.startswith("[") and h.endswith("]") else h.rsplit(":", 1)[0] if h.count(":") == 1 or h.startswith("[") else h


def run(source: Path, host: str, port: int, names: tuple[str, ...], say: Callable[[str], None]) -> None:
    srv = make_server(source, host, port, names)
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0', '::') else host}:{srv.server_address[1]}/"  # noqa: S104
    say(f"Beyond 90 is at {url}  (Ctrl+C to stop)")
    if host not in ("127.0.0.1", "localhost", "::1"):
        say("Listening beyond this machine: put it behind HTTPS, because browsers allow offline use and passphrase protection only on HTTPS or localhost, "
            "and pass every name it is reached by with --name.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
