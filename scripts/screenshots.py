"""Take the pictures used in the README and the docs from the built site, so they always show the app as it is.

    python3 site/build_site.py --out _site --pyodide site/npm/node_modules/pyodide
    python3 scripts/screenshots.py _site docs/img

Needs Playwright with Chromium. Every customer is the invented example data shipped with the repository.
The social card (social-card.png, 1280x640) is for the repository's "Social preview" setting on GitHub.
"""

from __future__ import annotations

import datetime
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

INIT = "localStorage.setItem('beyond90.role','all');localStorage.setItem('beyond90.tour','1');localStorage.setItem('beyond90.rank','effect')"
SINGLE = {"today": "app-today.png", "overview": "app-results.png", "connections": "app-connections.png", "accounts": "app-accounts.png",
          "whatif": "app-whatif.png", "execqbr": "app-execqbr.png", "onboarding": "app-onboarding.png", "outlook": "app-outlook.png",
          "prep": "app-prep.png", "pov": "app-pov.png"}
BOOK = {"week": "app-week.png", "bookmap": "app-book.png", "bookconnections": "app-shared.png", "booknews": "app-news.png"}


def serve(root: Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a: None  # type: ignore[method-assign]
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/index.html"


def shoot(site: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    srv, url = serve(site)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1, color_scheme="light")
            ctx.add_init_script(INIT)
            pg = ctx.new_page()
            pg.goto(url)
            pg.wait_for_selector("#demo:not([disabled])", timeout=180_000)
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-landing.png"))

            def run(button: str) -> None:
                pg.click(button)
                pg.wait_for_selector("#loaded li:has-text('.toml')")
                pg.click("#run")
                pg.wait_for_selector("#results:not([hidden])", timeout=180_000)
                pg.wait_for_timeout(500)

            run("#demo")
            for tab, name in SINGLE.items():
                pg.click(f"#tabs [data-tab={tab}]")
                pg.wait_for_timeout(500)
                pg.screenshot(path=str(out / name))
            pg.click("#tabs [data-tab=today]")
            pg.wait_for_timeout(300)
            pg.locator("#view .today").screenshot(path=str(out / "hero-today.png"))

            pg.click(".rail [data-place=start]")
            run("#demo-book")
            for tab, name in BOOK.items():
                if pg.locator(f"#tabs [data-tab={tab}]").count():
                    pg.click(f"#tabs [data-tab={tab}]")
                    pg.wait_for_timeout(600)
                    pg.screenshot(path=str(out / name))

            pg.click(".rail [data-place=start]")
            pg.click("#demo-estate")
            pg.wait_for_selector("#loaded li:nth-child(4)")
            pg.click("#run")
            pg.wait_for_selector("#view .estatemap", timeout=180_000)
            pg.wait_for_timeout(600)
            pg.screenshot(path=str(out / "app-estate.png"))
            pg.click("#tabs [data-tab=estategrow]")
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / "app-grow.png"))

            # a discovery workshop: invented answers for an invented prospect
            pg.click(".rail [data-place=start]")
            pg.click("#open-workshop")
            pg.wait_for_selector("#view .wsq")
            pg.fill("#view input[aria-label='Who the workshop is with']", "Kestrel Logistics (mock)")
            pg.get_by_role("button", name="Save the name").click()
            label = {"s": "Solved", "p": "Partly", "g": "A real gap", "u": "Nobody knows"}
            for prof, ans in (("hci", "pssps gsp"), ("dr-backup", "gggpgugu"), ("dbaas", "pgspgusp")):
                d = pg.locator(f"#ws-{prof}")
                if d.get_attribute("open") is None:
                    d.locator(":scope > summary").click()
                for i, a in enumerate(ans.replace(" ", "")):
                    d.locator(".wsq").nth(i).get_by_role("button", name=label[a], exact=True).click()
                    pg.wait_for_timeout(40)
            pg.locator("#ws-dr-backup .wsq").first.locator(".wsqhead").click()
            note = pg.locator("#ws-dr-backup .wsq").first.locator("input.wsnote")
            note.fill("A day down is about 2M in lost orders")
            note.press("Tab")
            pg.locator("#ws-dr-backup").scroll_into_view_if_needed()
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-workshop.png"))
            # a first meeting: the essential questions only, one of them opened on how to ask it
            pg.get_by_role("button", name="Essential questions only").click()
            pg.wait_for_timeout(200)
            q = pg.locator("#ws-dr-backup .wsq:not([hidden])").nth(2)
            q.locator(".wsqhead").click()
            q.locator(".wshow summary").click()
            pg.evaluate("document.querySelector('.wsnarrow').scrollIntoView({block: 'start', behavior: 'instant'})")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-questions.png"))
            pg.get_by_role("button", name="Essential questions only").click()
            pg.click("#tabs [data-tab=journey]")
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / "app-journey.png"))
            pg.click("#tabs [data-tab=hurt]")
            pg.wait_for_timeout(500)
            pg.screenshot(path=str(out / "app-hurt.png"))
            pg.click("#tabs [data-tab=wsprep]")
            pg.wait_for_selector("#view .objs")
            pg.locator("#view .obj").nth(3).get_by_role("button").click()
            pg.wait_for_selector("#view .obj.on")
            pg.evaluate("(() => { const c = document.querySelectorAll('#view .card')[1]; window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-prepare.png"))
            # qualify the deal: a few answers, the gate they open and what the next one needs
            pg.click("#tabs [data-tab=wsqualify]")
            pg.wait_for_selector("#view .qdhero")
            for i, ans in ((0, "Known"), (1, "Known"), (2, "Partly"), (3, "Not yet"), (7, "Partly"), (8, "Known")):    # in the order of the ten questions
                pg.locator("#view .qdlist .qlrow").nth(i).get_by_role("button", name=ans, exact=True).click()
                pg.wait_for_timeout(80)
            pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-qualify.png"))
            for name in ("Renew the current platform", "Move everything to a public cloud"):
                pg.locator("#view .altlist").get_by_role("button", name=name).click()
                pg.wait_for_selector(f"#view .altcard:has-text('{name}')")
            pg.evaluate("(() => { const c = document.querySelector('#view .altlist').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-alternatives.png"))
            def shift(n: int) -> str:
                return (datetime.date.today() + datetime.timedelta(days=n)).isoformat()

            pg.click("#tabs [data-tab=wsrfp]")
            pg.wait_for_selector("#view .rfphero")
            pg.get_by_label("Tender name").fill("Data centre renewal, lot 1 (mock)")
            pg.get_by_label("Tender name").press("Tab")
            pg.get_by_label("Questions to the contracting authority due").fill(shift(5))
            pg.get_by_label("Questions to the contracting authority due").press("Tab")
            pg.get_by_label("Bid due").fill(shift(16))
            pg.get_by_label("Bid due").press("Tab")
            pg.get_by_role("button", name="Try it with an invented tender").click()
            pg.wait_for_selector("#view .rfprow")
            # answered in a meeting's rhythm: open the first, then the keys 1 to 4, each opening the next one still open
            pg.locator("#view .rfprow[data-id=r1] .rfphead").click()
            for key in "1111112213":
                pg.keyboard.press(key)
                pg.wait_for_timeout(80)
            pg.keyboard.press("Escape")
            # two requirements for the partner, one for a specialist: a message ready for each
            for rid, who in (("r11", "partner"), ("r12", "partner"), ("r7", "specialist")):
                pg.locator(f"#view .rfprow[data-id={rid}] .rfphead").click()
                pg.locator(f"#view .rfprow[data-id={rid}] select[aria-label^='Who answers']").select_option(who)
                pg.wait_for_timeout(150)
                pg.keyboard.press("Escape")
            pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-rfp.png"))
            pg.locator("#view .rfprow[data-id=r14] .rfphead").click()
            pg.evaluate("(() => { const c = document.querySelector('#view .rfprow[data-id=\"r10\"]'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-rfp-kit.png"))
            pg.evaluate("(() => { const c = [...document.querySelectorAll('#view .card')].find((x) => x.textContent.includes('Deliver the bid')); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-rfp-deliver.png"))
            # what wins it: our bid against two guessed rivals, price scored on the discount
            pg.get_by_label("How price is scored").select_option("linear")
            for label, value in (("Base amount", "1200000"), ("Our quality points", "54"), ("Our price", "980000")):
                pg.get_by_label(label, exact=True).fill(value)
                pg.get_by_label(label, exact=True).press("Tab")
            for i, (name, quality, price) in enumerate((("Rival A (mock)", "60", "1050000"), ("Rival B (mock)", "47", "890000")), start=1):
                pg.get_by_role("button", name="Add a rival").first.click()
                for label, value in (("Name", name), ("Quality points", quality), ("Price", price)):
                    pg.get_by_label(f"{label}, rival {i}", exact=True).fill(value)
                    pg.get_by_label(f"{label}, rival {i}", exact=True).press("Tab")
            pg.wait_for_selector("#rfpaward .awardbars li:nth-child(3)")
            pg.evaluate("(() => { const c = document.getElementById('rfpaward'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-rfp-award.png"))
            # bid or no bid: a few answers by hand, the rest read from the tender
            bid = pg.locator("#rfpbid")
            for start, answer in (("We, or the partner who bids", "Yes"), ("We knew of it", "Partly"), ("It is not written around", "Yes"),
                                  ("We have the references", "Partly"), ("Its value", "Yes"), ("The contract terms", "Yes"), ("We, and the partner, have the people", "Partly")):
                bid.get_by_role("group", name=f"Answer: {start}").get_by_role("button", name=answer).click()
                pg.wait_for_timeout(120)
            pg.evaluate("(() => { const c = document.getElementById('rfpbid'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); document.activeElement && document.activeElement.blur(); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-rfp-bid.png"))
            # the way forward: the phase now, what moves it on, and the demo planned from what was said
            pg.click("#tabs [data-tab=wsforward]")
            pg.wait_for_selector("#view .fwhero")
            pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-forward.png"))
            pg.evaluate("(() => { const c = document.querySelectorAll('#view .card')[1]; window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-demo.png"))
            # partners on the deal: who leads, the registration, who does what, and what to settle
            pg.click("#tabs [data-tab=wspartners]")
            pg.wait_for_selector("#view .ptlist")
            if "No partner yet" in pg.inner_text("#view"):
                pg.get_by_role("button", name="Add a partner").click()
                pg.get_by_label("Partner 1: name").fill("Verdi Sistemi (mock)")
                pg.get_by_label("Partner 1: kind").select_option("integrator")
                pg.get_by_label("Partner 1: registered on").fill("2026-11-01")
                pg.get_by_label("Partner 1: registration until").fill("2027-02-01")
                pg.get_by_label("Partner 1: registration until").press("Tab")
                pg.get_by_role("group", name="Partner 1: lines it has skills on").get_by_role("button").first.click()
                for step, who in (("Discovery", "Together"), ("Proof of value", "Together"), ("Deployment and migration", "Verdi Sistemi (mock)"), ("Support after go-live", "Verdi Sistemi (mock)")):
                    pg.get_by_label(f"Who does: {step}").select_option(label=who)
                    pg.wait_for_timeout(60)
                pg.get_by_label("Route to purchase").select_option("distribution")
            pg.wait_for_selector("#view .pttable")
            pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-partners.png"))
            pg.click("#tabs [data-tab=workshop]")
            pg.wait_for_selector("#view .wsq")
            pg.get_by_role("button", name="AI on our own infrastructure").click()
            pg.wait_for_selector("#view .szhead")
            pg.locator("#view details.szassume summary").first.click()
            pg.evaluate("(() => { const c = document.querySelector('#view .szhead').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-gpu.png"))
            pg.get_by_role("button", name="Shops, plants and branches").click()
            pg.wait_for_selector("#view .edgetable")
            pg.evaluate("(() => { const c = document.querySelector('#view .edgetable').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-edge.png"))
            pg.get_by_role("button", name="Running it like a cloud").click()
            pg.wait_for_selector("#ws-cloud-operations")
            unit = pg.locator("#view .card").filter(has_text="What one machine costs")
            unit.locator("details.szassume summary").click()
            for label, value in (("Machines running (0: those running in the inventory)", "500"), ("Hardware in use: servers, storage, network, at purchase price", "1500000"),
                                 ("Software licences and subscriptions", "240000"), ("Hardware and software support", "60000"), ("Power and cooling", "45000"), ("Space: racks, rooms, data-centre rent", "30000"),
                                 ("People running the estate, as full-time equivalents", "3"), ("Cost of one full-time person", "70000"), ("Machines idle, oversized past use or forgotten", "18"),
                                 ("A comparable machine in a public cloud, storage, backup and support included (0: not compared)", "175")):
                f = pg.locator(f"#view input[aria-label='{label}']")
                f.fill(value)
                f.dispatch_event("change")
            pg.wait_for_timeout(300)
            unit.locator("details.szassume summary").click()
            pg.evaluate("(() => { const c = [...document.querySelectorAll('#view .card')].find((x) => x.textContent.includes('What one machine costs')); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-unitcost.png"))

            # the invented example: its inventory, and a first sizing sketch from it
            pg.click(".rail [data-place=start]")
            pg.click("#demo-workshop")
            pg.wait_for_selector("#view ol.journey")
            pg.click("#tabs [data-tab=workshop]")
            pg.wait_for_selector("#view .szhead")
            pg.evaluate("(() => { const c = document.querySelector('#view .szhead').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-sizing.png"))
            pg.evaluate("(() => { const c = document.querySelector('#view .wvtable').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-waves.png"))
            pg.evaluate("(() => { const c = document.querySelector('#view .drtable').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-recovery.png"))
            pg.click("#tabs [data-tab=wscase]")
            pg.wait_for_selector("#view .vcgroups")
            for label, value in (("What the current platform costs per year (licences, subscriptions, support)", "1200000"), ("Expected rise at the next renewal", "50"),
                                 ("The next renewal is in", "6"), ("Hardware refresh due if you stay", "900000"), ("The refresh is due in", "18"),
                                 ("What the new platform would cost per year", "1000000"), ("One-off cost of the move: services, migration, training", "600000"),
                                 ("Hours a month on routine work today: patching, upgrades, provisioning", "160"), ("Hours a month on the same work after the move", "60"),
                                 ("Cost of one hour of that work", "80"), ("Hours down per year today", "12"), ("Hours down per year expected after", "4")):
                f = pg.locator(f"#view input[aria-label='{label}']")
                f.fill(value)
                f.dispatch_event("change")
            pg.locator("#view .vcheard button").first.click()
            pg.wait_for_selector("#view .vcchart")
            pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-case.png"))
            pg.click("#tabs [data-tab=wsdelivery]")
            pg.wait_for_selector("#view .dldoc")
            pg.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-handover.png"))

            # the presales desk, filled with invented prospects at four stages
            pg.click(".rail [data-place=start]")
            pg.locator("#hero-roles [data-role=se]").click()
            pg.click("#desk-btn")
            pg.wait_for_selector("#desk-body .deskhero")
            if pg.get_by_role("button", name="Remove the invented examples").count():
                pg.get_by_role("button", name="Remove the invented examples").click()     # the example workshop above
            pg.get_by_role("button", name="Fill it with invented examples").click()
            pg.wait_for_selector("#desk-body :text('Pietra Bank')")
            pg.wait_for_timeout(400)
            pg.screenshot(path=str(out / "app-desk.png"))
            pg.evaluate("(() => { const c = [...document.querySelectorAll('#desk-body .card')].find((x) => x.textContent.includes('Tenders in progress')); if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-desk-tenders.png"))
            pg.evaluate("(() => { const c = [...document.querySelectorAll('#desk-body .card')].find((x) => x.textContent.includes('What the deals teach')); if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-lessons.png"))
            pg.evaluate("(() => { const c = [...document.querySelectorAll('#desk-body .card')].find((x) => x.textContent.includes('Partners across your deals')); if (c) window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-desk-partners.png"))
            pg.get_by_role("button", name="Try it with two invented engineers").click()
            pg.wait_for_selector("#desk-body .teamtable tbody tr:nth-child(2)")
            pg.evaluate("(() => { const c = document.querySelector('#desk-body .teamtable').closest('.card'); window.scrollTo({ top: c.getBoundingClientRect().top + window.scrollY - 76, behavior: 'instant' }); })()")
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "app-team.png"))
            pg.click(".rail [data-place=start]")
            pg.locator("#hero-roles [data-role=core]").click()

            phone = b.new_context(**p.devices["Pixel 7"], color_scheme="light")
            phone.add_init_script(INIT)
            mp = phone.new_page()
            mp.goto(url)
            mp.wait_for_selector("#demo:not([disabled])", timeout=180_000)
            mp.click("#demo")
            mp.wait_for_selector("#loaded li:has-text('.toml')")
            mp.click("#run")
            mp.wait_for_selector("#results:not([hidden])", timeout=180_000)
            mp.wait_for_timeout(500)
            mp.screenshot(path=str(out / "app-phone.png"))

            card = b.new_page(viewport={"width": 1280, "height": 640})
            card.goto(url)
            card.wait_for_selector(".hero-preview")
            card.evaluate("""() => {
              const fig = document.querySelector('.hero-preview').cloneNode(true);
              document.body.replaceChildren();
              const wrap = document.createElement('main');
              wrap.className = 'social';
              const h = document.createElement('h1'); h.textContent = 'Beyond 90';
              const p = document.createElement('p'); p.textContent = 'An adoption score for security products that multiplies instead of averaging. Open source, runs in your browser, nothing leaves it.';
              const left = document.createElement('div'); left.append(h, p);
              wrap.append(left, fig);
              document.body.append(wrap);
            }""")
            card.add_style_tag(content="""
              body{margin:0;background:#f3f5f9}
              .social{box-sizing:border-box;width:1280px;height:640px;padding:64px 72px;display:grid;grid-template-columns:1fr 440px;gap:56px;align-items:center}
              .social h1{font-family:var(--display);font-size:84px;line-height:1;letter-spacing:-.03em;margin:0 0 24px;color:#0b1b2e}
              .social > div > p{font-size:28px;line-height:1.35;color:#2b3b52;margin:0}
              .social .hero-preview{margin:0}""")
            card.wait_for_timeout(400)
            card.screenshot(path=str(out / "social-card.png"))
            b.close()
    finally:
        srv.shutdown()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    shoot(Path(sys.argv[1]), Path(sys.argv[2]))
