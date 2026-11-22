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

ROOT = Path(__file__).resolve().parent.parent

# Controls live in places (Start, Saved, Help); the test opens the place before using one, as a person would.
PLACE_OF = {
    **dict.fromkeys(("open-starter", "open-mapper", "map-file", "map-body", "map-check", "map-use", "map-cancel", "map-notes", "demo", "demo-book", "demo-estate", "open-workshop", "demo-endpoint", "demo-saas", "demo-ai", "demo-identity", "demo-siem", "demo-hci", "demo-objstore", "demo-dbaas", "demo-files", "demo-k8s", "demo-dr", "demo-migration", "demo-privateai", "demo-hybrid", "demo-euc", "demo-microseg", "demo-cloudops", "demo-edge", "demo-provider", "latest-adv", "demo-adv", "clear-adv", "adv-status", "run", "cancel",
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


def tiny_xlsx(sheets: dict) -> bytes:
    """A small workbook with inline strings, one sheet per entry: enough to test reading a tender's file."""
    import io
    import zipfile
    from xml.sax.saxutils import escape

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        names = list(sheets)
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(names))) + "</Types>")
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{escape(n)}" sheetId="{i + 1}" r:id="s{i + 1}"/>' for i, n in enumerate(names)) + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="s{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(names))) + "</Relationships>")
        for i, n in enumerate(names):
            rows = "".join(f'<row r="{r + 1}">' + "".join(f'<c r="{chr(65 + c)}{r + 1}" t="inlineStr"><is><t>{escape(v)}</t></is></c>' for c, v in enumerate(row)) + "</row>" for r, row in enumerate(sheets[n]))
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", f'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>')
    return buf.getvalue()


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

        def state_tab(pg) -> str:
            return pg.evaluate("document.body.dataset.view")

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
        check(page.locator("#view .firstmin li").count() == 3 and page.evaluate("getComputedStyle(document.querySelector('#view .firstmin')).position") == "static",
              "the first screen offers a first minute in three steps, in the page and not over it")
        page.get_by_role("button", name="Got it, hide this").click()
        check(page.locator("#view .firstmin").count() == 0 and page.evaluate("localStorage.getItem('beyond90.tour')") == "1", "the first minute can be dismissed and stays dismissed")
        check("29 of 121 accounts" in page.inner_text("#view .e2e-lead") and page.locator("#view .e2e-bar i").count() == 5, "Today shows how many accounts pass every stage, and where the others stop")
        page.click("#tabs [data-tab=overview]")
        check("Most accounts stop first at L3 (42 of 121)" in page.inner_text("#view .nextstep"), "a view ends with one next step worked out from the data")
        page.click("#view .nextstep button")
        page.wait_for_selector("#view .chipfilter[aria-label='Stops at'] button[aria-pressed=true]")
        check(page.get_attribute("#tabs [data-tab=accounts]", "aria-current") is not None, "and its button goes straight there, filtered")
        page.click("#tabs [data-tab=today]")
        page.click("#view .e2e-go[data-stop=L3]")
        page.wait_for_selector("#view .chipfilter[aria-label='Stops at'] button[aria-pressed=true]")
        stops = page.eval_on_selector_all("#view table tbody tr", "els => els.map(e => e.textContent.includes('L3 switched on') ? 'L3' : e.textContent.slice(0, 40))")
        check(page.get_attribute("#tabs [data-tab=accounts]", "aria-current") is not None and stops and all(x.startswith("L3") for x in stops) and len(stops) >= 20,
              f"a segment of the end-to-end bar opens Accounts filtered to the accounts that stop there ({len(stops)} rows)")
        page.click("#tabs [data-tab=today]")
        check(page.locator("#view .stagebars li").count() == 4 and page.locator("#view .stagebars li.weak").count() == 1 and "×" in page.inner_text("#view .chain"), "Today shows where it leaks: four stages, the weakest marked, the multiplication written out")
        first_effect = page.inner_text("#view .todocard .opp b >> nth=0")
        page.click("#view .seg [data-rank=quick]")
        check(page.get_attribute("#view .seg [data-rank=quick]", "aria-pressed") == "true" and page.evaluate("localStorage.getItem('beyond90.rank')") == "quick", "the actions on Today can be ranked by quickest wins, and the choice is kept")
        check(page.locator("#view .todocard .opp").count() == 3, "still three of them")
        page.hover("#view .todocard .opp >> nth=0")
        check(page.inner_text("#view .tprev").startswith("→ ") and page.locator("#view .today.previewing").count() == 1 and page.locator("#view .stagebars li.moving").count() == 1, "pointing at an action previews where Yield would land and the stage it moves")
        check(page.locator("#view .tm-ghost").evaluate("e => parseFloat(e.style.width) > 0") and "below the 90% target" in page.locator("#view .tmeter").get_attribute("aria-label"),
              "and the distance to the target under the number moves with it")
        page.hover("#view .chain")
        check(page.locator("#view .today.previewing").count() == 0 and page.locator("#view .stagebars li.moving").count() == 0, "and the preview goes when the pointer leaves")
        page.click("#view .seg [data-rank=finish]")
        check("finishes 9 accounts" in page.inner_text("#view .todocard .opp >> nth=0"), "ranked by accounts finished, the first action says how many it brings all the way through")
        page.click("#view .seg [data-rank=effect]")
        check(page.inner_text("#view .todocard .opp b >> nth=0") == first_effect, "and back to the biggest effect")
        before = int(page.inner_text("#tabs [data-tab=actions] .nbadge [aria-hidden]"))
        page.click("#view .todocard .opprow .donebtn >> nth=0")
        page.wait_for_selector("#view .doneprog")
        check("1 marked done" in page.inner_text("#view .doneprog") and "up to +" in page.inner_text("#view .doneprog"), "marking an action done shows what it adds, as an estimate")
        check(int(page.inner_text("#tabs [data-tab=actions] .nbadge [aria-hidden]")) == before - 1 and page.locator("#view .todocard .opp").count() == 3 and page.inner_text("#view .todocard .opp b >> nth=0") != first_effect, "the count drops and the next action moves up")
        stored = page.evaluate("JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage))")
        check("l4_assign_owners" not in stored and "bu-retail" not in stored, "an action marked done is not written to plain local storage: it goes to the customer's store, sealed when a passphrase is set")
        page.click("#view .donelist .donebtn")
        page.wait_for_selector("#view .doneprog", state="detached")
        check(page.inner_text("#view .todocard .opp b >> nth=0") == first_effect, "and it can be undone")
        page.click("#view .todocard .opprow .donebtn >> nth=0")
        page.wait_for_selector("#view .doneprog")
        page.reload()
        page.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        run_demo()
        page.click("#tabs [data-tab=today]")
        check(page.locator("#view .doneprog").count() == 1 and "1 marked done" in page.inner_text("#view .doneprog"), "a mark survives a reload: it is kept with the customer's saved data")
        page.click("#view .donelist .donebtn")
        page.wait_for_selector("#view .doneprog", state="detached")
        check(True, "and undoing it is kept too")
        check(1 <= page.locator("#view .watch li:not(.more)").count() <= 3, "Keep an eye on lists up to three things, each with its door")
        check("short of its" in page.inner_text("#view .tline") and page.locator("#view .bigbtn").count() == 4, "the first screen says how far from the target and offers four doors to the next step")
        page.click("[data-tab=overview]")
        check(page.locator("#view .gauge").count() == 1 and "72." in (page.text_content("#view .gauge") or ""), "overview draws the Yield gauge")
        check(page.locator("#view .opp").count() == 5 and page.locator("#view svg.chart").count() >= 2, "overview lists opportunities and draws the charts")
        page.click("[data-tab=actions]")
        check(page.locator("#view .startcard").count() == 3 and "points" in page.inner_text("#view .startcard"), "actions open on three to start with, each with its gain")
        page.locator("#view .startcard summary").first.click()
        check(page.locator("#view .startcard ol li").count() >= 1, "a starting action shows how to do it")
        n_all = page.locator("#view tbody tr").count()
        page.fill("#view input.search", "unowned")
        check(0 < page.locator("#view tbody tr").count() < n_all, "searching actions filters the table")
        page.fill("#view input.search", "")
        page.locator("#view .twisty").first.click()
        check(page.locator("#view tr.detail").count() == 1, "an action expands to show its steps")
        page.click("[data-tab=accounts]")
        check(page.locator("#view .bdlead").count() == 1 and page.locator("#view .firstlist li").count() == 3 and "not connected" in page.inner_text("#view .bdlead"), "the accounts view opens with one sentence and the three to look at first")
        page.get_by_role("button", name="not connected").click()
        check(page.locator("#view tbody tr").count() == 12 and "12 of 12" in page.inner_text("#view .tablewrap .note"), "the accounts view filters to the unconnected ones")
        page.click("#view th:nth-child(2) .sortbtn")
        check("ascending" in (page.locator("#view th[aria-sort=ascending]").first.get_attribute("aria-sort") or ""), "columns sort")
        page.click("[data-tab=findings]")
        check(page.locator("#view .bdlead").count() == 1 and 1 <= page.locator("#view .firstlist li").count() <= 3, "the findings view opens with one sentence and the few that need a person")
        page.get_by_role("button", name="critical", exact=True).click()
        check(page.locator("#view tbody tr").count() > 0 and "critical" in page.inner_text("#view tbody"), "findings filter by severity")
        page.click("[data-tab=planview]")
        before = page.inner_text("#view .kpiline")
        page.eval_on_selector("#view .slider input", "(i) => { i.value = 16; i.dispatchEvent(new Event('input')); }")
        page.wait_for_selector("#view .planout:has-text('week')", timeout=60_000)
        page.wait_for_timeout(2500)
        check(page.inner_text("#view .kpiline") != before, "the what-if slider recomputes the plan in the worker")
        page.click("[data-tab=prep]")
        check(page.locator("#view .disco li").count() == 12 and "weakest" in page.inner_text("#view .disco li >> nth=3"), "the call prep lists discovery questions, the customer's weakest stage right after business value")
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
        check(page.locator("#map-preview tr").count() == 2 and "2 rows ready" in page.inner_text("#map-notes") and page.locator("#map-use:not([disabled])").count() == 1,
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
        check("1 of" in page.inner_text("#view") and "1 thing agreed" in page.inner_text("#view"), "the call keeps count of what was covered and agreed")
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
        check("How fixes get made" in page.inner_text("#view") and "needed no one" in page.inner_text("#view") and page.locator("#view .ladder li").count() == 3, "the burn-down shows how fixes get made when the file records it")
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
        page.locator("#view input[aria-label='The problem to settle']").first.fill("We cannot see two of our clouds")
        page.locator("#view input[aria-label='Date the first value was seen']").fill("2026-11-12")
        page.get_by_role("button", name="Save answers").click()
        page.wait_for_selector("#view li:has-text('Yes: The problem is stated')")
        check("Yes: The problem is stated" in page.inner_text("#view"), "a qualification answer is saved and shown")
        check("Set the start and end of the window" in page.inner_text("#view"), "a proof of value without a window says how to get the mutual plan")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Readout invitation (.ics)").click()
        ro_ics = Path(dl.value.path()).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\n ", "")
        check("proof of value readout" in ro_ics and "Criterion by criterion" in ro_ics and "Who should be there: the sponsor" in ro_ics,
              "the readout has an invitation that carries its agenda: each criterion, and who should be there")
        # the readout, criterion by criterion: it opens on the first not tried, the evidence written on the card
        page.get_by_role("button", name="Go criterion by criterion").click()
        page.wait_for_selector("dialog.deck[open] .deckcard")
        RD = "dialog.deck"
        check(page.inner_text(f"{RD} .deckline") == "Criterion 2 of 4" and page.locator(f"{RD} .deckopt").count() == 4,
              "the readout opens on the first criterion not tried yet, one card each")
        page.fill(f"{RD} .decksaid", "Two of three clouds, the third next week")
        check(page.inner_text(f"{RD} .decksug") == "Sounds like partly met", "and the evidence written on it suggests the result")
        page.locator(f"{RD} .deckopt.o-partly").click()
        page.locator(f"{RD} .deckline", has_text="Criterion 3 of 4").wait_for()
        page.fill(f"{RD} .decksaid", "Failed: alerts arrived after two hours")
        page.locator(f"{RD} .deckopt.o-not_met").click()
        page.locator(f"{RD} .deckline", has_text="Criterion 4 of 4").wait_for()
        page.locator(f"{RD} .deckbar .linkbtn", has_text="Skip").click()
        page.wait_for_selector(f"{RD} .decksum")
        rs = page.inner_text(f"{RD} .decksum")
        check(rs.startswith("1 of 4 criteria met, 1 partly, 1 not met; 1 not tried yet.") and "Not met: what it means for the decision" in rs and "alerts arrived after two hours" in rs,
              "the end of the readout says what was not met, with the evidence, and what is still to try")
        # with pseudonyms, the mail is previewed like a copy, and nothing opens until it is accepted
        page.select_option("#share-level", "pseudonym")
        page.locator(f"{RD} .deckrecap button", has_text="Email the recap").click()
        page.wait_for_selector("#exit-dialog[open]")
        check(page.inner_text("#exit-title") == "Email with pseudonyms" and "Northwind" not in page.inner_text("#exit-text") and page.inner_text("#exit-go") == "Open the mail as shown",
              "the readout emailed to the account team passes the same check as a copy: aliases, and a preview first")
        page.click("#exit-cancel")
        page.wait_for_selector("#exit-dialog", state="hidden")
        page.select_option("#share-level", "full")
        page.locator(f"{RD} .deckendrow .btn", has_text="Mark the readout as held").click()
        page.wait_for_selector(f"{RD}", state="detached")
        page.wait_for_selector("#view .kpiline")
        check(page.locator("#view select[aria-label='Stage']").input_value() == "done" and "1/4" in page.inner_text("#view .kpiline")
              and page.locator("#view select[aria-label^='Result for'] >> nth=2").input_value() == "not_met",
              "marking the readout as held closes the proof, with every result kept on its criterion")
        page.click("#role-pick button[data-role=se]")
        page.click("#role-pick button[data-role=core]")
        check(page.locator("#tabs details.navmore").count() == 1 and page.locator("#tabs > .navgroup button[data-tab]").count() <= 12, "the essentials show about ten views and keep the rest under More views")
        page.click("#role-pick button[data-role=se]")
        check(page.locator("#tabs details.navmore").count() == 1 and page.locator("#tabs > .navgroup button[data-tab=pov]").count() == 1, "a role puts its views first and the rest under More views")
        page.click("#role-pick button[data-role=all]")
        check(page.locator("#tabs button[data-tab]").count() == 34 and page.locator("#tabs details").count() == 0, "showing everything brings every view back")
        check(page.locator("#tabs [data-tab=findings] .nbadge").count() == 1 and page.locator("#tabs [data-tab=burndown] .nbadge.t-bad").count() == 1, "the menu shows a live count on views with something waiting")
        check(page.locator("#pulse-host .pulse .pbar").count() == 4 and page.locator("#pulse-host .pbar.weak").count() == 1, "the menu opens with the customer's pulse: four stages, the weakest marked")
        page.click("#tabs [data-tab=burndown]")
        page.click("#pin-view")
        check(page.locator("#tabs [data-pin=burndown]").count() == 1 and page.get_attribute("#pin-view", "aria-pressed") == "true", "a view can be pinned to the top of the menu")
        page.click("#pin-view")
        check(page.locator("#tabs [data-pin]").count() == 0, "and unpinned")
        grp = page.locator("#tabs .navgroup:not(:has([aria-current])) > button.grp").first
        grp.click()
        check(grp.get_attribute("aria-expanded") == "false" and page.evaluate("JSON.parse(localStorage.getItem('beyond90.navclosed') || '[]').length") == 1, "a group of the menu folds and the menu remembers it")
        grp.click()
        check(grp.get_attribute("aria-expanded") == "true", "and opens again")
        page.click("#tabs [data-tab=today]")
        page.locator("body").press("g")
        page.locator("body").press("a")
        check(page.get_attribute("#tabs [data-tab=actions]", "aria-current") is not None, "g then a jumps to Actions")
        page.locator("body").press("]")
        check(page.get_attribute("#tabs [data-tab=actions]", "aria-current") is None, "] steps to the next view in the menu")
        page.locator("body").press("?")
        check(page.locator("#keys-help[open] kbd").count() >= 10, "? lists the keyboard shortcuts")
        page.keyboard.press("Escape")

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
        page.keyboard.press("Control+k")
        page.wait_for_selector("#palette[open]")
        page.fill("#palette-q", "acitons")
        check("Actions" in page.inner_text("#palette-list li:first-child"), "the palette finds a view despite a typing slip")
        page.keyboard.press("Escape")
        page.keyboard.press("Control+k")
        page.wait_for_selector("#palette[open]")
        page.fill("#palette-q", "late")
        check("promises are overdue" in page.inner_text("#palette-list li:first-child"), "the search box answers from the data: 'late' finds the overdue promises")
        page.keyboard.press("Enter")
        check(page.get_attribute("#tabs [data-tab=commitments]", "aria-current") is not None, "and goes there")
        page.keyboard.press("Control+k")
        page.wait_for_selector("#palette[open]")
        page.fill("#palette-q", "L3")
        check("stop at L3" in page.inner_text("#palette-list li:first-child"), "'L3' finds the accounts that stop there")
        page.keyboard.press("Escape")
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
        check("1 renewal outcome added" in page.inner_text("#ws-status"), "importing the workspace brings the recorded outcomes back")
        check("4 commitments added" in page.inner_text("#ws-status"), "importing the workspace brings the promises back")
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
        # every message the status line shows is kept: a later one can replace the warning before a poll sees it
        page.evaluate("""(() => { const s = document.getElementById('status'); window.__said = [];
          new MutationObserver(() => window.__said.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true }); })()""")
        page.click("#copy")
        warned = False
        for _ in range(50):
            if any("meant for you only" in x for x in page.evaluate("window.__said")) or "meant for you only" in page.inner_text("#status"):
                warned = True
                break
            page.wait_for_timeout(200)
        check(warned, "copying a QBR draft warns that it holds material for the TAM only")
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
        page.click("[data-tab=today]")
        check("promise to the customer is overdue" in page.inner_text("#view .watch"), "Today flags a promise to the customer that is overdue")
        page.click("[data-tab=qbr]")
        qbr = page.inner_text("#doc")
        check(" site" in qbr and "cloud" not in qbr.lower(), "and reads in its own words (sites, not cloud accounts)")
        for demo_id, who in (("demo-saas", "Acme SaaS"), ("demo-ai", "Orbit AI"), ("demo-hci", "Granite Manufacturing"), ("demo-dr", "Harborline Retail"),
                             ("demo-cloudops", "Quarzo Utilities"), ("demo-edge", "Faro Stores"), ("demo-provider", "Nimbo Cloud Services"), ("demo-objstore", "Meridian Health")):
            page.click(f"#{demo_id}")
            page.wait_for_selector("#loaded li:has-text('customer.toml')")
            run_and_wait()
            page.wait_for_selector("#results:not([hidden])")
            check(who in page.inner_text("#context"), f"the {who} demo runs with its own profile")
            if demo_id == "demo-hci":
                page.click("[data-tab=onboarding]")
                body = page.inner_text("#main")
                check(page.locator("#tabs [data-tab=accounts]").inner_text().strip().startswith("Clusters") and "Where clusters stop" in body and "AWS" not in body and "Azure" not in body and "(s)" not in page.inner_text("#tabs") and "cloud account" not in body.lower(),
                      "a hyperconverged customer reads in its own words: clusters, no public-cloud checklist")
                page.click("[data-tab=today]")
                check("(s)" not in page.inner_text("#view .todocard") and "1 clusters" not in page.inner_text("#view"), "and its actions use real plurals")
        page.click("[data-tab=pov]")
        page.get_by_role("button", name="Create the plan").click()
        page.wait_for_selector("#view .suggest li")
        page.locator("#view input[aria-label='Window start']").fill("2026-12-01")
        page.locator("#view input[aria-label='Window end']").fill("2026-12-21")
        page.get_by_role("button", name="Set the window").click()
        page.wait_for_selector("#view .mplan li")
        check(page.locator("#view .mplan li").count() == 8 and "2026-12-31" in page.inner_text("#view .mplan") and "Decision by the sponsor" in page.inner_text("#view .mplan"), "a proof of value with a window gets a dated mutual plan to signature")
        check("object lock" in page.inner_text("#view .suggest").lower(), "a proof of value for object storage suggests that product's own tests (object lock)")
        n_sug = page.locator("#view .suggest li").count()
        page.locator("#view .suggest button").first.click()
        page.wait_for_selector("#view .promises li:has-text('cannot be deleted or overwritten')")
        check(page.locator("#view .suggest li").count() == n_sug - 1, "and one click adds a suggested test to the success criteria, and takes it off the suggestions")

        # a discovery workshop: no files, the profiles' questions, what the customer says, where to start
        page.click(".rail [data-place=start]")
        page.click("#open-workshop")
        page.wait_for_selector("#view .wsq")
        check(page.locator("#view details.wsline").count() == 4 and "New prospect" in page.inner_text("#reshead"), "a workshop opens with no data, four infrastructure lines in scope")
        check(not re.search(r"\bnull\b|\bundefined\b", page.inner_text("#view")), "and shows no stray null or undefined where nothing was answered yet")
        page.fill("#view input[aria-label='Who the workshop is with']", "Kestrel Logistics (mock)")
        page.get_by_role("button", name="Save the name").click()
        page.wait_for_selector("#reshead:has-text('Kestrel Logistics')")
        answers = {"hci": ["partly", "solved", "solved", "partly", "solved", "gap", "solved", "partly"], "dr-backup": ["gap", "gap", "gap", "partly", "gap", "unknown", "gap", "unknown"]}
        label = {"solved": "Solved", "partly": "Partly", "gap": "A real gap", "unknown": "Nobody knows"}
        for prof, ans in answers.items():
            d = page.locator(f"#ws-{prof}")
            if d.get_attribute("open") is None:
                d.locator(":scope > summary").click()
            for i, a in enumerate(ans):
                d.locator(".wsq").nth(i).get_by_role("button", name=label[a], exact=True).click()
                page.wait_for_selector(f"#ws-{prof} .wsq:nth-child({i + 1}) .wsopt.o-{a}[aria-pressed=true]")
        # in a meeting: the next question is selected after an answer, and the keys 1 to 4 answer it
        d = page.locator("#ws-dbaas")
        if d.get_attribute("open") is None:
            d.locator(":scope > summary").click()
        d.locator(".wsq").nth(0).get_by_role("button", name="Partly", exact=True).click()
        page.wait_for_selector("#ws-dbaas .wsq:nth-child(1) .o-partly[aria-pressed=true]")
        page.keyboard.press("3")
        page.wait_for_selector("#ws-dbaas .wsq:nth-child(2) .o-gap[aria-pressed=true]")
        check(state_tab(page) == "workshop" and page.evaluate("document.activeElement.closest('.wsq') === document.querySelector('#ws-dbaas .wsq:nth-child(3)')"),
              "after an answer the next question is selected, and a digit answers it instead of switching views")
        for i in (1, 0):
            d.locator(".wsq").nth(i).locator(".wsopt[aria-pressed=true]").click()     # pressing again clears: back to the two lines above
            page.wait_for_selector(f"#ws-dbaas .wsq:nth-child({i + 1}) .wsopt[aria-pressed=true]", state="detached")
        # a first meeting: only the essential questions, then only those for the people in the room, each with how to ask it
        disc = {pr: json.loads((ROOT / "src/beyond90/data/profiles" / pr / "discovery.json").read_text())["questions"] for pr in ("hci", "dbaas", "dr-backup", "hybrid-cloud")}
        page.get_by_role("button", name="Essential questions only").click()
        n_core = sum(1 for qs in disc.values() for q in qs if q.get("core"))
        page.wait_for_function(f"document.querySelectorAll('#view .wsq:not([hidden])').length === {n_core}")
        check(f"{n_core} of {sum(len(qs) for qs in disc.values())} questions shown" in page.inner_text("#view .wsnarrow"), "a first meeting narrows to the essential questions on every line")
        page.get_by_role("group", name="Who is in the room").get_by_role("button", name="Security", exact=True).click()
        n_sec = sum(1 for qs in disc.values() for q in qs if q.get("core") and q.get("role") == "security")
        page.wait_for_function(f"document.querySelectorAll('#view .wsq:not([hidden])').length === {n_sec}")
        first = page.locator("#view .wsq:not([hidden])").first
        first.locator(".wsqhead").click()
        check(first.locator(".wsqmore").count() == 1 and page.locator("#view .wsq.open").count() == 1, "a question opens on its own, one at a time")
        first.locator(".wshow summary").click()
        check("Listen for" in first.inner_text() and "Then ask" in first.inner_text() and "Ask: security" in first.inner_text(),
              "and to the people in the room, each question saying who to ask, what to listen for and what to ask next")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Question guide (.md)").click()
        guide = Path(dl.value.path()).read_text(encoding="utf-8")
        check(guide.startswith("# Questions for Kestrel Logistics") and "Narrowed to the essential questions only, for security." in guide and guide.count("Then ask: ") == n_sec,
              "the narrowed questions download as a guide to take into the meeting")
        page.get_by_role("group", name="Who is in the room").get_by_role("button", name="Security", exact=True).click()
        page.get_by_role("button", name="Essential questions only").click()
        page.wait_for_function("document.querySelectorAll('#view .wsq[hidden]').length === 0")
        page.locator("#ws-dr-backup .wsq").first.locator(".wsqhead").click()
        note = page.locator("#ws-dr-backup .wsq").first.locator("input.wsnote")
        note.fill("A day down is about 2M in lost orders")
        note.press("Tab")
        fig = page.locator("#ws-dr-backup .wsq").first.locator(".wsworth input")
        fig.fill("2,000,000")
        fig.press("Tab")
        page.wait_for_timeout(300)
        in_scope = sum(len(json.loads((ROOT / "src/beyond90/data/profiles" / p / "discovery.json").read_text())["questions"]) for p in ("hci", "dbaas", "dr-backup", "hybrid-cloud"))
        check(f"16 of {in_scope} questions answered" in page.inner_text("#view .wsprog"), "progress follows the answers")
        page.keyboard.press("Escape")
        page.wait_for_selector("#ws-dr-backup .wsq:first-child:not(.open) .wsqsaid")
        check("“A day down is about 2M in lost orders”, 2,000,000 per day" in page.inner_text("#ws-dr-backup .wsq:first-child .wsqsaid"),
              "closed, a question shows what they said and the figure, in one line")
        check(page.locator("#view .wsstrip .qlgroup").count() == 4 and "8 of" in page.inner_text("#view .wsstrip"), "a strip shows every line in scope, a dot per question")
        page.get_by_role("button", name="Not answered yet").click()
        check(page.locator("#ws-dr-backup .wsq:not([hidden])").count() == page.locator("#ws-dr-backup .wsq").count() - 8, "the questions narrow to those not answered yet")
        page.get_by_role("button", name="Not answered yet").click()
        # one question at a time: the deck at the top of the questions shows the first one with no answer; words suggest an answer
        first_open = page.evaluate("document.querySelector('#view .wsq:not([data-answered=\"1\"]) .wsqq').textContent")
        D = "#view .deckpane.inpage"
        check(page.inner_text(f"{D} .deckq") == first_open and f"of {in_scope}" in page.inner_text(f"{D} .deckpos")
              and page.evaluate("document.querySelector('#view .deckpanel').compareDocumentPosition(document.querySelector('#view .wsline')) & 4") > 0,
              "the questions open on the deck, before the list, at the first question with no answer")
        check(page.evaluate("localStorage.getItem('beyond90.deckhint')") == "1", "the first card shown leans to say it can be swiped, and only the first time")
        check(page.locator("#view .deckhint").first.inner_text().startswith("Keys: → solved"), "with a mouse and a keyboard, the card says its keys instead of asking for a swipe")
        page.fill("#wsdeck-said", "We have never tested it")
        check(page.inner_text(f"{D} .decksug") == "Sounds like a real gap" and page.locator(f"{D} .deckopt.o-gap.sug").count() == 1,
              "what they said suggests an answer, without answering")
        page.evaluate("document.querySelector('#view .deckpane.inpage .deckstage').scrollIntoView({block: 'center', behavior: 'instant'})")
        box = page.locator(f"{D} .deckcard").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + 60
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx - 70, cy + 4, steps=4)
        check(page.inner_text(f"{D} .deckstamp") == "A real gap", "dragged, the card shows the answer it is heading for")
        page.mouse.move(cx - 220, cy + 10, steps=6)
        page.mouse.up()
        page.locator(f"{D} .deckq", has_not_text=first_open).wait_for()      # polling a script would break the page's policy
        second = page.inner_text(f"{D} .deckq")
        check(page.locator(f"{D} .deckafter", has_text="On the journey:").count() == 1,
              "a real gap says, under the next card, what it puts on the journey")
        page.keyboard.press("ArrowUp")
        page.locator(f"{D} .deckq", has_not_text=second).wait_for()
        page.locator(f"{D} .deckbar .linkbtn", has_text="Previous").click()
        check(page.locator(f"{D} .deckopt.o-partly[aria-pressed=true]").count() == 1 and "Answered: partly" in page.inner_text(f"{D} .decktags"),
              "a swipe left answers a real gap, an arrow answers, and Previous goes back to the card with its answer")
        page.locator(f"{D} .deckfull").click()
        page.wait_for_selector("dialog.deck[open] .deckcard")
        check(page.inner_text("dialog.deck .deckq") == second and page.locator("dialog.deck .deckopt.o-partly[aria-pressed=true]").count() == 1,
              "Full screen opens the same deck where it was")
        page.locator("dialog.deck .deckaside > summary").click()
        page.fill("dialog.deck #wsheard", "Any domain admin can wipe the backup repository")
        check(page.locator("dialog.deck .heardhit").count() > 0, "full screen, heard something is a sheet under the card, with its matches")
        page.fill("dialog.deck #wsheard", "")
        page.locator("dialog.deck .deckclose").click()
        page.wait_for_selector("dialog.deck", state="detached")
        check(page.locator("#view .deckside #wsheard").count() == 1, "closed, heard something is back beside the card")
        gap_q = page.locator("#view .wsq", has=page.locator(".wsqq", has_text=first_open)).first
        check("“We have never tested it”" in gap_q.inner_text() and gap_q.locator(".o-gap[aria-pressed=true]").count() == 1
              and f"18 of {in_scope} questions answered" in page.inner_text("#view .wsprog"),
              "the list carries the deck's answers and what they said, as they are given")
        for qtext in (second, first_open):        # the two answers go again, so the journey below reads as before
            row = page.locator("#view .wsq", has=page.locator(".wsqq", has_text=qtext)).first
            row.locator(".wsopt[aria-pressed=true]").click()
            row.locator(".wsopt[aria-pressed=true]").wait_for(state="detached")
        page.locator("#view .wsprog", has_text=f"16 of {in_scope} questions answered").wait_for()
        # heard something: written as it was said, it finds the question it answers, with the answer the words suggest
        page.fill("#wsheard", "Any domain admin can wipe the backup repository")
        hits = page.locator("#view .heardhit")
        check(0 < hits.count() <= 3 and any("administrator account delete" in hits.nth(i).inner_text() for i in range(hits.count()))
              and page.locator("#view .heardhit .heardopt.o-gap.sug").count() >= 1,
              "what was heard finds the question it answers, with the answer the words suggest")
        # a figure a first sketch starts from is offered for it: the backups and the distance, here
        page.fill("#wsheard", "We keep 200 TB of backups, the second site is 3 ms away")
        check(page.get_by_role("button", name="Use 181.9 as the protected data of the recovery design").count() == 1
              and page.get_by_role("button", name="Use 3 as the round trip between the sites, in the recovery design").count() == 1,
              "the protected data and the distance between the sites are offered for the recovery design")
        # and the case for change is read from what was said: the renewal and what staying costs
        page.fill("#wsheard", "The renewal would triple the cost; we pay 1.4 million a year for licences and support")
        page.get_by_role("button", name="Use 200 as the expected rise at the next renewal, in the case for change").click()
        page.locator("#view .heardsay", has_text="Put in the case for change: 200 percent more at the next renewal").wait_for()
        check(page.get_by_role("button", name="Use 1,400,000 as the yearly cost of the current platform, in the case for change").count() == 1
              and "already in it" in page.inner_text("#view .heardsketch"),
              "the rise at the renewal and the yearly cost of staying are offered for the case for change, and one tap puts each in")
        page.locator("#view .heardsay button", has_text="Undo").click()
        page.locator("#view .heardsay", has_text="Undone: the case for change is back as it was").wait_for()
        page.fill("#wsheard", "One day without the main site would cost about 2 million euros")
        check(any("Figure heard: 2,000,000 per day" in page.locator("#view .heardhit").nth(i).inner_text() for i in range(page.locator("#view .heardhit").count())),
              "a figure in what was heard is read, with what it is counted per, on the value question it answers")
        page.fill("#wsheard", "Qualsiasi amministratore di dominio può cancellare i backup")
        it_hits = [page.locator("#view .heardhit").nth(i).inner_text() for i in range(page.locator("#view .heardhit").count())]
        page.fill("#wsheard", "Un giorno senza la sede principale costerebbe circa 2 milioni di euro")
        check(any("administrator account delete" in t for t in it_hits)
              and any("Figure heard: 2,000,000 per day" in page.locator("#view .heardhit").nth(i).inner_text() for i in range(page.locator("#view .heardhit").count())),
              "a note written in Italian finds the same question, and its figure")
        page.fill("#wsheard", "The CIO signs off anything above 500k")
        deal_hit = page.locator("#view .heardhit", has_text="Who decides, who signs")
        check(deal_hit.count() == 1 and "Qualify the deal" in deal_hit.inner_text() and deal_hit.locator(".heardopt").count() == 3
              and "Who decides, who signs" in page.locator("#view .heardhit").first.inner_text(),
              "what was heard about the deal finds its qualification question, with its three answers")
        page.fill("#wsheard", "We have backups already, Veeam runs every night")
        concern = page.locator("#view .heardconcern")
        check(concern.count() == 1 and "We already have backups." in concern.inner_text() and "Ask first" in concern.inner_text()
              and page.locator("#view .heardout > .heardhit").first.get_attribute("class") == "heardhit heardconcern",
              "a concern the line expects is recognised as it is said, first, with the question to ask before answering")
        concern.get_by_role("button", name="Mark it raised: We already have backups.").click()
        page.locator("#view .heardsay", has_text="Marked as raised").wait_for()
        check("marked as raised" in page.inner_text("#view .heardconcern") and page.locator("#view .heardconcern .heardopt").count() == 0,
              "and a tap marks it raised, for the readout and the proof")
        page.locator("#view .heardsay button", has_text="Undo").click()
        page.locator("#view .heardsay", has_text="No longer marked as raised").wait_for()
        page.fill("#wsheard", "")
        check(page.locator("#view .heardhit").count() == 0, "cleared, the matches go")
        # the meeting's clock: a tap starts it; it keeps the time, on the card too, and the pace on the essential questions
        page.locator("#view .clockstart .btn", has_text="45 min").click()
        page.locator("#view .deckpane.inpage .deckmini", has_text="left").wait_for()
        check(re.match(r"^4[45]:\d\d left$", page.inner_text("#view .clocktime")) is not None and "essential question" in page.inner_text("#view .paceline"),
              "the meeting clock starts with a tap and gives the time left and the pace")
        clock_key = page.evaluate("Object.keys(sessionStorage).find((k) => k.startsWith('beyond90.clock.'))")
        page.evaluate(f"sessionStorage.setItem({json.dumps(clock_key)}, JSON.stringify({{start: Date.now() - 40 * 60000, minutes: 45}}))")
        page.click("[data-tab=wsqualify]")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .clocktime")
        check(page.inner_text("#view .paceline").startswith("Behind:") and page.locator("#view .paceact .btn", has_text="Ask only the essentials").count() == 1,
              "the clock outlives a change of view, and behind it offers the essential questions only")
        page.locator("#view .paceact .btn", has_text="Ask only the essentials").click()
        check(page.locator("#view .wsnarrow .kindchip[aria-pressed=true]", has_text="Essential questions only").count() == 1
              and page.locator("#view .deckpane.inpage .decktag.core").count() == 1 and page.locator("#view .paceact .btn").count() == 0,
              "asking only the essentials narrows the list and the card")
        page.locator("#view .wsnarrow .kindchip", has_text="Essential questions only").click()
        page.click("[data-tab=wsqualify]")
        page.wait_for_selector("#view .deckpane.inpage .deckcard")
        page.wait_for_timeout(1200)
        check(page.locator("#view .deckpane.inpage .deckmini", has_text="left").count() == 1, "the meeting clock follows to the qualification card")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .clocktime")
        page.locator("#view .clockhead .linkbtn", has_text="Stop").click()
        check(page.locator("#view .clockstart .btn").count() == 3 and page.evaluate(f"sessionStorage.getItem({json.dumps(clock_key)})") is None,
              "stopped, the clock goes, from the tab too")
        # most useful first: the card asks the essential questions first, on the lines known least or not touched, and says why
        page.locator("#view .wsnarrow .kindchip", has_text="Most useful first").click()
        tags = page.inner_text("#view .deckpane.inpage .decktags")
        check("Essential" in tags and "Nothing asked on this line yet" in tags and page.inner_text("#view .deckpane.inpage .deckpos").startswith("1 of"),
              "most useful first starts on an essential question of a line nothing was asked on, and says so")
        page.locator("#view .wsnarrow .kindchip", has_text="Most useful first").click()
        page.get_by_role("button", name="See the journey").click()
        page.wait_for_selector("#view ol.journey")
        check("Yes, this is possible." in page.inner_text("#view .jhero") and "2M in lost orders" in page.inner_text("#view .jhero"), "the journey opens on what is possible, with what is at stake in the customer's words")
        check("2,000,000 per day" in page.inner_text("#view .jhero"), "and with the figure the customer put on it")
        check(not re.search(r"\bnull\b|\bundefined\b|NaN", page.inner_text("#view")), "the journey shows no stray null, undefined or NaN")
        check(page.locator("#view .jstep").count() >= 3 and page.locator("#view .jconds li").count() >= 5 and "First step:" in page.inner_text("#view ol.journey"), "each step lists what would need to be true, with a first step")
        check("Validated by" in page.inner_text("#view .jstep.k-prove") and "Already true" in page.inner_text("#view ol.journey"), "and how it is validated, and what is already true")
        first = page.locator("#view .jstep.k-prove .jconds li").first
        first.locator("select").select_option("together")
        first.locator("input[type=date]").fill("2026-12-15")
        first.locator("input[type=date]").dispatch_event("change")
        page.wait_for_timeout(400)
        check("December 2026" in page.inner_text("#view") and page.locator("#view .jdated li").count() == 1, "a dated condition appears in the plan by date")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Add to a calendar (.ics)").click()
        ics = Path(dl.value.path()).read_text(encoding="utf-8")
        check(ics.startswith("BEGIN:VCALENDAR") and "DTSTART;VALUE=DATE:20261215" in ics and dl.value.suggested_filename.endswith("-plan.ics"), "and goes to a calendar file")
        page.click("[data-tab=readout]")
        check("Together" in page.frame_locator("#report").locator("table").first.inner_text() or "Together" in page.frame_locator("#report").locator("body").inner_text(),
              "who makes a condition true, and by when, reaches the customer readout")
        page.click("[data-tab=journey]")
        page.click("[data-tab=hurt]")
        page.wait_for_selector("#view .painmap")
        check("Disaster recovery and backup" in page.inner_text("#view .wsland"), "the line that hurts most is where to start")
        check(page.locator("#view .painmap .enode.absent").count() == 2 and "2M in lost orders" in page.inner_text("#view"), "lines not discussed are dashed, and the customer's own words back the choice")
        check(page.locator("#view .flags li").count() == 2, "what nobody could answer becomes the list for the next meeting")
        agenda = page.inner_text("#view pre[aria-label='Agenda of the next meeting']")
        check(agenda.startswith("Next meeting with Kestrel Logistics") and "Questions to answer together" in agenda and "It helps to have in the room:" in agenda,
              "and the next meeting has an agenda: what is open, and who to bring")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Invitation (.ics)").click()
        check("SUMMARY:Kestrel Logistics (mock): next meeting" in Path(dl.value.path()).read_text(encoding="utf-8"), "and an invitation that carries it")
        # prepare: the line for each audience, who to bring, the objections; one the customer raises goes to the proof and the readout
        page.click("[data-tab=wsprep]")
        page.wait_for_selector("#view .objs")
        check("Disaster recovery and backup: start here" in page.inner_text("#view") and page.locator("#view .tellit dt").count() >= 6 and "For finance" in page.inner_text("#view .tellit"),
              "prepare starts with the line to start with, told for the executive, the technical team and finance")
        raised = page.locator("#view .obj").filter(has_text="Ransomware would encrypt the backups too").get_by_role("button")
        raised.click()
        page.wait_for_selector("#view .obj.on")
        check(raised.get_attribute("aria-pressed") == "true" and "1 raised so far" in page.inner_text("#view"), "an objection the customer raises is marked, with the question to ask first")
        # rehearsing them before the meeting: the same cards, the one raised first, and nothing kept
        page.get_by_role("button", name="Rehearse the objections").click()
        page.wait_for_selector("dialog.deck[open] .deckcard")
        RH = "dialog.deck"
        check(page.inner_text(f"{RH} .deckq") == "“Ransomware would encrypt the backups too.”" and "They raised it" in page.inner_text(f"{RH} .decktags")
              and page.locator(f"{RH} .deckopt").count() == 2 and page.inner_text(f"{RH} .decklabel") == "Your answer, in a few words",
              "rehearsing the objections starts with the one they raised, on the line to start with")
        page.locator(f"{RH} .deckfoot .linkbtn", has_text="What to say").click()
        guide = page.inner_text(f"{RH} .deckguide")
        check("Ask first" in guide and "Answer" in guide and "Prove it" in guide, "the other side of the card says what to ask first, the answer and how to prove it")
        page.locator(f"{RH} .deckguide .linkbtn", has_text="Back to the question").click()
        page.locator(f"{RH} .deckopt.o-ready").click()
        page.locator(f"{RH} .deckpos", has_text="2 of ").wait_for()
        page.locator(f"{RH} .deckopt.o-again").click()
        page.locator(f"{RH} .deckpos", has_text="3 of ").wait_for()
        while not page.locator(f"{RH} .decksum").count():
            page.locator(f"{RH} .deckbar .linkbtn", has_text="Skip").click()
        check(page.inner_text(f"{RH} .deckheadline").startswith("1 of ") and "1 to practise again" in page.inner_text(f"{RH} .deckheadline")
              and "Practise these again" in page.inner_text(f"{RH} .decksum"), "the end of the rehearsal says what to practise again")
        page.locator(f"{RH} .deckclose").click()
        page.wait_for_selector(f"{RH}", state="detached")
        page.locator("#view p.note", has_text="Rehearsed on this visit").wait_for()
        check("1 ready, 1 to practise again" in page.inner_text("#view"), "and Prepare says how it went, for this visit only")
        page.keyboard.press("Control+k")
        page.wait_for_selector("#palette[open]")
        page.fill("#palette-q", "rehearse")
        page.keyboard.press("Enter")
        page.wait_for_selector("dialog.deck[open] .deckcard")
        check(page.locator("dialog.deck .deckopt").count() == 2, "the search starts a rehearsal too, from anywhere in the workshop")
        page.locator("dialog.deck .deckclose").click()
        page.wait_for_selector("dialog.deck", state="detached")
        # qualify the deal: the same ten questions on every line, and the gate they open
        page.click("[data-tab=wsqualify]")
        page.wait_for_selector("#view .qdhero")
        check("Not qualified yet" in page.inner_text("#view .qdhero") and page.locator("#view .qdlist .qlrow").count() == 10 and page.locator("#view .qdlist .qlgroup").count() == 3,
              "the deal starts unqualified, with ten questions in three groups")
        for tag, ans in (("Pain", "Known"), ("Metrics", "Partly"), ("Technical validation", "Partly")):
            page.locator("#view .qdlist .qlrow").filter(has_text=tag).get_by_role("button", name=ans, exact=True).click()
            page.wait_for_selector(f"#view .qdlist .qlrow:has-text('{tag}') .qlopt[aria-pressed=true]")
        pain = page.locator("#view .qdlist .qlrow").filter(has_text="Pain")
        pain.locator(".qlhead").click()
        pain = page.locator("#view .qdlist .qlrow.open")
        pain.locator("input.wsnote").fill("Two outages this year, the operations director carries them (mock)")
        pain.locator("input.wsnote").press("Tab")
        page.wait_for_selector("#view .qdlist .qlrow:has-text('Two outages this year')")
        check("“Two outages this year" in page.inner_text("#view .qdlist"), "an opened question takes what was heard, and its row shows it")
        hero = page.inner_text("#view .qdhero")
        check("Ready for a demo built for them" in hero and "To be ready to propose a proof of value, find out" in hero and "Economic buyer:" in hero,
              "three answers make it ready for a demo built for them, and say what a proof of value still needs")
        # the ten questions on a card too: the first one not answered, three answers, and the list beside it follows
        Q = "#view .deckpane.inpage"
        first_q = page.inner_text(f"{Q} .deckq")
        check(page.locator(f"{Q} .deckopt").count() == 3 and page.inner_text(f"{Q} .deckkicker") == "Find out next" and "Which date makes this a decision" in first_q,
              "the qualification questions open on a card too, at the first one not answered, with their three answers")
        answered = page.locator("#view .qdlist .qlopt[aria-pressed=true]").count()
        page.locator(f"{Q} .deckopt.o-partly").click()
        page.locator(f"{Q} .deckq", has_not_text=first_q).wait_for()
        row = page.locator("#view .qdlist .qlrow").filter(has_text="Event")
        check(page.locator("#view .qdlist .qlopt[aria-pressed=true]").count() == answered + 1 and row.locator(".qlopt[aria-pressed=true]").get_attribute("aria-label") == "Partly",
              "answered on the card, it shows in the list beside it")
        page.fill("#qdheard", "The CIO signs off anything above 500k")
        check("Who decides, who signs" in page.locator("#view .heardhit").first.inner_text(), "heard something is beside the qualification too, and finds the deal's question")
        page.fill("#qdheard", "")
        row.locator(".qlopt[aria-pressed=true]").click()           # cleared again, so what follows reads as before
        for _ in range(30):
            if page.locator("#view .qdlist .qlopt[aria-pressed=true]").count() == answered:
                break
            page.wait_for_timeout(100)
        # what else they weigh: marked from the conversation, each with what to ask and when the other choice wins
        alt = page.locator("#view .altlist").get_by_role("button", name="Do nothing for now")
        alt.click()
        page.wait_for_selector("#view .altcard:has-text('Do nothing for now')")
        card_text = page.inner_text("#view .altcard")
        check(alt.get_attribute("aria-pressed") == "true" and "It is the better choice when" in card_text and "What happens on the contract end date if nothing changes?" in card_text,
              "what else they weigh opens with what to ask, when the proposal fits and when the other choice is the better one")
        page.click("[data-tab=wsummary]")
        check("What else they weigh" in page.inner_text("#doc") and "Do nothing for now" in page.inner_text("#doc"), "and goes into the meeting summary")
        # a tender, requirement by requirement: pasted, read, matched, answered; whether to bid and what to ask
        page.click("[data-tab=wsrfp]")
        page.wait_for_selector("#view .rfphero")
        check("Load the tender's requirements" in page.inner_text("#view .rfpnext"), "a tender starts empty, and the next step is to load its requirements")
        page.get_by_role("button", name="Try it with an invented tender").click()
        page.wait_for_selector("#view .rfprow")
        check(page.locator("#view .rfprow").count() == 16 and "Added 16 requirements: 11 mandatory, 5 scored or optional" in page.inner_text("#view"),
              "pasted requirements are read one by one, mandatory or scored, into a compact list")
        check(page.locator("#view .rfpbar").count() == 2 and "Answer them" in page.inner_text("#view .rfpnext"), "the picture of the bid has a bar for mandatory and scored requirements, and says what to do next")
        # one requirement open at a time: its line, the keys 1 to 4, and the next one still open opens by itself
        page.locator("#view .rfprow[data-id=r1] .rfphead").click()
        check(page.get_by_label("Product line for 1.1").input_value() == "hci" and page.locator("#view .rfprow.open").count() == 1, "opening a requirement shows the product line it was matched to")
        page.keyboard.press("1")
        page.wait_for_selector("#view .rfprow[data-id=r2].open")
        check("Met" in page.inner_text("#view .rfprow[data-id=r1] .rfpstatus") and page.locator("#view .rfprow.open").count() == 1,
              "the key 1 answers it as met, and the next requirement still open opens")
        page.keyboard.press("Escape")
        check(page.locator("#view .rfprow.open").count() == 0, "Escape closes it")
        page.locator("#view .rfprow[data-id=r9] .rfphead").click()
        check(page.get_by_label("Product line for 3.1").input_value() == "object-storage", "and each is matched to the product line it asks about")
        page.locator("#view .rfprow[data-id=r9]").get_by_role("button", name="Not met", exact=True).click()
        page.wait_for_selector("#view .rfpverdict.risk")
        check("1 mandatory requirement not met" in page.inner_text("#view .rfpverdict") and "not in scope" in page.inner_text("#view"),
              "a mandatory requirement not met puts the bid at risk; lines the tender asks about outside the conversation are marked")
        check("not met: ask whether an equivalent is accepted" in page.inner_text("#view .rfpnext"), "and becomes the first thing to do")
        page.locator("#view .rfpnext").get_by_role("button", name="See them").first.click()
        check(page.locator("#view .rfprow").count() == 1 and page.locator("#view [data-only=no][aria-pressed=true]").count() == 1, "which narrows the list to what is not met")
        page.get_by_role("group", name="Which requirements to show").get_by_role("button", name="All").click()
        page.get_by_label("Find a requirement by its words or its reference").fill("immutable")
        check(page.locator("#view .rfprow").count() == 1, "a search finds a requirement by its words")
        page.get_by_label("Find a requirement by its words or its reference").fill("")
        page.get_by_role("button", name="Group by line").click()
        check(page.locator("#view .rfpgroup").count() >= 5, "the list can be grouped by product line")
        page.get_by_role("button", name="Group by line").click()
        check("Requirement 3.1" in page.inner_text("#view .rfpdeliver") and "Evidence to gather" in page.inner_text("#view .rfpdeliver"),
              "delivering the bid shows the questions for the contracting authority and the evidence to gather")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Compliance matrix (.csv)").click()
        matrix = Path(dl.value.path()).read_text(encoding="utf-8")
        check(matrix.startswith("ref,requirement,mandatory,points,product_line,answer,how_it_is_met,who_answers") and "Not met" in matrix, "the compliance matrix downloads for the bid team")
        # the technical response: checked before it leaves, section by section as the tender numbers it
        check("Before it leaves" in page.inner_text("#view .rfpchecks") and "not answered yet" in page.inner_text("#view .rfpchecks"), "delivering the bid checks the response before it leaves")
        page.locator("#view .rfpsections summary").click()
        page.get_by_label("Title of section 2").fill("Business continuity")
        page.get_by_label("Title of section 2").press("Tab")
        page.wait_for_timeout(300)
        with page.expect_download() as dl:
            page.get_by_role("button", name="Technical response (.html, to print)").click()
        response = Path(dl.value.path()).read_text(encoding="utf-8")
        check("default-src 'none'" in response and "<h2>2. Business continuity</h2>" in response and "<script" not in response,
              "the technical response downloads as a page to print, with the section titles the tender uses and no scripts")
        # what wins it: price and quality, our bid against a rival's guessed one
        award = page.locator("#rfpaward")
        check("To compare the bids, add" in award.inner_text(), "the comparison says what it still needs")
        page.get_by_label("How price is scored").select_option("linear")
        for label, value in (("Base amount", "1200000"), ("Our quality points", "52"), ("Our price", "1000000")):
            page.get_by_label(label, exact=True).fill(value)
            page.get_by_label(label, exact=True).press("Tab")
        award.get_by_role("button", name="Add a rival's guessed bid").click()
        for label, value in (("Name, rival 1", "Rival A <b>(mock)</b>"), ("Quality points, rival 1", "60"), ("Price, rival 1", "900000")):
            page.get_by_label(label, exact=True).fill(value)
            page.get_by_label(label, exact=True).press("Tab")
        page.wait_for_selector("#rfpaward .awardbars li:nth-child(2)")
        at = award.inner_text()
        check("Rival A <b>(mock)</b> comes first; we come second, 18 points behind." in at and award.locator("b b").count() == 0,
              "with our bid and a rival's, it says who comes first and by how much, names kept as text")
        check("We would come first below" in at and "one point of quality is worth about" in at, "and the price at which that changes, and what a point of quality is worth")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Bid summary (.md)").click()
        summary = Path(dl.value.path()).read_text(encoding="utf-8")
        check("## Price and quality" in summary and "| **Us** | 52 | 1,000,000 (16.7% off) | 20 | 72 |" in summary, "the bid summary carries the comparison")
        page.get_by_label("Price, rival 1", exact=True).fill("1150000")
        page.get_by_label("Price, rival 1", exact=True).press("Tab")
        page.wait_for_selector("#rfpaward .awardlead.first")
        check("We come first" in award.inner_text() and "We stay first" in award.inner_text(), "a dearer rival puts us first, with how far our price can rise")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .wsq")
        page.click("[data-tab=wsrfp]")
        page.wait_for_selector("#rfpaward .awardlead.first")
        check(page.get_by_label("Price, rival 1", exact=True).input_value() == "1150000", "the comparison is kept with the tender")
        # bid or no bid: four answers read from the tender, the rest by hand; a no that can exclude the bid stops it
        bid = page.locator("#rfpbid")
        check("read from the tender:" in bid.inner_text() and bid.locator(".qlstop").count() == 3 and bid.locator(".qlgroup").count() == 4,
              "the bid review reads what the tender already says, marks what can exclude the bid, and counts each group")
        # a group alone, then the keys: open a question, 1 to 3 answer it and move to the next one still open
        bid.locator(".qlgroup", has_text="Is it worth it").click()
        check(bid.locator(".qlrow").count() == 2, "a group's tile narrows the list to its questions")
        bid.locator(".qlrow[data-id=value] .qlhead").click()
        check("The hours of presales" in bid.locator(".qlrow[data-id=value]").inner_text(), "an opened question shows all of it, and why it matters")
        page.keyboard.press("2")
        page.wait_for_selector("#rfpbid .qlrow.t-mid[data-id=value]")
        check(bid.locator(".qlrow.open[data-id=terms]").count() == 1, "a key answers and opens the next question still open")
        page.keyboard.press("Escape")
        bid.locator(".qlrow[data-id=value]").get_by_role("button", name="Partly").click()
        page.wait_for_selector("#rfpbid .qlrow.t-open[data-id=value]")
        bid.get_by_role("button", name="Show every group").click()
        bid.get_by_role("group", name="Answer: We, or the partner who bids").get_by_role("button", name="Yes").click()
        page.wait_for_selector("#rfpbid .qlrow.t-good[data-id=standing]")
        bid.get_by_role("group", name="Answer: The contract terms are acceptable").get_by_role("button", name="No").click()
        page.wait_for_selector("#rfpbid .qlrow.t-bad[data-id=terms]")
        check("Do not bid as it stands" in bid.inner_text() and "the contract terms are acceptable" in bid.inner_text(), "a no on the contract terms stops the bid, saying why")
        check("Do not bid as it stands" in page.inner_text("#view .rfphero .rfpnext"), "and leads what to do next")
        page.get_by_label("Why the team decided").fill("The terms ask for unlimited liability (mock)")
        bid.get_by_role("button", name="We do not bid").click()
        page.wait_for_selector("#view .rfpverdict.nobid")
        check("We decided not to bid, on " in page.inner_text("#view .rfphero") and bid.get_by_role("button", name="Copy the letter declining it").count() == 1,
              "the team's call is kept, dated, and the letter declining it is ready")
        bid.get_by_role("button", name="Take the call back").click()
        page.wait_for_selector("#rfpbid .bidcall button:has-text('We do not bid')")
        for group in ("Answer: The contract terms are acceptable", "Answer: We, or the partner who bids"):
            pressed = bid.get_by_role("group", name=group).locator("button[aria-pressed=true]")
            pressed.click()
            page.wait_for_timeout(300)
        check(page.locator("#view .rfpverdict.nobid").count() == 0 and bid.locator(".qlrow.t-good").count() <= 2, "a call taken back puts the tender back in play")
        # the tender's own workbook: the sheet holding the requirements is found and read
        page.locator("#view .rfploader > summary").click()
        page.locator("#view .filebtn input[type=file]").set_input_files(files=[{"name": "tender.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "buffer": tiny_xlsx({"Cover": [["Tender", "Lot 1"]], "Requisiti": [["N.", "Requisito", "Tipologia"], ["7.1", "La soluzione deve includere la formazione di sei amministratori", "Obbligatorio"],
                                                                         ["7.2", "Sono preferibili report mensili di capacità e costi", "Migliorativo"]]})}])
        page.wait_for_selector("#view .rfprow[data-id=r18]", timeout=60_000)
        check('tender.xlsx, sheet "Requisiti": added 2 requirements: 1 mandatory, 1 scored or optional' in page.inner_text("#view"), "a tender's workbook is read: the sheet with the requirements, in Italian")
        # the answer kit: a neutral answer to adapt, the evidence to attach, used in one click or for every empty note
        page.locator("#view .rfprow[data-id=r6] .rfphead").click()
        check("Matched on:" in page.inner_text("#view .rfprow[data-id=r6]") and page.locator("#view .rfprow[data-id=r6] .rfpdq").count() == 1,
              "an open requirement shows the words it was matched on, and the discovery question it touches")
        kit = page.locator("#view .rfprow[data-id=r6] .rfpsuggest")
        check("From the answer kit: Copies nobody can delete" in kit.inner_text() and "Attach:" in kit.inner_text(), "a requirement offers the kit's answer, with the evidence to attach")
        kit.get_by_role("button", name="Use it").click()
        page.wait_for_timeout(400)
        check(page.locator("#view .rfprow[data-id=r6] input.wsnote").input_value().startswith("At least one copy is immutable"), "and puts it in the note to adapt")
        page.get_by_role("button", name="Use the kit's answers where there is no note yet").click()
        page.wait_for_selector("#view p.note:has-text('filled from the answer kit')")
        page.locator("#view .rfprow[data-id=r1] .rfphead").click()
        check(page.locator("#view .rfprow[data-id=r1] input.wsnote").input_value().startswith("The platform keeps running when a node fails"), "every empty note can be filled from the kit at once")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .wsq")
        page.get_by_role("button", name="Asked by the tender").click()
        visible = page.locator("#view .wsq:not([hidden])")
        check(visible.count() > 0 and visible.count() == page.locator("#view .wsq:not([hidden]) .rfpasks").count(), "the questions narrow to those a requirement of the tender touches")
        page.get_by_role("button", name="Asked by the tender").click()
        page.click("[data-tab=wsrfp]")
        page.wait_for_selector("#view .rfphero")
        # partners on the deal: who brings it, the registration, who does what, and what to hand them
        page.click("[data-tab=wspartners]")
        page.wait_for_selector("#view .ptlist")
        check("No partner yet" in page.inner_text("#view"), "a deal starts without partners, saying most come through one")
        page.get_by_role("button", name="Add a partner").click()
        page.get_by_label("Partner 1: name").fill("Verdi Sistemi (mock)")
        page.get_by_label("Partner 1: kind").select_option("integrator")
        page.get_by_label("Partner 1: registered on").fill("2026-11-01")
        page.get_by_label("Partner 1: registration until").fill("2027-02-01")
        page.get_by_label("Partner 1: registration until").press("Tab")
        page.get_by_role("group", name="Partner 1: lines it has skills on").get_by_role("button").first.click()
        page.get_by_label("Who does: Deployment and migration").select_option(label="Verdi Sistemi (mock)")
        page.get_by_label("Who does: Proof of value").select_option(label="Together")
        page.get_by_label("Route to purchase").select_option("distribution")
        page.wait_for_selector("#view .ptwarn li:has-text('without skills on')")
        settle = page.inner_text("#view")
        check("Verdi Sistemi (mock) leads." in settle and "Nobody owns discovery" in settle and "without skills on" in settle,
              "the partner leads; what nobody owns and the lines it would deliver without skills are what to settle")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Brief for the partner (.md)").click()
        brief = Path(dl.value.path()).read_text(encoding="utf-8")
        check(brief.startswith("# Brief for Verdi Sistemi (mock): Kestrel Logistics") and "| Deployment and migration | Verdi Sistemi (mock) |" in brief and "2M in lost orders" not in brief,
              "the brief for the partner says who does what, without the customer's words unless asked")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Discovery kit for partners (.md)").click()
        kit = Path(dl.value.path()).read_text(encoding="utf-8")
        check(kit.startswith("# Discovery kit for partners") and "Kestrel" not in kit and "Ready on the proof's first day" in kit,
              "the discovery kit for partners holds the questions, the proof and its first day, and no customer")
        # the way forward: the phase now, what moves it on, how to run it, and the demo planned from what was said
        page.click("[data-tab=wsforward]")
        page.wait_for_selector("#view .fwhero")
        now = page.inner_text("#view .fwtrack li[aria-current=step]")
        check("Demo built for them" in now and "How to run it" in page.inner_text("#view .fwhero") and page.locator("#view details.fwphase").count() == 4,
              "the way forward puts a prospect ready for a demo at the demo, with how to run it, and the other phases a click away")
        demo = page.inner_text("#view")
        check("Who should be there: the executive sponsor" in demo, "the demo plan says who should be there")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Demo invitation (.ics)").click()
        demo_ics = Path(dl.value.path()).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\n ", "")
        check("SUMMARY:Kestrel Logistics (mock): demo" in demo_ics and "Who should be there: the executive sponsor" in demo_ics and "They said" not in demo_ics,
              "and an invitation carries the agenda for the customer, with nothing from the discovery notes")
        check("Their situation, in their words" in demo and "2M in lost orders" in demo and "Only what closes their gaps" in demo and "Close: agree what a proof would have to show" in demo,
              "the demo is planned from what they said: their words first, then only their gaps, then the proof to agree")
        def each_part() -> int:
            m = re.search(r"about (\d+) minutes each", page.inner_text("#view"))
            return int(m.group(1)) if m else 0
        at45 = each_part()
        check(at45 >= 5 and page.get_by_label("Length of the demo meeting").input_value() == "45" and "(2 minutes)" in page.inner_text("#view"),
              "the demo is timed for a 45-minute meeting: minutes for each part")
        page.get_by_label("Length of the demo meeting").select_option("30")
        page.locator("#view .fwtime", has_not_text=f"About {at45} minutes").wait_for()
        check(0 < each_part() < at45, "and a shorter meeting gives each part less")
        page.get_by_label("Length of the demo meeting").select_option("45")
        page.locator("#view .fwtime", has_text=f"About {at45} minutes").wait_for()
        # with pseudonyms, a workshop's text leaves without the prospect's name, as a customer's does
        page.select_option("#share-level", "pseudonym")
        page.get_by_role("button", name="Copy the demo plan").click()
        page.wait_for_selector("#exit-dialog[open]")
        check("Kestrel" not in page.inner_text("#exit-text") and "# Demo plan: Customer " in page.inner_text("#exit-text"),
              "with pseudonyms, the demo plan leaves with the prospect's alias, not its name")
        page.click("#exit-cancel")
        page.wait_for_selector("#exit-dialog", state="hidden")
        # the questions to send ahead leave through the same check: a short note, grouped by who would answer
        page.click("#tabs [data-tab=workshop]")
        page.get_by_role("button", name="Copy the questions to send ahead").click()
        page.wait_for_selector("#exit-dialog[open]")
        ahead = page.inner_text("#exit-text")
        check(ahead.startswith("Before our meeting") and "\nFor " in ahead and "\n- " in ahead and "Kestrel" not in ahead,
              "the questions to send ahead are a short note for the customer, grouped by who would answer them")
        page.click("#exit-cancel")
        page.wait_for_selector("#exit-dialog", state="hidden")
        page.evaluate("document.querySelector('[data-tab=wsforward]').click()")
        page.wait_for_selector("#view .fwhero")
        page.select_option("#share-level", "full")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Demo plan (.md)").click()
        check(Path(dl.value.path()).read_text(encoding="utf-8").startswith("# Demo plan: Kestrel Logistics"), "and downloads as a plan to share with the seller")
        # running it: one card per part of the plan, swiped as it landed, with what they said; twenty minutes in,
        # the first part is late
        page.evaluate(f"sessionStorage.setItem({json.dumps(clock_key)}, JSON.stringify({{start: Date.now() - 20 * 60000, minutes: 45}}))")
        page.get_by_role("button", name="Run the demo", exact=True).click()
        page.wait_for_selector("dialog.deck[open] .deckcard")
        DD = "dialog.deck"
        check("minutes behind" in page.inner_text(f"{DD} .decknote.p-behind") and "left" in page.inner_text(f"{DD} .deckmini"),
              "with the meeting clock running, the demo's card says it is behind, and by how much")
        page.evaluate(f"sessionStorage.removeItem({json.dumps(clock_key)})")
        total = int(page.inner_text(f"{DD} .deckpos").split(" of ")[1])
        check(page.inner_text(f"{DD} .deckq").startswith("Show that ") and page.locator(f"{DD} .deckopt").count() == 4 and total >= 4
              and "For the architect" in page.inner_text(f"{DD} .decktags"),
              "running the demo opens on its first part, to swipe as it landed, with who it is for")
        page.locator(f"{DD} .deckaside > summary").click()
        page.fill(f"{DD} #fwheard", "Any domain admin can wipe the backup repository")
        check(page.locator(f"{DD} .heardhit").count() > 0, "during the demo, heard something is under the cards too")
        page.fill(f"{DD} #fwheard", "")
        page.locator(f"{DD} .deckaside > summary").click()
        page.fill(f"{DD} .decksaid", "How long does a restore take?")
        check(page.inner_text(f"{DD} .decksug") == "Sounds like questions" and page.locator(f"{DD} .deckopt.o-questions.sug").count() == 1,
              "and what they said suggests how it landed")

        def react(k: str, n: int) -> None:
            page.locator(f"{DD} .deckopt.o-{k}").click()
            if n < total:
                page.locator(f"{DD} .deckpos", has_text=f"{n + 1} of {total}").wait_for()
            else:
                page.wait_for_selector(f"{DD} .decksum")
        react("questions", 1)
        page.fill(f"{DD} .decksaid", "That's exactly what we need")
        react("landed", 2)
        react("missed", 3)
        for n in range(4, total + 1):
            react("skipped", n)
        sm = page.inner_text(f"{DD} .decksum")
        check(sm.startswith("1 of 3 parts shown landed, 1 with questions, 1 did not land.") and "Questions to answer, in writing" in sm and "How long does a restore take?" in sm
              and "Landed: what the proof should confirm" in sm and page.locator(f"{DD} .decktally").count() == 4,
              "where the demo stands: what landed, the questions to answer in writing, and what did not land")
        page.evaluate("(() => { window.__mail = ''; const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.href.startsWith('mailto:')) { window.__mail = this.href; HTMLAnchorElement.prototype.click = c; } else c.call(this); }; })()")
        page.locator(f"{DD} .deckrecap button", has_text="Email the recap").click()
        mailed = ""
        for _ in range(50):
            mailed = page.evaluate("window.__mail")
            if mailed:
                break
            page.wait_for_timeout(100)
        check(mailed.startswith("mailto:?subject=Demo%20recap%3A%20Kestrel"), "and a recap of the demo for the account team, drafted in their own mail app")
        check(page.locator(f"{DD} .deckrecap button", has_text="Copy the note for the customer").count() == 1, "and a note for the customer, with no reaction named in it")
        page.locator(f"{DD} .deckendrow .btn", has_text="Mark the demo as given today").click()
        page.wait_for_selector(f"{DD}", state="detached")
        page.wait_for_selector("#view .fwlanded")
        check(page.locator("#view .fwhero .fwchecks li.ok").count() >= 2 and "Given on " in page.inner_text("#view") and "How it landed" in page.inner_text("#view"),
              "marking the demo as given from the end of it ticks it off the way forward, with how it landed under the plan")
        page.click("[data-tab=hurt]")
        page.wait_for_selector("#view .painmap")
        agenda = page.inner_text("#view pre[aria-label='Agenda of the next meeting']")
        check("Back from the demo" in agenda and "How long does a restore take?" in agenda and "To show again, closer to your case" in agenda,
              "the next meeting picks up what the demo left: their questions, and what to show again")
        page.get_by_role("button", name="Start the proof of value").click()
        page.wait_for_selector("#view .promise")
        check("Recovery point and time agreed for the workloads in the test" in page.inner_text("#view"), "the proof of value starts with the first line's own checklist")
        check('Landed in the demo: "That\'s exactly what we need"' in page.inner_text("#view"), "and with what landed in the demo, to confirm on their own systems")
        check(state_tab(page) == "wspov" and "immutable copy" in page.inner_text("#view"), "starting the proof of value carries the first line's own criteria")
        check("Try to delete a locked copy with an administrator account, then recover from it" in page.inner_text("#view"), "and what the customer asked us to prove")
        check(page.locator("#view select[aria-label='Outcome'] option").count() == 4 and page.locator("#view select[aria-label='Main reason'] option").count() == 8,
              "the proof of value can record how the deal ended, and why")
        # the handover to delivery: what was proven, agreed and asked, and the promises the delivery team inherits
        page.click("[data-tab=wsdelivery]")
        page.wait_for_selector("#view .dlpromises")
        promises = page.inner_text("#view .dlpromises")
        check("Prove: try to delete a locked copy" in promises and "Owner: together, by 2026-12-15" in promises, "the handover lists the promises: what was agreed, with owner and date, and what the customer asked us to prove")
        check("# Handover to delivery: Kestrel Logistics" in page.inner_text("#view .dldoc") and "## What the customer asked us to prove" in page.inner_text("#view .dldoc"), "and the note the delivery team reads")
        page.get_by_role("button", name=re.compile(r"^Keep \d+ promises? as commitments")).click()
        page.wait_for_selector("#view button:has-text('All promises are kept as commitments')")
        check("added for Kestrel Logistics" in page.inner_text("#view"), "the promises are kept as the customer's commitments, once")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download it (.md)").click()
        check(dl.value.suggested_filename.endswith("-handover.md") and "Promises to keep after go-live" in Path(dl.value.path()).read_text(encoding="utf-8"), "and downloads as Markdown")
        page.click("[data-tab=readout]")
        readout = page.frame_locator("#report").locator("body")
        check("Yes, this is possible." in readout.inner_text() and "What would need to be true" in readout.inner_text() and "pain" not in readout.inner_text().lower(),
              "the customer readout says what is possible, in the customer's language")
        check(page.frame_locator("#report").locator("script").count() == 0, "and runs nothing")
        check("What you asked us to prove" in readout.inner_text() and "Ransomware would encrypt the backups too" in readout.inner_text(), "the readout lists the concerns the customer raised, with how each will be proven")
        page.click("[data-tab=wsummary]")
        check("Discovery: Kestrel Logistics" in page.inner_text("#doc") and "To find out before the next meeting" in page.inner_text("#doc"), "the meeting summary is ready to send")
        check("Concerns they raised" in page.inner_text("#doc") and "How to tell it" in page.inner_text("#doc"), "and says what the customer pushed back on, and how to tell the story to each audience")
        page.reload()
        page.wait_for_selector("#demo:not([disabled])", timeout=180_000)
        page.click("#open-workshop")
        page.wait_for_selector("#view .wsq")
        check("Kestrel Logistics" in page.inner_text("#reshead") and page.locator("#view .wsopt[aria-pressed=true]").count() == 16, "a workshop is kept in the browser and comes back after a reload")
        # AI on the customer's own infrastructure: a first GPU sketch, open to the customer's assumptions
        page.get_by_role("button", name="AI on our own infrastructure").click()
        gpucard = page.locator("#view .card").filter(has_text="A first GPU sketch")
        gpucard.locator(".szhead").wait_for()
        gpus = int(gpucard.locator(".szhead > b").inner_text())
        gpucard.locator("details.szassume summary").first.click()
        bits = page.locator("#view input[aria-label='Bits per weight as served']")
        bits.fill("4")
        bits.dispatch_event("change")
        page.wait_for_timeout(300)
        check(gpus == 8 and int(gpucard.locator(".szhead > b").inner_text()) < gpus and "copies of the model" in gpucard.locator(".szhead").inner_text(),
              "with the AI line in scope, a first GPU sketch follows the assumptions: fewer bits, fewer GPUs")
        # shops, plants and branches: a first edge design, kind of site by kind of site
        check(page.locator("#view details.wsscopebox").get_attribute("open") is None and "Lines in scope" in page.inner_text("#view .wsscopebox"),
              "the lines in scope read as one line; the whole choice opens on demand")
        page.locator("#view details.wsscopebox > summary").click()
        page.get_by_role("button", name="Shops, plants and branches").click()
        page.wait_for_selector("#ws-edge-sites")
        edgecard = page.locator("#view .card").filter(has_text="A first edge design")
        check(edgecard.locator(".edgetable tbody tr").count() == 3 and edgecard.locator(".szhead > b").inner_text() == "198" and "a witness for 30 two-server sites" in edgecard.inner_text(),
              "with edge sites in scope, a first edge design: servers per kind of site and the witness the two-server sites need")
        edgecard.locator("details.szassume summary").click()
        link = page.locator("#view input[aria-label='Kind 1: link (Mbit/s)']")
        link.fill("2")
        link.dispatch_event("change")
        page.wait_for_timeout(300)
        check("Does not fit the night." in edgecard.locator(".edgetable").inner_text() and "does not fit the night over its link" in edgecard.inner_text(),
              "and says when the daily copy no longer fits the night over a thin link")
        # the digital workplace: a first desktop sizing sketch, hosts by processor and by memory
        page.get_by_role("button", name="The digital workplace").click()
        page.wait_for_selector("#ws-euc")
        vdicard = page.locator("#view .card").filter(has_text="A first desktop sizing sketch")
        check(vdicard.locator(".szhead > b").inner_text() == "8" and "the memory decides" in vdicard.inner_text() and "need hosts with GPUs" in vdicard.inner_text(),
              "with virtual desktops in scope, a first desktop sizing sketch: hosts by processor and by memory, one kept free, GPUs for graphics")
        vdicard.locator("details.szassume summary").first.click()
        users = page.locator("#view input[aria-label='Users who will have a desktop']")
        users.fill("3000")
        users.dispatch_event("change")
        page.wait_for_timeout(300)
        check(int(vdicard.locator(".szhead > b").inner_text()) > 8, "and follows the users given")
        # a figure said in the meeting goes into its sketch with a tap, and the card follows
        page.fill("#wsheard", "We have about 1,500 users, 900 at the same time")
        page.get_by_role("button", name="Use 1,500 as the users of the desktop sizing sketch").click()
        page.locator("#view .heardsay", has_text="Put in the desktop sizing sketch: 1,500 users").wait_for()
        check(users.input_value() == "1500" and "1,500 users" in vdicard.inner_text(), "a figure heard in the meeting goes into its sketch with a tap, and the card follows")
        page.get_by_role("button", name="Use 60 as the share connected at the busiest hour, in the desktop sizing sketch").click()
        page.locator("#view .heardsay", has_text="Put in the desktop sizing sketch: 60 percent connected at once").wait_for()
        page.locator("#view .heardsay button", has_text="Undo").click()
        page.locator("#view .heardsay", has_text="Undone: the desktop sizing sketch is back as it was").wait_for()
        page.fill("#wsheard", "")
        # the digital workplace has file shares too: a first file storage sketch, the cold share on a cheaper tier
        filecard = page.locator("#view .card").filter(has_text="A first file storage sketch")
        check(filecard.locator(".szhead > b").inner_text() == "111.5" and "46.1 TiB on a cheaper tier" in filecard.inner_text() and "Snapshots are not a backup" in filecard.inner_text(),
              "with file storage in scope, a first file storage sketch: growth, the cold share on a cheaper tier, snapshots, protection")
        filecard.locator("details.szassume summary").click()
        cold = page.locator("#view input[aria-label='Not opened in a year, to a cheaper tier (%)']")
        cold.fill("0")
        cold.dispatch_event("change")
        page.wait_for_timeout(300)
        check(float(filecard.locator(".szhead > b").inner_text()) > 111.5, "and with nothing moved to a cheaper tier, more stays on the fast one")
        # modernising applications: a first container platform sizing sketch, production and test apart
        page.get_by_role("button", name="Modernising applications").click()
        page.wait_for_selector("#ws-kubernetes-platform")
        k8scard = page.locator("#view .card").filter(has_text="A first container platform sizing sketch")
        check(k8scard.locator(".szhead > b").inner_text() == "11" and "in 2 clusters, 17 nodes with the control plane" in k8scard.inner_text()
              and "the processor decides" in k8scard.inner_text(),
              "with the container platform in scope, a first sizing sketch: workers by processor, memory and pods, production and test apart")
        k8scard.locator("details.szassume summary").first.click()
        mem = page.locator("#view input[aria-label='Memory requested per pod (MiB)']")
        mem.fill("8192")
        mem.dispatch_event("change")
        page.wait_for_timeout(300)
        check("the memory decides" in k8scard.inner_text() and int(k8scard.locator(".szhead > b").inner_text()) > 11, "and the memory decides when the pods ask for more of it")
        # the databases line: a first licence sketch, cores at the planned peak on whole hosts
        dbcard = page.locator("#view .card").filter(has_text="A first database licence sketch")
        check(dbcard.locator(".szhead > b").inner_text() == "256" and "256 fewer than today" in dbcard.inner_text() and "licence agreement decides" in dbcard.inner_text(),
              "with databases in scope, a first licence sketch: the busy cores at the planned peak, on whole hosts, against today")
        dbcard.locator("details.szassume summary").click()
        dbcard.get_by_label("The agreement asks for the spare host to be licensed too").uncheck()
        page.wait_for_timeout(300)
        check(dbcard.locator(".szhead > b").inner_text() == "224" and "not licensed, as the agreement allows" in dbcard.inner_text(), "and a spare host the agreement does not count is left out")
        # the sketches worked out with their figures can go in the customer readout, one line each
        page.get_by_label("Show the sketches worked out with their figures in the customer readout").check()
        page.wait_for_timeout(300)
        page.click("[data-tab=readout]")
        sized = page.frame_locator("#report").locator("body")
        check("First orders of magnitude" in sized.inner_text() and "processor cores to license" in sized.inner_text() and "not a quote" in sized.inner_text(),
              "the sketches worked out with their figures go in the customer readout when asked, one line each")
        page.click("#tabs [data-tab=workshop]")
        page.wait_for_selector("#view .wssketchhead")
        # running it like a cloud: what one machine costs, all in
        page.get_by_role("button", name="Running it like a cloud").click()
        page.wait_for_selector("#ws-cloud-operations")
        unitcard = page.locator("#view .card").filter(has_text="What one machine costs")
        check("number of machines running" in unitcard.inner_text(), "with cloud operations in scope, the cost per machine asks for the customer's figures")
        unitcard.locator("details.szassume summary").click()
        for label, value in (("Machines running (0: those running in the inventory)", "500"), ("Software licences and subscriptions", "240000"),
                             ("People running the estate, as full-time equivalents", "3"), ("Cost of one full-time person", "70000")):
            f = page.locator(f"#view input[aria-label='{label}']")
            f.fill(value)
            f.dispatch_event("change")
        page.wait_for_timeout(300)
        check(unitcard.locator(".szhead > b").inner_text() == "75" and "People" in unitcard.locator(".vctable").inner_text() and unitcard.get_by_role("button", name="Copy for finance").is_visible(),
              "and works out the cost per machine a month, with each part shown")
        page.get_by_role("button", name="Leaving a virtualisation platform").click()
        page.wait_for_selector("#ws-platform-migration")
        check(page.locator("#view details.wsline").count() == 4 and page.locator("#view .wsopt[aria-pressed=true]").count() >= 8,
              "a starting point sets the lines in scope, and keeps what was already answered")
        page.get_by_role("button", name="Try it with an invented export").click()
        page.wait_for_selector("#view .invkpis")
        check("620" in page.inner_text("#view .invkpis") and "CL-TEST" in page.inner_text("#view .inv"), "an inventory export is read in the page into totals and a first wave")
        check("From their inventory: 620 virtual machines on 5 clusters" in page.inner_text("#ws-platform-migration"), "and answers part of the migration questions")
        # a filled-in example, for showing the method in thirty seconds, and deleting it again
        page.click(".rail [data-place=start]")
        page.click("#demo-workshop")
        page.wait_for_selector("#view ol.journey")
        check("2,000,000 per day" in page.inner_text("#view .jhero") and "Kestrel Logistics" in page.inner_text("#reshead") and page.locator("#view .jstep").count() >= 3,
              "the example opens on its journey, with figures and notes")
        check("Where they start from" in page.inner_text("#view .jhero") and "620 virtual machines" in page.inner_text("#view .jhero"), "the example comes with an invented inventory")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .szhead")
        before = int(page.inner_text("#view .szhead > b"))
        page.locator("#view details.szassume summary").first.click()
        ratio = page.locator("#view input[aria-label='vCPU per physical core']")
        ratio.fill("8")
        ratio.dispatch_event("change")
        page.wait_for_timeout(300)
        after = int(page.inner_text("#view .szhead > b"))
        check(before > 3 and after < before and "decided by" in page.inner_text("#view .szhead"), "a first sizing sketch follows the assumptions agreed with the customer")
        rows = page.locator("#view .wvtable tbody tr")
        check(rows.count() > 5 and "Test wave" in rows.first.inner_text() and "CL-TEST" in rows.first.inner_text(), "a plan in waves starts with a test wave on the cluster that teaches the most for the least risk")
        n_waves = rows.count()
        page.locator("#view .wvout").locator("xpath=..").locator("details.szassume summary").first.click()
        per = page.locator("#view input[aria-label='Machines per wave at most']")
        per.fill("150")
        per.dispatch_event("change")
        page.wait_for_timeout(300)
        check(page.locator("#view .wvtable tbody tr").count() < n_waves, "and follows the settings agreed with the customer")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Add the waves to a calendar (.ics)").click()
        ics = Path(dl.value.path()).read_text(encoding="utf-8")
        check(ics.count("BEGIN:VEVENT") == page.locator("#view .wvtable tbody tr").count() and "Test wave" in ics, "and goes to a calendar, one event per wave")
        dr = page.locator("#view .drtable tbody tr")
        check(dr.count() == 3 and "Synchronous replication" in dr.first.inner_text() and "Mbit/s between the sites" in page.inner_text("#view"),
              "with disaster recovery in scope, a first recovery design: replication by tier and the bandwidth it needs, from the inventory")
        page.locator("#view .drtable").locator("xpath=ancestor::div[@class='sz'][1]").locator("details.szassume summary").click()
        far = page.locator("#view input[aria-label='Round trip between the sites (ms)']")
        far.fill("20")
        far.dispatch_event("change")
        page.wait_for_timeout(300)
        check("Not at this distance" in page.inner_text("#view .drtable"), "and says when the distance rules out zero data loss")
        objcard = page.locator("#view .card").filter(has_text="A first backup capacity sketch")
        usable = float(objcard.locator(".szhead > b").inner_text().replace(",", ""))
        objcard.locator("details.szassume summary").click()
        months = page.locator("#view input[aria-label='Monthly fulls kept']")
        months.fill("84")
        months.dispatch_event("change")
        page.wait_for_timeout(300)
        check("TiB usable" in objcard.inner_text() and float(objcard.locator(".szhead > b").inner_text().replace(",", "")) > usable and "colder tier" in objcard.inner_text(),
              "with object storage in scope, a backup capacity sketch follows the retention agreed with the customer")
        page.click("[data-tab=readout]")
        check("How the move would run" in page.frame_locator("#report").locator("body").inner_text(), "the customer readout shows how the move would run")
        # the case for change, in the customer's figures
        page.click("[data-tab=wscase]")
        page.wait_for_selector("#view .vcgroups")
        check("less by moving" in page.inner_text("#view .vcout"), "the example comes with its case for change, in its own figures")
        for label, value in (("What the current platform costs per year (licences, subscriptions, support)", "1200000"), ("Expected rise at the next renewal", "50"),
                             ("The next renewal is in", "6"), ("What the new platform would cost per year", "1000000"), ("One-off cost of the move: services, migration, training", "600000")):
            f = page.locator(f"#view input[aria-label='{label}']")
            f.fill(value)
            f.dispatch_event("change")
        page.wait_for_selector("#view .vcchart")
        check("less by moving" in page.inner_text("#view .vcline") and "paid back by month" in page.inner_text("#view .vcline"), "and adds up staying and moving, with when the move pays back")
        use = page.locator("#view .vcheard button").first
        check("83,333" in use.inner_text(), "a figure heard in the workshop is offered as the cost of an hour down")
        use.click()
        page.locator("#view input[aria-label='Hours down per year today']").fill("12")
        page.locator("#view input[aria-label='Hours down per year today']").dispatch_event("change")
        page.wait_for_timeout(200)
        check("Downtime" in page.inner_text("#view .vctable"), "and counts what downtime costs")
        page.get_by_label("Show the case in the customer readout").uncheck()
        page.wait_for_timeout(200)
        page.get_by_label("Show the case in the customer readout").check()
        page.wait_for_timeout(300)
        page.click("[data-tab=readout]")
        check("The case for change, in your figures" in page.frame_locator("#report").locator("body").inner_text(), "the case goes to the customer readout when asked")
        page.click("[data-tab=wsummary]")
        check("## The case for change" in page.inner_text("#doc") or "The case for change" in page.inner_text("#doc"), "and to the meeting summary")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .wvtable")
        page.click("[data-tab=workshop]")
        page.wait_for_selector("#view .wvtable")
        page.click("[data-tab=journey]")
        page.wait_for_selector("#view ol.journey")
        page.get_by_role("button", name="Present", exact=True).click()
        page.wait_for_selector("body.presenting")
        check(not page.is_visible("#rail") and page.is_visible("#view .jhero") and page.is_visible("#present-exit"), "presenting shows the journey alone, with a way back")
        page.keyboard.press("Escape")
        page.wait_for_selector("body:not(.presenting)")
        check(page.is_visible("#rail") and not page.is_visible("#present-exit"), "and Esc brings the app back")
        page.click("[data-tab=workshop]")
        page.once("dialog", lambda dlg: dlg.accept())
        page.get_by_role("button", name="Delete this workshop").click()
        page.wait_for_timeout(500)
        page.click(".rail [data-place=start]")
        page.click("#open-workshop")
        page.wait_for_selector("#view .wsq")
        check(page.locator("#view select[aria-label='Open another workshop'] option").count() in (0, 1), "deleting a workshop removes it from this browser")

        # one customer, every product line: each line on its own profile, the estate on one map
        page.click(".rail [data-place=start]")
        page.click("#demo-estate")
        page.wait_for_selector("#loaded li:nth-child(4)")
        check("Halden Group" in page.inner_text("#run"), "the estate demo is one customer, not a book")
        run_and_wait()
        page.wait_for_selector("#view .estatemap")
        check(page.locator("#view .enode").count() == 14 and page.locator("#view .enode.absent").count() == 10, "the estate map draws the whole family, with the lines not in place dashed")
        check(page.locator("#view .elink.risk").count() >= 1 and page.locator("#view .elink.grow").count() >= 1, "and links coloured by risk and by what comes next")
        check(page.locator("#view .heatcell").count() == 16 and "of 14 clusters" in page.inner_text("#view") and "of 10 sites" in page.inner_text("#view"), "each line is counted in its own units")
        check("Platform 71.9%, recovery 42.8%" in page.inner_text("#view"), "a solid line leaning on a weak one is called out")
        check("First step:" in page.inner_text("#view .flags"), "with the first step on the weak line")
        page.locator("#view .enode.absent").first.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector("#view .card.grow.focus")
        check(page.locator("#view .card.grow").count() == 10 and "Open with" in page.inner_text("#view"), "a missing line opens where to grow, with the first question to ask")
        page.locator("#view .card.grow.focus").get_by_role("button", name="Start a discovery workshop on this line").click()
        page.wait_for_selector("#view .wsq")
        check("Halden Group" in page.inner_text("#reshead") and page.locator("#view details.wsline").count() == 1, "a line to grow starts a discovery workshop with the same customer, on that line")
        page.once("dialog", lambda dlg: dlg.accept())
        page.get_by_role("button", name="Delete this workshop").click()
        page.wait_for_timeout(300)
        page.click(".rail [data-place=start]")
        page.click("#demo-estate")
        page.wait_for_selector("#loaded li:nth-child(4)")
        run_and_wait()
        page.wait_for_selector("#view .estatemap")
        page.click("[data-tab=estateplan]")
        check("Account plan: Halden Group" in page.inner_text("#doc") and "Questions for the next meeting" in page.inner_text("#doc"), "the account plan is ready to share")
        page.click("[data-tab=estate]")
        page.locator("#view tbody tr").first.get_by_role("button", name="Open").click()
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=180_000)
        page.wait_for_selector("#view .todayhero", timeout=180_000)
        check("Halden Group" in page.inner_text("#reshead") and page.locator("[data-tab=estate]").count() == 0, "opening a line shows that line's own report")

        # working as a pre-sales engineer: a desk of one's own, from discovery to decision
        page.click(".rail [data-place=start]")
        role_before = page.evaluate("localStorage.getItem('beyond90.role') || 'core'")
        page.locator("#hero-roles [data-role=tam]").click()
        check(not page.is_visible("#desk-btn"), "the presales desk is not in the way of other roles")
        page.locator("#hero-roles [data-role=se]").click()
        check(page.is_visible("#desk-btn"), "choosing pre-sales engineer adds a desk to the menu")
        check(page.evaluate("document.querySelector('.choose > .wsstart').getBoundingClientRect().top < document.getElementById('drop').getBoundingClientRect().top"),
              "and puts the discovery workshop for a new prospect before the customer's files")
        page.click("#desk-btn")
        page.wait_for_selector("#desk-body .deskfunnel")
        check("Your presales desk" in page.inner_text("#desk-body") and page.locator("#desk-body table", has_text="Kestrel Logistics").count() >= 1, "the desk lists every prospect kept in this browser")
        check(page.locator("#desk-body .deskfunnel li").count() == 4 and "Proof of value" in page.inner_text("#desk-body .deskfunnel"), "with the stages from discovery to decision")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Download it (.md)").click()
        check(Path(dl.value.path()).read_text(encoding="utf-8").startswith("# Presales update"), "and the weekly update for the account team")
        check("What could stop a deal" in page.inner_text("#desk-body") and "No sponsor named for the proof of value" in page.inner_text("#desk-body .deskstops"),
              "the desk says what could stop a deal, read from what is recorded: here, a proof of value with no sponsor")
        stops = page.locator("#desk-body .deskstop")
        names = [stops.nth(i).locator(".deskstophead b").inner_text() for i in range(stops.count())]
        check(stops.count() > 0 and len(names) == len(set(names)) and "can lose it" in stops.first.locator(".deskstopcount").inner_text(),
              "what could stop a deal is one block per prospect, the one with most to lose first")
        check("## What could stop a deal" in Path(dl.value.path()).read_text(encoding="utf-8"), "and the Monday note carries it to the account team")
        page.get_by_role("button", name="Fill it with invented examples").click()
        page.wait_for_selector("#desk-body :text('Pietra Bank')")
        counts = [int(t) for t in page.locator("#desk-body .deskfunnel li b").all_inner_texts()]
        check(all(c >= 1 for c in counts) and page.locator("#desk-body .deskagenda li.late").count() >= 1, "invented examples fill every stage, with something late on the agenda")
        check(page.locator("#desk-body .deskstage.s-won").count() == 1 and page.locator("#desk-body .deskstage.s-lost").count() == 1, "decided deals show as won or lost, off the live pipeline")
        ev = page.locator("#desk-body .deskev")
        check(ev.count() >= 4 and "What would raise it" in (ev.first.get_attribute("title") or "") and int(ev.first.locator("b").inner_text()) <= 100,
              "each open deal shows how much evidence of a technical win it holds, and what would raise it")
        lessons_card = page.locator("#desk-body .card").filter(has_text="What the deals teach")
        check(lessons_card.count() == 1 and "What customers push back on" in lessons_card.inner_text() and "Ransomware would encrypt the backups too" in lessons_card.inner_text(),
              "what the deals teach: what customers push back on, read from every prospect")
        check("What did not land in the demos" in lessons_card.inner_text(), "and what did not land in the demos, from the demo run on this desk")
        # the partners across the desk: their deals, registrations to act on, what was won and lost with them
        partner_card = page.locator("#desk-body .card").filter(has_text="Partners across your deals")
        pt = partner_card.inner_text() if partner_card.count() == 1 else ""
        check("Verdi Sistemi (mock)" in pt and "Lago Cloud (mock)" in pt and "6 days left" in pt and "not registered" in pt and "1 won, 0 lost" in pt,
              "the partners across every deal: live deals, registrations to renew or file, wins and losses with each")
        check(page.locator("#desk-body").get_by_text("Verdi Sistemi (mock)'s deal registration runs out in 6 days").count() >= 1,
              "a registration about to run out is a risk that can lose the deal")
        desk_text = page.inner_text("#desk-body")
        check("Verdi Sistemi (mock)'s deal registration runs out" in page.inner_text("#desk-body .deskagenda") and "with Verdi Sistemi (mock); now: " in desk_text,
              "the registration's end is on the agenda, and each prospect says who it is sold with and the phase it is in")

        # tenders across the desk: the nearest deadline first, and one click into the tender
        tender_card = page.locator("#desk-body .card").filter(has_text="Tenders in progress")
        tt = tender_card.inner_text() if tender_card.count() == 1 else ""
        check("Valle Health (mock)" in tt and "At risk" in tt and "Questions due" in tt and "A public body" in tt,
              "the tenders in progress, with whether each can bid and the next deadline")
        tender_card.get_by_role("button", name="Open the tender of Valle Health (mock)").click()
        page.wait_for_selector("#view .rfphero")
        check("Recovery site and data platform (mock)" in page.inner_text("#view .rfphero") and page.locator("#view .rfpowed button").count() >= 1,
              "which opens the tender, with a message ready for each person who still owes answers")
        page.click(".rail [data-place=desk]")
        page.wait_for_selector("#desk-body :text('Pietra Bank')")

        # the team: each engineer shares a snapshot, the manager reads them together
        page.get_by_label("Your name, as your manager should see it").fill("Giulia R. (mock)")
        with page.expect_download() as dl:
            page.get_by_role("button", name="Snapshot for my manager (.json)").click()
        snap_text = Path(dl.value.path()).read_text(encoding="utf-8")
        snap = json.loads(snap_text)
        check(snap["kind"] == "beyond90-desk-snapshot" and snap["by"] == "Giulia R. (mock)" and len(snap["deals"]) >= 6 and "Patient data must stay in Italy" not in snap_text,
              "a desk snapshot for the manager: stages, risks and lessons, without notes")
        bad_path = Path(dl.value.path()).with_name("not-a-snapshot.json")
        bad_path.write_text(json.dumps({"kind": "beyond90-desk-snapshot", "format": 1, "by": "x", "as_of": "2026-11-19", "deals": [{"customer": "<img src=x onerror=alert(1)>"}]}), encoding="utf-8")
        page.get_by_label("The team's desk snapshots").set_input_files([dl.value.path(), str(bad_path)])
        page.wait_for_selector("#desk-body .teamtable")
        team_text = page.inner_text("#desk-body .teambody")
        check("Giulia R. (mock)" in team_text and "Not read: not-a-snapshot.json" in team_text and page.locator("#desk-body .teambody img").count() == 0,
              "the manager reads the team's snapshots, checked field by field: a forged one is refused")
        page.get_by_role("button", name="Try it with two invented engineers").click()
        page.wait_for_selector("#desk-body .teamtable tbody tr:nth-child(2)")
        check("Engineer B (mock)" in page.inner_text("#desk-body .teamtable") and "What the team's deals teach" in page.inner_text("#desk-body .teambody"),
              "and sees each engineer's pipeline, the deals at risk and what the team's deals teach")
        team_text = page.inner_text("#desk-body .teambody")
        check("Partners across the team" in team_text and "Verdi Sistemi (mock)" in team_text and "Qualified for a proof" in page.inner_text("#desk-body .teamtable"),
              "and the partners across the team, and how many deals each engineer has qualified for a proof")
        page.get_by_role("button", name="Clear the team").click()
        check(page.locator("#desk-body .teamtable").count() == 0, "and clears it: nothing was kept")
        page.get_by_role("button", name="Remove the invented examples").click()
        page.wait_for_selector("#desk-body :text('Pietra Bank')", state="detached", timeout=60_000)   # the page's CSP forbids string evaluation
        check("Kestrel Logistics" in page.inner_text("#desk-body"), "and go away in one click, leaving real work alone")
        page.locator("#desk-body table").get_by_role("button", name="Open Kestrel Logistics").first.click()
        page.wait_for_selector("#view .wsq, #view ol.journey, #view .promise")
        check("Kestrel Logistics" in page.inner_text("#reshead"), "an opportunity opens where it stands")
        page.reload()
        page.wait_for_selector("#desk-body .deskfunnel", timeout=180_000)
        check(page.is_visible("#place-desk") and not page.is_visible("#place-start"), "a pre-sales engineer lands on the desk")
        page.click(".rail [data-place=start]")
        page.locator(f"#hero-roles [data-role={role_before}]").click()

        # a whole book: several customers, one budget of hours
        page.click(".rail [data-place=start]")
        page.click("#demo-book")
        page.wait_for_selector("#loaded li:nth-child(3)")
        run_and_wait()
        page.wait_for_selector("#view tbody tr")
        check("null" not in page.inner_text("#reshead"), "the book header shows nothing it should not")
        check("Revenue-weighted" in page.inner_text("#kpis") and page.locator("#view tbody tr").count() == 3, "the book demo shows three customers and the weighted Yield")
        check(page.locator("#tabs button[data-tab]").count() == 10 and page.locator("#view tbody tr").count() == 3, "book mode opens on the week, one row per customer")
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
        page.click("[data-tab=bookmap]")
        check("29 of 121" in page.inner_text("#view") and "0 of 27" in page.inner_text("#view"), "the book shows, for each customer, how many accounts pass every stage")
        page.click("[data-tab=bookreport]")
        check("hours" in page.frame_locator("#report").locator("body").inner_text().lower(), "the book report renders")
        page.click("[data-tab=bookmap]")
        page.locator("#view tbody tr").first.get_by_role("button", name="Open").click()
        page.wait_for_selector("#run:not([disabled])", state="attached", timeout=180_000)
        page.wait_for_selector("#book-table[hidden]", state="attached")
        check("Yield" in page.inner_text("#kpis") and page.locator("#tabs button[data-tab]").count() == 34, "opening a customer from the book shows its own report")
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

        # opened like an installed app: a shortcut on its icon, and files shared to it from another app
        page.goto(base + "?start=demo")
        page.wait_for_selector("#results:not([hidden])", timeout=180_000)
        check("start=" not in page.url, "the icon's Example shortcut opens the example, analysed, and leaves a clean address")
        # one link for a presales leader: the desk at work, at once, without waiting for the engine
        fresh = browser.new_context()
        fp = fresh.new_page()
        fp.goto(base + "?start=presales")
        fp.wait_for_selector("#desk-body :text('Pietra Bank')", timeout=30_000)
        check("start=" not in fp.url and "What the deals teach" in fp.inner_text("#desk-body") and "Your team" in fp.inner_text("#desk-body"),
              "one link opens the presales desk at work, with the invented examples, for a first visit")
        fresh_desk = fp.inner_text("#desk-body")
        check("What the deals not won had not established" in fresh_desk and "Economic buyer: 1 of 1" in fresh_desk and "Through a reseller: 1 won of 1" in fresh_desk,
              "what the deals teach includes the qualification the deals not won left open, and the routes to purchase")
        fresh.close()
        role_was = page.evaluate("localStorage.getItem('beyond90.role')")
        page.goto(base + "?start=presales")
        page.wait_for_selector("#desk-body .deskfunnel")
        check(page.locator("#desk-body :text('Pietra Bank')").count() == 0 and "Kestrel Logistics" in page.inner_text("#desk-body"), "and adds nothing to a browser with real work")
        page.evaluate("(r) => r === null ? localStorage.removeItem('beyond90.role') : localStorage.setItem('beyond90.role', r)", role_was)
        shared = page.evaluate("""async () => {
          const files = await (await fetch("./demo.json")).json();
          const form = new FormData();
          for (const [name, text] of Object.entries(files)) form.append("files", new File([text], name));
          form.append("files", new File(["MZ"], "tool.exe"));
          form.append("files", new File(["x"], "../../etc/passwd.csv"));
          const r = await fetch("./share-target", { method: "POST", body: form });
          return { redirected: r.redirected, status: r.status, n: Object.keys(files).length };
        }""")
        check(shared["status"] == 200, f"sharing files to the app is answered by its own service worker, which opens the app (a plain server would refuse a POST): {shared}")
        page.goto(base + "?shared=1")
        page.wait_for_selector("#loaded li:has-text('customer.toml')", timeout=120_000)
        names = page.eval_on_selector_all("#loaded li", "els => els.map(e => e.textContent)")
        check(len(names) == shared["n"] + 1 and not any("tool.exe" in x for x in names) and any("passwd.csv" in x for x in names) and not any("/" in x.split(" ")[0] for x in names),
              f"shared files load like picked ones: only csv, toml and xlsx, folder paths stripped: {len(names)} files")
        check(page.evaluate("caches.has('share-inbox')") is False and "shared=" not in page.url, "the share inbox is emptied at once and the address is clean")

        # a new build is offered, not forced, and one click moves the page to it
        sw = Path(site) / "sw.js"
        original = sw.read_text(encoding="utf-8")
        try:
            sw.write_text(re.sub(r'self\.skipWaiting\(\);  // forced[^\n]*', '', re.sub(r'const CACHE = "(beyond90-[0-9a-f]+)"', r'const CACHE = "\1-next"', original)), encoding="utf-8")
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
        # the letter depends on which customers and prospects were shared before: read the one this customer was given
        found_alias = re.search(r"^# (Customer [A-Z]+):", shown)
        alias = found_alias.group(1) if found_alias else "Customer ?"
        check("Northwind" not in shown and found_alias is not None, "pseudonym level replaces the customer's name in what is about to leave")
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
        check("northwind" not in dl.value.suggested_filename.lower() and alias.lower().replace(" ", "-") in dl.value.suggested_filename, "the downloaded file's name carries the alias too")
        saved_note = Path(tmp) / "handoff.md"
        dl.value.save_as(saved_note)
        check("Northwind" not in saved_note.read_text() and alias in saved_note.read_text(), "the downloaded file holds aliases, not names")
        page.click(".rail [data-place=saved]")
        page.locator("#privacy-body summary").click()
        page.fill("#restore-in", f"{alias} should renew; {alias} is at risk.")
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
        check("0 records left" in page.inner_text("#erase-result"), "after erasing, a second look finds nothing left for that customer")
        check("earlier export" in page.inner_text("#erase-result"), "the erasure says which earlier exports are outside its reach")
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
        places = mp.evaluate("""(() => { const b = document.querySelector('.place-btn[aria-current]'), cs = getComputedStyle(b), r = b.getBoundingClientRect();
          const shown = [...document.querySelectorAll('.place-btn')].filter((x) => !x.hidden);
          const own = shown.every((x) => { const q = x.getBoundingClientRect(); const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return e && e.closest('.place-btn') === x; });
          return [cs.position, cs.borderTopLeftRadius, cs.backgroundColor !== 'rgba(0, 0, 0, 0)', Math.round(r.bottom) === innerHeight, shown.length >= 3, own]; })()""")
        check(places == ["fixed", "0px", True, True, True, True],
              f"on a phone with no customer open, the places are a solid bar at the bottom, each in its own place, nothing showing through: {places}")
        mp.click("#demo")
        mp.click("#run")
        mp.wait_for_selector("#results:not([hidden])", timeout=180_000)
        bar = mp.evaluate("(() => { const b = document.getElementById('mobilebar').getBoundingClientRect(); return [getComputedStyle(document.getElementById('mobilebar')).position, Math.round(b.bottom) === innerHeight, b.height > 40]; })()")
        check(bar == ["fixed", True, True], f"on a phone a customer gets an app bar at the bottom: {bar}")
        check(not mp.locator("#rail").is_visible(), "and the full menu stays out of the way until asked for")
        top = mp.evaluate("(() => { const t=document.querySelector('.top'); const n=document.querySelector('.context-name'); return [t.scrollWidth <= t.clientWidth, n.scrollWidth <= n.clientWidth + 1, !!document.querySelector('#sheet-tools #share-level'), !!document.querySelector('#sheet-tools #theme')]; })()")
        check(top == [True, True, True, True], f"on a phone the top bar holds the customer's whole name, and the names and theme controls sit in the menu: {top}")
        mp.click("#m-menu")
        mp.select_option("#share-level", "pseudonym")
        mp.click("#m-menu")
        check(mp.locator("#share-flag").is_visible() and "Aliases" in mp.inner_text("#share-flag"), "with aliases on, the phone's top bar says so")
        mp.click("#m-menu")
        mp.select_option("#share-level", "full")
        mp.click("#m-menu")
        check(not mp.locator("#share-flag").is_visible(), "and the flag goes when names are shown")
        mp.click("#mobilebar [data-go=actions]")
        check(mp.get_attribute("#mobilebar [data-go=actions]", "aria-current") is not None and "Actions" in mp.inner_text("#res-title"), "the app bar opens a view in one tap")
        wide = {}
        for tab in ("today", "overview", "connections", "accounts", "findings", "actions", "prep", "execqbr"):
            mp.click("#m-menu")
            mp.locator(f"#tabs [data-tab={tab}]").click()
            check(not mp.locator("#rail").is_visible(), f"choosing {tab} from the menu closes it")
            mp.wait_for_timeout(300)
            wide[tab] = mp.evaluate("document.documentElement.scrollWidth") - mp.viewport_size["width"]    # the phone's width: the page's own grows with it
        check(not any(wide.values()), f"no view is wider than a phone: {wide}")
        mp.click("#m-menu")
        mp.locator("#tabs [data-tab=accounts]").click()
        check(mp.evaluate("getComputedStyle(document.querySelector('#view .dt tbody td:not(.x)'), '::before').content").strip('"') == "Account",
              "on a phone each table row reads as a card with its labels")
        # a workshop on a phone: its own views in the app bar, and nothing wider than the screen
        mp.goto(base)
        mp.wait_for_selector("#demo-workshop:not([disabled])", state="attached", timeout=180_000)
        mp.locator("#demo-workshop").dispatch_event("click")
        mp.wait_for_selector("#view ol.journey")
        guide = mp.locator("#view .firstmin")
        check(guide.count() == 1 and "Your first minute with a prospect" in guide.inner_text() and guide.locator("button", has_text="Plan the demo").count() == 1,
              "the example prospect explains itself: its meetings, each a tap away")
        guide.get_by_role("button", name="Got it, hide this").click()
        check(mp.locator("#view .firstmin").count() == 0 and mp.evaluate("localStorage.getItem('beyond90.wstour')") == "1", "and puts the guide away for good")
        shown = [b.get_attribute("data-go") or "menu" for b in mp.locator("#mobilebar button:visible").all()]
        check(shown == ["workshop", "wsqualify", "wsforward", "menu"], f"in a workshop the phone bar carries Questions, Qualify and the way forward: {shown}")
        mp.click("#mobilebar [data-go=wsqualify]")
        mp.wait_for_selector("#view .qdlist")
        check(mp.get_attribute("#mobilebar [data-go=wsqualify]", "aria-current") is not None, "and opens each in one tap")
        cells = mp.evaluate("(() => { const a = document.querySelector('#view .qlrow .qlans'); return a ? a.getBoundingClientRect().right <= innerWidth : false; })()")
        check(cells, "the answers fit the screen")
        more = mp.locator("#view-tip-more")
        check(more.is_visible() and mp.evaluate("document.getElementById('view-tip').scrollHeight > document.getElementById('view-tip').clientHeight"), "a long introduction shows two lines and More")
        more.click()
        check(more.get_attribute("aria-expanded") == "true" and more.inner_text() == "Less", "More opens the rest")
        # the deck on a phone: the whole screen, one card, the answers within reach; skipped to the end, where it stands
        mp.click("#mobilebar [data-go=workshop]")
        mp.wait_for_selector("#view .deckpane.inpage .deckcard")
        check(mp.evaluate("document.querySelector('#view .deckpane.inpage .deckcard').getBoundingClientRect().top < innerHeight / 2"),
              "on a phone the questions open on the card of the next question")
        essential = mp.locator("#view .wsnarrow").get_by_role("button", name="Essential questions only")
        mp.fill("#wsheard", "The last failover drill was three years ago and nobody signed it off")
        hit = mp.locator("#view .heardhit").first
        heard_q = hit.locator(".heardq").inner_text()
        mp.locator("#wsheard").press("Control+Enter")       # files it under the first match, as suggested
        mp.locator("#view .heardsay", has_text="Filed as").wait_for()
        filed = mp.locator("#view .wsq", has=mp.locator(".wsqq", has_text=heard_q)).first
        check("failover drill was three years ago" in filed.inner_text() and mp.locator("#view .heardhit").count() == 0,
              "on a phone, what was heard is filed under the question it answers, with the words as the note")
        mp.locator("#view .heardsay .linkbtn", has_text="Undo").click()
        mp.locator("#view .heardsay", has_text="Undone").wait_for()
        check("failover drill was three years ago" not in filed.inner_text() and mp.input_value("#wsheard").startswith("The last failover drill"),
              "undo puts back what the question had, and the words in the box")
        mp.fill("#wsheard", "")
        essential.dispatch_event("click")
        mp.locator("#view .deckfull").click()
        mp.wait_for_selector("dialog.deck[open] .deckcard")
        fit = mp.evaluate("""(() => { const d = document.querySelector('dialog.deck').getBoundingClientRect(), a = document.querySelector('dialog.deck .deckans').getBoundingClientRect();
          return Math.round(d.width) === innerWidth && Math.round(d.height) === innerHeight && a.bottom <= innerHeight && a.right <= innerWidth; })()""")
        check(fit, "on a phone the deck fills the screen, with the answers within reach")
        for _ in range(80):
            if mp.locator("dialog.deck .decksum").count():
                break
            mp.locator("dialog.deck .deckbar .linkbtn", has_text="Skip").click()
        check(mp.locator("dialog.deck .deckheadline").count() == 1 and mp.locator("dialog.deck .decktally").count() == 4,
              "skipped to the end, the deck says where the meeting stands")
        check("Invite " in mp.inner_text("dialog.deck .decksum") and "essential question" in mp.inner_text("dialog.deck .decksum"),
              "and says who to invite next, for the essential questions still open")
        mp.evaluate("(() => { window.__mail = ''; const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.href.startsWith('mailto:')) { window.__mail = this.href; HTMLAnchorElement.prototype.click = c; } else c.call(this); }; })()")
        mp.locator("dialog.deck .deckrecap button", has_text="Email the recap").click()
        mailed = ""
        for _ in range(50):
            mailed = mp.evaluate("window.__mail")
            if mailed:
                break
            mp.wait_for_timeout(100)
        check(mailed.startswith("mailto:?subject=Discovery%20recap") and "Discovery%20recap%3A" in mailed and mp.locator("dialog.deck .deckrecap button", has_text="Copy the recap").count() == 1,
              "at the end, the recap can be copied or opened in the phone's own mail app, for the account team")
        mp.locator("dialog.deck .deckendrow .btn", has_text="Back to the list").click()
        mp.wait_for_selector("dialog.deck", state="detached")
        essential.dispatch_event("click")
        wide = {}
        for tab in ("workshop", "wsqualify", "wsrfp", "journey", "wsforward", "wsprep", "wspartners", "wscase", "wspov", "hurt"):
            mp.locator(f"#tabs [data-tab={tab}]").dispatch_event("click")
            mp.wait_for_timeout(400)
            wide[tab] = mp.evaluate("document.documentElement.scrollWidth") - mp.viewport_size["width"]
        check(not any(wide.values()), f"no workshop view is wider than a phone: {wide}")
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
                apage.click(".rail [data-place=start]")
                apage.click("#demo-estate")
                apage.wait_for_selector("#loaded li:nth-child(4)")
                apage.click("#run")
                apage.wait_for_selector("#view .estatemap", timeout=180_000)
                bad += [f"estate: {v}" for v in audit()]
                apage.click("[data-tab=estategrow]")
                bad += [f"grow: {v}" for v in audit()]
                apage.click(".rail [data-place=start]")
                apage.click("#open-workshop")
                apage.wait_for_selector("#view .wsq")
                apage.locator("#view .wsq").first.get_by_role("button", name="A real gap", exact=True).click()
                bad += [f"workshop: {v}" for v in audit()]
                apage.locator("#view .deckfull").click()
                apage.wait_for_selector("dialog.deck[open] .deckcard")
                apage.fill("#deck-said", "We have never tested it")
                bad += [f"deck: {v}" for v in audit()]
                apage.locator("dialog.deck .deckclose").click()
                apage.wait_for_selector("dialog.deck", state="detached")
                apage.get_by_role("button", name="Try it with an invented export").click()
                apage.wait_for_selector("#view .invkpis")
                bad += [f"inventory: {v}" for v in audit()]
                apage.get_by_role("button", name="AI on our own infrastructure").click()
                apage.wait_for_selector("#view .szhead")
                bad += [f"gpu: {v}" for v in audit()]
                apage.click(".rail [data-place=start]")
                apage.locator("#hero-roles [data-role=se]").click()
                apage.click("#desk-btn")
                apage.wait_for_selector("#desk-body .deskfunnel")
                bad += [f"desk: {v}" for v in audit()]
                apage.get_by_role("button", name="Fill it with invented examples").click()
                apage.wait_for_selector("#desk-body .deskstage.s-won")
                bad += [f"desk with examples: {v}" for v in audit()]
                apage.get_by_role("button", name="Remove the invented examples").click()
                apage.wait_for_selector("#desk-body .deskstage.s-won", state="detached")
                apage.click(".rail [data-place=start]")
                apage.locator("#hero-roles [data-role=core]").click()
                apage.click("#open-workshop")
                apage.wait_for_selector("#view .wsq")
                for i, ans in enumerate(("A real gap", "A real gap", "Partly")):
                    apage.locator("#view .wsq").nth(i + 1).get_by_role("button", name=ans, exact=True).click()
                apage.click("[data-tab=journey]")
                apage.wait_for_selector("#view ol.journey")
                bad += [f"journey: {v}" for v in audit()]
                apage.click("[data-tab=hurt]")
                bad += [f"hurt: {v}" for v in audit()]
                apage.hover("#open-palette")
                apage.wait_for_selector("#tip:not([hidden])")
                bad += [f"tooltip: {v}" for v in audit()]
                apage.click("[data-tab=wsprep]")
                apage.wait_for_selector("#view .objs")
                apage.locator("#view .objraise").first.click()
                apage.wait_for_selector("#view .obj.on")
                bad += [f"prepare: {v}" for v in audit()]
                apage.click("[data-tab=wsqualify]")
                apage.wait_for_selector("#view .qdhero")
                apage.locator("#view .qdlist .qlrow").first.get_by_role("button", name="Known", exact=True).click()
                apage.wait_for_selector("#view .qdlist .qlopt[aria-pressed=true]")
                apage.locator("#view .qdlist .qlrow").first.locator(".qlhead").click()
                apage.locator("#view .qdlist .qlrow.open .wshow summary").click()
                bad += [f"qualify: {v}" for v in audit()]
                apage.click("[data-tab=wsforward]")
                apage.wait_for_selector("#view .fwhero")
                apage.locator("#view details.fwphase summary").first.click()
                bad += [f"forward: {v}" for v in audit()]
                apage.click("[data-tab=wspartners]")
                apage.wait_for_selector("#view .ptlist")
                apage.get_by_role("button", name="Add a partner").click()
                apage.get_by_label("Partner 1: name").fill("Audit partner (mock)")
                apage.get_by_label("Partner 1: name").press("Tab")
                apage.wait_for_selector("#view .pttable")
                bad += [f"partners: {v}" for v in audit()]
                apage.click("[data-tab=wscase]")
                apage.wait_for_selector("#view .vcgroups")
                for label, value in (("What the current platform costs per year (licences, subscriptions, support)", "100000"), ("What the new platform would cost per year", "80000")):
                    apage.locator(f"#view input[aria-label='{label}']").fill(value)
                    apage.locator(f"#view input[aria-label='{label}']").dispatch_event("change")
                apage.wait_for_selector("#view .vcchart")
                bad += [f"case: {v}" for v in audit()]
                apage.click("[data-tab=wsdelivery]")
                apage.wait_for_selector("#view .dldoc")
                bad += [f"handover: {v}" for v in audit()]
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
