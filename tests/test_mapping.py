"""Mapping an export with your own column names to the files the engine reads."""

from __future__ import annotations

import csv
import io

import pytest

from beyond90 import loader
from beyond90.catalogue import Catalogue
from beyond90.mapping import MappingError, convert, detect, read_table, suggest

ACCOUNTS = """Subscription ID;Cloud;Onboarded;Team;Monthly cost;Created
111122223333;Amazon;Yes;Payments;1,200.50;03/11/2026
aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee;Microsoft;No;Data;300;25/10/2026
;AWS;Yes;x;1;01/01/2026
"""
FINDINGS = """Finding ID,Account,Severity,Public,First seen,Fixed,Assignee,Disposition
F1,111122223333,Crit,Yes,2026-10-01,,alice,
F2,111122223333,Moderate,No,2026-09-12,2026-10-20,bob,False positive
F3,111122223333,Whatever,No,2026-09-12,,,
F4,111122223333,High,No,not a date,,,
"""


def _rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def test_delimiter_and_bom_are_handled() -> None:
    headers, rows = read_table("﻿a;b\n1;2\n")
    assert headers == ["a", "b"] and rows == [{"a": "1", "b": "2"}]
    assert read_table("a\tb\n1\t2\n")[0] == ["a", "b"]


def test_detects_the_file_and_guesses_the_columns() -> None:
    s = suggest(ACCOUNTS)
    assert s["target"] == "accounts.csv" and s["rows"] == 3
    m = s["mapping"]
    assert m["id"] == "Subscription ID" and m["provider"] == "Cloud" and m["connected"] == "Onboarded"
    assert m["owner"] == "Team" and m["last_spend"] == "Monthly cost" and m["created_at"] == "Created"
    f = suggest(FINDINGS)
    assert f["target"] == "findings.csv" and f["mapping"]["severity"] == "Severity" and f["mapping"]["opened_at"] == "First seen"


def test_one_column_is_never_used_twice() -> None:
    m = suggest(FINDINGS)["mapping"]
    used = [c for c in m.values() if c]
    assert len(used) == len(set(used))


def test_unclear_files_are_not_guessed() -> None:
    assert detect(["foo", "bar", "baz"]) == ""
    assert "mapping" not in suggest("foo,bar\n1,2\n")


def test_accounts_convert_to_what_the_loader_accepts(tmp_path) -> None:
    s = suggest(ACCOUNTS)
    out = convert(ACCOUNTS, "accounts.csv", s["mapping"], {"sources": "platform"})
    rows = _rows(out.csv)
    assert out.rows == 2 and out.skipped == 1
    assert rows[0]["provider"] == "aws" and rows[0]["connected"] == "true" and rows[0]["last_spend"] == "1200.50"
    assert rows[1]["provider"] == "azure" and rows[1]["connected"] == "false"
    assert rows[0]["created_at"] == "2026-11-03"        # day/month/year: 25/10 proves the order
    assert any("no account id" in n for n in out.notes)
    (tmp_path / "accounts.csv").write_text(out.csv)
    (tmp_path / "customer.toml").write_text('[customer]\nname = "T"\nas_of = "2026-11-05"\n')
    data, _ = loader.load_customer(tmp_path, Catalogue.for_directory(tmp_path), require_accounts=True)
    assert len(data.accounts) == 2 and data.accounts[0].connected


def test_findings_are_normalised_and_bad_rows_counted() -> None:
    s = suggest(FINDINGS)
    out = convert(FINDINGS, "findings.csv", s["mapping"])
    rows = _rows(out.csv)
    assert [r["id"] for r in rows] == ["F1", "F2"]
    assert rows[0]["severity"] == "critical" and rows[0]["exposure"] == "internet"
    assert rows[1]["severity"] == "medium" and rows[1]["decision"] == "false_positive" and rows[1]["closed_at"] == "2026-10-20"
    assert out.skipped == 2
    assert any("severity not understood" in n for n in out.notes) and any("opened date" in n for n in out.notes)


def test_ambiguous_dates_are_reported_not_hidden() -> None:
    text = "id,account_id,severity,opened_at\nF1,a,high,03/04/2026\n"
    out = convert(text, "findings.csv", suggest(text, "findings.csv")["mapping"])
    assert _rows(out.csv)[0]["opened_at"] == "2026-04-03"
    assert any("day/month or month/day" in n for n in out.notes)


def test_month_first_is_recognised_when_the_data_proves_it() -> None:
    text = "id,account_id,severity,opened_at\nF1,a,high,04/25/2026\nF2,a,high,03/04/2026\n"
    out = convert(text, "findings.csv", suggest(text, "findings.csv")["mapping"])
    assert [r["opened_at"] for r in _rows(out.csv)] == ["2026-04-25", "2026-03-04"]


def test_a_missing_required_field_is_refused() -> None:
    with pytest.raises(MappingError, match="Choose a column for: id"):
        convert(ACCOUNTS, "accounts.csv", {"provider": "Cloud"})


def test_a_default_provider_fills_a_missing_column() -> None:
    text = "Account\n111122223333\n"
    out = convert(text, "accounts.csv", {"id": "Account"}, {"provider": "aws"})
    assert _rows(out.csv)[0]["provider"] == "aws"


def test_bad_mappings_are_refused() -> None:
    with pytest.raises(MappingError, match="not in the file"):
        convert(ACCOUNTS, "accounts.csv", {"id": "Nope", "provider": "Cloud"})
    with pytest.raises(MappingError, match="two fields"):
        convert(ACCOUNTS, "accounts.csv", {"id": "Cloud", "provider": "Cloud"})
    with pytest.raises(MappingError, match="not a field"):
        convert(ACCOUNTS, "accounts.csv", {"id": "Cloud", "bogus": "Team"})
    with pytest.raises(MappingError, match="sources must be"):
        convert(ACCOUNTS, "accounts.csv", suggest(ACCOUNTS)["mapping"], {"sources": "magic"})


def test_duplicate_headers_and_empty_files_are_refused() -> None:
    with pytest.raises(MappingError, match="same name"):
        read_table("a,a\n1,2\n")
    with pytest.raises(MappingError, match="header"):
        read_table("")


def test_hostile_cells_stay_plain_text() -> None:
    text = "id,provider,connected,owner\n111122223333,aws,yes,\"=cmd|' /C calc'!A0\"\n"
    out = convert(text, "accounts.csv", suggest(text, "accounts.csv")["mapping"])
    assert _rows(out.csv)[0]["owner"].startswith("=")      # kept as data; the engine and the pages treat every cell as text


def test_unmapped_connection_is_declared_not_assumed() -> None:
    text = "Account,Cloud\n111122223333,aws\n"
    out = convert(text, "accounts.csv", {"id": "Account", "provider": "Cloud"})
    assert _rows(out.csv)[0]["connected"] == "false"
    assert any("counted as not connected" in n for n in out.notes)


def test_the_web_functions_round_trip() -> None:
    import json

    from beyond90 import web

    s = json.loads(web.mapping_suggest_json(ACCOUNTS, json.dumps({"hint": "export.csv"})))
    assert s["ok"] and s["target"] == "accounts.csv"
    r = json.loads(web.mapping_convert_json(json.dumps({"text": ACCOUNTS, "target": "accounts.csv", "mapping": s["mapping"], "defaults": {}})))
    assert r["ok"] and r["rows"] == 2 and len(r["preview"]) == 2
    bad = json.loads(web.mapping_suggest_json(""))
    assert not bad["ok"] and "header" in bad["error"]
