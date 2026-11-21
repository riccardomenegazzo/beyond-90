"""Record the deck in use on a phone, as an animated picture for the README.

The example workshop is invented, and the page is served from this machine: nothing leaves it. The picture shows
what was said being written on a card, the answer it suggests, a swipe with the answer stamped on the card as it
moves, and the next cards answered with a swipe up and a tap.

    python3 scripts/deck_gif.py <built site> docs/img/deck.gif
"""
from __future__ import annotations

import argparse
import functools
import http.server
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass          # the server's own log is noise here


def drag(page, box, dx, dy, steps, pause_at=None):
    """Drag the card from near its top by (dx, dy), slowly enough to be seen; pause part way if asked."""
    x, y = box["x"] + box["width"] / 2, box["y"] + 70
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, steps + 1):
        f = i / steps
        page.mouse.move(x + dx * f, y + dy * f)
        page.wait_for_timeout(28)
        if pause_at and abs(i / steps - pause_at) < 1e-9:
            page.wait_for_timeout(650)
    page.mouse.up()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("site", type=Path)
    ap.add_argument("out", type=Path)
    a = ap.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("ffmpeg is needed to turn the recording into a picture", file=sys.stderr)
        return 1
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(_Quiet, directory=str(a.site)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    with tempfile.TemporaryDirectory() as tmp:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            size = {"width": 412, "height": 839}
            ctx = browser.new_context(**{**p.devices["Pixel 7"], "device_scale_factor": 1}, record_video_dir=tmp, record_video_size=size)
            begun = time.monotonic()
            page = ctx.new_page()
            page.goto(url)
            page.wait_for_selector("#demo-workshop", state="attached", timeout=180_000)
            page.locator("#demo-workshop").dispatch_event("click")
            page.wait_for_selector("#view ol.journey")
            page.click("#mobilebar [data-go=workshop]")
            page.wait_for_selector("#view .deckfull")
            page.locator("#view .deckfull").click()
            page.wait_for_selector("dialog.deck[open] .deckcard")
            page.wait_for_timeout(500)
            start = time.monotonic() - begun
            page.wait_for_timeout(700)
            page.locator("#deck-said").click()
            page.keyboard.type("Never tested end to end, nobody signed it off", delay=40)
            page.wait_for_timeout(900)
            page.locator("dialog.deck .deckq").click()
            page.wait_for_timeout(300)
            drag(page, page.locator("dialog.deck .deckcard").bounding_box(), -250, 14, 18, pause_at=6 / 18)
            page.wait_for_timeout(900)
            drag(page, page.locator("dialog.deck .deckcard").bounding_box(), 8, -260, 16, pause_at=6 / 16)
            page.wait_for_timeout(900)
            page.locator("dialog.deck .deckopt.o-solved").click()
            page.wait_for_timeout(1100)
            length = time.monotonic() - begun - start
            video = page.video.path()
            ctx.close()
            browser.close()
        a.out.parent.mkdir(parents=True, exist_ok=True)
        graph = ("fps=12,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=80:stats_mode=diff[p];"
                 "[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle")
        args = [ffmpeg, "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(video), "-vf", graph, "-loop", "0", str(a.out)]
        subprocess.run(args, check=True)  # noqa: S603 - a fixed command on the person's own paths
    print(f"{a.out}: {a.out.stat().st_size // 1024} KB, {length:.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
