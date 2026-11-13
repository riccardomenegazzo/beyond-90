"""The download that runs on any computer: it builds the same bytes twice, and its start.py serves the app on localhost."""

import importlib.util
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("local_bundle", ROOT / "scripts" / "local_bundle.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _fake_site(tmp: Path) -> Path:
    site = tmp / "site"
    (site / "download").mkdir(parents=True)
    (site / "index.html").write_text('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><p>Beyond 90</p>')
    (site / "download" / "beyond90-site.zip").write_bytes(b"not shipped twice")
    with zipfile.ZipFile(site / "beyond90.zip", "w") as z:
        for p in sorted((ROOT / "src" / "beyond90").rglob("*.py")):
            z.write(p, p.relative_to(ROOT / "src").as_posix())
    return site


def test_the_bundle_is_reproducible_and_holds_what_it_needs(tmp_path):
    mod = _load()
    site = _fake_site(tmp_path)
    a = mod.bundle(site, tmp_path / "a.zip", "9.9.9")
    b = mod.bundle(site, tmp_path / "b.zip", "9.9.9")
    assert a.read_bytes() == b.read_bytes()
    names = zipfile.ZipFile(a).namelist()
    assert {"beyond90-local-9.9.9/start.py", "beyond90-local-9.9.9/README.txt", "beyond90-local-9.9.9/LICENSE",
            "beyond90-local-9.9.9/site/index.html", "beyond90-local-9.9.9/site/beyond90.zip"} <= set(names)
    assert not any("/download/" in n for n in names)
    start = zipfile.ZipFile(a).read("beyond90-local-9.9.9/start.py").decode()
    assert "127.0.0.1" in start and "urllib" not in start and "http://" not in start.replace("http://localhost", "")


def test_start_py_serves_the_app_on_this_computer_only(tmp_path):
    mod = _load()
    z = mod.bundle(_fake_site(tmp_path), tmp_path / "local.zip", "9.9.9")
    zipfile.ZipFile(z).extractall(tmp_path / "x")
    folder = tmp_path / "x" / "beyond90-local-9.9.9"
    proc = subprocess.Popen([sys.executable, "-I", str(folder / "start.py"), "--port", "0", "--no-browser"], cwd=tmp_path,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        line = proc.stdout.readline()
        assert line.startswith("Beyond 90 is at http://localhost:"), line
        url = line.split()[4]
        with urllib.request.urlopen(url + "index.html", timeout=5) as r:
            assert r.status == 200 and b"Beyond 90" in r.read()
            assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
        req = urllib.request.Request(url + "index.html", data=b"x", method="POST")
        try:
            urllib.request.urlopen(req, timeout=5)
            raise AssertionError("a write was accepted")
        except urllib.error.HTTPError as e:
            assert e.code in (405, 501)
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def test_start_py_explains_a_missing_site(tmp_path):
    mod = _load()
    (tmp_path / "start.py").write_text(mod.START)
    r = subprocess.run([sys.executable, "-I", str(tmp_path / "start.py"), "--no-browser"], capture_output=True, text=True, timeout=30)
    assert r.returncode == 2 and "Unzip the whole download" in r.stderr
