from datetime import timedelta

from beyond90.candor import candor_items, not_relevant_modules, render_candor_markdown
from beyond90.catalogue import Catalogue
from beyond90.models import Activation, Commitment, Entitlement, InventoryRow
from beyond90.scoring import compute_score

from helpers import AS_OF, account, data, finding, full_inventory

CAT = Catalogue.load()


def healthy():
    accs = [account(f"a{i}", sources=("billing", "org", "sso"), in_plan=True) for i in range(3)]
    inv = [r for a in accs for r in full_inventory(a.id)]
    acts = [Activation(a.id, m.id, True) for a in accs for m in CAT.modules_at("2026.4") if "aws" in m.providers]
    return data(accounts=accs, inventory=inv, activations=acts, findings=[finding("f", owner="o", decision="fix", opened_days_ago=20)])


def kinds(d, **kw):
    return [i.kind for i in candor_items(compute_score(d, CAT), d, CAT, **kw)]


def test_a_healthy_account_has_nothing_to_confess():
    d = healthy()
    assert kinds(d) == []
    assert render_candor_markdown([]) == []


def test_legacy_figure_overstating_is_named_with_both_numbers():
    d = healthy()
    d.accounts = [account("x", connected=False, in_plan=False)] + [a for a in d.accounts]
    d.accounts[0] = account("x", connected=False, in_plan=False)
    items = candor_items(compute_score(d, CAT), d, CAT)
    # the legacy metric counts only plan accounts (all connected = 100%) while the real figure is lower
    legacy = [i for i in items if i.kind == "legacy_overstates"]
    assert legacy and "100%" in legacy[0].say and "overstates" in legacy[0].say


def test_unused_licences_are_one_item_that_names_the_option_of_paying_for_less():
    d = healthy()
    d.entitlements = [Entitlement("sensors", 100, 30), Entitlement("code_seats", 50, 10), Entitlement("workloads", 100, 95)]
    items = [i for i in candor_items(compute_score(d, CAT), d, CAT) if i.kind == "unused_licence"]
    assert len(items) == 1
    assert "pay for less" in items[0].say and "sensors" in items[0].say and "code_seats" in items[0].say and "workloads" not in items[0].say


def test_overdue_commitments_and_downgrades_and_missing_data_are_said_out_loud():
    from beyond90.models import Contact
    d = healthy()
    d.contacts = [Contact("c", "C", "champion", last_contact=AS_OF - timedelta(days=3))]
    d.commitments = [Commitment("k", "send it", AS_OF - timedelta(days=5))]
    opened = 40
    d.findings.append(finding("dg", severity="medium", opened_days_ago=opened, previous_severity="high",
                              severity_changed_at=AS_OF - timedelta(days=opened) + timedelta(days=29), owner="o", decision="fix"))
    assert {"overdue_commitments", "downgrades"} <= set(kinds(d))
    empty = data(accounts=[account("a")])
    ks = kinds(empty)
    assert "not_measured_l2" in ks and "not_measured_l3" in ks


def test_not_recommending_what_the_estate_does_not_need():
    d = healthy()
    d.inventory = [r for r in d.inventory if r.resource_type != "ai_service"]
    names = {n for _, n, _ in not_relevant_modules(d, CAT)}
    assert "AI services posture" in names and "Identity and entitlement analysis" not in names
    item = next(i for i in candor_items(compute_score(d, CAT), d, CAT) if i.kind == "not_recommending")
    assert "AI services posture" in item.say and "ai_service" in item.evidence
    assert not_relevant_modules(data(accounts=[account("a")]), CAT) == []           # no inventory: cannot say what is irrelevant


def test_j_curve_and_slow_zero_critical_and_bar_moved_come_from_the_analyses():
    from beyond90.attribution import Attribution
    from beyond90.planner import build_plan
    d = healthy()
    d.accounts.append(account("late", connected=False, owner="x"))
    plan = build_plan(d, CAT, realization=1.0, horizon_weeks=8)
    forecast = {"available": True, "state": "open", "p50_days": 200, "open_critical": 4, "arrivals_per_week": 1.2, "stuck_beyond_history": 2}
    att = Attribution("T", "2026-09-30", "2026-10-31", "2026.1", "2026.4", 0.6, 0.62, 2.0, 4.0, -2.0)
    ks = kinds(d, plan=plan, forecast=forecast, attribution=att)
    assert {"j_curve", "zero_critical_far", "bar_moved"} <= set(ks)


def test_the_markdown_lists_say_evidence_and_why_and_can_be_capped():
    d = healthy()
    d.entitlements = [Entitlement("sensors", 100, 30)]
    d.inventory = [r for r in d.inventory if r.resource_type != "ai_service"] + [InventoryRow("a0", "ai_service", 0, True)]
    items = candor_items(compute_score(d, CAT), d, CAT)
    md = "\n".join(render_candor_markdown(items))
    assert "Evidence:" in md and "Why say it:" in md
    assert "more in the full report" in "\n".join(render_candor_markdown(items * 4, limit=2))
