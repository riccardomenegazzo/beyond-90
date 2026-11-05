import http.client
import threading
import zipfile

import pytest

from beyond90 import serve

PAGE = (b'<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; connect-src \'self\'">'
        b"<title>Beyond 90</title>")


def site_dir(tmp_path):
    d = tmp_path / "site"
    (d / "pyodide").mkdir(parents=True)
    (d / "index.html").write_bytes(PAGE)
    (d / "app.js").write_text("export {}")
    (d / "pyodide" / "pyodide.asm.wasm").write_bytes(b"\0asm")
    (tmp_path / "secret.txt").write_text("not part of the site")
    return d


@pytest.fixture(params=["folder", "zip"])
def server(tmp_path, request):
    d = site_dir(tmp_path)
    source = d
    if request.param == "zip":
        source = tmp_path / "beyond90-site.zip"
        with zipfile.ZipFile(source, "w") as z:
            for p in d.rglob("*"):
                if p.is_file():
                    z.write(p, "beyond90-site/" + p.relative_to(d).as_posix())
    srv = serve.make_server(source, "127.0.0.1", 0, ("b90.internal",))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def get(port, path, method="GET", host=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.putrequest(method, path, skip_host=True)
    c.putheader("Host", host or f"127.0.0.1:{port}")
    c.endheaders()
    r = c.getresponse()
    return r.status, dict(r.getheaders()), r.read()


def test_the_app_is_served_with_its_policy_as_a_header(server):
    status, h, body = get(server, "/")
    assert status == 200 and body == PAGE
    assert h["Content-Security-Policy"] == "default-src 'none'; connect-src 'self'; frame-ancestors 'none'"
    assert h["X-Content-Type-Options"] == "nosniff" and h["Referrer-Policy"] == "no-referrer" and h["Cross-Origin-Opener-Policy"] == "same-origin"
    assert get(server, "/pyodide/pyodide.asm.wasm")[1]["Content-Type"] == "application/wasm"
    assert get(server, "/app.js?v=1")[1]["Content-Type"] == "text/javascript"


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/pyodide/../../secret.txt", "//etc/passwd", "/missing.js", "/..%5csecret.txt"])
def test_nothing_outside_the_site_is_reachable(server, path):
    status, _, body = get(server, path)
    assert status == 404 and b"not part of the site" not in body


def test_it_is_read_only(server):
    for m in ("POST", "PUT", "DELETE", "PATCH", "OPTIONS"):
        assert get(server, "/index.html", m)[0] == 405


def test_another_host_name_is_refused_against_dns_rebinding(server):
    assert get(server, "/", host="attacker.example")[0] == 421
    assert get(server, "/", host=f"localhost:{server}")[0] == 200
    assert get(server, "/", host="b90.internal")[0] == 200


def test_a_folder_without_the_app_is_refused(tmp_path):
    with pytest.raises(ValueError, match=r"no index\.html"):
        serve.Site(tmp_path)
    with pytest.raises(ValueError, match="expected a built site"):
        serve.Site(tmp_path / "nothing.zip")
