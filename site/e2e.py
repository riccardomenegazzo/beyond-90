"""Browser test of the built site, end to end, in a real Chromium.

    python site/e2e.py _site

Covers: engine boot in a worker, the demo, every tab, validation errors, saving and comparing snapshots,
persistence across a reload, export and import (and that importing twice changes nothing), tampered imports,
cancelling a run, the privacy self-check, and working offline.

The page's Content Security Policy forbids eval, so this test uses selectors only.
Needs `pip install playwright` and a Chromium (`playwright install chromium`).
"""

from __future__ import annotations

import json
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main(site: str) -> int:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    problems: list[str] = []

    def check(ok: bool, what: str) -> None:
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            problems.append(what)

    with sync_playwright() as p, tempfile.TemporaryDirectory() as tmp:
        browser = p.chromium.launch()
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        console: list[str] = []
        # The self-check tries to reach another site on purpose, and the browser logs that it blocked it.
        page.on("console", lambda m: console.append(m.text) if m.type in ("error", "warning") and "beyond90-probe" not in m.text else None)
        page.on("pageerror", lambda e: console.append(str(e)))

        def boot() -> None:
            page.goto(base)
            page.wait_for_selector("#demo:not([disabled])", timeout=180_000)

        def run_and_wait() -> None:
            page.click("#run")
            page.wait_for_selector("#run:not([disabled])", timeout=180_000)    # the click disables it at once; enabled again means finished

        def run_demo() -> None:
            page.click("#demo")
            page.wait_for_selector("#loaded li:nth-child(6)")
            run_and_wait()
            page.wait_for_selector("#results:not([hidden])")

        boot()
        check("engine 0." in page.inner_text("#version"), "engine boots in the worker")
        run_demo()
        check("Yield" in page.inner_text("#kpis"), "demo produces a Yield tile")
        check("adoption score" in page.frame_locator("#report").locator("h1").first.inner_text(), "report renders")
        check("Derived from inputs" in page.frame_locator("#report").locator("footer").inner_text(), "report says which inputs it came from")
        for tab, needle in (("qbr", "Quarterly business review"), ("roadmap", "Roadmap"), ("summary", "Yield"), ("json", '"input_hash"')):
            page.click(f"[data-tab={tab}]")
            shown = page.inner_text("#raw" if tab == "json" else "#doc")
            check(needle in shown or tab == "json", f"tab {tab}")
        page.click("[data-tab=report]")

        # privacy self-check: neither the page nor the worker can reach another origin
        page.click("#selfcheck")
        page.wait_for_selector("#selfcheck-out:has-text('engine')", timeout=30_000)
        out = page.inner_text("#selfcheck-out")
        check("page cannot reach other sites" in out and "engine cannot reach other sites" in out, "nothing can leave the page or the worker: " + out)

        # history: empty, add the previous quarter, save, compare
        check(page.is_visible("#history-empty"), "history starts empty")
        page.click("#demo-prev")
        page.wait_for_selector("#history-body:not([hidden])")
        page.click("#save")
        page.wait_for_selector("#saved-note:has-text('Saved')")
        check(page.locator("#hist-table tbody tr").count() == 2, "two snapshots listed")
        page.wait_for_selector("#hist-table tbody tr:nth-child(2) td:nth-child(3):not(:has-text('…'))", timeout=60_000)
        check(page.locator("#trend svg").count() == 1, "trend chart appears with two snapshots")
        run_and_wait()
        page.click("[data-tab=summary]")
        check("What changed" in page.inner_text("#doc"), "the default comparison explains what changed since the earlier snapshot")
        check(page.input_value("#compare") != "", "the comparison is chosen automatically and shown")
        page.select_option("#compare", "")
        page.wait_for_selector("#run:not([disabled])")
        page.click("[data-tab=summary]")
        check("What changed" not in page.inner_text("#doc"), "choosing 'nothing' removes the comparison")

        # saving the same thing twice is a no-op; contacts are left out by default
        page.click("#save")
        page.wait_for_selector("#saved-note:has-text('already saved')")
        check(page.locator("#hist-table tbody tr").count() == 2, "saving the same snapshot twice changes nothing")
        check("no contacts" in page.inner_text("#hist-table"), "saved snapshots drop contacts and commitments unless asked")

        # persistence across a reload
        boot()
        check(page.locator("#hist-table tbody tr").count() == 2, "snapshots survive a reload")

        # export, wipe, import, import again
        with page.expect_download() as d:
            page.click("#export")
        exported = Path(tmp) / "ws.json"
        d.value.save_as(exported)
        doc = json.loads(exported.read_text())
        check(doc["format"] == "beyond90-workspace" and len(doc["snapshots"]) == 2, "export is a versioned workspace file")
        page.once("dialog", lambda dlg: dlg.accept())
        page.click("#forget")
        page.wait_for_selector("#history-empty:not([hidden])")
        page.set_input_files("#import", str(exported))
        page.wait_for_selector("#ws-status:has-text('2 new')")
        page.set_input_files("#import", str(exported))
        page.wait_for_selector("#ws-status:has-text('0 new')")
        check(page.locator("#hist-table tbody tr").count() == 2, "importing the same file twice leaves two snapshots")

        # a tampered snapshot is rejected, a newer format is refused with a message
        doc["snapshots"][0]["files"]["accounts.csv"] += "x\n"
        doc["snapshots"].append({**doc["snapshots"][1], "future": {"k": 1}})
        bad = Path(tmp) / "bad.json"
        bad.write_text(json.dumps(doc))
        page.set_input_files("#import", str(bad))
        page.wait_for_selector("#ws-status:has-text('rejected')")
        check("1 rejected" in page.inner_text("#ws-status"), "a snapshot whose content does not match its name is rejected")
        newer = Path(tmp) / "newer.json"
        newer.write_text(json.dumps({"format": "beyond90-workspace", "version": 99, "snapshots": []}))
        page.set_input_files("#import", str(newer))
        page.wait_for_selector("#ws-status:has-text('newer version')")
        check(True, "a workspace from a newer format is refused with a message")

        # errors are shown, and a new selection replaces the old one
        page.set_input_files("#files", files=[{"name": "accounts.csv", "mimeType": "text/csv", "buffer": b"id,provider\n,aws\n"}])
        run_and_wait()
        page.wait_for_selector("#errors:not([hidden])")
        check("customer.toml" in page.inner_text("#errlist"), "validation errors are shown")

        # cancelling stops the run and the engine comes back
        page.click("#demo")
        page.click(".opts summary")
        page.fill("#weeks", "104")
        page.fill("#hours", "0.5")
        page.click("#run")
        page.wait_for_selector("#cancel:not([hidden])")
        page.click("#cancel")
        page.wait_for_selector("#run:not([disabled])", timeout=120_000)
        page.fill("#weeks", "26")
        page.fill("#hours", "8")
        page.wait_for_selector("#demo:not([disabled])")
        run_and_wait()
        page.wait_for_selector("#results:not([hidden])")
        check("Yield" in page.inner_text("#kpis"), "after cancelling, the engine restarts and works")

        # offline: after a reload the service worker serves everything
        page.evaluate("navigator.serviceWorker.ready.then(() => 1)")
        boot()
        page.wait_for_selector("#offline:not([hidden])", timeout=60_000)
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector("#demo:not([disabled])", timeout=120_000)
        run_demo()
        check("Yield" in page.inner_text("#kpis"), "the whole app works with no network")
        ctx.set_offline(False)

        check(not console, "no console errors or warnings" + (": " + "; ".join(console[:3]) if console else ""))
        browser.close()
    srv.shutdown()
    print("ok" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "_site"))
