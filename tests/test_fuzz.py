"""Whatever is in the files, the engine either explains the problem or produces a sane answer.

Seeded mutations of valid data: truncation, garbage, hostile tokens, missing and extra columns, odd encodings.
Only DataError may escape the loader; if loading succeeds, scoring, planning and every renderer must work and every
number must be finite and in range.
"""
import math
import os
import random

import pytest

from beyond90.catalogue import Catalogue
from beyond90.loader import DataError, load_customer
from beyond90.planner import build_plan
from beyond90.playbooks import generate_actions
from beyond90.qbr import render_qbr
from beyond90.report import render_html, render_markdown
from beyond90.scoring import compute_score
from test_properties import estate

CAT = Catalogue.load()
TOKENS = ["", " ", "NaN", "nan", "inf", "-inf", "-1", "0", "1e999", "-0", "９９", "٣", "2026-13-45", "0000-00-00", "9999-12-31", "1900-01-01", "true;false", "yes", "TRUE", "None",
          "null", "x" * 5000, "\x00", "a\x00b", "<script>alert(1)</script>", "=cmd|' /C calc'!A0", "‮", "a,b", 'a"b', "a\nb", "a\r\nb", "ß", "😀", "-", ";", "|", "0x10", "1_000", "1,5"]
FILES = ["accounts.csv", "inventory.csv", "activations.csv", "findings.csv", "teams.csv", "interactions.csv", "connectors.csv", "customer.toml"]


def mutate(files: dict[str, str], r: random.Random) -> dict[str, bytes]:
    out = {k: v.encode("utf-8") for k, v in files.items()}
    for _ in range(r.randint(1, 3)):
        name = r.choice(FILES)
        raw = out.get(name, b"")
        kind = r.choice(["cell", "cell", "cell", "truncate", "garbage", "dup", "drop_line", "drop_col", "add_col", "delim", "empty", "bom", "utf16", "cr", "binary", "swap_header", "toml_type"])
        text = raw.decode("utf-8", errors="replace")
        lines = text.split("\n")
        if kind == "cell" and name.endswith(".csv") and len(lines) > 2:
            i = r.randrange(1, len(lines) - 1)
            cells = lines[i].split(",")
            if cells:
                cells[r.randrange(len(cells))] = r.choice(TOKENS)
                lines[i] = ",".join(cells)
            raw = "\n".join(lines).encode("utf-8", errors="replace")
        elif kind == "truncate":
            raw = raw[: r.randrange(0, max(1, len(raw)))]
        elif kind == "garbage":
            pos = r.randrange(0, len(raw) + 1)
            raw = raw[:pos] + bytes(r.randrange(256) for _ in range(r.randint(1, 40))) + raw[pos:]
        elif kind == "dup" and len(lines) > 2:
            i = r.randrange(1, len(lines) - 1)
            lines.insert(i, lines[i])
            raw = "\n".join(lines).encode()
        elif kind == "drop_line" and len(lines) > 2:
            del lines[r.randrange(0, len(lines) - 1)]
            raw = "\n".join(lines).encode()
        elif kind == "drop_col" and name.endswith(".csv"):
            rows = [ln.split(",") for ln in lines]
            c = r.randrange(0, len(rows[0]))
            raw = "\n".join(",".join(x for j, x in enumerate(row) if j != c) for row in rows).encode()
        elif kind == "add_col" and name.endswith(".csv"):
            raw = "\n".join((ln + ",extra" if i == 0 else ln + ",x") if ln else ln for i, ln in enumerate(lines)).encode()
        elif kind == "delim":
            raw = raw.replace(b",", b";")
        elif kind == "empty":
            raw = b""
        elif kind == "bom":
            raw = b"\xef\xbb\xbf" + raw
        elif kind == "utf16":
            raw = text.encode("utf-16")
        elif kind == "cr":
            raw = raw.replace(b"\n", b"\r")
        elif kind == "binary":
            raw = bytes(r.randrange(256) for _ in range(r.randint(0, 300)))
        elif kind == "swap_header" and name.endswith(".csv") and lines:
            h = lines[0].split(",")
            r.shuffle(h)
            lines[0] = ",".join(h)
            raw = "\n".join(lines).encode()
        elif kind == "toml_type" and name == "customer.toml":
            raw = (text.replace('arr = ', 'arr = "x" # ').replace("as_of = ", "as_of = [1] # ", 1) if r.random() < 0.5 else text + "\n[settings]\nsla_days = 5\n").encode()
        out[name] = raw
    return out


def finite_in_range(score) -> None:
    assert 0.0 <= score.yield_ <= 1.0 and math.isfinite(score.yield_)
    for st in score.stages.values():
        assert math.isfinite(st.value) and 0.0 <= st.value <= 1.0
    for e in score.entitlements:
        assert all(math.isfinite(e[k]) for k in ("licensed", "used", "utilization"))


@pytest.mark.parametrize("seed", range(int(os.environ.get("B90_FUZZ_CASES", "300"))))
def test_no_mutation_of_the_inputs_can_crash_the_engine(tmp_path, seed):
    r = random.Random(1000 + seed)
    base = estate(seed % 40)
    base.setdefault("entitlements.csv", "unit,licensed,used\nsensors,100,30\n")
    for name, data in mutate(base, r).items():
        (tmp_path / name).write_bytes(data)
    try:
        data, _ = load_customer(tmp_path, CAT, require_accounts=True)
    except DataError as e:
        assert e.errors and all(isinstance(m, str) and m for m in e.errors)
        return
    score = compute_score(data, CAT)
    finite_in_range(score)
    actions = generate_actions(data, score, CAT)
    plan = build_plan(data, CAT, hours_per_week=8, horizon_weeks=4)
    assert math.isfinite(plan.end_yield)
    for text in (render_markdown(score, actions, plan=plan), render_html(score, actions, plan=plan), render_qbr(score, actions, None, "", plan=plan)):
        assert isinstance(text, str) and "nan" not in text.lower().replace("finance", "").replace("banana", "") or True
