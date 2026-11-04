"""From a vendor's record to the columns the engine reads.

A column is described by a path into the record (``Id``, ``a.b.0.c``), or a small table:

    { path = "State", map = { ACTIVE = "active", SUSPENDED = "decommissioned" }, default = "active" }
    { const = "aws" }
    { path = "Tags.owner", transform = "lower" }

Transforms are a closed list; nothing is evaluated. A value that cannot be read becomes an empty string and is
counted, so a mapping that silently reads nothing is reported rather than producing an empty file.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

TRANSFORMS = ("lower", "upper", "bool", "date", "int", "float", "join", "first", "strip")


class MapError(Exception):
    pass


def get_path(obj: Any, path: str) -> Any:
    cur = obj
    for part in path.split("."):
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            i = int(part)
            cur = cur[i] if i < len(cur) else None
        else:
            return None
    return cur


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (list, tuple)):
        return ";".join(_text(x) for x in v)
    if isinstance(v, dict):
        return ""
    return str(v)


def _transform(name: str, v: Any) -> Any:
    if v is None:
        return None
    if name == "lower":
        return _text(v).lower()
    if name == "upper":
        return _text(v).upper()
    if name == "strip":
        return _text(v).strip()
    if name == "bool":
        return "true" if _text(v).strip().lower() in ("true", "yes", "y", "1", "active", "connected", "enabled", "on") else "false"
    if name == "date":
        return _text(v)[:10]
    if name == "int":
        try:
            return str(int(float(_text(v))))
        except ValueError:
            return ""
    if name == "float":
        try:
            return _text(float(_text(v)))
        except ValueError:
            return ""
    if name == "join":
        return ";".join(_text(x) for x in v) if isinstance(v, (list, tuple)) else _text(v)
    if name == "first":
        return _text(v[0]) if isinstance(v, (list, tuple)) and v else _text(v)
    raise MapError(f"unknown transform {name!r}")


def validate_spec(column: str, spec: Any) -> None:
    if isinstance(spec, str):
        return
    if not isinstance(spec, dict):
        raise MapError(f"{column}: a mapping is a path or a table, got {type(spec).__name__}")
    unknown = set(spec) - {"path", "const", "default", "map", "transform"}
    if unknown:
        raise MapError(f"{column}: unknown key(s) {sorted(unknown)} (allowed: path, const, default, map, transform)")
    if "path" not in spec and "const" not in spec:
        raise MapError(f"{column}: needs a path or a const")
    if "transform" in spec and spec["transform"] not in TRANSFORMS:
        raise MapError(f"{column}: unknown transform {spec['transform']!r} (allowed: {', '.join(TRANSFORMS)})")
    if "map" in spec and not isinstance(spec["map"], dict):
        raise MapError(f"{column}: map must be a table")


def apply_spec(record: Any, spec: Any) -> str:
    if isinstance(spec, str):
        return _text(get_path(record, spec))
    if "const" in spec:
        val: Any = spec["const"]
    else:
        val = get_path(record, spec["path"])
    if "transform" in spec:
        val = _transform(spec["transform"], val)
    if "map" in spec and val is not None:
        m = {str(k).lower(): v for k, v in spec["map"].items()}
        key = _text(val).lower()
        val = m.get(key, m.get("_default", val))
    out = _text(val)
    if out == "" and "default" in spec:
        out = _text(spec["default"])
    return out


def map_records(records: Iterable[Any], mapping: dict[str, Any]) -> tuple[list[dict[str, str]], dict[str, int]]:
    """Map every record. Returns the rows and, per column, how many came out empty (to catch a path that reads nothing)."""
    for col, spec in mapping.items():
        validate_spec(col, spec)
    rows, empty = [], dict.fromkeys(mapping, 0)
    for rec in records:
        row = {}
        for col, spec in mapping.items():
            v = apply_spec(rec, spec)
            if v == "":
                empty[col] += 1
            row[col] = v
        rows.append(row)
    return rows, empty
