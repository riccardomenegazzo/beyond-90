import json

from beyond90.catalogue import Catalogue
from beyond90.playbooks import generate_actions
from beyond90.qbr import render_qbr
from beyond90.report import render_html, render_json, render_markdown, render_text
from beyond90.scoring import compute_score

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()


def fixture(name="Acme"):
    d = data(accounts=[account("a1"), account("a2", connected=False, owner="x", last_spend=5)],
             inventory=full_inventory("a1"), findings=[finding("f1"), finding("f2", owner="o", decision="fix")])
    d.name = name
    sc = compute_score(d, CAT)
    return sc, generate_actions(d, sc, CAT)


def test_html_is_self_contained_and_escapes_input():
    sc, actions = fixture('<script>alert(1)</script> & Co')
    html = render_html(sc, actions)
    assert "<script" not in html.lower().replace("&lt;script&gt;", "")
    assert "&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co" in html
    assert "http://" not in html.replace("http://www.w3.org", "") and "https://" not in html
    for needle in ("Table view", "prefers-color-scheme:dark", 'role="img"', "legacy metric" if sc.naive is not None else "Yield"):
        assert needle in html


def test_html_shows_history_when_available():
    sc, actions = fixture()
    hist = [{"as_of": "2026-09-30", "ceiling_version": "2026.4", "yield": 0.5, "naive": 0.9, "l1": 1, "l2": 1, "l3": 1, "l4": 1, "reach": None, "critical_open": 1},
            {"as_of": "2026-10-31", "ceiling_version": "2026.4", "yield": 0.6, "naive": 0.9, "l1": 1, "l2": 1, "l3": 1, "l4": 1, "reach": None, "critical_open": 0}]
    assert "Yield over time" in render_html(sc, actions, hist)


def test_json_roundtrips_and_has_the_expected_keys():
    sc, actions = fixture()
    payload = json.loads(render_json(sc, actions))
    assert payload["yield"] == sc.yield_ and set(payload["stages"]) == {"L1", "L2", "L3", "L4"}
    assert payload["actions"][0]["playbook"]


def test_text_and_markdown_mention_the_stages():
    sc, actions = fixture()
    for out in (render_text(sc, actions), render_markdown(sc, actions)):
        for sid in ("L1", "L2", "L3", "L4"):
            assert sid in out


def test_qbr_answers_first_and_asks_for_decisions():
    sc, actions = fixture()
    md = render_qbr(sc, actions, quarter="Q4 2026")
    assert md.index("## The answer") < md.index("## Three reasons") < md.index("## Evidence") < md.index("## Decisions we need today")
    assert "Q4 2026" in md
