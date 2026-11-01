import pytest

from beyond90.catalogue import Catalogue
from beyond90.models import Activation
from beyond90.scoring import compute_score
from beyond90.views import CSF_FUNCTIONS, adoption_views

from helpers import account, data, full_inventory

CAT = Catalogue.load()


def estate(active_modules):
    accs = [account(f"a{i}", sources=("billing", "org")) for i in range(4)]
    mods = [m for m in CAT.modules_at("2026.4") if "aws" in m.providers]
    acts = [Activation(a.id, m.id, m.id in active_modules) for a in accs for m in mods]
    return data(accounts=accs, inventory=[r for a in accs for r in full_inventory(a.id)], activations=acts)


def views_for(active):
    d = estate(active)
    return compute_score(d, CAT), compute_score(d, CAT).views


def test_every_module_belongs_to_a_use_case_and_a_function_in_every_profile():
    from beyond90.catalogue import available_profiles
    for name in available_profiles():
        cat = Catalogue.load(profile=name)
        for m in cat.modules:
            assert m.use_case in cat.use_cases, (name, m.id)
            assert m.csf and set(m.csf) <= set(CSF_FUNCTIONS), (name, m.id, m.csf)


def test_use_case_figures_add_up_to_the_stage_they_come_from():
    s, v = views_for({"posture", "runtime_sensor"})
    l3 = s.stages["L3"]
    assert sum(u["relevant"] for u in v["use_cases"]) == l3.denominator and sum(u["active"] for u in v["use_cases"]) == l3.numerator


def test_states_follow_the_rate():
    allmods = {m.id for m in CAT.modules_at("2026.4")}
    _, none = views_for(set())
    assert {u["state"] for u in none["use_cases"]} == {"not started"}
    _, full = views_for(allmods)
    assert {u["state"] for u in full["use_cases"]} == {"deep"} and all(u["biggest_gap"] == "" for u in full["use_cases"])
    _, some = views_for({"posture"})
    by = {u["id"]: u for u in some["use_cases"]}
    assert by["posture"]["rate"] == 1.0 and by["posture"]["state"] == "deep" and by["detection"]["state"] == "not started"


def test_the_thinnest_use_case_comes_first_and_the_order_is_stable():
    _, v = views_for({"posture", "vulnerability_scanning", "runtime_sensor"})
    rates = [u["rate"] for u in v["use_cases"]]
    assert rates == sorted(rates)
    assert v == views_for({"posture", "vulnerability_scanning", "runtime_sensor"})[1]


def test_a_module_serving_two_functions_counts_in_both():
    s, v = views_for({m.id for m in CAT.modules_at("2026.4")})
    fn = v["csf"]["functions"]
    assert sum(f["relevant"] for f in fn.values()) > s.stages["L3"].denominator
    assert fn["recover"]["rate"] is None                                    # nothing in this catalogue serves recover: said, not zero


def test_the_uneven_note_appears_only_when_the_functions_really_differ():
    _, v = views_for({"posture", "vulnerability_scanning", "identity_analysis", "data_security", "container_security", "code_scanning"})
    assert "Uneven" in v["csf"]["note"] and "detect" in v["csf"]["note"]
    allmods = {m.id for m in CAT.modules_at("2026.4")}
    assert views_for(allmods)[1]["csf"]["note"] == ""


def test_without_activations_there_are_no_views_rather_than_zeros():
    d = estate(set())
    d.activations = []
    assert compute_score(d, CAT).views == {} and adoption_views(compute_score(d, CAT), CAT) == {}


@pytest.mark.parametrize("name", ["cnapp", "endpoint"])
def test_both_profiles_produce_views_on_their_examples(name):
    from pathlib import Path

    from beyond90.loader import load_customer
    root = Path(__file__).resolve().parent.parent / "examples"
    d = root / ("portfolio/northwind" if name == "cnapp" else "profiles/endpoint/acme-endpoint")
    cat = Catalogue.for_directory(d)
    v = compute_score(load_customer(d, cat)[0], cat).views
    assert v["use_cases"] and set(v["csf"]["functions"]) == set(CSF_FUNCTIONS)
