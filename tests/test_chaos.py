"""A vendor API that misbehaves: the fetcher must end in a FetchError that names the source, never a traceback."""
import contextlib
import socket
import threading

import pytest

from beyond90.connect import FetchError, fetch_source, load_config
from connect_helpers import Api, config_text, serve_default

ENV = {"T_TOKEN": "t0ken", "PATH": "/usr/bin:/bin"}


class RawServer:
    """Speaks just enough HTTP to say something wrong: a short body, a dropped connection, garbage."""

    def __init__(self, reply: bytes, then_close: bool = True):
        self.reply, self.then_close = reply, then_close
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.stopped = False
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while not self.stopped:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            try:
                conn.settimeout(2)
                conn.recv(65536)
                conn.sendall(self.reply)
            except OSError:
                pass
            finally:
                conn.close()

    def stop(self):
        self.stopped = True
        self.sock.close()


def cfg_for(tmp_path, base, **kw):
    p = tmp_path / "beyond90.toml"
    p.write_text(config_text(base, **kw))
    return load_config(p)


@pytest.fixture
def api():
    a = Api()
    serve_default(a)
    yield a
    a.stop()


@pytest.mark.parametrize("reply", [
    b"HTTP/1.1 200 OK\r\nContent-Length: 500\r\n\r\n{\"data\": [",           # body cut short (IncompleteRead)
    b"",                                                                      # connection closed with no answer
    b"garbage that is not http\r\n\r\n",                                      # not HTTP at all
    b"HTTP/1.1 200 OK\r\nContent-Length: abc\r\n\r\n{}",                      # a broken header
    b"HTTP/1.1 999 Weird\r\nContent-Length: 2\r\n\r\n{}",                     # a status nobody uses
])
def test_a_server_that_breaks_the_protocol_gives_a_fetch_error(tmp_path, reply):
    srv = RawServer(reply)
    try:
        cfg = cfg_for(tmp_path, f"http://127.0.0.1:{srv.port}")
        with pytest.raises(FetchError):
            fetch_source(cfg.sources[0], cfg, env=ENV, sleep=lambda s: None)
    finally:
        srv.stop()


@pytest.mark.parametrize("body", [
    b"\xff\xfe\x00\x00 not utf-8",
    b"[" * 100000,                                                             # nesting deep enough to overflow the parser
    b"NaN",
    b'{"data": "a string, not records"}',
    b'{"data": [1, 2, 3], "next": null}',                                     # records that are not objects
    b'{"data": [{"id": "x"}], "next": {"a": 1}}',                             # a cursor that cannot be compared
    b'{"data": [{"id": "x"}], "next": [1]}',
    b"",
    b"null",
    b'{"data": [{"id": 1e999}]}',
])
def test_a_response_that_is_not_what_the_mapping_expects_is_an_error_not_a_crash(api, tmp_path, body):
    api.routes["/tenants"] = lambda q, h: (200, body, {})
    cfg = cfg_for(tmp_path, api.base)
    with contextlib.suppress(FetchError):                      # an error is fine; any other exception fails the test
        fetch_source(cfg.sources[0], cfg, env=ENV, sleep=lambda s: None)


@pytest.mark.parametrize("retry_after", ["nan", "inf", "-5", "abc", "1e999", ""])
def test_a_strange_retry_after_never_breaks_the_wait(api, tmp_path, retry_after):
    calls = {"n": 0}

    def flaky(q, h):
        calls["n"] += 1
        return (429, {}, {"Retry-After": retry_after}) if calls["n"] < 2 else (200, {"data": [{"id": "t1"}], "next": None}, {})

    api.routes["/tenants"] = flaky
    cfg = cfg_for(tmp_path, api.base)
    waits: list[float] = []
    fetch_source(cfg.sources[0], cfg, env=ENV, sleep=waits.append)
    assert all(0 <= w <= 30 and w == w for w in waits)
