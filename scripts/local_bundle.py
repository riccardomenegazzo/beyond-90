"""Pack a built site into one download that runs on any computer with Python, without the public site.

    python scripts/local_bundle.py _site dist/beyond90-local-0.64.0.zip

The zip holds one folder: the built site, `start.py` (standard library only) and a short README. Unzip it and run
`python3 start.py`: the app opens at http://localhost:8090, served by this computer, read-only. The engine runs in the
browser as on the public site, so customer files still go nowhere. The zip is reproducible: same site, same bytes.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

START = '''#!/usr/bin/env python3
"""Start Beyond 90 on this computer.

    python3 start.py              then open http://localhost:8090 (the browser opens by itself)
    python3 start.py --port 9000  if 8090 is taken
    python3 start.py --no-browser

Only this computer can reach it (127.0.0.1). It hands out the files in ./site and nothing else: it accepts no
uploads, keeps no logs of what you do, and never sees your customer files, which the page reads inside the browser.
Stop it with Ctrl+C.
"""

import argparse
import sys
import threading
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE / "site"


def main() -> int:
    if sys.version_info < (3, 9):
        print("Beyond 90 needs Python 3.9 or newer to start (python.org/downloads).", file=sys.stderr)
        return 2
    ap = argparse.ArgumentParser(description="Start Beyond 90 on this computer.")
    ap.add_argument("--port", type=int, default=8090, help="port on this computer (default 8090)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    args = ap.parse_args()
    if not (SITE / "index.html").is_file() or not (SITE / "beyond90.zip").is_file():
        print("The site folder is missing next to start.py. Unzip the whole download and run start.py from inside it.", file=sys.stderr)
        return 2
    sys.path.insert(0, str(SITE / "beyond90.zip"))   # the same engine package the page runs, for its small file server
    from beyond90 import serve

    def say(message: str) -> None:
        print(message, flush=True)
        if message.startswith("Beyond 90 is at ") and not args.no_browser:
            threading.Timer(0.8, webbrowser.open, (message.split()[4],)).start()

    try:
        serve.run(SITE, "127.0.0.1", args.port, (), say)
    except OSError as e:
        print(f"Could not start on port {args.port} ({e.strerror or e}). Try: python3 start.py --port 9000", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
'''

README = '''Beyond 90 {version}, to run on your own computer
==================================================

1. Install Python 3.9 or newer if you do not have it (python.org/downloads).
2. Unzip this folder anywhere.
3. In a terminal, inside the folder:   python3 start.py
   (on Windows:   py start.py   or double-click start.py)
4. Your browser opens http://localhost:8090. Press "See it on an example", or load your own files.

Nothing here talks to the public site or to any other server. The page and its engine run in your browser;
start.py only hands out the files in ./site to this computer. Your data stays in this browser, as on the
public site, and can be protected with a passphrase (Saved).

Check the download: SHA256SUMS in the release lists this zip, and site/SHA256SUMS lists every file inside.
Licence: Apache-2.0 (LICENSE). Third-party software: site/THIRD_PARTY.md.
'''

STAMP = (2026, 1, 1, 0, 0, 0)


def bundle(site: Path, out: Path, version: str) -> Path:
    if not (site / "index.html").is_file() or not (site / "beyond90.zip").is_file():
        raise SystemExit(f"{site}: not a built site (run site/build_site.py first)")
    top = f"beyond90-local-{version}"
    out.parent.mkdir(parents=True, exist_ok=True)

    def put(z: zipfile.ZipFile, name: str, data: bytes, mode: int = 0o644) -> None:
        info = zipfile.ZipInfo(f"{top}/{name}", date_time=STAMP)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = (0o100000 | mode) << 16
        z.writestr(info, data)

    with zipfile.ZipFile(out, "w") as z:
        put(z, "start.py", START.encode(), 0o755)
        put(z, "README.txt", README.format(version=version).encode())
        put(z, "LICENSE", (ROOT / "LICENSE").read_bytes())
        for p in sorted(site.rglob("*")):
            if p.is_file() and not p.is_symlink() and p.name != ".nojekyll" and "download" not in p.relative_to(site).parts:
                put(z, "site/" + p.relative_to(site).as_posix(), p.read_bytes())
    return out


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    sys.path.insert(0, str(ROOT / "src"))
    from beyond90 import __version__

    print(bundle(Path(sys.argv[1]), Path(sys.argv[2]), __version__))
    return 0


if __name__ == "__main__":
    sys.exit(main())
