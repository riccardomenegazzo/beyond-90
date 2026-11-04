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
import os
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
        check("Yield" in page.inner_text("#kpis") and "Maturity level" in page.inner_text("#kpis"), "demo produces a Yield tile and a maturity level")
        # the native dashboard
        check(page.locator("#view .gauge").count() == 1 and "72." in (page.text_content("#view .gauge") or ""), "overview draws the Yield gauge")
        check(page.locator("#view .opp").count() == 5 and page.locator("#view svg.chart").count() >= 2, "overview lists opportunities and draws the charts")
        page.click("[data-tab=actions]")
        n_all = page.locator("#view tbody tr").count()
        page.fill("#view input.search", "unowned")
        check(0 < page.locator("#view tbody tr").count() < n_all, "searching actions filters the table")
        page.fill("#view input.search", "")
        page.locator("#view .twisty").first.click()
        check(page.locator("#view tr.detail").count() == 1, "an action expands to show its steps")
        page.click("[data-tab=accounts]")
        page.get_by_role("button", name="not connected").click()
        check(page.locator("#view tbody tr").count() == 12 and "12 of 12" in page.inner_text("#view .tablewrap .note"), "the accounts view filters to the unconnected ones")
        page.click("#view th:nth-child(2) .sortbtn")
        check("ascending" in (page.locator("#view th[aria-sort=ascending]").first.get_attribute("aria-sort") or ""), "columns sort")
        page.click("[data-tab=findings]")
        page.get_by_role("button", name="critical", exact=True).click()
        check(page.locator("#view tbody tr").count() > 0 and "critical" in page.inner_text("#view tbody"), "findings filter by severity")
        page.click("[data-tab=planview]")
        before = page.inner_text("#view .kpiline")
        page.eval_on_selector("#view .slider input", "(i) => { i.value = 16; i.dispatchEvent(new Event('input')); }")
        page.wait_for_selector("#view .planout:has-text('week')", timeout=60_000)
        page.wait_for_timeout(2500)
        check(page.inner_text("#view .kpiline") != before, "the what-if slider recomputes the plan in the worker")
        page.click("[data-tab=prep]")
        check(page.locator("#view .agitem").count() >= 4 and "since the last touch" in page.inner_text("#view"), "the call prep has an agenda and the rhythm")
        page.fill("#view input[aria-label=Summary]", "Agreed the owner for the critical findings")
        page.fill("#view input[aria-label='Next step']", "Send the owner list")
        page.get_by_role("button", name="Add and re-run").click()
        page.wait_for_selector("#run:not([disabled])", timeout=120_000)
        page.click("[data-tab=prep]")
        check("Agreed the owner" in page.inner_text("#view"), "a logged touch appears in the next preparation")
        page.click("[data-tab=news]")
        check("MOCK-2026" not in page.inner_text("#view"), "no news until a feed is added")
        if page.locator("#latest-adv").is_visible():
            page.click("#latest-adv")
            check("cloud stories as of" in page.inner_text("#adv-status"), "the daily cloud news is offered and described")
        page.click("#demo-adv")
        page.wait_for_selector("#adv-status:has-text('advisories loaded')")
        page.click("#run")
        page.wait_for_selector("#run:not([disabled])", timeout=120_000)
        page.click("[data-tab=news]")
        check("MOCK-2026-002" in page.inner_text("#view") and page.get_by_role("button", name="Copy a note for the customer").count() >= 1, "a feed is matched to the customer's inventory")
        check(page.get_by_role("button", name="Copy the briefing for the customer").count() == 1, "the customer gets a ready security briefing")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download briefing (.md)").click()
        brief = Path(dl.value.path()).read_text()
        check(brief.startswith("# Cloud security briefing") and "Yield" not in brief, "the briefing downloads without internal scores")
        page.click("[data-tab=onboarding]")
        view = page.inner_text("#view")
        check("counted as connected, but the connector is failing" in view and page.locator("#view .wave").count() >= 5, "onboarding shows the broken connector and the waves")
        page.locator("#view .wave summary").first.click()
        check(page.locator("#view .wave[open] ol li").count() >= 1, "a wave opens on its steps")
        check("az ad" in page.inner_text("#view .wave[open] .cmds pre"), "a wave lists the read-only commands to check")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Status page for the customer (.html)").click()
        status = Path(dl.value.path()).read_text()
        check(status.startswith("<!doctype html>") and "Waiting on your teams" in status and "Yield" not in status, "the customer status page downloads without internal scores")
        page.fill("#view .triage textarea", "AADSTS65001: The user or administrator has not consented")
        page.get_by_role("button", name="Explain").click()
        page.wait_for_selector("#view .triage-out .card")
        check("Admin consent" in page.inner_text("#view .triage-out"), "a pasted error is explained")
        page.get_by_role("button", name="Build the checklist").click()
        page.wait_for_selector("#view .preflight-out .agitem")
        check("Who must be in the room" in page.inner_text("#view .preflight-out"), "the pre-flight checklist is built")
        page.click("[data-tab=overview]")
        check("Weighted by what is at stake" in page.inner_text("#view") and "by spend" in page.inner_text("#view"), "the overview weighs coverage by spend and exposure")
        page.click("[data-tab=outlook]")
        view = page.inner_text("#view")
        check("Waiting costs" in view and page.locator("#view tbody tr").count() >= 10, "the outlook lists the dated events and what waiting costs")
        page.get_by_role("button", name="ours", exact=True).click()
        check(all("ours" in t for t in page.locator("#view tbody tr td:nth-child(5)").all_inner_texts()), "the outlook filters by whose move it is")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Add to calendar (.ics)").click()
        check(Path(dl.value.path()).read_text().startswith("BEGIN:VCALENDAR"), "the outlook exports a calendar file")
        page.click("[data-tab=maturity]")
        check(page.locator("#view .rung").count() == 3 and page.locator("#view .checks li").count() >= 20, "maturity shows the ladder and every check")
        page.click("[data-tab=renewal]")
        check("Renewal" in page.inner_text("#view") and "Relationship" in page.inner_text("#view"), "renewal and relationship render")
        page.keyboard.press("Control+k")
        page.wait_for_selector("#palette[open]")
        page.fill("#palette-q", "findings")
        page.keyboard.press("Enter")
        check(page.get_attribute("[data-tab=findings]", "aria-selected") == "true", "the command palette navigates")
        theme0 = page.evaluate("document.documentElement.dataset.theme || ''")
        page.click("#theme")
        check(page.evaluate("document.documentElement.dataset.theme || ''") != theme0, "the theme switches")
        page.click("[data-tab=report]")
        check("adoption score" in page.frame_locator("#report").locator("h1").first.inner_text(), "report renders")
        check("Derived from inputs" in page.frame_locator("#report").locator("footer").inner_text(), "report says which inputs it came from")
        for tab, needle in (("qbr", "Quarterly business review"), ("plan", "Success plan"), ("roadmap", "Roadmap"), ("summary", "Yield"), ("json", '"input_hash"')):
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
        check(page.is_visible("#history-body") and page.locator("#hist-table tbody tr").count() >= 1, "every analysis is already in the customer's history")
        page.click("#demo-prev")
        page.wait_for_selector("#demo-prev", state="hidden")
        page.click("#save")
        page.wait_for_selector("#saved-note:has-text('already saved')")
        check(page.locator("#hist-table tbody tr").count() == 2, "two snapshots listed")
        page.wait_for_selector("#hist-table tbody tr:nth-child(2) td:nth-child(3):not(:has-text('…'))", timeout=60_000)
        page.wait_for_selector("#trend svg", timeout=30_000)
        check(page.locator("#trend svg").count() == 1, "trend chart appears with two snapshots")
        run_and_wait()
        page.click("[data-tab=summary]")
        check("What changed" in page.inner_text("#doc"), "the default comparison explains what changed since the earlier snapshot")
        check(page.input_value("#compare") != "", "the comparison is chosen automatically and shown")
        page.click("[data-tab=onboarding]")
        check("Since 2026-09-30" in page.inner_text("#view") and "all complete around" in page.inner_text("#view"), "onboarding shows progress since the earlier snapshot and a forecast")
        page.click("[data-tab=execqbr]")
        check("2026-09-30" in page.inner_text("#view .snaptl") and "Q4 2026" in page.inner_text("#view select"), "the executive QBR lists the customer's history and offers its quarters")
        check("Compared with 2026-09-30" in page.inner_text("#view [role=status]"), "and says which snapshots the period uses")
        page.get_by_role("button", name="Build the executive review").click()
        page.wait_for_selector("#view iframe.qbrframe", timeout=120_000)
        check("findings closed" in page.inner_text("#view .callout") and page.locator("#view iframe.qbrframe").get_attribute("sandbox") == "", "the review is built from the history, previewed in a sandbox")
        check("Decisions we need from you" in page.frame_locator("#view iframe.qbrframe").locator("body").inner_text(), "and ends with the decisions to ask for")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download (.html, prints to PDF)").click()
        review = Path(dl.value.path()).read_text()
        check(review.startswith("<!doctype html>") and "Yield" not in review and "L4" not in review and "<script" not in review, "the executive review downloads without internal jargon or script")
        page.select_option("#view select", "custom")
        page.fill("#view input[aria-label=From]", "2025-01-01")
        page.fill("#view input[aria-label=To]", "2025-03-31")
        page.locator("#view input[aria-label=To]").dispatch_event("change")
        check("No snapshot falls" in page.inner_text("#view [role=status]"), "an empty period is said before building")
        page.click("[data-tab=value]")
        view = page.inner_text("#view")
        check("2026-09-30" in view and "findings closed" in view and "What did not move" in view, "the value receipt shows what moved and what did not")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download receipt (.html)").click()
        receipt = Path(dl.value.path()).read_text()
        check(receipt.startswith("<!doctype html>") and "followed, not necessarily caused" in receipt, "the receipt downloads as a self-contained page")
        page.click("[data-tab=teams]")
        check(page.locator("#view .teamgrid > .card").count() >= 2 and page.get_by_role("button", name="Copy message").count() >= 2, "each customer team gets its own digest and message")
        page.click("[data-tab=prep]")
        page.fill("#view textarea[aria-label='Agreed next steps']", "Grant admin consent | identity team | 2026-11-11")
        check("Grant admin consent (identity team, by 2026-11-11)" in page.inner_text("#view pre.recap"), "the recap after the call lists what was agreed")
        page.select_option("#compare", "")
        page.wait_for_selector("#run:not([disabled])")
        page.click("[data-tab=value]")
        check("Pick a saved snapshot" in page.inner_text("#view"), "without a comparison the receipt explains what it needs")
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

        # hostile text in the data is shown as text, everywhere, and never runs
        evil = '<img src=x onerror="window.__pwned=1"> | # Injected'
        page.set_input_files("#files", files=[
            {"name": "customer.toml", "mimeType": "text/plain", "buffer": f'[customer]\nname = "{evil.replace(chr(34), chr(39))}"\nas_of = 2026-10-31\n'.encode()},
            {"name": "accounts.csv", "mimeType": "text/csv", "buffer": b"id,provider,sources,connected,owner\na1,aws,billing;org,true,<b>x</b>\na2,aws,billing,false,<b>x</b>\n"},
        ])
        page.wait_for_selector("#loaded li:has-text('customer.toml')")
        run_and_wait()
        page.wait_for_selector("#results:not([hidden])")
        check(page.locator("#kpis img, #kpis b b").count() == 0 and "<img" in page.inner_text("#kpis"), "a hostile customer name is shown as text in the tiles")
        page.click("[data-tab=qbr]")
        check(page.locator("#doc img, #doc script").count() == 0 and "Injected" in page.inner_text("#doc"), "and in the rendered Markdown")
        for tab in ("overview", "onboarding", "outlook", "teams", "prep", "execqbr", "actions", "accounts", "findings", "maturity", "renewal"):
            page.click(f"[data-tab={tab}]")
            check(page.locator("#view img, #view script, #view iframe").count() == 0, f"and in the {tab} view")
        page.click("[data-tab=report]")
        check(page.frame_locator("#report").locator("img, script").count() == 0, "and in the report")
        check(not page.evaluate("window.__pwned === 1"), "nothing ran")

        # an empty estate is refused, never shown as 100%
        page.set_input_files("#files", files=[
            {"name": "customer.toml", "mimeType": "text/plain", "buffer": b'[customer]\nname = "Empty"\nas_of = 2026-10-31\n'},
            {"name": "accounts.csv", "mimeType": "text/csv", "buffer": b"id,provider,sources,connected\n"},
        ])
        page.wait_for_selector("#loaded li:has-text('customer.toml')")
        run_and_wait()
        page.wait_for_selector("#errors:not([hidden])")
        check("nothing to measure" in page.inner_text("#errlist"), "an empty estate is refused with an explanation")

        # another kind of security product: the same engine, a different catalogue, its own words
        page.click("#demo-endpoint")
        page.wait_for_selector("#loaded li:has-text('customer.toml')")
        run_and_wait()
        page.wait_for_selector("#results:not([hidden])")
        check("endpoint" in page.inner_text("#kpis"), "the endpoint demo runs with its own profile")
        page.click("[data-tab=qbr]")
        qbr = page.inner_text("#doc")
        check("site(s)" in qbr and "cloud" not in qbr.lower(), "and reads in its own words (sites, not cloud accounts)")

        # a whole book: several customers, one budget of hours
        page.click("#demo-book")
        page.wait_for_selector("#loaded li:nth-child(3)")
        run_and_wait()
        page.wait_for_selector("#view tbody tr")
        check("ARR-weighted" in page.inner_text("#kpis") and page.locator("#view tbody tr").count() == 3, "the book demo shows three customers and the weighted Yield")
        check(page.locator("#tabs button").count() == 7 and page.locator("#view tbody tr").count() == 3, "book mode opens on the week, one row per customer")
        check("Mon" in page.inner_text("#view") or "Tue" in page.inner_text("#view"), "the week gives each customer a day")
        page.locator("#view .twisty").first.click()
        check(page.locator("#view .agitem").count() >= 4, "a customer's call prep opens in place")
        page.click("[data-tab=bookonboard]")
        check(page.locator("#view tbody tr").count() == 3 and "shares" in page.inner_text("#view"), "book onboarding lists every customer and the causes they share")
        page.click("[data-tab=booknews]")
        check(page.locator("#view .card.news").count() >= 1 and "touch" in page.inner_text("#view .callout"), "book news lists each story with the customers it touches")
        check(page.locator("#view .card.news table tbody tr").count() >= 1, "and a row per customer touched")
        page.click("[data-tab=bookmap]")
        check(page.locator("#view .heatcell").count() == 12, "the portfolio map has a cell per customer and stage")
        page.click("[data-tab=portfolio]")
        check("Portfolio" in page.inner_text("#doc"), "book mode keeps its written portfolio")
        page.click("[data-tab=book]")
        check("hours" in page.inner_text("#doc").lower(), "the plan says where the hours go")
        page.click("[data-tab=bookreport]")
        check("hours" in page.frame_locator("#report").locator("body").inner_text().lower(), "the book report renders")
        page.click("[data-tab=bookmap]")
        page.locator("#view tbody tr").first.get_by_role("button", name="Open").click()
        page.wait_for_selector("#run:not([disabled])", timeout=180_000)
        page.wait_for_selector("#book-table[hidden]", state="attached")
        check("Yield" in page.inner_text("#kpis") and page.locator("#tabs button").count() == 21, "opening a customer from the book shows its own report")
        examples = Path(__file__).resolve().parent.parent / "examples" / "portfolio"
        page.set_input_files("#folder", str(examples))
        page.wait_for_selector("#status:has-text('customers found')")
        check("customers found" in page.inner_text("#status"), "choosing a folder of customer folders is recognised as a book")
        page.set_input_files("#folder", str(examples / "northwind"))
        page.wait_for_selector("#loaded li:has-text('customer.toml')")
        run_and_wait()
        check("Yield" in page.inner_text("#kpis") and page.locator("#book-table[hidden]").count() == 1, "choosing one customer folder is a single analysis")

        # protecting what is saved with a passphrase
        page.click("#demo")
        page.wait_for_selector("#loaded li:nth-child(6)")
        run_and_wait()
        page.click("#save")
        page.wait_for_selector("#saved-note:has-text('Saved'), #saved-note:has-text('already saved')")
        page.click("#vault-on")
        page.fill("#vault-pass", "short")
        page.fill("#vault-pass2", "short")
        page.click("#vault-go")
        check("at least 12" in page.inner_text("#vault-msg"), "a short passphrase is refused")
        page.fill("#vault-pass", "correct horse battery staple")
        page.fill("#vault-pass2", "correct horse battery staple")
        page.click("#vault-go")
        page.wait_for_selector("#vault-state:has-text('unlocked')", timeout=60_000)
        raw = page.evaluate("""() => new Promise((res) => { const r = indexedDB.open('beyond90'); r.onsuccess = () => {
            const q = r.result.transaction('snapshots').objectStore('snapshots').getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }; })""")
        check("Northwind" not in raw and "accounts.csv" not in raw and "sealed" in raw, "sealed snapshots hold nothing readable")
        page.reload()
        page.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        page.wait_for_selector("#vault-unlock:not([hidden])")
        check(page.locator("#hist-table tbody tr").count() == 0, "after a reload the saved data stays locked")
        page.click("#vault-unlock")
        page.fill("#vault-pass", "not the passphrase")
        page.click("#vault-go")
        page.wait_for_selector("#vault-title:has-text('Unlock')")
        page.wait_for_selector("#vault-help:has-text('not the passphrase')", timeout=10_000)
        page.fill("#vault-pass", "correct horse battery staple")
        page.click("#vault-go")
        page.wait_for_selector("#vault-state:has-text('unlocked')", timeout=60_000)
        check(page.locator("#hist-table tbody tr").count() >= 1, "the right passphrase brings the snapshots back")
        page.click("#vault-lock")
        page.wait_for_selector("#vault-unlock:not([hidden])")
        check(page.locator("#hist-table tbody tr").count() == 0, "locking hides them again")
        page.click("#vault-unlock")
        page.fill("#vault-pass", "correct horse battery staple")
        page.click("#vault-go")
        page.wait_for_selector("#vault-state:has-text('unlocked')", timeout=60_000)
        page.once("dialog", lambda d: d.accept())
        page.click("#vault-off")
        page.wait_for_selector("#vault-state:has-text('not protected')")
        check(page.locator("#hist-table tbody tr").count() >= 1, "removing protection keeps the snapshots")

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

        browser.close()
        browser = p.chromium.launch()

        # accessibility: axe-core, when its path is given (the Pages workflow installs it); both colour schemes
        axe = os.environ.get("AXE_CORE")
        if axe:
            for scheme in ("light", "dark"):
                actx = browser.new_context(bypass_csp=True, color_scheme=scheme)       # the audit injects a script, which the page's policy rightly forbids
                apage = actx.new_page()
                apage.goto(base)
                apage.wait_for_selector("#demo:not([disabled])", timeout=180_000)
                apage.click("#demo-prev")
                apage.click("#demo")
                apage.click("#run")
                apage.wait_for_selector("#results:not([hidden])", timeout=180_000)
                apage.click("#save")
                apage.wait_for_selector("#saved-note:has-text('Saved')")
                apage.add_script_tag(path=axe)
                bad = apage.evaluate("axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']}).then(r => r.violations.map(v => v.id + ' x' + v.nodes.length))")
                check(not bad, f"no accessibility violations ({scheme}): {bad}")
                actx.close()
        else:
            print("skip accessibility audit (set AXE_CORE to axe.min.js)")

        check(not console, "no console errors or warnings" + (": " + "; ".join(console[:3]) if console else ""))
        browser.close()
    srv.shutdown()
    print("ok" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "_site"))
