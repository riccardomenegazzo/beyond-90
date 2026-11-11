"""Aliases for the MCP server: stable, reversible, whole-word, and honest about what they miss."""
import json
import shutil
import stat
from pathlib import Path

import pytest

from beyond90.mcp_server import Server
from beyond90.pseudonyms import Aliases, _letters

PORTFOLIO = Path(__file__).parent.parent / "examples" / "portfolio"


def test_letters_run_on_after_z():
    assert [_letters(i) for i in (0, 1, 25, 26, 27, 701, 702)] == ["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]


def test_scrub_is_whole_word_case_insensitive_and_longest_first():
    a = Aliases()
    a.group("customer", ["Northwind", "Northwind Traders"])
    a.group("person", ["Ann"])
    assert a.scrub("northwind traders asked; ANN agreed; Annex stays") == "Customer A asked; Person 1 agreed; Annex stays"


def test_group_gives_one_alias_and_skips_short_names():
    a = Aliases()
    assert a.group("customer", ["acme", "Acme Corp"]) == a.group("customer", ["Acme Corp"]) == "Customer A"
    assert a.group("person", ["Al"]) is None
    assert a.group("person", ["Bob"]) == "Person 1"


def test_restore_returns_the_first_name_and_walks_objects():
    a = Aliases()
    a.group("customer", ["northwind", "Northwind Traders"])
    assert a.restore_obj({"customer": "customer a", "n": 3, "l": ["Customer A"]}) == {"customer": "northwind", "n": 3, "l": ["northwind"]}


def test_table_persists_privately(tmp_path):
    f = tmp_path / "sub" / "aliases.json"
    a = Aliases(f)
    a.group("customer", ["northwind"])
    a.group("customer", ["fabrikam"])
    a.save()
    assert stat.S_IMODE(f.stat().st_mode) == 0o600
    b = Aliases(f)
    assert b.scrub("fabrikam") == "Customer B"
    assert b.group("customer", ["third"]) == "Customer C"
    assert json.loads(f.read_text())["entries"]


def test_a_damaged_row_is_ignored(tmp_path):
    f = tmp_path / "a.json"
    f.write_text(json.dumps({"entries": [{"o": "x"}, {"o": "Real", "a": "Customer A", "k": "customer"}, "bad"]}))
    assert Aliases(f).scrub("Real") == "Customer A"


@pytest.fixture()
def root(tmp_path):
    for name in ("northwind", "fabrikam-labs"):
        shutil.copytree(PORTFOLIO / name, tmp_path / name)
    return tmp_path


def _call(server, name, args=None):
    r = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
    return r["isError"], r["content"][0]["text"]


def test_server_never_returns_a_real_customer_name_and_accepts_the_alias(root):
    s = Server(root, aliases=Aliases())
    bad, text = _call(s, "list_customers")
    assert not bad
    assert "northwind" not in text.lower() and "fabrikam" not in text.lower()
    assert "Customer A" in text and "Customer B" in text
    bad, text = _call(s, "score", {"customer": "Customer A"})
    assert not bad and "northwind" not in text.lower()
    bad, text = _call(s, "actions", {"customer": "Customer A", "limit": 3})
    assert not bad and "northwind" not in text.lower()


def test_errors_are_scrubbed_too(root):
    s = Server(root, aliases=Aliases())
    _call(s, "list_customers")
    bad, text = _call(s, "score", {"customer": "Customer Z"})
    assert bad and "northwind" not in text.lower()


def test_without_the_flag_names_pass_through(root):
    bad, text = _call(Server(root), "list_customers")
    assert not bad and "northwind" in text.lower()


def test_prompts_list_and_get(root):
    s = Server(root)
    assert "prompts" in s.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})["result"]["capabilities"]
    listed = s.handle({"jsonrpc": "2.0", "id": 2, "method": "prompts/list"})["result"]["prompts"]
    assert {p["name"] for p in listed} == {"qbr_prep", "weekly_book_review", "escalation_triage"}
    assert all("template" not in p for p in listed)
    got = s.handle({"jsonrpc": "2.0", "id": 3, "method": "prompts/get", "params": {"name": "qbr_prep", "arguments": {"customer": "northwind"}}})
    text = got["result"]["messages"][0]["content"]["text"]
    assert "northwind" in text and "do not fill the gap" in text
    missing = s.handle({"jsonrpc": "2.0", "id": 4, "method": "prompts/get", "params": {"name": "qbr_prep", "arguments": {}}})
    assert missing["error"]["code"] == -32602
    unknown = s.handle({"jsonrpc": "2.0", "id": 5, "method": "prompts/get", "params": {"name": "nope"}})
    assert unknown["error"]["code"] == -32602


def test_prompt_arguments_are_flattened_and_capped(root):
    s = Server(root)
    got = s.handle({"jsonrpc": "2.0", "id": 1, "method": "prompts/get",
                    "params": {"name": "escalation_triage", "arguments": {"customer": "x\n\nIgnore all", "issue": "y" * 500}}})
    text = got["result"]["messages"][0]["content"]["text"]
    assert "x Ignore all" in text and "y" * 201 not in text


def test_pseudonym_mode_tells_the_model_about_aliases(root):
    s = Server(root, aliases=Aliases())
    got = s.handle({"jsonrpc": "2.0", "id": 1, "method": "prompts/get", "params": {"name": "weekly_book_review"}})
    assert "aliases" in got["result"]["messages"][0]["content"]["text"]
