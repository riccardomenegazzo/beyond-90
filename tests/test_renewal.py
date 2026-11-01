from datetime import date, timedelta

import pytest

from beyond90.catalogue import Catalogue
from beyond90.loader import DataError, load_customer
from beyond90.models import Activation, Commitment, Contact, Entitlement
from beyond90.playbooks import generate_actions
from beyond90.renewal import compute_renewal
from beyond90.scoring import compute_score
from beyond90.sections import md_renewal, renewal_headline
from beyond90.successplan import render_success_plan

from helpers import AS_OF, account, data, finding, full_inventory

CAT = Catalogue.load()


def customer(renewal_in=100, **kw):
    accs = [account(f"a{i}", sources=("billing", "org"), owner="o") for i in range(4)]
    d = data(accounts=accs, inventory=[r for a in accs for r in full_inventory(a.id)],
             activations=[Activation(a.id, m.id, True) for a in accs for m in CAT.modules_at("2026.4") if "aws" in m.providers],
             findings=[finding("f", owner="o", decision="fix", opened_days_ago=2)], **kw)
    d.renewal_date = None if renewal_in is None else AS_OF + timedelta(days=renewal_in)
    return d


def sig(r, id):
    return next(s for s in r["signals"] if s["id"] == id)


def good_people(d):
    d.contacts = [Contact("e", "E", "executive_sponsor", team="t", last_contact=AS_OF - timedelta(days=10)),
                  Contact("c", "C", "champion", team="t", last_contact=AS_OF - timedelta(days=5))]
    d.commitments = [Commitment("k", "x", AS_OF - timedelta(days=20), done_on=AS_OF - timedelta(days=22))]
    d.entitlements = [Entitlement("sensors", 100, 90)]


def test_no_renewal_date_means_no_section():
    d = customer(renewal_in=None)
    assert compute_renewal(d, compute_score(d, CAT)) is None and md_renewal(None) == []


def test_a_healthy_customer_is_ready_and_nothing_is_flagged():
    d = customer()
    good_people(d)
    r = compute_renewal(d, compute_score(d, CAT))
    assert r["status"] == "ready" and r["days"] == 100 and r["state"] == "approaching" and r["arr_at_risk"] == 0.0
    assert all(s["status"] in ("ok", "not measured") for s in r["signals"])


def test_the_status_is_the_worst_measured_signal_and_arr_is_at_risk_only_inside_the_window():
    d = customer()
    good_people(d)
    d.contacts = [c for c in d.contacts if c.role != "executive_sponsor"] + [Contact("c2", "C2", "practitioner", last_contact=AS_OF - timedelta(days=3))]
    r = compute_renewal(d, compute_score(d, CAT))
    assert sig(r, "sponsor")["status"] == "risk" and r["status"] == "at_risk" and r["arr_at_risk"] == d.arr
    d2 = customer(renewal_in=400)
    d2.contacts = list(d.contacts)
    far = compute_renewal(d2, compute_score(d2, CAT))
    assert far["status"] == "at_risk" and far["state"] == "later" and far["arr_at_risk"] == 0.0           # at risk in kind, not yet in time


def test_licence_use_has_three_bands():
    for used, status in ((90, "ok"), (60, "watch"), (30, "risk")):
        d = customer()
        good_people(d)
        d.entitlements = [Entitlement("sensors", 100, used)]
        assert sig(compute_renewal(d, compute_score(d, CAT)), "licences")["status"] == status


def test_unmeasured_signals_are_listed_and_never_count_as_good_news():
    d = customer()
    r = compute_renewal(d, compute_score(d, CAT))
    assert {"licences", "relationship"} <= set(r["not_measured"]) and r["status"] == "ready"
    assert "not measured" in "\n".join(md_renewal(r))


def test_a_falling_yield_is_a_signal_and_a_rising_one_is_not():
    d = customer()
    good_people(d)
    s = compute_score(d, CAT)
    assert sig(compute_renewal(d, s, {"yield": s.yield_ + 0.06, "as_of": "2026-09-30"}), "trend")["status"] == "risk"
    assert sig(compute_renewal(d, s, {"yield": s.yield_ + 0.03, "as_of": "2026-09-30"}), "trend")["status"] == "watch"
    assert sig(compute_renewal(d, s, {"yield": s.yield_ - 0.05, "as_of": "2026-09-30"}), "trend")["status"] == "ok"


def test_a_date_in_the_past_is_said_plainly():
    d = customer(renewal_in=-12)
    r = compute_renewal(d, compute_score(d, CAT))
    assert r["state"] == "passed" and "12 days ago" in renewal_headline(r)


def test_the_loader_reads_the_date_and_refuses_nonsense(tmp_path):
    (tmp_path / "customer.toml").write_text('[customer]\nname = "T"\nas_of = 2026-10-31\nrenewal_date = 2027-03-01\n')
    (tmp_path / "accounts.csv").write_text("id,provider,sources,connected\na1,aws,billing;org,true\n")
    assert load_customer(tmp_path)[0].renewal_date == date(2027, 3, 1)
    (tmp_path / "customer.toml").write_text('[customer]\nname = "T"\nas_of = 2026-10-31\nrenewal_date = "soon"\n')
    with pytest.raises(DataError) as e:
        load_customer(tmp_path)
    assert "renewal_date" in str(e.value)


def test_the_portfolio_lists_renewals_by_date_with_the_revenue_at_risk():
    from pathlib import Path

    from beyond90.portfolio import load_portfolio, render_portfolio_markdown
    md = render_portfolio_markdown(load_portfolio(Path(__file__).resolve().parent.parent / "examples" / "portfolio"))
    assert "## Renewals" in md and md.index("Fabrikam") < md.index("2027-02-28") and "Revenue at risk" in md


def test_the_qbr_keeps_renewal_in_the_private_section_only():
    from beyond90.qbr import render_qbr
    d = customer()
    good_people(d)
    s = compute_score(d, CAT)
    q = render_qbr(s, generate_actions(d, s, CAT), None, "", renewal=compute_renewal(d, s))
    assert "Renewal readiness" in q and q.index("Renewal readiness") > q.index("For you only")


# ------------------------------------------------------------------ success plan

def plan_for(d):
    s = compute_score(d, CAT)
    return render_success_plan(s, generate_actions(d, s, CAT), None, owner="Alex")


def test_the_success_plan_has_every_section_and_something_to_sign():
    d = customer()
    d.activations = [Activation(a.id, "posture", True) for a in d.accounts]
    md = plan_for(d)
    for h in ("## Outcomes we are working toward", "## How we will measure progress", "## Who does what", "## What we need from you", "## What we commit to", "## What could get in the way", "## Agreed"):
        assert h in md, h
    assert "Alex" in md and "Customer sponsor" in md


def test_the_success_plan_contains_nothing_private():
    d = customer()
    good_people(d)
    d.contacts[0] = Contact("e", "Private Person", "executive_sponsor", team="t", last_contact=AS_OF, credibility=1, reliability=1, intimacy=1, self_orientation=9)
    md = plan_for(d)
    for word in ("Private Person", "self-orientation", "trust index", "Renewal", "sponsor on record"):
        assert word not in md, word


def test_a_customer_with_no_gaps_gets_a_plan_to_hold_the_level():
    d = customer()
    assert "Keep the current level" in plan_for(d)
