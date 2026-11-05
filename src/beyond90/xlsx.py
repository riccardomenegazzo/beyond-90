"""Excel workbooks in, the customer's files out: what most people have at hand is an .xlsx, not a CSV.

Standard library only (the engine runs in the browser). Reads the cells' values, not formulas or formatting: shared
and inline strings, numbers, booleans, and dates (cells whose number format is a date become YYYY-MM-DD).

* `accounts.xlsx` (named like one of the files) becomes `accounts.csv`, from its first sheet.
* Any other workbook is read sheet by sheet: a sheet named like a file (`accounts`, `findings`, ...) becomes that file,
  and a sheet named `customer` with two columns (field, value) becomes `customer.toml`; a field written
  `settings.triage_window_days` goes in the `[settings]` table.

Hostile files are refused: size caps on the archive and every part, DOCTYPE and entity declarations, paths that are
not inside the workbook.
"""

from __future__ import annotations

import csv
import io
import posixpath
import re
import zipfile
import zlib
from datetime import date, timedelta
from typing import Any
from xml.etree import ElementTree as ET

from .provenance import INPUT_FILES

MAX_PART = 40 * 1024 * 1024
MAX_TOTAL = 120 * 1024 * 1024
MAX_CELLS = 2_000_000
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel": "http://schemas.openxmlformats.org/package/2006/relationships"}
DATE_FORMATS = set(range(14, 23)) | {45, 46, 47}
CSV_NAMES = {n[:-4]: n for n in INPUT_FILES if n.endswith(".csv")}


class WorkbookError(ValueError):
    pass


class Text(str):
    """A cell that holds text, as opposed to a number, a date or a boolean: "2026.4" typed as text stays text."""


def _xml(z: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        info = z.getinfo(name)
    except KeyError:
        raise WorkbookError(f"the workbook has no {name}") from None
    if info.file_size > MAX_PART:
        raise WorkbookError(f"{name} is too large")
    raw = z.read(info)
    low = raw[:65536].lower()
    if b"<!doctype" in low or b"<!entity" in raw.lower():
        raise WorkbookError("a workbook part declares a DOCTYPE or an entity; refused")
    try:
        return ET.fromstring(raw)  # noqa: S314 - DOCTYPE and entity declarations are refused above
    except (ET.ParseError, LookupError, ValueError) as e:
        raise WorkbookError(f"{name} is not valid XML ({e})") from None


def _col(ref: str) -> int:
    """Zero-based column of a cell reference such as "AB12"."""
    m = re.match(r"[A-Za-z]+", ref)
    n = 0
    for ch in (m.group(0).upper() if m else "A"):
        n = n * 26 + ord(ch) - 64
    return n - 1


def _date_styles(z: zipfile.ZipFile) -> set[int]:
    """The indexes of cell styles whose number format shows a date."""
    if "xl/styles.xml" not in z.namelist():
        return set()
    root = _xml(z, "xl/styles.xml")
    custom = {int(f.get("numFmtId", "0")) for f in root.iterfind("m:numFmts/m:numFmt", NS)
              if re.search(r"[dy]", re.sub(r'"[^"]*"|\[[^]]*]', "", f.get("formatCode", "")).lower())}
    return {i for i, xf in enumerate(root.iterfind("m:cellXfs/m:xf", NS)) if int(xf.get("numFmtId", "0")) in DATE_FORMATS | custom}


def _number(text: str, as_date: bool) -> str:
    try:
        v = float(text)
    except ValueError:
        return text
    if as_date and 0 < v < 2958466:
        return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
    return str(int(v)) if v.is_integer() and abs(v) < 1e15 else repr(v)


def read_workbook(data: bytes) -> list[tuple[str, list[list[str]]]]:
    """Every sheet as (name, rows of text values), in workbook order."""
    try:
        return _read(data)
    except (zipfile.BadZipFile, zlib.error, EOFError, OSError, NotImplementedError, RuntimeError, UnicodeDecodeError) as e:
        raise WorkbookError(f"the workbook is damaged ({type(e).__name__})") from None


def _read(data: bytes) -> list[tuple[str, list[list[str]]]]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise WorkbookError("not an .xlsx workbook (it is not a zip archive); save it as Excel Workbook (.xlsx)") from None
    with z:
        if sum(i.file_size for i in z.infolist()) > MAX_TOTAL:
            raise WorkbookError("the workbook is too large once unpacked")
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = ["".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")) for si in _xml(z, "xl/sharedStrings.xml").iterfind("m:si", NS)]
        dates = _date_styles(z)
        book = _xml(z, "xl/workbook.xml")
        rels = {r.get("Id"): r.get("Target", "") for r in _xml(z, "xl/_rels/workbook.xml.rels").iterfind("rel:Relationship", NS)}
        out, cells = [], 0
        for sh in book.iterfind("m:sheets/m:sheet", NS):
            target = rels.get(sh.get(f"{{{NS['r']}}}id", ""), "")
            path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target))
            if not path.startswith("xl/") or ".." in path.split("/"):
                raise WorkbookError("a sheet points outside the workbook; refused")
            rows: list[list[str]] = []
            for row in _xml(z, path).iterfind("m:sheetData/m:row", NS):
                vals: dict[int, str] = {}
                for i, c in enumerate(row.iterfind("m:c", NS)):
                    cells += 1
                    if cells > MAX_CELLS:
                        raise WorkbookError("the workbook has too many cells")
                    col = _col(c.get("r", "")) if c.get("r") else i
                    kind, v = c.get("t", "n"), c.find("m:v", NS)
                    if kind == "inlineStr":
                        text = "".join(t.text or "" for t in c.iter(f"{{{NS['m']}}}t"))
                    elif v is None or v.text is None:
                        continue
                    elif kind == "s":
                        idx = int(v.text) if v.text.isdigit() else -1
                        text = shared[idx] if 0 <= idx < len(shared) else ""
                    elif kind == "b":
                        text = "true" if v.text == "1" else "false"
                    elif kind in ("str", "e"):
                        text = v.text if kind == "str" else ""
                    else:
                        text = _number(v.text, int(c.get("s", "0") or 0) in dates)
                    if 0 <= col < 16384:
                        vals[col] = Text(text.strip()) if kind in ("s", "inlineStr", "str") else text.strip()
                if vals and any(vals.values()):
                    rows.append([vals.get(i, "") for i in range(max(vals) + 1)])
            out.append((sh.get("name", "Sheet"), rows))
        return out


def _csv(rows: list[list[str]]) -> str:
    width = max((len(r) for r in rows), default=0)
    while width and not any(len(r) >= width and r[width - 1] for r in rows):
        width -= 1
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for r in rows:
        w.writerow((r + [""] * width)[:width])
    return buf.getvalue()


def _toml_value(v: str) -> str:
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) or (not isinstance(v, Text) and (re.fullmatch(r"-?\d+(\.\d+)?", v) or v in ("true", "false"))):
        return v
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _toml(rows: list[list[str]]) -> str:
    tables: dict[str, list[str]] = {"customer": []}
    for r in rows:
        if len(r) < 2 or not r[0] or r[0].lower() in ("field", "key", "name of the field"):
            continue
        key, value = r[0].strip(), r[1]
        table, _, leaf = key.rpartition(".")
        table = table or "customer"
        if not re.fullmatch(r"[A-Za-z0-9_.]+", table) or not re.fullmatch(r"[A-Za-z0-9_]+", leaf):
            continue
        tables.setdefault(table, []).append(f"{leaf} = {_toml_value(value)}")
    return "\n\n".join(f"[{t}]\n" + "\n".join(lines) for t, lines in tables.items() if lines) + "\n"


def to_files(name: str, data: bytes) -> dict[str, Any]:
    """The customer's files found in one workbook, and what was used or ignored, in words."""
    sheets = read_workbook(data)
    stem = posixpath.splitext(posixpath.basename(name))[0].strip().lower()
    files: dict[str, str] = {}
    notes: list[str] = []
    if stem in CSV_NAMES or stem == "customer":
        rows = next((r for _, r in sheets if r), [])
        files[CSV_NAMES.get(stem, "customer.toml")] = _toml(rows) if stem == "customer" else _csv(rows)
        notes.append(f"{name}: first sheet read as {CSV_NAMES.get(stem, 'customer.toml')}.")
        return {"files": files, "notes": notes}
    for sheet, rows in sheets:
        key = sheet.strip().lower().replace(" ", "_")
        if key in CSV_NAMES and rows:
            files[CSV_NAMES[key]] = _csv(rows)
        elif key == "customer" and rows:
            files["customer.toml"] = _toml(rows)
        else:
            notes.append(f"{name}: sheet '{sheet}' is not one of the files and was ignored.")
    if files:
        notes.insert(0, f"{name}: read {', '.join(sorted(files))}.")
    else:
        notes.append(f"{name}: no sheet is named like a file (customer, accounts, findings, ...); name the sheets, or the workbook, after the files.")
    return {"files": files, "notes": notes}
