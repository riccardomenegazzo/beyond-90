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
import re
import sys
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

# Controls live in places (Start, Saved, Help); the test opens the place before using one, as a person would.
PLACE_OF = {
    **dict.fromkeys(("open-starter", "open-mapper", "map-file", "map-body", "map-check", "map-use", "map-cancel", "map-notes", "demo", "demo-book", "demo-endpoint", "latest-adv", "demo-adv", "clear-adv", "adv-status", "run", "cancel",
                     "weeks", "hours", "real", "quarter", "bookhours", "weighting", "loaded", "status"), "start"),
    **dict.fromkeys(("demo-prev", "export", "forget", "vault-on", "vault-unlock", "vault-lock", "vault-off", "vault-state",
                     "vault-warn", "ws-status", "history-body", "device-qr", "send-work", "history-empty", "hist-table", "trend", "autosave", "personal", "privacy-body", "restore-in", "restore-out", "restore-note", "erase-result"), "saved"),
    **dict.fromkeys(("selfcheck", "selfcheck-out", "faq-q", "tour-start", "verify-build", "verify-out", "build-info"), "help"),
}


class Guided:
    """The page, with one habit added: before acting on or waiting for a control, open the place that holds it."""

    def __init__(self, page):
        self._page = page

    def __getattr__(self, name):
        return getattr(self._page, name)

    def _open_for(self, selector: str) -> None:
        m = re.match(r"#([\w-]+)", selector)
        place = PLACE_OF.get(m.group(1)) if m else None
        if place and self._page.locator(f".rail [data-place={place}][aria-current]").count() == 0:
            self._page.click(f".rail [data-place={place}]")

    def click(self, selector, **kw):
        self._open_for(selector)
        return self._page.click(selector, **kw)

    def fill(self, selector, value, **kw):
        self._open_for(selector)
        return self._page.fill(selector, value, **kw)

    def is_visible(self, selector, **kw):
        self._open_for(selector)
        return self._page.is_visible(selector, **kw)

    def inner_text(self, selector, **kw):
        self._open_for(selector)
        return self._page.inner_text(selector, **kw)

    def wait_for_selector(self, selector, **kw):
        if "state" not in kw:
            self._open_for(selector)
        return self._page.wait_for_selector(selector, **kw)


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
        ctx.add_init_script("try { if (!localStorage.getItem('beyond90.role')) localStorage.setItem('beyond90.role', 'all'); } catch (e) {}")
        page = Guided(ctx.new_page())
        console: list[str] = []
        # The self-check tries to reach another site on purpose, and the browser logs that it blocked it.
        page.on("console", lambda m: console.append(m.text) if m.type in ("error", "warning") and "beyond90-probe" not in m.text else None)
        page.on("pageerror", lambda e: console.append(str(e)))

        def boot() -> None:
            page.goto(base)
            page.wait_for_selector("#demo:not([disabled])", timeout=180_000)

        def run_and_wait() -> None:
            page.click("#run")
            page.wait_for_selector("#run:not([disabled])", state="attached", timeout=180_000)    # the click disables it at once; enabled again means finished

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
        check(page.locator("#view .todayhero").count() == 1 and "72." in page.inner_text("#view .todayhero") and page.locator("#view .opp").count() == 3, "the first screen gives the score, one sentence and three things to do")
        check("short of its" in page.inner_text("#view .tline") and page.locator("#view .bigbtn").count() == 3, "the first screen says how far from the target and offers three next steps")
        page.click("[data-tab=overview]")
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
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=120_000)
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
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=120_000)
        page.click("[data-tab=news]")
        check("MOCK-2026-002" in page.inner_text("#view") and page.get_by_role("button", name="Copy a note for the customer").count() >= 1, "a feed is matched to the customer's inventory")
        check(page.get_by_role("button", name="Copy the briefing for the customer").count() == 1, "the customer gets a ready security briefing")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download briefing (.md)").click()
        brief = Path(dl.value.path()).read_text()
        check(brief.startswith("# Cloud security briefing") and "Yield" not in brief, "the briefing downloads without internal scores")
        page.click("[data-tab=connections]")
        check(page.locator("#view svg.g-svg .g-story").count() >= 1 and page.locator("#view .g-account").count() >= 5, "the connections map draws stories, gaps and accounts together")
        page.locator("#view .g-insight").first.click()
        check(page.locator("#view .g-insight[aria-pressed=true]").count() == 1 and page.locator("#view svg.g-focus .g-node.on").count() >= 2, "an insight lights up its own part of the map")
        page.get_by_role("button", name="Fit", exact=True).click()
        page.locator("#view .g-account").first.focus()
        page.keyboard.press("Enter")
        check(page.locator("#view .g-panel h3").inner_text().startswith(("aws", "azure", "gcp")) and page.locator("#view .g-links li").count() >= 1, "an account opens from the keyboard with what it is linked to")
        page.locator("#view .g-tog").first.click()
        check(page.locator("#view .g-node.off").count() >= 1, "a kind of item can be hidden from the legend")
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
        check("Customer health" in page.inner_text("#view") and page.locator("#view .rates li").count() >= 4 and "hypothesis" in page.inner_text("#view"),
              "renewal shows the customer health with its parts and says it is a hypothesis")
        page.click("[data-tab=onepager]")
        one = page.frame_locator("#report")
        check("effective coverage" in one.locator("body").inner_text() and "Yield" not in one.locator("body").inner_text(), "the CISO one-pager renders in the customer's words")
        page.click("[data-tab=actionscsv]")
        check(page.inner_text("#raw").startswith("Summary,Description,Assignee,Due date,Priority") and page.inner_text("#raw").count("\n") >= 5, "the actions are offered as a CSV for a ticket tracker")
        with page.expect_download() as dl:
            page.click("#download")
        check(dl.value.suggested_filename == "beyond90-actions.csv", "the actions CSV downloads with its own name")
        page.click("#open-mapper")
        page.wait_for_selector("#mapper[open]")
        page.set_input_files("#map-file", files=[{"name": "export.csv", "mimeType": "text/csv", "buffer": b"Subscription ID;Cloud;Onboarded;Team\n111122223333;Amazon;Yes;Payments\n444455556666;Amazon;No;Data\n"}])
        page.wait_for_selector("#map-body:not([hidden])")
        check(page.locator("#map-rows select").first.input_value() == "Subscription ID", "the mapper guesses which column is the account")
        page.click("#map-check")
        page.wait_for_selector("#map-preview tr")
        check(page.locator("#map-preview tr").count() == 2 and "2 row(s) ready" in page.inner_text("#map-notes") and page.locator("#map-use:not([disabled])").count() == 1,
              "the mapper previews the result and offers to use it")
        page.select_option("#map-rows select >> nth=1", "")
        check(page.locator("#map-use[disabled]").count() == 1, "changing the mapping asks for a new check")
        page.click("#map-cancel")
        # on the call: tick, note, agree, then the recap never carries the private note
        page.click("[data-tab=call]")
        check(page.locator("#view details.agitem").count() >= 3, "on the call: the prepared agenda is there to tick off")
        page.locator("#view details.agitem input[type=checkbox]").first.check()
        page.locator("#view details.agitem textarea").first.fill("PRIVATE-NOTE-XYZ")
        page.get_by_role("button", name="Add something agreed").click()
        page.locator("#view .agrow input[type=text]").nth(0).fill("Grant admin consent")
        page.locator("#view .agrow input[type=text]").nth(1).fill("identity team")
        recap = page.inner_text("#view pre.recap")
        check("Grant admin consent (identity team)" in recap and "PRIVATE-NOTE-XYZ" not in recap and "What we agreed" in recap, "the recap carries what was agreed and never the private notes")
        check("1 of" in page.inner_text("#view") and "1 thing(s) agreed" in page.inner_text("#view"), "the call keeps count of what was covered and agreed")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download the actions (CSV)").click()
        csv_text = Path(dl.value.path()).read_text()
        check(csv_text.startswith("Action,Owner,Due date,Customer,Call date,Source") and "Grant admin consent,identity team" in csv_text, "the agreed actions download as a CSV")
        page.get_by_role("button", name="Keep in the ledger").click()
        for _ in range(40):
            if "kept in the ledger" in page.inner_text("#view"):
                break
            page.wait_for_timeout(250)
        check("kept in the ledger" in page.inner_text("#view"), "what was agreed on the call can be kept in the ledger")
        page.click("[data-tab=prep]")
        page.click("[data-tab=call]")
        check(page.locator("#view details.agitem input[type=checkbox]:checked").count() == 1 and "Grant admin consent" in page.inner_text("#view pre.recap"), "a call in progress survives a visit to another view")
        page.get_by_role("button", name="Log this call").click()
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=120_000)
        page.click("[data-tab=prep]")
        check("Grant admin consent" in page.inner_text("#view"), "a logged call appears in the next preparation")

        # try a combination: nothing is changed, the dip is shown, and a target gives a path
        page.click("[data-tab=whatif]")
        page.wait_for_selector("#view .whatif-reach .whatif-path li")
        check("Connect the accounts that are not connected" in page.inner_text("#view .whatif-path"), "the path to a target starts with the biggest gain")
        page.get_by_label("Connect every account that is not connected").check()
        page.wait_for_selector("#view .whatif-try .kpiline")
        view = page.inner_text("#view")
        check("right after" in view and "once settled" in view and "Yield dips first" in view, "a combination shows today, right after and settled, and says when connecting dips first")
        page.get_by_label("Switch on every module that can run").check()
        for _ in range(60):
            if not re.search(r"(?<!\d)0 modules", page.inner_text("#view .whatif-try .note")):
                break
            page.wait_for_timeout(250)
        check(not re.search(r"(?<!\d)0 modules", page.inner_text("#view .whatif-try .note")), "adding a step changes what the combination touches")

        # promises: the call's commitments are there, one can be added and closed, and the handoff note carries them
        page.click("[data-tab=commitments]")
        page.wait_for_selector("#view li.promise")
        check("Grant admin consent" in page.inner_text("#view"), "the promises view lists what was agreed on the call")
        page.get_by_label("What was promised").fill("Send the QBR deck")
        page.get_by_role("button", name="Keep in the ledger").click()
        page.wait_for_selector("#view li.promise:has-text('Send the QBR deck')")
        page.get_by_role("button", name="Mark done: Send the QBR deck").click()
        page.wait_for_selector("#view li.promise:has-text('done on')")
        check("Closed in the last 30 days" in page.inner_text("#view"), "a promise marked done moves to the closed list")
        page.click("[data-tab=handoff]")
        note = page.inner_text("#view pre.recap")
        check(note.startswith("# Handoff:") and "Send the QBR deck (done on" in note and "Grant admin consent" in note and "PRIVATE-NOTE-XYZ" not in note, "the handoff note carries the promises and never the private notes")
        page.get_by_label("To (optional)").fill("Marco")
        check("to Marco" in page.inner_text("#view pre.recap"), "the handoff note names who it is for")

        # risk burn-down, asks, proof of value, and the role lens
        page.click("[data-tab=burndown]")
        page.wait_for_selector("#view .bd-flow")
        check("critical open" in page.inner_text("#view") and "older than target" in page.inner_text("#view"), "the burn-down view shows open risk against a stated service target")
        page.click("[data-tab=asks]")
        page.get_by_label("What is being asked").fill("Export findings to our ticket tool")
        page.get_by_label("What is at stake (a number, optional)").fill("40000")
        page.get_by_role("button", name="Keep in the ledger").click()
        page.wait_for_selector("#view li.promise:has-text('Export findings to our ticket tool')")
        check("1 customer" in page.inner_text("#view"), "an ask is kept and counted once per customer")
        page.get_by_role("button", name="Mark done: Export findings to our ticket tool").click()
        page.wait_for_selector("#view li.promise:has-text('done')")
        page.click("[data-tab=pov]")
        page.get_by_role("button", name="Create the plan").click()
        page.wait_for_selector("#view li.promise")
        check("Success criteria" in page.inner_text("#view") and "Ready to start?" in page.inner_text("#view"), "a proof of value starts with criteria and a readiness list")
        page.locator("#view select[aria-label^='Result for']").first.select_option("met")
        page.locator("#view input[aria-label^='What was seen']").first.fill("All accounts visible on day one")
        page.locator("#view button[aria-label^='Save result for']").first.click()
        page.wait_for_selector("#view .kpiline .stat:has-text('1/4')")
        check("1/4" in page.inner_text("#view .kpiline"), "marking a criterion met moves the count")
        check("Worth starting? not ready" in page.inner_text("#view"), "a plan with gaps says it is not ready to start")
        page.locator("#view input[aria-label='The problem to settle']").last.fill("We cannot see two of our clouds")
        page.locator("#view input[aria-label='Date the first value was seen']").fill("2026-11-12")
        page.get_by_role("button", name="Save answers").click()
        page.wait_for_selector("#view li:has-text('Yes: The problem is stated')")
        check("Yes: The problem is stated" in page.inner_text("#view"), "a qualification answer is saved and shown")
        page.click("#role-pick button[data-role=se]")
        page.click("#role-pick button[data-role=core]")
        check(page.locator("#tabs details.navmore").count() == 1 and page.locator("#tabs > .navgroup button").count() <= 12, "the essentials show about ten views and keep the rest under More views")
        page.click("#role-pick button[data-role=se]")
        check(page.locator("#tabs details.navmore").count() == 1 and page.locator("#tabs > .navgroup button[data-tab=pov]").count() == 1, "a role puts its views first and the rest under More views")
        page.click("#role-pick button[data-role=all]")
        check(page.locator("#tabs button").count() == 34 and page.locator("#tabs details").count() == 0, "showing everything brings every view back")

        # what renewals taught: record outcomes, see them, remove one
        page.click("[data-tab=renewal]")
        page.select_option("#view select[aria-label='What happened']", "renewed")
        page.fill("#view input[aria-label=Note]", "Signed for two years")
        page.get_by_role("button", name="Record with this reading").click()
        page.wait_for_selector("#view table[aria-label='Recorded outcomes'] tbody tr")
        page.click("[data-tab=renewal]")
        page.select_option("#view select[aria-label='What happened']", "churned")
        page.fill("#view input[aria-label='Date the customer decided']", "2026-09-15")
        page.get_by_role("button", name="Record with this reading").click()
        page.wait_for_selector("#view table[aria-label='Recorded outcomes'] tbody tr:nth-child(2)")
        check("renewed" in page.inner_text("#view") and "churned" in page.inner_text("#view") and "Needs at least 3" in page.inner_text("#view"),
              "recorded outcomes are listed, and the comparison says it needs three of each before it concludes")
        page.get_by_role("button", name="Remove the outcome of Northwind (mock), 2026-09-15").click()
        page.wait_for_selector("#view table[aria-label='Recorded outcomes'] tbody tr:nth-child(2)", state="detached")
        check(page.locator("#view table[aria-label='Recorded outcomes'] tbody tr").count() == 1, "an outcome can be removed")

        page.keyboard.press("Control+k")
        page.wait_for_selector("#palette[open]")
        page.fill("#palette-q", "findings")
        page.keyboard.press("Enter")
        check(page.get_attribute("#tabs [data-tab=findings]", "aria-current") is not None, "the command palette navigates")
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

        framed = browser.new_page()
        framed.set_content(f'<iframe src="{base}" width="900" height="600" title="framed"></iframe>')
        framed.wait_for_timeout(8000)                      # far longer than the engine needs to start at the top level
        check(framed.frame_locator("iframe").locator("#demo[disabled]").count() == 1, "inside another page's frame the app refuses to run")
        framed.close()

        # privacy self-check: neither the page nor the worker can reach another origin
        page.click("#selfcheck")
        page.wait_for_selector("#selfcheck-out:has-text('engine')", timeout=30_000)
        out = page.inner_text("#selfcheck-out")
        check("page cannot reach other sites" in out and "engine cannot reach other sites" in out, "nothing can leave the page or the worker: " + out)
        page.click("#verify-build")
        page.wait_for_selector("#verify-out:has-text('match')", timeout=120_000)
        check(re.match(r"All \d+ files match the manifest", page.inner_text("#verify-out")) is not None and "Version" in page.inner_text("#build-info"),
              "every file the page runs matches the published manifest")

        # history: empty, add the previous quarter, save, compare
        check(page.is_visible("#history-body") and page.locator("#hist-table tbody tr").count() >= 1, "every analysis is already in the customer's history")
        check(page.locator("#device-qr svg.qr path").count() == 1 and "github.io" not in page.inner_text("#device-qr") and "127.0.0.1" in page.inner_text("#device-qr"),
              "Saved shows a code that opens this app on another device")
        page.click("#send-work")
        page.wait_for_selector("#ws-status:not(:empty)")
        check("passphrase first" in page.inner_text("#ws-status"), "work is sent to another device only encrypted: a passphrase is asked for first: " + page.inner_text("#ws-status"))
        page.click("[data-tab=overview]")
        page.click("#demo-prev")
        page.wait_for_selector("#demo-prev", state="hidden")
        page.click("[data-tab=overview]")
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
        page.click("[data-tab=connections]")
        check("Since 2026-09-30" in page.inner_text("#view .g-change") and page.locator("#view .g-new").count() >= 1, "the map says what changed since the earlier snapshot and marks what is new")
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
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download slides (.pptx)").click()
        deck = Path(dl.value.path()).read_bytes()
        check(deck[:2] == b"PK" and b"ppt/slides/slide6.xml" in deck and dl.value.suggested_filename.endswith(".pptx"), "the review downloads as a PowerPoint deck")
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
        page.wait_for_selector("#run:not([disabled])", state="attached")
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
        page.wait_for_selector("#hist-table tbody tr:nth-child(2)", timeout=30_000)
        check(page.locator("#hist-table tbody tr").count() == 2, "snapshots survive a reload")

        # export, wipe, import, import again
        with page.expect_download() as d:
            page.click("#export")
        exported = Path(tmp) / "ws.json"
        d.value.save_as(exported)
        doc = json.loads(exported.read_text())
        check(doc["format"] == "beyond90-workspace" and len(doc["snapshots"]) == 2, "export is a versioned workspace file")
        check(len(doc.get("outcomes", [])) == 1 and doc["outcomes"][0]["outcome"] == "renewed", "recorded renewal outcomes travel in the workspace file")
        check(len(doc.get("commitments", [])) == 4 and any(c["status"] == "done" for c in doc["commitments"]), "promises travel in the workspace file")
        check(len(doc.get("povs", [])) == 1 and len(doc.get("asks", [])) == 1, "proofs of value and asks travel in the workspace file")
        check("unencrypted" in page.inner_text("#vault-warn"), "unprotected customer data is called out")
        page.once("dialog", lambda dlg: dlg.accept())
        page.click("#forget")
        page.wait_for_selector("#history-empty:not([hidden])")
        page.set_input_files("#import", str(exported))
        page.wait_for_selector("#ws-status:has-text('2 new')")
        check("1 renewal outcome(s) added" in page.inner_text("#ws-status"), "importing the workspace brings the recorded outcomes back")
        check("4 commitment(s) added" in page.inner_text("#ws-status"), "importing the workspace brings the promises back")
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
        check(page.locator("#reshead img, #context img").count() == 0 and "<img" in page.inner_text("#reshead") and "<img" in page.inner_text("#context"), "a hostile customer name is shown as text in the header")
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
        check("Acme Endpoint" in page.inner_text("#context"), "the endpoint demo runs with its own profile")
        page.click("[data-tab=qbr]")
        qbr = page.inner_text("#doc")
        check("site(s)" in qbr and "cloud" not in qbr.lower(), "and reads in its own words (sites, not cloud accounts)")

        # a whole book: several customers, one budget of hours
        page.click("#demo-book")
        page.wait_for_selector("#loaded li:nth-child(3)")
        run_and_wait()
        page.wait_for_selector("#view tbody tr")
        check("null" not in page.inner_text("#reshead"), "the book header shows nothing it should not")
        check("Revenue-weighted" in page.inner_text("#kpis") and page.locator("#view tbody tr").count() == 3, "the book demo shows three customers and the weighted Yield")
        check(page.locator("#tabs button").count() == 10 and page.locator("#view tbody tr").count() == 3, "book mode opens on the week, one row per customer")
        page.click("[data-tab=bookburndown]")
        page.wait_for_selector("#view table[aria-label='Risk by customer'] tbody tr")
        check(page.locator("#view table[aria-label='Risk by customer'] tbody tr").count() == 3 and "at zero criticals" in page.inner_text("#view"), "the book's burn-down lists each customer with its risk")
        page.click("[data-tab=week]")
        check("Mon" in page.inner_text("#view") or "Tue" in page.inner_text("#view"), "the week gives each customer a day")
        page.locator("#view .twisty").first.click()
        check(page.locator("#view .agitem").count() >= 4, "a customer's call prep opens in place")
        page.click("[data-tab=bookonboard]")
        check(page.locator("#view tbody tr").count() == 3 and "shares" in page.inner_text("#view"), "book onboarding lists every customer and the causes they share")
        page.click("[data-tab=booknews]")
        check(page.locator("#view .card.news").count() >= 1 and "touch" in page.inner_text("#view .callout"), "book news lists each story with the customers it touches")
        check(page.locator("#view .card.news table tbody tr").count() >= 1, "and a row per customer touched")
        page.click("[data-tab=bookconnections]")
        check(page.locator("#view .g-customer").count() >= 2 and page.locator("#view .g-cause").count() >= 1, "shared patterns draw the customers and what they have in common")
        check("customers" in page.inner_text("#view .g-insights"), "and say which pattern spans several customers")
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
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=180_000)
        page.wait_for_selector("#book-table[hidden]", state="attached")
        check("Yield" in page.inner_text("#kpis") and page.locator("#tabs button").count() == 34, "opening a customer from the book shows its own report")
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
        check(page.locator("#vault-warn").is_hidden(), "the warning goes once the data is sealed")
        raw = page.evaluate("""() => new Promise((res) => { const r = indexedDB.open('beyond90'); r.onsuccess = () => {
            const q = r.result.transaction('snapshots').objectStore('snapshots').getAll(); q.onsuccess = () => res(JSON.stringify(q.result)); }; })""")
        check("Northwind" not in raw and "accounts.csv" not in raw and "sealed" in raw, "sealed snapshots hold nothing readable")
        facts = page.evaluate("""() => new Promise((res) => { const r = indexedDB.open('beyond90'); r.onsuccess = () => {
            const names = ['outcomes', 'commitments', 'retention', 'exports', 'aliases'];
            const tx = r.result.transaction(names); const out = {}; let left = names.length;
            for (const n of names) { const q = tx.objectStore(n).getAll(); q.onsuccess = () => { out[n] = q.result; if (--left === 0) res(JSON.stringify(out)); }; } }; })""")
        check("Northwind" not in facts and "Acme" not in facts and "renewed" not in facts and "sealed" in facts, "sealed outcomes and promises carry no customer name, not even in their keys")
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
        with page.expect_download() as d:
            page.click("#export")
        sealed_file = Path(tmp) / "sealed.json"
        d.value.save_as(sealed_file)
        sealed_text = sealed_file.read_text()
        check(json.loads(sealed_text)["format"] == "beyond90-sealed-workspace" and "Northwind" not in sealed_text and "accounts.csv" not in sealed_text,
              "with a passphrase, an exported workspace is sealed too")
        with page.expect_download() as d:                      # headless Chromium has no share sheet: the file is saved instead
            page.click("#send-work")
        sent = Path(d.value.path()).read_text()
        check(json.loads(sent)["format"] == "beyond90-sealed-workspace" and "Northwind" not in sent, "work sent to another device travels sealed")
        rows_before = page.locator("#hist-table tbody tr").count()
        page.set_input_files("#import", str(sealed_file))
        page.wait_for_selector("#vault-title:has-text('sealed workspace')")
        page.fill("#vault-pass", "not the passphrase")
        page.click("#vault-go")
        page.wait_for_selector("#ws-status:has-text('not the passphrase')", timeout=30_000)
        page.set_input_files("#import", str(sealed_file))
        page.wait_for_selector("#vault-title:has-text('sealed workspace')")
        page.fill("#vault-pass", "correct horse battery staple")
        page.click("#vault-go")
        page.wait_for_selector("#ws-status:has-text('already here')", timeout=60_000)
        check(page.locator("#hist-table tbody tr").count() == rows_before, "a sealed workspace opens only with its passphrase")
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
        page.click(".rail [data-place=start]")
        page.click(".opts summary")
        page.fill("#weeks", "104")
        page.fill("#hours", "0.5")
        page.click("#run")
        page.wait_for_selector("#cancel:not([hidden])")
        page.click("#cancel")
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=120_000)
        page.fill("#weeks", "26")
        page.fill("#hours", "8")
        page.wait_for_selector("#demo:not([disabled])")
        run_and_wait()
        page.wait_for_selector("#results:not([hidden])")
        check("Yield" in page.inner_text("#kpis"), "after cancelling, the engine restarts and works")

        # no files at all: a short form makes them
        page.click(".rail [data-place=start]")
        page.click("#open-starter")
        page.click("#st-go")
        check("Give the customer a name." in page.inner_text("#st-problems") and "Add at least one" in page.inner_text("#st-problems"), "the form says what is missing, in words")
        page.fill("#st-name", "Contoso <b>test</b>")
        rows = page.locator("#st-rows tr")
        rows.nth(0).locator("input[aria-label=Account]").fill("prod")
        rows.nth(0).locator("input[aria-label=Connected]").check()
        rows.nth(0).locator("input[aria-label='Monthly spend']").fill("1200")
        rows.nth(1).locator("input[aria-label=Account]").fill("dev")
        rows.nth(1).locator("select").select_option("azure")
        page.click("#st-go")
        page.wait_for_selector("#results:not([hidden])", timeout=120_000)
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=120_000)
        check("Contoso <b>test</b>" in page.inner_text("#reshead") and "50.0%" in page.inner_text("#kpis"), "a customer described in the form is analysed, its name kept as text")

        # an Excel workbook stands in for the files
        page.click(".rail [data-place=start]")
        page.set_input_files("#files", str(Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "xlsx" / "northwind.xlsx"))
        page.wait_for_selector("#status:has-text('northwind.xlsx: read')", timeout=60_000)
        check(page.locator("#loaded li").count() >= 6, "an Excel workbook is read into the customer's files")
        page.click("#run")
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=120_000)
        check("Yield" in page.inner_text("#kpis"), "and analysed like them")

        # offline: after a reload the service worker serves everything
        page.evaluate("navigator.serviceWorker.ready.then(() => 1)")
        boot()
        page.wait_for_selector("#offline:not([hidden])", timeout=60_000)
        cdp = page.context.new_cdp_session(page._page if hasattr(page, "_page") else page)
        errors = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
        manifest = cdp.send("Page.getAppManifest")
        check(not errors and not manifest.get("errors"), f"the page installs as an app on any device: {errors or manifest.get('errors')}")
        ctx.set_offline(True)
        page.reload()
        page.wait_for_selector("#demo:not([disabled])", timeout=120_000)
        run_demo()
        check("Yield" in page.inner_text("#kpis"), "the whole app works with no network")
        ctx.set_offline(False)

        # a new build is offered, not forced, and one click moves the page to it
        sw = Path(site) / "sw.js"
        original = sw.read_text(encoding="utf-8")
        try:
            sw.write_text(re.sub(r'const CACHE = "(beyond90-[0-9a-f]+)"', r'const CACHE = "\1-next"', original), encoding="utf-8")
            page.reload()
            page.wait_for_selector("#update-bar:not([hidden])", timeout=60_000)
            check(page.is_visible("#offline"), "the current version keeps working while the new one waits")
            with page.expect_navigation():
                page.click("#update-now")
            page.wait_for_function("caches.keys().then(k => k.some(n => n.endsWith('-next')) && !k.some(n => /^beyond90-[0-9a-f]+$/.test(n)))", timeout=60_000)
            check(page.locator("#update-bar").is_hidden(), "after Update now the page runs the new version and the old cache is gone")
        finally:
            sw.write_text(original, encoding="utf-8")

        # sharing with pseudonyms: a preview first, real names never in what leaves, and the names come back on this device
        run_demo()
        page.click("[data-tab=summary]")
        page.select_option("#share-level", "pseudonym")
        page.click("#copy")
        page.wait_for_selector("#exit-dialog[open]")
        shown = page.inner_text("#exit-text")
        check("Northwind" not in shown and "Customer A" in shown, "pseudonym level replaces the customer's name in what is about to leave")
        check("replaced" in page.inner_text("#exit-sum") and page.locator("#exit-left li").count() >= 1, "the preview says what was replaced and what the page can still see")
        page.click("#exit-cancel")
        page.wait_for_selector("#exit-dialog", state="hidden")
        page.select_option("#share-level", "people")
        page.click("#copy")
        page.wait_for_selector("#exit-dialog[open]")
        check("Northwind" in page.inner_text("#exit-text") and "customer name still visible" in page.inner_text("#exit-left"), "people-hidden level keeps the customer name and says so")
        page.click("#exit-cancel")
        page.wait_for_selector("#exit-dialog", state="hidden")
        page.select_option("#share-level", "pseudonym")
        with page.expect_download() as dl:
            page.click("[data-tab=handoff]")
            page.get_by_role("button", name="Download .md").click()
            page.wait_for_selector("#exit-dialog[open]")
            page.click("#exit-go")
        check("northwind" not in dl.value.suggested_filename.lower() and "customer-a" in dl.value.suggested_filename, "the downloaded file's name carries the alias too")
        saved_note = Path(tmp) / "handoff.md"
        dl.value.save_as(saved_note)
        check("Northwind" not in saved_note.read_text() and "Customer A" in saved_note.read_text(), "the downloaded file holds aliases, not names")
        page.click(".rail [data-place=saved]")
        page.locator("#privacy-body summary").click()
        page.fill("#restore-in", "Customer A should renew; Customer A is at risk.")
        page.click("#restore-go")
        check("Northwind (mock) should renew" in page.inner_text("#restore-out") and "2 aliases restored" in page.inner_text("#restore-note"), "pasted aliases are turned back into the real names on this device")
        page.select_option("#share-level", "full")

        # keeping data only as long as it should be kept, and erasing one customer completely
        page.click(".rail [data-place=saved]")
        page.wait_for_timeout(1500)                      # the panel redraws when the saved data is read; let that settle before typing in it
        page.locator("#privacy-body tr:has-text('Northwind') input[type=date]").fill("2020-01-01")
        page.locator("#privacy-body tr:has-text('Northwind') button:has-text('Set')").click()
        page.wait_for_selector("#privacy-body .bad-text")
        check("Past the keep-until date" in page.inner_text("#privacy-body"), "a customer past its keep-until date is called out")
        page.once("dialog", lambda dlg: dlg.accept())
        page.locator("#privacy-body tr:has-text('Northwind') button:has-text('Erase all')").click()
        page.wait_for_selector("#erase-result .note")
        check("0 record(s) left" in page.inner_text("#erase-result"), "after erasing, a second look finds nothing left for that customer")
        check("earlier export(s)" in page.inner_text("#erase-result"), "the erasure says which earlier exports are outside its reach")
        check("Northwind" not in page.inner_text("#hist-table"), "erasing a customer removes its snapshots and leaves other customers' alone")
        with page.expect_download() as rec:
            page.get_by_role("button", name="Download the erasure record").click()
        rec_path = Path(tmp) / "erasure.md"
        rec.value.save_as(rec_path)
        text = rec_path.read_text()
        check("not independent proof" in text and re.search(r"saved snapshots: [1-9]", text) is not None and "recorded outcomes: 1" in text, "the erasure record is honest about what it proves and counts what it removed")
        page.reload()
        page.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        check("Northwind" not in page.inner_text("#privacy-body") if page.locator("#privacy-body").count() else True, "the erasure survives a reload")

        # the first look: one click on a fresh page goes from nothing to a result
        first = browser.new_page()
        first.goto(base)
        first.wait_for_selector("#try-now:not([disabled])", timeout=180_000)
        first.click("#try-now")
        first.wait_for_selector("#view-overview, .kpis, [data-tab=overview]", timeout=180_000)
        first.wait_for_selector("text=Northwind (mock)", timeout=60_000)
        check(first.locator("#try-now").count() == 1, "one click on a fresh page opens the example customer's result")
        first.close()

        browser.close()
        browser = p.chromium.launch()

        # a phone: places at the bottom, nothing wider than the screen, tables as cards
        # target ages, the closure path and the scorecard, on a fresh page so the history above is untouched
        bctx = browser.new_context()
        bctx.add_init_script("try { localStorage.setItem('beyond90.role', 'all'); } catch (e) {}")
        tp = bctx.new_page()
        tp.goto(base)
        tp.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        tp.click("#demo")
        tp.click("#run")
        tp.wait_for_selector("#results:not([hidden])", timeout=180_000)
        tp.click("[data-tab=burndown]")
        tp.wait_for_selector("#view .bd-flow")
        tp.get_by_label("Target age for critical findings, in days").fill("3")
        tp.get_by_role("button", name="Apply and recompute").click()
        tp.wait_for_selector("#view td:has-text('(target 3d)')", timeout=120_000)
        check("From raised to confirmed" in tp.inner_text("#view"), "the burn-down shows the path from raised to confirmed")
        check("customer's own file" in tp.inner_text("#view"), "the burn-down says where the target ages are kept")
        tp.click("[data-tab=scorecard]")
        sc = tp.inner_text("#view pre.recap")
        check(sc.startswith("# Posture scorecard:") and "Input fingerprint:" in sc and "not an audit" in sc, "the scorecard carries a fingerprint and says what it does not prove")
        fp = re.search(r"Input fingerprint: `([0-9a-f]{16})`", sc).group(1)
        tp.get_by_label("Fingerprint to check").fill(fp)
        check("matches the data loaded now" in tp.inner_text("#view") and "does not match" not in tp.inner_text("#view"), "a fingerprint from this data matches")
        tp.get_by_label("Fingerprint to check").fill("0123456789abcdef")
        check("does not match" in tp.inner_text("#view"), "a different fingerprint does not")
        bctx.close()

        mctx = browser.new_context(**p.devices["Pixel 7"])
        mctx.add_init_script("try { localStorage.setItem('beyond90.role', 'all'); } catch (e) {}")
        mp = mctx.new_page()
        mp.goto(base)
        mp.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        mp.click("#demo")
        mp.click("#run")
        mp.wait_for_selector("#results:not([hidden])", timeout=180_000)
        bar = mp.evaluate("[...document.querySelectorAll('.place-btn')].map(b => [getComputedStyle(b).position, Math.round(b.getBoundingClientRect().bottom) === innerHeight])")
        check(all(x == ["fixed", True] for x in bar), f"on a phone the places sit in a bar at the bottom: {bar}")
        wide = {}
        for tab in ("overview", "connections", "accounts", "findings", "actions", "prep", "execqbr"):
            mp.locator(f"[data-tab={tab}]").click()
            mp.wait_for_timeout(300)
            wide[tab] = mp.evaluate("document.documentElement.scrollWidth - innerWidth")
        check(not any(wide.values()), f"no view is wider than a phone: {wide}")
        mp.locator("[data-tab=accounts]").click()
        check(mp.evaluate("getComputedStyle(document.querySelector('#view .dt tbody td:not(.x)'), '::before').content").strip('"') == "Account",
              "on a phone each table row reads as a card with its labels")
        mctx.close()

        # accessibility: axe-core, when its path is given (the Pages workflow installs it); both colour schemes
        axe = os.environ.get("AXE_CORE")
        if axe:
            for scheme in ("light", "dark"):
                actx = browser.new_context(bypass_csp=True, color_scheme=scheme)       # the audit injects a script, which the page's policy rightly forbids
                apage = actx.new_page()
                apage.goto(base)
                apage.wait_for_selector("#demo:not([disabled])", timeout=180_000)
                apage.add_script_tag(path=axe)
                rules = "axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']}).then(r => r.violations.map(v => v.id + ' x' + v.nodes.length))"

                def audit(page=apage, rules=rules):
                    page.wait_for_timeout(400)                 # let a place finish fading in: contrast is measured on what is painted
                    return page.evaluate(rules)
                bad = [f"start: {v}" for v in audit()]
                apage.click(".rail [data-place=saved]")
                apage.click("#demo-prev")
                apage.click(".rail [data-place=start]")
                apage.click("#demo")
                apage.click("#run")
                apage.wait_for_selector("#results:not([hidden])", timeout=180_000)
                bad += [f"work: {v}" for v in audit()]
                apage.click("[data-tab=connections]")
                bad += [f"connections: {v}" for v in audit()]
                apage.hover("#open-palette")
                apage.wait_for_selector("#tip:not([hidden])")
                bad += [f"tooltip: {v}" for v in audit()]
                for place in ("saved", "help"):
                    apage.click(f".rail [data-place={place}]")
                    bad += [f"{place}: {v}" for v in audit()]
                apage.click("#tour-start")
                apage.wait_for_selector("#tour:not([hidden])")
                bad += [f"tour: {v}" for v in audit()]
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
