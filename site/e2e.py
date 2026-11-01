"""Browser smoke test of the built site: boots the engine, runs the demo, checks every tab and the error path.

    python site/e2e.py _site

Needs `pip install playwright` and a Chromium (`playwright install chromium`). The page's Content
Security Policy forbids eval, so the test uses selectors only.
"""

from __future__ import annotations

import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main(site: str) -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    problems: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        console: list[str] = []
        page.on("console", lambda m: console.append(m.text) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: console.append(str(e)))
        page.goto(base)
        page.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        page.click("#demo")
        page.wait_for_selector("#loaded li:nth-child(6)")
        page.click("#run")
        page.wait_for_selector("#results:not([hidden])", timeout=180_000)
        if "Yield" not in page.inner_text("#kpis"):
            problems.append("no Yield tile")
        if "adoption score" not in page.frame_locator("#report").locator("h1").first.inner_text():
            problems.append("report did not render")
        for tab, needle in (("qbr", "Quarterly business review"), ("roadmap", "Roadmap"), ("summary", "Yield"), ("json", '"yield"')):
            page.click(f"[data-tab={tab}]")
            shown = page.inner_text("#raw" if tab == "json" else "#doc")
            if needle not in shown:
                problems.append(f"tab {tab} missing {needle!r}")
        page.set_input_files("#files", files=[{"name": "accounts.csv", "mimeType": "text/csv", "buffer": b"id,provider\n,aws\n"}])
        page.click("#run")
        page.wait_for_selector("#errors:not([hidden])")
        if "customer.toml" not in page.inner_text("#errlist"):
            problems.append("validation errors not shown")
        if console:
            problems.append("console: " + "; ".join(console[:3]))
        browser.close()
    srv.shutdown()
    for x in problems:
        print("FAIL", x)
    print("ok" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "_site"))
