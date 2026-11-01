from beyond90.models import Activation
from beyond90.quality import assess
from beyond90.scoring import compute_score

from helpers import account, data, finding, full_inventory


def by_id(q):
    return {c["id"]: c for c in q["checks"]}


def good(n=8):
    accs = [account(f"a{i}", sources=("billing", "org"), owner="o") for i in range(n)]
    inv = [r for a in accs for r in full_inventory(a.id)]
    acts = [Activation(a.id, "posture", True) for a in accs]
    return data(accounts=accs, inventory=inv, activations=acts, findings=[finding("f", owner="o", decision="fix", opened_days_ago=2)])


def test_clean_inputs_have_high_confidence():
    q = assess(good())
    assert q["confidence"] == "high" and q["weak"] == 0 and q["notes"] == 0


def test_an_account_list_from_the_platform_itself_is_weak():
    d = good()
    d.accounts = [account(f"a{i}", sources=("plan",)) for i in range(8)]
    q = assess(d)
    assert by_id(q)["universe"]["status"] == "weak" and q["confidence"] == "low"
    assert "100% by construction" in by_id(q)["universe"]["detail"]


def test_one_independent_source_is_a_note():
    d = good()
    d.accounts = [account(f"a{i}", sources=("billing",)) for i in range(8)]
    assert by_id(assess(d))["universe"]["status"] == "note"


def test_missing_and_partial_inventory_and_activations():
    d = good()
    d.inventory, d.activations = [], []
    c = by_id(assess(d))
    assert c["inventory"]["status"] == "weak" and "not zero" in c["inventory"]["detail"] and c["activations"]["status"] == "weak"
    d = good()
    d.inventory = [r for r in d.inventory if r.account_id in {"a0", "a1", "a2", "a3", "a4", "a5", "a6"}]
    assert by_id(assess(d))["inventory"]["status"] == "note"                      # 7 of 8 connected accounts
    d.inventory = [r for r in d.inventory if r.account_id == "a0"]
    assert by_id(assess(d))["inventory"]["status"] == "weak"


def test_old_findings_exports_are_flagged_by_age():
    d = good()
    d.findings = [finding("f", owner="o", decision="fix", opened_days_ago=40)]
    assert by_id(assess(d))["freshness"]["status"] == "note"
    d.findings = [finding("f", owner="o", decision="fix", opened_days_ago=90)]
    assert by_id(assess(d))["freshness"]["status"] == "weak"


def test_a_findings_export_without_owner_and_decision_columns_is_suspicious():
    d = good()
    d.findings = [finding(f"f{i}", opened_days_ago=20) for i in range(6)]
    assert by_id(assess(d))["columns"]["status"] == "weak"
    d.findings = [finding(f"f{i}", opened_days_ago=20) for i in range(3)]                  # too few to tell
    assert by_id(assess(d))["columns"]["status"] == "ok"


def test_few_accounts_and_forgotten_accounts_are_notes():
    d = good(4)
    assert "each one moves L1 by 25 points" in by_id(assess(d))["granularity"]["detail"]
    d = good(8)
    d.accounts = [account(f"x{i}", connected=False, sources=("billing", "org"), last_spend=0.0, owner="") for i in range(8)]
    assert by_id(assess(d))["orphans"]["status"] == "note"


def test_no_findings_is_a_note_and_confidence_is_attached_to_the_score():
    d = good()
    d.findings = []
    assert by_id(assess(d))["findings"]["status"] == "note"
    assert compute_score(good()).quality["confidence"] == "high"
