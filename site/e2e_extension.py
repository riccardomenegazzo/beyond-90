"""The browser extension, end to end in Chromium: load it unpacked, open it from its own origin, run the demo.

    python site/e2e_extension.py dist/extension/chrome

Checks that the manifest policy lets the engine start (WebAssembly, the worker from its own file), that the page
works with no service worker, and that nothing outside the extension can be reached.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        failures.append(what)


def main(folder: str) -> None:
    ext = str(Path(folder).resolve())
    with sync_playwright() as p, tempfile.TemporaryDirectory() as profile:
        ctx = p.chromium.launch_persistent_context(profile, channel="chromium", headless=True,
                                                   args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}"])
        worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        origin = worker.url.split("/background.js")[0]
        check(origin.startswith("chrome-extension://"), "the extension loads and its background script starts")
        page = ctx.new_page()
        problems: list[str] = []
        page.on("console", lambda m: problems.append(m.text) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: problems.append(str(e)))
        page.goto(f"{origin}/index.html")
        page.wait_for_selector("#version:has-text('engine')", timeout=180_000)
        check(True, "the engine starts under the extension's policy")
        page.click("#demo")
        page.click("#run")
        page.wait_for_selector("#results:not([hidden])", timeout=180_000)
        check("Yield" in page.inner_text("#kpis"), "the demo runs inside the extension")
        page.click("[data-tab=connections]")
        check(page.locator("#view svg.g-svg .g-account").count() >= 5, "the connections map draws in the extension")
        check(page.evaluate("navigator.serviceWorker.controller") is None, "no service worker is installed for the page")
        check(page.is_visible("#offline") and not page.locator("#get-extension").is_visible(), "the extension says it works offline and does not offer itself")
        reached = page.evaluate("fetch('https://example.com/', {mode: 'no-cors'}).then(() => true, () => false)")
        check(not reached, "the page cannot reach the network")
        page.click(".rail [data-place=help]")
        page.click("#selfcheck")
        page.wait_for_selector("#selfcheck-out:has-text('the engine')", timeout=60_000)
        out = page.inner_text("#selfcheck-out")
        check("page cannot reach other sites" in out and "engine cannot reach other sites" in out, "the built-in privacy self-check passes in the extension")
        page.click("#verify-build")
        page.wait_for_selector("#verify-out:has-text('match')", timeout=120_000)
        check(page.inner_text("#verify-out").startswith("All "), "every file of the package matches its manifest")
        problems = [m for m in problems if "example.com" not in m and "Content Security Policy" not in m]
        check(not problems, f"no console errors or warnings: {problems}")
        ctx.close()
    if failures:
        sys.exit(f"{len(failures)} check(s) failed")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "dist/extension/chrome")
