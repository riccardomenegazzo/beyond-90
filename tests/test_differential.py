"""A second, deliberately naive implementation of the four stages, written from the definitions in SPEC.md and fed the raw CSV text.

It shares no code with the engine (not the loader, not the stage functions), so a change that breaks the
arithmetic of the score, or a loader that reads a column differently, shows up as a disagreement here.
"""
import csv
import io
import json
from datetime import date
from pathlib import Path

import pytest

from beyond90 import scoring
from beyond90.scoring import compute_score
from test_properties import CAT, estate, load

DATA = Path(scoring.__file__).parent / "data"
MODULES = json.loads((DATA / "modules.json").read_text())["modules"]
EXPECTED = json.loads((DATA / "resource_types.json").read_text())["expected"]


def rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def true(v):
    return v.strip().lower() in ("true", "yes", "1")


def ver(v):
    return tuple(int(x) for x in v.split("."))


def reference(files, ceiling, window):
    accounts = [a for a in rows(files["accounts.csv"]) if (a["status"] or "active") == "active"]
    connected = [a for a in accounts if true(a["connected"])]
    l1 = (len(connected) / len(accounts)) if accounts else 1.0

    inv = rows(files["inventory.csv"])
    l2 = 1.0
    if inv:
        have = {(r["account_id"], r["resource_type"]) for r in inv if true(r["inventoried"])}
        want = [(a["id"], t) for a in connected for t in EXPECTED.get(a["provider"], [])]
        l2 = sum(1 for k in want if k in have) / len(want) if want else 1.0

    act = rows(files["activations.csv"])
    l3 = 1.0
    if act:
        present = {}
        for r in inv:
            if true(r["inventoried"]) and float(r["count"]) > 0:
                present.setdefault(r["account_id"], set()).add(r["resource_type"])
        on = {(r["account_id"], r["module_id"]) for r in act if true(r["active"])}
        pairs = []
        for a in connected:
            for m in MODULES:
                if ver(m["since"]) > ver(ceiling) or a["provider"] not in m["providers"]:
                    continue
                if m["requires_any"] and not (present.get(a["id"], set()) & set(m["requires_any"])):
                    continue
                pairs.append((a["id"], m["id"]))
        l3 = sum(1 for p in pairs if p in on) / len(pairs) if pairs else 1.0

    as_of = date(2026, 10, 31)
    open_f = [f for f in rows(files["findings.csv"]) if not f["closed_at"] and (as_of - date.fromisoformat(f["opened_at"])).days >= window]
    good = 0
    for f in open_f:
        if not f["owner"] or not f["decision"]:
            continue
        if f["decision"] == "accepted_risk" and (not f["expiry"] or date.fromisoformat(f["expiry"]) < as_of):
            continue
        good += 1
    l4 = good / len(open_f) if open_f else 1.0
    return l1, l2, l3, l4


@pytest.mark.parametrize("seed", range(150))
def test_the_engine_and_a_naive_reimplementation_agree(tmp_path, seed):
    files = estate(seed)
    d = load(tmp_path, files)
    if d is None:
        pytest.skip("empty estate")
    s = compute_score(d, CAT)
    ref = reference(files, d.settings.ceiling_version, d.settings.triage_window_days)
    got = tuple(s.stages[k].value for k in ("L1", "L2", "L3", "L4"))
    assert got == pytest.approx(ref, abs=1e-12), (seed, got, ref)
    assert s.yield_ == pytest.approx(ref[0] * ref[1] * ref[2] * ref[3], abs=1e-12)
