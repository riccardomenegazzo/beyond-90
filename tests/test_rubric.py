import copy
import json
import shutil
from pathlib import Path

import pytest

from beyond90.catalogue import DATA_DIR, Catalogue
from beyond90.loader import load_customer
from beyond90.models import Activation, Entitlement
from beyond90.rubric import evaluate, metrics, validate
from beyond90.scoring import compute_score
from beyond90.sections import md_rubric, rubric_headline

from helpers import account, data, finding, full_inventory

CAT = Catalogue.load()
RUBRIC = json.loads((DATA_DIR / "rubric.json").read_text())
ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / "examples"


def all_metrics(**over):
    """A customer that passes everything, with some metrics changed."""
    m = {"independent_sources": 3.0, "l1": 1.0, "l2": 1.0, "l3": 1.0, "l4": 1.0, "yield": 1.0, "unseen_share": 0.0, "critical_open": 0.0,
         "critical_unowned": 0.0, "critical_overdue": 0.0, "mttr_p90_ratio": 0.5, "downgrade_suspects": 0.0, "min_utilization": 0.9,
         "reach": 1.0, "quality_weak": 0.0, "sponsor": 1.0, "reliability_rate": 1.0, "overdue_commitments": 0.0}
    m.update(over)
    return m


def test_the_shipped_rubric_is_valid_and_every_check_names_real_playbooks():
    validate(RUBRIC)
    for c in RUBRIC["checks"]:
        for pb in c["playbooks"]:
            assert pb in CAT.playbooks, (c["id"], pb)
    assert {c["level"] for c in RUBRIC["checks"]} == {"bronze", "silver", "gold"}


@pytest.mark.parametrize("mutate,needle", [
    (lambda r: r.update(levels=["a", "b"]), "levels must be exactly"),
    (lambda r: r["checks"].append(dict(r["checks"][0])), "duplicate check id"),
    (lambda r: r["checks"][0].update(metric="nonsense"), "unknown metric"),
    (lambda r: r["checks"][0].update(op="~="), "unknown operator"),
    (lambda r: r["checks"][0].update(value="high"), "numeric value"),
    (lambda r: r["checks"][0].update(level="platinum"), "unknown level"),
    (lambda r: r["checks"][0].pop("title"), "missing 'title'"),
])
def test_a_broken_rubric_is_refused_with_the_reason(mutate, needle):
    r = copy.deepcopy(RUBRIC)
    mutate(r)
    with pytest.raises(ValueError) as e:
        validate(r)
    assert needle in str(e.value)


def test_a_perfect_customer_is_gold_with_nothing_blocking():
    r = evaluate(RUBRIC, all_metrics())
    assert r["level"] == "gold" and r["next_level"] is None and r["blocking"] == [] and not r["provisional"]


def test_one_failing_gold_check_leaves_the_customer_at_silver_and_names_it():
    r = evaluate(RUBRIC, all_metrics(mttr_p90_ratio=2.0))
    assert r["level"] == "silver" and r["next_level"] == "gold" and [c["id"] for c in r["blocking"]] == ["fast_remediation"]
    assert rubric_headline(r) == "Maturity level: **Silver**. 1 check stands between you and Gold."


def test_a_failing_bronze_check_beats_a_hundred_good_ones():
    r = evaluate(RUBRIC, all_metrics(critical_unowned=1.0))
    assert r["level"] == "basic" and r["next_level"] == "bronze" and [c["id"] for c in r["blocking"]] == ["criticals_owned"]


def test_level_is_the_highest_level_whose_checks_and_all_below_pass():
    for over, level in [({"l1": 0.7}, "basic"), ({"l1": 0.9}, "bronze"), ({"l2": 0.8}, "bronze"), ({"l2": 0.95}, "silver"), ({}, "gold")]:
        assert evaluate(RUBRIC, all_metrics(**over))["level"] == level, over


def test_a_check_that_cannot_be_measured_neither_passes_nor_blocks_but_makes_the_level_provisional():
    r = evaluate(RUBRIC, all_metrics(sponsor=None, reliability_rate=None))
    assert r["level"] == "gold" and r["provisional"] is True                       # gold reached without a sponsor check is gold on partial evidence
    r = evaluate(RUBRIC, all_metrics(sponsor=None, mttr_p90_ratio=2.0))
    assert r["level"] == "silver" and [c["id"] for c in r["blocking"]] == ["fast_remediation"]
    r = evaluate(RUBRIC, all_metrics(l2=None, mttr_p90_ratio=2.0))
    assert r["provisional"] is True and any(c["id"] == "visibility_90" for c in r["unmeasured"])
    assert "provisional" in rubric_headline(r)


def test_the_raw_value_of_every_check_is_exposed_so_a_policy_of_your_own_can_be_applied():
    r = evaluate(RUBRIC, all_metrics(l1=0.93))
    c = next(c for c in r["checks"] if c["id"] == "connected_95")
    assert (c["value"], c["target"], c["op"], c["status"]) == (0.93, 0.95, ">=", "fail")


def build():
    accs = [account(f"a{i}", sources=("billing", "org"), owner="o") for i in range(4)]
    return data(accounts=accs, inventory=[r for a in accs for r in full_inventory(a.id)], activations=[Activation(a.id, "posture", True) for a in accs],
                findings=[finding("c1", severity="critical", opened_days_ago=30, owner="", closed_after=None), finding("c2", severity="critical", opened_days_ago=2, owner="o", decision="fix")],
                entitlements=[Entitlement("sensors", 100, 30)])


def test_metrics_are_computed_from_the_data():
    d = build()
    m = metrics(compute_score(d, CAT), d)
    assert m["critical_open"] == 2 and m["critical_unowned"] == 1 and m["critical_overdue"] == 1     # c1 is 30 days old against a 7-day deadline
    assert m["min_utilization"] == pytest.approx(0.3) and m["independent_sources"] == 2 and m["sponsor"] is None and m["mttr_p90_ratio"] is None


def test_no_findings_means_findings_metrics_are_not_measured_not_perfect():
    d = build()
    d.findings = []
    m = metrics(compute_score(d, CAT), d)
    assert m["critical_open"] is None and m["critical_unowned"] is None and m["downgrade_suspects"] is None


def test_the_example_customers_land_where_the_story_says():
    levels = {}
    for name in ("contoso-bank", "northwind", "fabrikam-labs"):
        d = EX / "portfolio" / name
        cat = Catalogue.for_directory(d)
        levels[name] = compute_score(load_customer(d, cat)[0], cat).rubric["level"]
    assert levels == {"contoso-bank": "silver", "northwind": "bronze", "fabrikam-labs": "bronze"}


def test_a_profile_can_ship_its_own_rubric_and_it_changes_the_digest(tmp_path):
    for n in ("resource_types.json", "modules.json", "playbooks.json", "rubric.json"):
        shutil.copy(DATA_DIR / n, tmp_path / n)
    base = Catalogue.load(tmp_path)
    custom = json.loads((tmp_path / "rubric.json").read_text())
    custom["checks"] = [c for c in custom["checks"] if c["id"] != "connected_95"]
    (tmp_path / "rubric.json").write_text(json.dumps(custom))
    c2 = Catalogue.load(tmp_path)
    assert len(c2.rubric["checks"]) == len(base.rubric["checks"]) - 1 and c2.digest != base.digest


def test_the_markdown_names_the_next_checks_and_the_action_that_closes_them():
    d = build()
    s = compute_score(d, CAT)
    from beyond90.playbooks import generate_actions
    md = "\n".join(md_rubric(s.rubric, generate_actions(d, s, CAT)))
    assert "## Maturity level" in md and "Next to pass for Bronze" in md and "Every open critical finding has an owner" in md and "Closes with:" in md
