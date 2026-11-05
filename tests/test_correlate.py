import json
from pathlib import Path

import pytest

from beyond90 import correlate
from beyond90.web import analyze

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "examples" / "portfolio" / "northwind"
THREATS = json.loads((ROOT / "examples" / "threats.json").read_text(encoding="utf-8"))
JARGON = ("convergence", "barycent", "dimension", "node", "edge", "graph", "signal")


def graph(directory=DEMO, advisories=THREATS):
    out = analyze(str(directory), advisories=advisories)
    assert out["ok"], out.get("errors")
    return out["dashboard"]["graph"]


@pytest.fixture(scope="module")
def demo():
    return graph()


def test_every_link_joins_two_drawn_items_of_the_expected_kinds(demo):
    kinds = {n["id"]: n["type"] for n in demo["nodes"]}
    assert len(kinds) == len(demo["nodes"]), "ids are unique"
    allowed = {"owns": ("account", "team"), "exposes": ("story", "account"), "blind": ("story", "account"), "blocks": ("cause", "account"),
               "missing": ("capability", "account"), "mitigates": ("capability", "story"), "on": ("finding", "account")}
    for e in demo["edges"]:
        assert e["kind"] in allowed
        assert {kinds[e["source"]], kinds[e["target"]]} == set(allowed[e["kind"]]), e


def test_the_picture_stays_small_enough_to_read(demo):
    count = lambda t: sum(1 for n in demo["nodes"] if n["type"] == t)  # noqa: E731
    assert count("account") <= correlate.MAX_ACCOUNTS
    assert count("story") <= correlate.MAX_STORIES
    assert count("finding") <= correlate.MAX_FINDINGS
    assert count("capability") <= correlate.MAX_MODULES
    assert sum(1 for e in demo["edges"] if e["kind"] == "blind") <= correlate.MAX_BLIND * correlate.MAX_STORIES
    assert demo["stats"]["accounts_shown"] == count("account") <= demo["stats"]["accounts_with_signals"]


def test_every_drawn_account_carries_at_least_one_problem(demo):
    for n in demo["nodes"]:
        if n["type"] == "account":
            assert n["weight"] > 0 and n["signals"] and n["convergence"] == len(n["dims"]) >= 1


def test_security_stories_reach_the_accounts_they_touch():
    g = graph()
    assert any(n["type"] == "story" for n in g["nodes"])
    assert any(e["kind"] in ("exposes", "blind") for e in g["edges"])
    assert graph(advisories=None)["stats"]["stories"] == 0


def test_insights_are_few_ranked_actionable_and_point_at_drawn_items(demo):
    ids = {n["id"] for n in demo["nodes"]}
    ins = demo["insights"]
    assert 1 <= len(ins) <= 6
    assert [i["score"] for i in ins] == sorted((i["score"] for i in ins), reverse=True)
    assert len({i["id"] for i in ins}) == len(ins)
    for i in ins:
        assert i["kind"] in {"convergence", "leverage", "concentration", "blind_spot", "root_cause"}
        assert i["title"] and i["text"] and i["action"] and i["owner"]
        assert i["nodes"] and set(i["nodes"]) <= ids


def test_insights_are_written_for_people_not_for_engineers(demo):
    for i in demo["insights"]:
        words = f"{i['title']} {i['text']} {i['action']}".lower()
        assert not [j for j in JARGON if j in words], i


def test_two_faces_of_one_gap_count_once():
    assert not correlate._converges({"dims": ["visibility"]})
    assert not correlate._converges({"dims": ["threat", "protection"]})
    assert correlate._converges({"dims": ["visibility", "findings"]})
    assert correlate._converges({"dims": ["threat", "findings", "protection"]})


def test_the_same_customer_always_gives_the_same_picture(demo):
    assert json.dumps(graph(), sort_keys=True) == json.dumps(demo, sort_keys=True)
