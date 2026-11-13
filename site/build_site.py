"""Assemble the static site: page, engine archive, demo data and a same-origin copy of Pyodide.

    npm install pyodide@314.0.7 --prefix build/npm
    python site/build_site.py --out _site --pyodide build/npm/node_modules/pyodide

The result is a folder of static files. It needs no server code and loads nothing from a third party.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import struct
import sys
import zipfile
import zlib
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
PYODIDE_FILES = ("pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "package.json")
FONT = ROOT / "site" / "npm" / "node_modules" / "@fontsource-variable" / "atkinson-hyperlegible-next"
FONT_FILES = {f"files/atkinson-hyperlegible-next-{s}-wght-normal.woff2": f"atkinson-{s}.woff2" for s in ("latin", "latin-ext")} | {"LICENSE": "OFL.txt"}
DISPLAY = ROOT / "site" / "npm" / "node_modules" / "@fontsource-variable" / "bricolage-grotesque"
DISPLAY_FILES = {f"files/bricolage-grotesque-{s}-wght-normal.woff2": f"display-{s}.woff2" for s in ("latin", "latin-ext")} | {"LICENSE": "OFL-display.txt"}
DEMO = ROOT / "examples" / "portfolio" / "northwind"
DEMO_ENDPOINT = ROOT / "examples" / "profiles" / "endpoint" / "acme-endpoint"
DEMO_PROFILES = {"saas": ROOT / "examples" / "profiles" / "saas" / "acme-saas", "ai": ROOT / "examples" / "profiles" / "ai" / "orbit-ai"}
DEMO_PREVIOUS = ROOT / "examples" / "history" / "northwind-2026-09"


def build(out: Path, pyodide: Path, feed: Optional[Path] = None, font: Path = FONT, display: Path = DISPLAY) -> None:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in ("index.html", "app.js", "style.css", "engine.js", "store.js", "workspace-core.js", "worker.js", "ui.js", "charts.js", "views.js", "vault.js", "recap.js", "guide.js", "graph.js", "qr.js", "starter.js", "outcomes.js", "commitments.js", "handoff.js", "callmode.js", "aliases.js", "erasure.js", "privacy.js", "pov.js", "asks.js", "roles.js", "sla.js", "scorecard.js", "today.js", "fuzzy.js", "triage.js", "internal.js", "nav.js"):
        shutil.copy(ROOT / "site" / name, out / name)
    # The engine: the package and its data, nothing else, in a fixed order so builds are reproducible.
    with zipfile.ZipFile(out / "beyond90.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted((ROOT / "src" / "beyond90").rglob("*")):
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc":
                info = zipfile.ZipInfo(str(p.relative_to(ROOT / "src")), date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, p.read_bytes())
    demo = {p.name: p.read_text(encoding="utf-8") for p in sorted(DEMO.iterdir()) if p.suffix in (".csv", ".toml")}
    (out / "demo.json").write_text(json.dumps(demo, ensure_ascii=False), encoding="utf-8")
    prev = {p.name: p.read_text(encoding="utf-8") for p in sorted(DEMO_PREVIOUS.iterdir()) if p.suffix in (".csv", ".toml")}
    (out / "demo-previous.json").write_text(json.dumps(prev, ensure_ascii=False), encoding="utf-8")
    dest = out / "pyodide"
    dest.mkdir()
    for name in PYODIDE_FILES:
        src = pyodide / name
        if not src.exists():
            sys.exit(f"missing {src}: run npm install pyodide first")
        shutil.copy(src, dest / name)
    book = {p.name: {q.name: q.read_text(encoding="utf-8") for q in sorted(p.iterdir()) if q.suffix in (".csv", ".toml")}
            for p in sorted(DEMO.parent.iterdir()) if p.is_dir()}
    (out / "demo-book.json").write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
    ep = {p.name: p.read_text(encoding="utf-8") for p in sorted(DEMO_ENDPOINT.iterdir()) if p.suffix in (".csv", ".toml")}
    (out / "demo-endpoint.json").write_text(json.dumps(ep, ensure_ascii=False), encoding="utf-8")
    for key, folder in DEMO_PROFILES.items():
        extra = {p.name: p.read_text(encoding="utf-8") for p in sorted(folder.iterdir()) if p.suffix in (".csv", ".toml")}
        (out / f"demo-{key}.json").write_text(json.dumps(extra, ensure_ascii=False), encoding="utf-8")
    shutil.copy(ROOT / "examples" / "threats.json", out / "demo-advisories.json")
    (out / "fonts").mkdir()
    for src, name in FONT_FILES.items():
        if not (font / src).exists():
            sys.exit(f"missing {font / src}: run npm ci in site/npm first")
        shutil.copy(font / src, out / "fonts" / name)
    for src, name in DISPLAY_FILES.items():
        if not (display / src).exists():
            sys.exit(f"missing {display / src}: run npm ci in site/npm first")
        shutil.copy(display / src, out / "fonts" / name)
    # Always a feed file, so the page never asks for one that is missing; an empty one when none was collected.
    doc = {"schema": "beyond90-feed/1", "as_of": "", "window_days": 0, "sources": [], "threats": [], "general": [], "note": "No feed was collected for this build."}
    if feed is not None and feed.is_file():
        got = json.loads(feed.read_text(encoding="utf-8"))          # parsed and written again: only JSON reaches the site
        if got.get("schema") == "beyond90-feed/1" and isinstance(got.get("threats"), list):
            doc = got
    (out / "feed").mkdir(exist_ok=True)
    (out / "feed" / "advisories.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    shutil.copy(ROOT / "THIRD_PARTY.md", out / "THIRD_PARTY.md")
    shutil.copy(ROOT / "LICENSE", out / "LICENSE.txt")
    write_app_manifest(out)
    write_service_worker(out)
    write_manifest(out)
    (out / ".nojekyll").write_text("")


MANIFEST = ("SHA256SUMS", "build.json")
APP_ICONS = {"icons/app-192.png": (192, None, 1.0), "icons/app-512.png": (512, None, 1.0),
             "icons/maskable-512.png": (512, (0xFF, 0xFF, 0xFF), 0.72), "icons/apple-touch-180.png": (180, (0xFF, 0xFF, 0xFF), 0.8)}


def icon(size: int, background: Optional[tuple[int, int, int]] = None, scale: float = 1.0) -> bytes:
    """The ring of the logo as a PNG, drawn here so the site and the extension carry no binary that is not built from source.

    `background` fills the square (installed apps and home screens want an opaque icon); `scale` shrinks the ring into
    the safe zone that launchers crop to a circle or a rounded square.
    """
    track, arc = (0xD5, 0xDB, 0xE8), (0x2E, 0x46, 0xC8)
    c, r, w = size / 2, size * 12 / 32 * scale, size * 4.4 / 32 * scale
    n = 4 if size <= 128 else 2                                          # supersampling: enough for smooth edges
    start, end = -math.pi / 2, math.atan2(12.3 - 16, 4.6 - 16) + 2 * math.pi   # the arc of the logo: from the top, clockwise
    cap = (math.cos(end) * r + c, math.sin(end) * r + c)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            hits_arc = hits_track = 0
            for sy in range(n):
                for sx in range(n):
                    px, py = x + (sx + 0.5) / n, y + (sy + 0.5) / n
                    d = math.hypot(px - c, py - c)
                    a = math.atan2(py - c, px - c)
                    a = a + 2 * math.pi if a < start else a
                    on_ring = abs(d - r) <= w / 2
                    if (on_ring and a <= end) or math.hypot(px - c, py - c + r) <= w / 2 or math.hypot(px - cap[0], py - cap[1]) <= w / 2:
                        hits_arc += 1
                    elif on_ring:
                        hits_track += 1
            total, cover = n * n, hits_arc + hits_track
            if background:
                bg = background
                row += bytes(round((arc[i] * hits_arc + track[i] * hits_track + bg[i] * (total - cover)) / total) for i in range(3)) + b"\xff"
            elif not cover:
                row += bytes(4)
            else:
                row += bytes([*(round((arc[i] * hits_arc + track[i] * hits_track) / cover) for i in range(3)), round(255 * cover / total)])
        rows.append(bytes(row))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def write_app_manifest(out: Path) -> None:
    """What makes the page an app: install it from the browser on a phone, a tablet or a computer, and it opens in its own window."""
    (out / "icons").mkdir(exist_ok=True)
    for name, (size, bg, scale) in APP_ICONS.items():
        (out / name).write_bytes(icon(size, bg, scale))
    doc = {"name": "Beyond 90", "short_name": "Beyond 90", "id": "./", "start_url": "./index.html", "scope": "./", "display": "standalone",
           "background_color": "#f3f5f9", "theme_color": "#2e46c8", "lang": "en", "dir": "ltr", "categories": ["business", "productivity"],
           "description": "Customer health for cloud security teams: where each customer stands and what to do next. Your data never leaves the device.",
           "icons": [{"src": "icons/app-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                     {"src": "icons/app-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                     {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}
    (out / "app.webmanifest").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")


def write_manifest(out: Path) -> None:
    """Publish what this build is made of: the SHA-256 of every file, in the format `sha256sum -c` reads, and its digest.

    The page checks the files it is running against this list (Help, "This build"), and the Pages workflow signs the
    list with a provenance attestation, so anyone can prove the site was built by this repository's workflow.
    """
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file() and p.name not in MANIFEST and p.name != ".nojekyll")
    sums = "".join(f"{hashlib.sha256((out / n).read_bytes()).hexdigest()}  {n}\n" for n in files)
    (out / "SHA256SUMS").write_text(sums, encoding="utf-8")
    sys.path.insert(0, str(ROOT / "src"))
    from beyond90 import __version__

    commit = os.environ.get("GITHUB_SHA", "")
    repo = os.environ.get("GITHUB_REPOSITORY", "riccardomenegazzo/beyond-90")
    doc = {"schema": "beyond90-build/1", "version": __version__, "repository": repo, "commit": commit, "files": len(files),
           "digest": hashlib.sha256(sums.encode()).hexdigest()}
    (out / "build.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")


# One release can ask installed copies to switch at once (a build that must reach everyone, for instance after an update
# offer that could not be seen). Normally empty: a new build waits until the person accepts it.
FORCE_UPDATE = "self.skipWaiting();  // forced for this release only" if os.environ.get("B90_FORCE_UPDATE") == "1" else ""


def write_service_worker(out: Path) -> None:
    """Precache every file under a name derived from their content, so a new build is a new cache."""
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file() and p.name not in MANIFEST) + list(MANIFEST)
    digest = hashlib.sha256()
    for name in files[: -len(MANIFEST)]:
        digest.update(name.encode() + b"\0" + (out / name).read_bytes() + b"\0")
    template = (ROOT / "site" / "sw.js").read_text(encoding="utf-8")
    assets = ["./"] + [f"./{n}" for n in files]
    (out / "sw.js").write_text(template.replace("__CACHE__", "beyond90-" + digest.hexdigest()[:16]).replace("__ASSETS__", json.dumps(assets)).replace("/*__FORCE__*/", FORCE_UPDATE), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="_site")
    ap.add_argument("--pyodide", required=True, help="the node_modules/pyodide folder")
    ap.add_argument("--feed", help="a feed written by `beyond90 feeds`, published as feed/advisories.json")
    a = ap.parse_args()
    build(Path(a.out), Path(a.pyodide), Path(a.feed) if a.feed else None)
    print(f"built {a.out}")


if __name__ == "__main__":
    main()
