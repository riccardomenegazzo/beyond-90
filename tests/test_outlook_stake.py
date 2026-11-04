import shutil
from datetime import timedelta
from pathlib import Path

import pytest

from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.outlook import events, ics, outlook, project
from beyond90.scoring import compute_score
from beyond90.stake import weighted
from beyond90.web import analyze

ROOT = Path(__file__).resolve().parent.parent
NW = ROOT / "examples" / "portfolio" / "northwind"
CAT = Catalogue.load()


def load(d):
    return load_customer(d, CAT)[0]


@pytest.fixture
def nw(tmp_path):
    d = tmp_path / "nw"
    shutil.copytree(NW, d)
    return d


# ----------------------------------------------------------------------------- outlook

def test_day_zero_is_today_and_the_curve_only_falls_when_nothing_is_done():
    d = load(NW)
    o = outlook(d, CAT)
    assert o["curve"][0]["yield"] == pytest.approx(compute_score(d, CAT).yield_)
    ys = [c["yield"] for c in o["curve"]]
    assert ys == sorted(ys, reverse=True) and o["loss_points"] < 0
    assert o["curve"][0]["level"] and o["curve"][-1]["day"] == 90


def test_each_event_effect_is_exactly_the_score_change_on_that_day():
    d = load(NW)
    o = outlook(d, CAT)
    day = next(e for e in o["events"] if e.get("points"))["date"]
    from datetime import date
    dd = date.fromisoformat(day)
    a, b = compute_score(project(d, dd - timedelta(days=1)), CAT).yield_, compute_score(project(d, dd), CAT).yield_
    assert next(e["points"] for e in o["events"] if e["date"] == day and e.get("points")) == pytest.approx(round((b - a) * 100, 2))


def test_the_projection_changes_only_what_is_dated():
    d = load(NW)
    later = project(d, d.as_of + timedelta(days=30))
    assert len(later.findings) == len(d.findings) and len(later.accounts) == len(d.accounts)
    expiring = {c.account_id for c in d.connectors if c.secret_expires_on and d.as_of <= c.secret_expires_on < later.as_of}
    assert expiring and all(not a.connected for a in later.accounts if a.id in expiring)
    already = {c.account_id for c in d.connectors if c.secret_expires_on and c.secret_expires_on < d.as_of}
    assert all(a.connected == b.connected for a, b in zip(d.accounts, later.accounts) if a.id in already)


def test_events_are_in_order_inside_the_window_and_say_whose_move_it_is():
    d = load(NW)
    evs = events(d, d.as_of + timedelta(days=90))
    assert [e["date"] for e in evs] == sorted(e["date"] for e in evs)
    assert all(d.as_of.isoformat() < e["date"] <= (d.as_of + timedelta(days=90)).isoformat() for e in evs)
    kinds = {e["kind"] for e in evs}
    assert {"secret_expiry", "acceptance_expiry", "triage_entry", "commitment", "cadence"} <= kinds
    assert {e["who"] for e in evs} <= {"customer", "us", "both"}


def test_an_estate_with_nothing_dated_has_nothing_to_lose(nw):
    (nw / "findings.csv").write_text("id,account_id,severity,exposure,opened_at\n")
    (nw / "connectors.csv").unlink()
    (nw / "commitments.csv").unlink()
    (nw / "interactions.csv").unlink()
    (nw / "contacts.csv").unlink()
    toml = (nw / "customer.toml").read_text().replace("renewal_date", "# renewal_date")
    (nw / "customer.toml").write_text(toml)
    o = outlook(load(nw), CAT)
    assert o["events"] == [] and o["loss_points"] == 0 and "Nothing already dated" in o["summary"]


def test_the_calendar_file_is_valid_and_stable():
    d = load(NW)
    evs = outlook(d, CAT)["events"]
    a, b = ics(evs, "Acme, Inc; test"), ics(evs, "Acme, Inc; test")
    assert a == b and a.startswith("BEGIN:VCALENDAR\r\n") and a.rstrip().endswith("END:VCALENDAR")
    assert a.count("BEGIN:VEVENT") == len(evs) and r"Acme\, Inc\; test" in a
    assert all(len(line) < 400 for line in a.split("\r\n"))


# ----------------------------------------------------------------------------- stake

def test_spend_weighting_reveals_expensive_accounts_left_out():
    d = load(NW)
    s = compute_score(d, CAT)
    w = weighted(d, s, CAT)
    assert w["stages"]["L1"] < s.stages["L1"].value - 0.05 and w["unconnected_spend_share"] > 0.15
    assert w["say"] and "by spend" in w["say"][0]
    top = w["heaviest_accounts"][0]
    assert top["gap"] == "not connected" and top["spend"] >= 18000


def test_equal_spend_gives_back_the_count(nw):
    lines = (nw / "accounts.csv").read_text().splitlines()
    head = lines[0].split(",")
    i = head.index("last_spend")
    rows = [ln.split(",") for ln in lines[1:]]
    for r in rows:
        r[i] = "100"
    (nw / "accounts.csv").write_text("\n".join([lines[0]] + [",".join(r) for r in rows]) + "\n")
    d = load(nw)
    w = weighted(d, compute_score(d, CAT), CAT)
    assert w["stages"]["L1"] == pytest.approx(w["count"]["L1"])


def test_findings_weigh_by_severity_and_exposure():
    d = load(NW)
    w = weighted(d, compute_score(d, CAT), CAT)
    weights = [f["weight"] for f in w["heaviest_findings"]]
    assert weights == sorted(weights, reverse=True) and max(weights) <= 16
    assert all(f["state"] != "ok" for f in w["heaviest_findings"])


def test_both_reach_the_dashboard_the_brief_and_the_customer_page():
    r = analyze(str(NW))
    d = r["dashboard"]
    assert d["outlook"]["events"] and d["stake"]["value"] < r["yield"]
    ids = [i["id"] for i in d["rhythm"]["prep"]["items"]]
    assert "decay" in ids and "stake" in ids
    assert "Coming up if nothing changes" in r["onboarding_status_markdown"] and "BEGIN:VEVENT" in r["outlook_ics"]
