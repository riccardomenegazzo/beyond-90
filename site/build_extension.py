"""Package the built site as a browser extension for Chromium browsers and for Firefox.

The extension is the same page and engine as the website, opened from the toolbar in a tab of its own. It asks for
no permissions, cannot see the pages you visit, and its policy allows no network at all beyond its own files, so
the data stays on the machine exactly as it does on the website, under a private origin no other site shares.

    python site/build_extension.py --site _site --out dist/extension

writes an unpacked folder and a zip per browser. Builds are reproducible: fixed order, fixed timestamps.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import struct
import sys
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from beyond90 import __version__  # noqa: E402

NAME = "Beyond 90"
DESCRIPTION = "Customer health for cloud security teams: where each customer stands and what to do next. Your data never leaves the browser."
SIZES = (16, 32, 48, 128)
# The page's own policy, minus what an extension cannot or need not have: no blob: workers (the engine starts from its
# own file) and nothing from any other origin. The browser enforces it on every extension page and worker.
POLICY = ("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; "
          "img-src 'self' data:; frame-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; "
          "require-trusted-types-for 'script'; trusted-types b90-report b90-worker b90-sw")
LEFT_OUT = {"sw.js", ".nojekyll"}                       # an extension is offline by nature: no service worker to install
GECKO_ID = "beyond90@riccardomenegazzo.github.io"


def manifest(browser: str) -> dict[str, object]:
    m: dict[str, object] = {
        "manifest_version": 3,
        "name": NAME,
        "short_name": "Beyond 90",
        "version": __version__,
        "description": DESCRIPTION,
        "homepage_url": "https://github.com/riccardomenegazzo/beyond-90",
        "icons": {str(s): f"icons/icon-{s}.png" for s in SIZES},
        "action": {"default_title": "Open Beyond 90", "default_icon": {str(s): f"icons/icon-{s}.png" for s in SIZES[:2]}},
        "content_security_policy": {"extension_pages": POLICY},
    }
    if browser == "chrome":
        m["background"] = {"service_worker": "background.js"}
        m["minimum_chrome_version"] = "120"
    else:
        m["background"] = {"scripts": ["background.js"]}
        m["browser_specific_settings"] = {"gecko": {"id": GECKO_ID, "strict_min_version": "140.0", "data_collection_permissions": {"required": ["none"]}},
                                          "gecko_android": {"strict_min_version": "142.0"}}
    return m


def icon(size: int) -> bytes:
    """The ring of the logo as a PNG, drawn here so the extension carries no binary that is not built from source."""
    track, arc = (0xD5, 0xDB, 0xE8), (0x2E, 0x46, 0xC8)
    c, r, w, n = size / 2, size * 12 / 32, size * 4.4 / 32, 4
    start, end = -math.pi / 2, math.atan2(12.3 - 16, 4.6 - 16) + 2 * math.pi   # the arc of the logo: from the top, clockwise
    cap = (math.cos(end) * r + c, math.sin(end) * r + c)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            hits = {"track": 0, "arc": 0}
            for sy in range(n):
                for sx in range(n):
                    px, py = x + (sx + 0.5) / n, y + (sy + 0.5) / n
                    d = math.hypot(px - c, py - c)
                    a = math.atan2(py - c, px - c)
                    a = a + 2 * math.pi if a < start else a
                    on_ring = abs(d - r) <= w / 2
                    if (on_ring and a <= end) or math.hypot(px - c, py - c - (-r)) <= w / 2 or math.hypot(px - cap[0], py - cap[1]) <= w / 2:
                        hits["arc"] += 1
                    elif on_ring:
                        hits["track"] += 1
            total = n * n
            cover = hits["arc"] + hits["track"]
            if not cover:
                row += bytes(4)
                continue
            mix = [round((arc[i] * hits["arc"] + track[i] * hits["track"]) / cover) for i in range(3)]
            row += bytes([*mix, round(255 * cover / total)])
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def build(site: Path, out: Path) -> list[Path]:
    if not (site / "index.html").is_file():
        sys.exit(f"{site} has no index.html: build the site first")
    if out.exists():
        shutil.rmtree(out)
    icons = {s: icon(s) for s in SIZES}
    made = []
    for browser in ("chrome", "firefox"):
        root = out / browser
        shutil.copytree(site, root, ignore=lambda d, names: [n for n in names if n in LEFT_OUT and Path(d) == site])
        shutil.copy(ROOT / "site" / "extension" / "background.js", root / "background.js")
        (root / "icons").mkdir()
        for s, data in icons.items():
            (root / "icons" / f"icon-{s}.png").write_bytes(data)
        (root / "manifest.json").write_text(json.dumps(manifest(browser), indent=2) + "\n", encoding="utf-8")
        page = (root / "index.html").read_text(encoding="utf-8")
        (root / "index.html").write_text(re.sub(r"worker-src 'self' blob:", "worker-src 'self'", page), encoding="utf-8")
        archive = out / f"beyond90-{browser}-{__version__}.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(root.rglob("*")):
                if p.is_file():
                    info = zipfile.ZipInfo(p.relative_to(root).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    z.writestr(info, p.read_bytes())
        made.append(archive)
    return made


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default="_site", help="the folder written by build_site.py")
    ap.add_argument("--out", default="dist/extension")
    a = ap.parse_args()
    for p in build(Path(a.site), Path(a.out)):
        print(f"built {p}")


if __name__ == "__main__":
    main()
