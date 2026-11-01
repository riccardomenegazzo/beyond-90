import json
from pathlib import Path

import pytest

from beyond90.catalogue import Catalogue
from beyond90.cli import main
from beyond90.loader import load_customer
from beyond90.models import Activation
from beyond90.radar import (
    Threat,
    load_threats,
    release_radar,
    render_radar_json,
    render_radar_markdown,
    render_radar_text,
    threat_radar,
)

from helpers import AS_OF, account, data, full_inventory

CAT = Catalogue.load()
ROOT = Path(__file__).parent.parent / "examples" / "portfolio"
FEED = Path(__file__).parent.parent / "examples" / "threats.json"


def cust(name, arr, *, active=(), skip=(), accounts=2):
    accs = [account(f"{name}{i}") for i in range(accounts)]
    inv = [r for a in accs for r in full_inventory(a.id, skip=skip)]
    acts = [Activation(a.id, m, True) for a in accs for m in active]
    acts += [Activation(a.id, "posture", True) for a in accs]               # keep L3 measurable
    d = data(accounts=accs, inventory=inv, activations=acts, baseline_ceiling="2026.1")
    d.name, d.arr = name, float(arr)
    return name, d


def test_release_radar_lists_customers_where_a_new_module_is_relevant_and_off():
    a = cust("a", 1_000, active=["workflow_automation"])         # already on
    b = cust("b", 500)                                           # off
    reports = release_radar([a, b], CAT, version="2026.3")
    (rep,) = reports
    assert rep.module_id == "workflow_automation" and {c.customer for c in rep.customers} == {"a", "b"}
    by = {c.customer: c for c in rep.customers}
    assert by["a"].inactive_accounts == 0 and by["a"].yield_gain_points == 0
    assert by["b"].inactive_accounts == 2 and by["b"].yield_gain_points > 0 and by["b"].already_on == 0


def test_release_radar_ranks_by_arr_times_gain():
    big, small = cust("big", 1_000_000), cust("small", 1_000)
    (rep,) = release_radar([small, big], CAT, version="2026.3")
    assert rep.customers[0].customer == "big"


def test_release_radar_since_baseline_and_irrelevant_modules_are_skipped():
    no_ai = cust("noai", 10, skip=("ai_service",))
    reports = {r.module_id: r for r in release_radar([no_ai], CAT, since_baseline=True)}
    assert "ai_posture" not in reports                           # the account has no AI services: not relevant
    assert {"attack_surface", "workflow_automation"} <= set(reports)


def test_threat_feed_validation_names_the_entry_and_field(tmp_path):
    bad = tmp_path / "t.json"
    bad.write_text(json.dumps([{"id": "T1", "severity": "scary", "resource_types": ["teleporter"], "mitigated_by": ["nope"], "published": "yesterday"},
                               {"id": "T1", "severity": "high", "resource_types": ["compute"], "mitigated_by": ["posture"]}]))
    with pytest.raises(ValueError) as exc:
        load_threats(bad, CAT)
    msg = str(exc.value)
    for needle in ("threat #1 (T1): severity", "unknown: teleporter", "unknown: nope", "published must be YYYY-MM-DD", "threat #2 (T1): duplicate id"):
        assert needle in msg
    not_json = tmp_path / "x.json"
    not_json.write_text("{")
    with pytest.raises(ValueError, match="not valid JSON"):
        load_threats(not_json, CAT)


def test_threat_radar_separates_covered_uncovered_and_unknown():
    covered = cust("covered", 1_000, active=["data_security"])
    open_ = cust("open", 1_000)
    blind = cust("blind", 1_000, skip=("storage_object",))
    th = Threat("T", "t", "critical", AS_OF, ["storage_object"], [], ["data_security"])
    (rep,) = threat_radar([covered, open_, blind], [th], CAT, as_of=AS_OF)
    by = {c.customer: c for c in rep.customers}
    assert by["covered"].exposed_accounts == 2 and by["covered"].covered_accounts == 2 and by["covered"].uncovered_ids == []
    assert by["open"].uncovered_ids == ["open0", "open1"] and by["open"].yield_gain_points > 0
    assert by["blind"].exposed_accounts == 0 and by["blind"].unknown_ids == ["blind0", "blind1"]     # never inventoried: cannot be ruled out
    assert rep.customers[0].customer in ("open", "blind") and by["covered"].urgency == 0


def test_urgency_scales_with_severity_arr_and_uncovered_share():
    d = cust("x", 100)
    low = Threat("L", "l", "low", None, ["compute"], [], ["runtime_sensor"])
    crit = Threat("C", "c", "critical", None, ["compute"], [], ["runtime_sensor"])
    rl, rc = threat_radar([d], [low, crit], CAT)[1], threat_radar([d], [low, crit], CAT)[0]
    assert rc.threat.id == "C" and rc.customers[0].urgency == 4 * rl.customers[0].urgency


def test_any_listed_module_mitigates_and_provider_filter_applies():
    d = cust("x", 10, active=["cloud_detection"])
    th = Threat("T", "t", "high", None, ["compute"], [], ["runtime_sensor", "cloud_detection"])
    assert threat_radar([d], [th], CAT)[0].customers[0].uncovered_ids == []
    azure_only = Threat("A", "a", "high", None, ["compute"], ["azure"], ["runtime_sensor"])
    assert threat_radar([d], [azure_only], CAT)[0].customers == []


def test_renderers_and_the_example_feed():
    customers = []
    for p in sorted(ROOT.iterdir()):
        dd, _ = load_customer(p, CAT)
        customers.append((dd.name, dd))
    threats = load_threats(FEED, CAT)
    rep = threat_radar(customers, threats, CAT, as_of=AS_OF)
    assert [r.threat.severity for r in rep][0] == "critical"
    rel = release_radar(customers, CAT, since_baseline=True)
    md, txt, js = render_radar_markdown(rel, rep), render_radar_text(rel, rep), json.loads(render_radar_json(rel, rep))
    assert "## Threats" in md and "Unknown means" in md and "MOCK-2026-001" in txt
    assert js["threats"][0]["threat"]["id"] == rep[0].threat.id and js["releases"]


def test_cli(capsys):
    assert main(["radar", str(ROOT)]) == 0
    assert "released" in capsys.readouterr().out
    assert main(["radar", str(ROOT), "--threats", str(FEED), "--format", "markdown"]) == 0
    assert "### MOCK-2026-002" in capsys.readouterr().out
    assert main(["radar", str(ROOT), "--release", "2026.3", "--format", "json"]) == 0
    assert json.loads(capsys.readouterr().out)["releases"][0]["since"] == "2026.3"
    assert main(["radar", str(ROOT / "northwind")]) == 1
