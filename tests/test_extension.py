import json
import re
import struct
import sys
import zipfile
from pathlib import Path

import pytest

from beyond90 import __version__

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "site"))
import build_extension  # noqa: E402


def directives(policy: str) -> dict[str, set[str]]:
    return {d.split()[0]: set(d.split()[1:]) for d in (p.strip() for p in policy.split(";")) if d}


PAGE = directives(re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', (ROOT / "site" / "index.html").read_text(encoding="utf-8")).group(1))


@pytest.fixture()
def built(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text((ROOT / "site" / "index.html").read_text(encoding="utf-8"), encoding="utf-8")
    for name in ("app.js", "sw.js", ".nojekyll"):
        (site / name).write_text("//", encoding="utf-8")
    (site / "icons").mkdir()                                  # the site's own app icons share the folder
    (site / "icons" / "app-192.png").write_bytes(b"png")
    (site / "pyodide").mkdir()
    (site / "pyodide" / "pyodide.mjs").write_text("//", encoding="utf-8")
    out = tmp_path / "ext"
    return out, build_extension.build(site, out), site


def manifest(out, browser):
    return json.loads((out / browser / "manifest.json").read_text(encoding="utf-8"))


def test_one_package_per_browser_named_after_the_version(built):
    out, zips, _ = built
    assert [z.name for z in zips] == [f"beyond90-chrome-{__version__}.zip", f"beyond90-firefox-{__version__}.zip"]
    for browser in ("chrome", "firefox"):
        m = manifest(out, browser)
        assert m["manifest_version"] == 3 and m["version"] == __version__


def test_the_extension_asks_for_nothing_and_injects_nothing(built):
    out, _, _ = built
    for browser in ("chrome", "firefox"):
        m = manifest(out, browser)
        assert not {"permissions", "optional_permissions", "host_permissions", "optional_host_permissions", "content_scripts",
                    "web_accessible_resources", "externally_connectable", "update_url"} & set(m)


def test_its_policy_is_the_page_policy_without_blob_workers(built):
    out, _, _ = built
    for browser in ("chrome", "firefox"):
        ext = directives(manifest(out, browser)["content_security_policy"]["extension_pages"])
        assert ext.pop("object-src") == {"'none'"}
        assert ext.pop("worker-src") == {"'self'"}
        page = {k: v for k, v in PAGE.items() if k != "worker-src"}
        assert ext == page
        assert not any(re.search(r"https?:|blob:|\*|'unsafe-eval'", v) for vals in ext.values() for v in vals)
        assert "worker-src 'self';" in (out / browser / "index.html").read_text(encoding="utf-8")


def test_each_browser_gets_the_background_it_supports(built):
    out, _, _ = built
    assert manifest(out, "chrome")["background"] == {"service_worker": "background.js"}
    ff = manifest(out, "firefox")
    assert ff["background"] == {"scripts": ["background.js"]}
    assert ff["browser_specific_settings"]["gecko"]["data_collection_permissions"] == {"required": ["none"]}
    assert "tabs.create" in (out / "chrome" / "background.js").read_text(encoding="utf-8")


def test_the_service_worker_stays_out_and_everything_else_goes_in(built):
    _, zips, _ = built
    for z in zips:
        names = set(zipfile.ZipFile(z).namelist())
        assert "sw.js" not in names and ".nojekyll" not in names
        assert {"index.html", "app.js", "pyodide/pyodide.mjs", "manifest.json", "background.js"} <= names


def test_icons_are_real_pngs_of_the_declared_sizes(built):
    out, _, _ = built
    for size, path in manifest(out, "chrome")["icons"].items():
        data = (out / "chrome" / path).read_bytes()
        assert data[:8] == b"\x89PNG\r\n\x1a\n"
        assert struct.unpack(">II", data[16:24]) == (int(size), int(size))


def test_packages_are_reproducible(built, tmp_path):
    _, zips, site = built
    again = build_extension.build(site, tmp_path / "again")
    assert [z.read_bytes() for z in zips] == [z.read_bytes() for z in again]
