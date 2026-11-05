import base64
import io
import json
import zipfile
from pathlib import Path

import pytest

from beyond90 import xlsx
from beyond90.web import analyze_files, workbook_json

ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / "tests" / "fixtures" / "xlsx" / "northwind.xlsx"
DEMO = ROOT / "examples" / "portfolio" / "northwind"
SHEETS = ("customer.toml", "accounts.csv", "findings.csv", "inventory.csv", "activations.csv", "teams.csv")


def test_a_workbook_gives_the_same_analysis_as_the_files():
    got = xlsx.to_files("northwind.xlsx", BOOK.read_bytes())
    assert set(got["files"]) == set(SHEETS)
    assert any("'notes' is not one of the files" in n for n in got["notes"])
    from_book = analyze_files(got["files"])
    from_csv = analyze_files({n: (DEMO / n).read_text(encoding="utf-8") for n in SHEETS})
    assert from_book["ok"], from_book.get("errors")
    assert from_book["yield"] == pytest.approx(from_csv["yield"]) and from_book["actions"] == from_csv["actions"]


def test_dates_numbers_and_text_keep_their_meaning():
    files = xlsx.to_files("northwind.xlsx", BOOK.read_bytes())["files"]
    toml = files["customer.toml"]
    assert "as_of = 2026-10-31" in toml and "arr = 480000" in toml
    assert 'ceiling_version = "2026.4"' in toml, "a version typed as text stays text"
    first = files["findings.csv"].splitlines()[1].split(",")
    assert first[4] == "2026-05-21", "a date cell becomes YYYY-MM-DD"


def test_a_workbook_named_like_a_file_is_that_file():
    data = xlsx.to_files("Accounts.xlsx", BOOK.read_bytes())
    assert list(data["files"]) == ["accounts.csv"] and data["files"]["accounts.csv"].startswith("field,value")


def rebuilt(**replace: bytes) -> bytes:
    src = zipfile.ZipFile(BOOK)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for i in src.infolist():
            z.writestr(i, replace.get(i.filename, src.read(i)))
    return buf.getvalue()


@pytest.mark.parametrize(("data", "says"), [
    (b"not a zip at all", "not an .xlsx workbook"),
    (rebuilt(**{"xl/workbook.xml": b'<!DOCTYPE x [<!ENTITY a "a">]><workbook/>'}), "DOCTYPE"),
    (rebuilt(**{"xl/_rels/workbook.xml.rels": b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                              b'<Relationship Id="rId1" Target="../../../etc/passwd" Type="x"/></Relationships>'}), "outside the workbook"),
])
def test_hostile_workbooks_are_refused_with_a_reason(data, says):
    with pytest.raises(xlsx.WorkbookError, match=says):
        xlsx.read_workbook(data)


def test_the_page_gets_an_answer_even_for_a_broken_file():
    out = json.loads(workbook_json("x.xlsx", base64.b64encode(b"garbage").decode()))
    assert out["ok"] is False and "x.xlsx" in out["notes"][0]
    assert json.loads(workbook_json("x.xlsx", "%%%"))["ok"] is False
    ok = json.loads(workbook_json("northwind.xlsx", base64.b64encode(BOOK.read_bytes()).decode()))
    assert ok["ok"] and "customer.toml" in ok["files"]
