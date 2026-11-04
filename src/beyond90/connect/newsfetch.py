"""The one network call of the cloud news collector, kept with the other network code (see tests/test_security.py)."""

from __future__ import annotations

import urllib.error
import urllib.request
from urllib.parse import urlparse

from .. import __version__
from ..feeds import MAX_BYTES, TIMEOUT, FeedError


class _Redirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, hosts: list[str]) -> None:
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urlparse(newurl)
        if u.scheme != "https" or u.hostname not in self.hosts:
            raise FeedError(f"redirect to {u.scheme}://{u.hostname} refused (https to a configured host only)")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def http_get(url: str, hosts: list[str]) -> bytes:
    """GET over https with a size cap; redirects only to hosts in ``hosts``."""
    u = urlparse(url)
    if u.scheme != "https" or u.hostname not in hosts:
        raise FeedError(f"{u.scheme}://{u.hostname}: https to a configured host only")
    opener = urllib.request.build_opener(_Redirects(hosts))
    req = urllib.request.Request(url, headers={"User-Agent": f"beyond90-feeds/{__version__}", "Accept": "application/json, application/xml, text/xml, */*;q=0.5"})
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            body: bytes = resp.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        raise FeedError(f"HTTP {e.code}") from None
    except FeedError:
        raise
    except Exception as e:                                       # network, TLS, timeouts: reported, never fatal for the run
        raise FeedError(type(e).__name__) from None
    if len(body) > MAX_BYTES:
        raise FeedError(f"larger than {MAX_BYTES // (1024 * 1024)} MB")
    return body
