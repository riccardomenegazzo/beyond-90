import json
from pathlib import Path

import pytest

from beyond90.book import build_book_plan, render_book_html, render_book_json, render_book_markdown, render_book_text
from beyond90.catalogue import Catalogue
from beyond90.cli import main
from beyond90.loader import load_customer
from beyond90.models import Activation

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()
ROOT = Path(__file__).parent.parent / "examples" / "portfolio"


def small(name, arr, unconnected=0, unowned=0):
    acts = [Activation("ok", m.id, True) for m in CAT.modules_at("2026.4") if "aws" in m.providers]
    d = data(accounts=[account("ok")] + [account(f"{name}-u{i}", connected=False, owner="x") for i in range(unconnected)],
             inventory=full_inventory("ok"), activations=acts,
             findings=[finding(f"{name}-f{i}", opened_days_ago=20) for i in range(unowned)])
    d.name, d.arr = name, float(arr)
    return name, d


def load_all():
    out = []
    for p in sorted(ROOT.iterdir()):
        d, _ = load_customer(p, CAT)
        out.append((d.name, d))
    return out


def test_scarce_hours_go_where_the_weighted_gain_per_hour_is_highest():
    big = small("big", 1_000_000, unowned=10)
    tiny = small("tiny", 10_000, unowned=10)                  # identical work, 100x less ARR
    plan = build_book_plan([big, tiny], CAT, hours_per_week=2, horizon_weeks=2, realization=1.0, baselines=False)
    hours = {c.name: c.hours for c in plan.customers}
    assert hours["big"] > hours["tiny"]
    assert plan.jobs[0].customer == "big"


def test_equal_weighting_ignores_arr():
    big = small("big", 1_000_000, unowned=10)
    tiny = small("tiny", 10_000, unowned=10)
    plan = build_book_plan([big, tiny], CAT, hours_per_week=3, horizon_weeks=3, realization=1.0, weighting="equal", baselines=False)
    assert {c.weight for c in plan.customers} == {0.5}


def test_the_hour_budget_is_never_exceeded_and_yield_never_falls_below_the_dip():
    plan = build_book_plan(load_all(), CAT, hours_per_week=8, horizon_weeks=8)
    for w in plan.weeks[1:]:
        assert sum(w.hours.values()) <= 8 + 1e-6
    assert plan.weighted_end > plan.weighted_start


def test_book_beats_or_matches_the_simple_rules_when_hours_are_scarce():
    plan = build_book_plan(load_all(), CAT, hours_per_week=6, horizon_weeks=10)
    assert set(plan.baselines) == {"equal_split", "arr_proportional"}
    assert plan.weighted_end >= max(plan.baselines.values()) - 1e-9
    assert any("points against the better" in n for n in plan.notes)


def test_with_plenty_of_hours_it_says_allocation_does_not_matter():
    plan = build_book_plan([small("a", 100, unowned=2), small("b", 100, unowned=2)], CAT, hours_per_week=40, horizon_weeks=4, realization=1.0)
    assert any("does not matter" in n for n in plan.notes)


def test_deterministic():
    a = build_book_plan(load_all(), CAT, hours_per_week=8, horizon_weeks=6, baselines=False).to_dict()
    b = build_book_plan(load_all(), CAT, hours_per_week=8, horizon_weeks=6, baselines=False).to_dict()
    assert a == b


def test_validation():
    with pytest.raises(ValueError, match="at least one"):
        build_book_plan([], CAT)
    with pytest.raises(ValueError, match="unique"):
        build_book_plan([small("a", 1), small("a", 1)], CAT)
    with pytest.raises(ValueError, match="positive"):
        build_book_plan([small("a", 1)], CAT, hours_per_week=0)
    with pytest.raises(ValueError, match="weighting"):
        build_book_plan([small("a", 1)], CAT, weighting="vibes")


def test_renderers():
    plan = build_book_plan(load_all(), CAT, hours_per_week=8, horizon_weeks=4, baselines=False)
    assert "Book plan" in render_book_text(plan) and "| Customer |" in render_book_markdown(plan)
    assert json.loads(render_book_json(plan))["hours_per_week"] == 8
    html = render_book_html(plan)
    assert "<script" not in html.lower() and "Table view" in html and 'role="img"' in html


def test_html_folds_more_than_eight_customers_into_other():
    customers = [small(f"c{i}", 100 + i, unowned=1) for i in range(10)]
    html = render_book_html(build_book_plan(customers, CAT, hours_per_week=10, horizon_weeks=2, realization=1.0, baselines=False))
    assert "Other" in html


def test_cli(capsys):
    assert main(["book", str(ROOT), "--hours", "8", "--weeks", "4", "--no-baselines"]) == 0
    assert "Weighted Yield" in capsys.readouterr().out
    assert main(["book", str(ROOT), "--hours", "8", "--weeks", "4", "--no-baselines", "--format", "json"]) == 0
    assert json.loads(capsys.readouterr().out)["weighting"] == "arr"
    assert main(["book", str(ROOT / "northwind"), "--no-baselines"]) == 1     # no customer sub-directories there
