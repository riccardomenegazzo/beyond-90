"""The browser's entry point for what-if: same answers as the library, errors as data."""
import json
from pathlib import Path

from beyond90 import web

DIR = Path(__file__).parent.parent / "examples" / "portfolio" / "northwind"
FILES = {p.name: p.read_text(encoding="utf-8") for p in DIR.iterdir() if p.suffix in (".csv", ".toml")}


def ask(**options):
    return json.loads(web.whatif_json(json.dumps(FILES), json.dumps(options)))


def test_scenarios_and_targets_answer():
    r = ask(scenarios=[{"steps": [{"kind": "connect_all"}]}])
    assert r["ok"] and r["result"]["scenarios"][0]["steady"]["yield"] > r["result"]["scenarios"][0]["today"]["yield"]
    t = ask(reach=0.85)
    assert t["ok"] and t["result"]["reached"]


def test_bad_input_comes_back_as_errors_not_exceptions():
    assert not ask(scenarios=[{"steps": [{"kind": "nope"}]}])["ok"]
    assert not ask(reach=7)["ok"]
    assert not ask(reach=True)["ok"]           # a boolean is not a number, so it is ignored and no scenario is left
    assert not ask()["ok"]
    broken = json.loads(web.whatif_json(json.dumps({"customer.toml": "x ="}), "{}"))
    assert not broken["ok"] and broken["errors"]


def test_unknown_options_are_ignored():
    assert ask(scenarios=[{"steps": [{"kind": "enable_all"}]}], evil="x")["ok"]
