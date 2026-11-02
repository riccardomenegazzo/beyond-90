"""Fetch one source's records, safely.

* HTTP: GET only. https, except plain http to localhost. The host must be in ``allow_hosts``, and so must the
  host of any redirect. The token comes from an environment variable and is never written to a message or a log.
  Responses are capped in size, requests in time, and a failed request is retried a couple of times with a fixed
  back-off (a read is safe to repeat; the data is the same either way, so a retry cannot make anything worse).
* Command: an argument list, never a shell. Only the environment variables the source names are passed on.
* File: a local path or glob, for exports another system drops in a folder.
"""

from __future__ import annotations

import csv
import glob
import http.client
import io
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any, Optional
from urllib.parse import urlencode, urljoin, urlparse

from .. import __version__
from .config import Config, Source
from .mapping import get_path


class FetchError(Exception):
    pass


def _safe_url(url: str) -> str:
    u = urlparse(url)
    return f"{u.scheme}://{u.netloc}{u.path}"                 # the query can carry a token; messages never show it


def check_url(url: str, allow_hosts: list[str]) -> None:
    u = urlparse(url)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        raise FetchError(f"{_safe_url(url)}: only https is allowed (plain http only for localhost)")
    if u.hostname not in allow_hosts:
        raise FetchError(f"{_safe_url(url)}: host {u.hostname!r} is not in allow_hosts")


class _SameRules(urllib.request.HTTPRedirectHandler):
    def __init__(self, allow_hosts: list[str]) -> None:
        self.allow_hosts = allow_hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl, self.allow_hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _parse(body: bytes, fmt: str, records: str, delimiter: str = ",") -> list[Any]:
    if fmt == "csv":
        text = body.decode("utf-8-sig", errors="replace")
        try:
            return [dict(r) for r in csv.DictReader(io.StringIO(text), delimiter=delimiter)]
        except csv.Error as e:
            raise FetchError(f"the response is not valid CSV: {e}") from e
    try:
        doc = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError) as e:
        raise FetchError(f"the response is not valid JSON: {type(e).__name__}") from e
    node = get_path(doc, records) if records else doc
    if node is None:
        raise FetchError(f"no records at path {records!r} in the response")
    if isinstance(node, dict):
        return [node]
    if not isinstance(node, list):
        raise FetchError(f"records path {records!r} is a {type(node).__name__}, not a list")
    return node


def _read(resp: Any, cap: int) -> bytes:
    body = resp.read(cap + 1)
    if len(body) > cap:
        raise FetchError(f"the response is larger than max_bytes ({cap})")
    return body


def _http(s: Source, cfg: Config, env: Mapping[str, str], sleep: Callable[[float], None], opener: Optional[urllib.request.OpenerDirector]) -> list[Any]:
    check_url(s.url, cfg.allow_hosts)
    headers = {"Accept": "application/json" if s.format == "json" else "text/csv", "User-Agent": f"beyond90/{__version__}", **s.headers}
    if s.auth:
        token = env.get(s.auth["env"])
        if not token:
            raise FetchError(f"environment variable {s.auth['env']} is not set (it should hold the token for {s.name})")
        headers[s.auth.get("header", "Authorization")] = s.auth.get("prefix", "Bearer ") + token
    opener = opener or urllib.request.build_opener(_SameRules(cfg.allow_hosts))
    p = s.pagination
    out: list[Any] = []
    url, seen, pages = s.url, set(), 0
    params: dict[str, Any] = {}
    page_no = int(p.get("start", 1)) if p.get("type") == "page" else 0
    offset = 0
    while True:
        pages += 1
        if pages > int(p.get("max_pages", 200)):
            raise FetchError(f"more than {p.get('max_pages', 200)} pages; raise pagination.max_pages if that is right")
        q = dict(params)
        if p.get("type") == "page":
            q[p["page_param"]] = page_no
            if "size_param" in p:
                q[p["size_param"]] = p.get("size", 100)
        elif p.get("type") == "offset":
            q[p["offset_param"]], q[p["limit_param"]] = offset, p["limit"]
        full = url + (("&" if "?" in url else "?") + urlencode(q) if q else "")
        check_url(full, cfg.allow_hosts)
        body, link = _request(opener, full, headers, s.timeout_seconds, cfg, sleep)
        recs = _parse(body, s.format, s.records, s.delimiter)
        out.extend(recs)
        if len(out) * 1 > 5_000_000:
            raise FetchError("more than 5,000,000 records")
        kind = p.get("type")
        if not kind or not recs and kind != "link_header":
            break
        if kind == "link_header":
            if not link:
                break
            url, params = urljoin(url, link), {}
            if url in seen:
                raise FetchError("pagination loops back to a page already read")
            seen.add(url)
        elif kind == "cursor":
            try:
                nxt = get_path(json.loads(body.decode("utf-8-sig")), p["cursor_path"])
            except (ValueError, RecursionError):
                break
            if not nxt:
                break
            if not isinstance(nxt, (str, int)):
                raise FetchError("the pagination cursor is not a string or a number")
            nxt = str(nxt)
            if nxt in seen:
                raise FetchError("pagination cursor repeats; stopping so it cannot loop")
            seen.add(nxt)
            params = {p["cursor_param"]: nxt}
        elif kind == "page":
            page_no += 1
        elif kind == "offset":
            if len(recs) < int(p["limit"]):
                break
            offset += int(p["limit"])
    return out


def _request(opener: urllib.request.OpenerDirector, url: str, headers: dict[str, str], timeout: float, cfg: Config,
             sleep: Callable[[float], None]) -> tuple[bytes, str]:
    last = ""
    for attempt in range(cfg.retries + 1):
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with opener.open(req, timeout=timeout) as resp:
                link = resp.headers.get("Link", "")
                nxt = ""
                for part in link.split(","):
                    if 'rel="next"' in part and "<" in part:
                        nxt = part.split("<", 1)[1].split(">", 1)[0]
                return _read(resp, cfg.max_bytes), nxt
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code not in (429, 500, 502, 503, 504) or attempt == cfg.retries:
                raise FetchError(f"{_safe_url(url)}: {last}" + (" (check the token and its scope)" if e.code in (401, 403) else "")) from None
            try:
                wait = float(e.headers.get("Retry-After", ""))
                wait = min(wait, 30.0) if wait >= 0 else 2.0 ** attempt      # NaN fails the comparison
                if wait != wait:
                    wait = 2.0 ** attempt
            except ValueError:
                wait = 2.0 ** attempt
            sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, http.client.HTTPException) as e:
            last = type(e).__name__
            if attempt == cfg.retries:
                raise FetchError(f"{_safe_url(url)}: {last}") from None
            sleep(2.0 ** attempt)
    raise FetchError(f"{_safe_url(url)}: {last}")


def _command(s: Source, cfg: Config, env: Mapping[str, str]) -> list[Any]:
    passed = {k: env[k] for k in ["PATH", "HOME", *s.env] if k in env}
    try:
        r = subprocess.run(s.argv, capture_output=True, timeout=s.timeout_seconds, env=passed, stdin=subprocess.DEVNULL, check=False)
    except FileNotFoundError:
        raise FetchError(f"command not found: {s.argv[0]} (is it installed on the machine that runs this?)") from None
    except subprocess.TimeoutExpired:
        raise FetchError(f"{s.argv[0]} did not finish within {s.timeout_seconds:g} seconds") from None
    if r.returncode != 0:
        tail = r.stderr.decode("utf-8", errors="replace").strip().splitlines()[-1:] or [""]
        raise FetchError(f"{s.argv[0]} exited with status {r.returncode}: {tail[0][:200]}")
    if len(r.stdout) > cfg.max_bytes:
        raise FetchError(f"the output is larger than max_bytes ({cfg.max_bytes})")
    return _parse(r.stdout, s.format, s.records, s.delimiter)


def _file(s: Source, cfg: Config) -> list[Any]:
    pattern = s.path if os.path.isabs(s.path) else str(cfg.base_dir / s.path)
    paths = sorted(glob.glob(pattern))
    if not paths:
        raise FetchError(f"no file matches {s.path}")
    out: list[Any] = []
    for p in paths:
        with open(p, "rb") as fh:
            body = fh.read(cfg.max_bytes + 1)
        if len(body) > cfg.max_bytes:
            raise FetchError(f"{p} is larger than max_bytes")
        out.extend(_parse(body, s.format, s.records, s.delimiter))
    return out


def fetch_source(s: Source, cfg: Config, *, env: Optional[Mapping[str, str]] = None, sleep: Callable[[float], None] = time.sleep,
                 opener: Optional[urllib.request.OpenerDirector] = None) -> list[Any]:
    env = os.environ if env is None else env
    if s.type == "http":
        return _http(s, cfg, env, sleep, opener)
    if s.type == "command":
        return _command(s, cfg, env)
    return _file(s, cfg)
