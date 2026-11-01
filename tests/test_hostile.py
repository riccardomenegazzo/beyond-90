"""Whatever is in a customer's files, outputs must stay well-formed and must not run anything."""
import json
import re
from html.parser import HTMLParser

import pytest

from beyond90.web import analyze_book, analyze_files

NASTY = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "a | b | c",
    "line one\n# Injected heading\n- item",
    "`code` **bold** _it_ [link](javascript:alert(1))",
    "‮RTL override",
    "x" * 400,
    "&lt;already escaped&gt; & ampersand",
]


def files_with(name):
    return {
        "customer.toml": f'[customer]\nname = {json.dumps(name)}\nas_of = 2026-10-31\ntier = {json.dumps(name)}\narr = 1000\n',
        "accounts.csv": "id,provider,sources,connected,owner\n" + "".join(
            f'"{name.replace(chr(34), chr(34) * 2)}-{i}",aws,billing;org,{"true" if i % 2 else "false"},"{name.replace(chr(34), chr(34) * 2)}"\n' for i in range(4)),
        "teams.csv": f'id,name,has_assets,active_users,sso,role_scoped\nt1,"{name.replace(chr(34), chr(34) * 2)}",true,0,false,false\n',
        "findings.csv": f'id,account_id,severity,opened_at,owner,decision\nf1,"{name.replace(chr(34), chr(34) * 2)}-1",critical,2026-10-01,"{name.replace(chr(34), chr(34) * 2)}",fix\n',
        "contacts.csv": f'id,name,role,team,credibility,reliability,intimacy,self_orientation\nc1,"{name.replace(chr(34), chr(34) * 2)}",champion,t1,5,5,5,5\n',
        "commitments.csv": f'id,description,due_on,contact_id\nk1,"{name.replace(chr(34), chr(34) * 2)}",2026-10-10,c1\n',
        "entitlements.csv": "unit,licensed,used\nsensors,100,10\n",
    }


DANGEROUS_TAGS = {"script", "img", "iframe", "object", "embed", "link", "meta", "form", "svg_script"}


class Audit(HTMLParser):
    """Looks at what the browser would act on: tags, event attributes, and links that run code."""

    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag, attrs):
        if tag in DANGEROUS_TAGS and tag not in ("meta",):
            self.found.append(f"<{tag}>")
        for k, v in attrs:
            if k.startswith("on"):
                self.found.append(f"{k}=")
            if k in ("href", "src", "xlink:href", "action") and (v or "").strip().lower().startswith(("javascript:", "data:text/html")):
                self.found.append(f"{k}={v[:20]}")


def unsafe(html: str) -> list:
    a = Audit()
    a.feed(html)
    return a.found


def md_tables_are_rectangular(md: str) -> list[str]:
    """Every table row in a block must have the same number of cells as its header."""
    bad, width = [], None
    for line in md.split("\n"):
        if line.startswith("|"):
            cells = len(re.split(r"(?<!\\)\|", line.strip())) - 2
            if width is None:
                width = cells
            elif cells != width:
                bad.append(line[:100])
        else:
            width = None
    return bad


@pytest.mark.parametrize("name", NASTY)
def test_html_outputs_never_contain_live_markup_from_data(name):
    r = analyze_files(files_with(name))
    assert r["ok"], r.get("errors")
    assert unsafe(r["report_html"]) == [], "single report"


@pytest.mark.parametrize("name", NASTY)
def test_markdown_tables_stay_rectangular_and_headings_cannot_be_injected(name):
    r = analyze_files(files_with(name))
    for key in ("report_markdown", "qbr_markdown", "roadmap_markdown"):
        assert md_tables_are_rectangular(r[key]) == [], (key, md_tables_are_rectangular(r[key])[:2])
        assert "\n# Injected heading" not in r[key]


@pytest.mark.parametrize("name", NASTY)
def test_a_book_survives_hostile_customer_names(name):
    g = {"one": files_with(name), "two": files_with(name + " two")}
    r = analyze_book(g, hours=10, weeks=4)
    assert r["ok"], r.get("errors")
    assert unsafe(r["book_html"]) == []
    assert md_tables_are_rectangular(r["portfolio_markdown"]) == [] and md_tables_are_rectangular(r["book_markdown"]) == []
