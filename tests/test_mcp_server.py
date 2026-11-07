"""The MCP server: protocol behaviour, and the promises it makes (read-only, confined to its root)."""
import io
import json
import shutil
from pathlib import Path

import pytest

from beyond90 import mcp_server
from beyond90.mcp_server import Server

PORTFOLIO = Path(__file__).parent.parent / "examples" / "portfolio"


@pytest.fixture()
def root(tmp_path):
    for name in ("northwind", "fabrikam-labs"):
        shutil.copytree(PORTFOLIO / name, tmp_path / name)
    return tmp_path


def call(server, name, arguments=None, mid=1):
    reply = server.handle({"jsonrpc": "2.0", "id": mid, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}})
    return reply["result"]["isError"], reply["result"]["content"][0]["text"]


def test_initialize_agrees_a_version_and_falls_back_to_the_newest(root):
    s = Server(root)
    ok = s.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}})
    assert ok["result"]["protocolVersion"] == "2024-11-05"
    odd = s.handle({"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {"protocolVersion": "1999-01-01"}})
    assert odd["result"]["protocolVersion"] == mcp_server.PROTOCOL_VERSIONS[0]
    assert "data" in odd["result"]["instructions"]


def test_notifications_get_no_reply_and_unknown_methods_get_an_error(root):
    s = Server(root)
    assert s.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    assert s.handle({"jsonrpc": "2.0", "id": 3, "method": "resources/list"})["error"]["code"] == -32601
    assert s.handle([{"jsonrpc": "2.0", "id": 1, "method": "ping"}])["error"]["code"] == -32600


def test_every_tool_is_declared_read_only(root):
    tools = Server(root).handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]
    assert {t["name"] for t in tools} == {"list_customers", "score", "actions", "what_if", "path_to_target"}
    assert all(t["annotations"]["readOnlyHint"] and not t["annotations"]["openWorldHint"] for t in tools)


def test_list_customers_puts_the_weakest_first(root):
    bad, text = call(Server(root), "list_customers")
    rows = json.loads(text)["customers"]
    assert not bad and [r["customer"] for r in rows] == ["fabrikam-labs", "northwind"]
    assert rows[0]["yield"] < rows[1]["yield"]


def test_score_actions_and_what_if_answer(root):
    s = Server(root)
    bad, text = call(s, "score", {"customer": "northwind"})
    assert not bad and set(json.loads(text)["stages"]) == {"L1", "L2", "L3", "L4"}
    bad, text = call(s, "actions", {"customer": "northwind", "limit": 3})
    assert not bad and len(json.loads(text)["actions"]) == 3
    bad, text = call(s, "what_if", {"customer": "northwind", "scenarios": [{"steps": [{"kind": "connect_all"}]}]})
    assert not bad and json.loads(text)["scenarios"][0]["steady"]["yield"] > 0
    bad, text = call(s, "path_to_target", {"customer": "northwind", "target": 0.85})
    assert not bad and json.loads(text)["reached"]


@pytest.mark.parametrize("name", ["..", "../northwind", "a/b", ".hidden", "", "/etc", "x\x00y", 7, None, "missing"])
def test_a_customer_name_cannot_leave_the_root(root, name):
    bad, text = call(Server(root), "score", {"customer": name})
    assert bad and "customer" in text


def test_a_symlink_out_of_the_root_is_refused(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("elsewhere")
    shutil.copytree(PORTFOLIO / "northwind", outside / "secret")
    (root / "sneaky").symlink_to(outside / "secret", target_is_directory=True)
    bad, _ = call(Server(root), "score", {"customer": "sneaky"})
    assert bad


def test_bad_arguments_are_errors_the_model_can_read(root):
    s = Server(root)
    assert call(s, "actions", {"customer": "northwind", "limit": 0})[0]
    assert call(s, "actions", {"customer": "northwind", "limit": True})[0]
    assert call(s, "what_if", {"customer": "northwind", "scenarios": "x"})[0]
    assert call(s, "what_if", {"customer": "northwind", "scenarios": [{"steps": [{"kind": "x"}]}]})[0]
    assert call(s, "path_to_target", {"customer": "northwind", "target": "high"})[0]
    assert s.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "rm", "arguments": {}}})["error"]["code"] == -32602
    assert s.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "score", "arguments": []}})["error"]["code"] == -32602


def test_using_every_tool_changes_no_file(root):
    def snapshot():
        return {str(p.relative_to(root)): (p.stat().st_mtime_ns, p.stat().st_size) for p in root.rglob("*") if p.is_file()}
    before = snapshot()
    s = Server(root)
    call(s, "list_customers")
    call(s, "score", {"customer": "northwind"})
    call(s, "actions", {"customer": "northwind"})
    call(s, "what_if", {"customer": "northwind", "scenarios": [{"steps": [{"kind": "enable_all"}]}]})
    call(s, "path_to_target", {"customer": "northwind"})
    assert snapshot() == before


def test_the_serve_loop_survives_garbage_and_oversized_lines(root, monkeypatch):
    monkeypatch.setattr(mcp_server, "MAX_LINE", 64)
    lines = ["not json\n", "x" * 200 + "\n", '{"jsonrpc":"2.0","id":9,"method":"ping"}\n']
    out = io.StringIO()
    Server(root).serve(io.StringIO("".join(lines)), out)
    replies = [json.loads(x) for x in out.getvalue().splitlines()]
    assert [r.get("error", {}).get("code") for r in replies] == [-32700, -32600, None]
    assert replies[2]["id"] == 9


def test_the_server_module_has_no_way_to_reach_the_network():
    src = Path(mcp_server.__file__).read_text(encoding="utf-8")
    for word in ("socket", "urllib", "http", "requests", "subprocess", "os.system"):
        assert f"import {word}" not in src and f"from {word}" not in src
