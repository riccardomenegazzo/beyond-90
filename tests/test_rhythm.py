import json
import shutil
from datetime import timedelta
from pathlib import Path

import pytest

from beyond90 import rhythm
from beyond90.catalogue import Catalogue
from beyond90.loader import DataError, load_customer
from beyond90.radar import parse_threats
from beyond90.web import analyze, analyze_book

ROOT = Path(__file__).resolve().parent.parent
PORTFOLIO = ROOT / "examples" / "portfolio"
FEED = json.loads((ROOT / "examples" / "threats.json").read_text())
CAT = Catalogue.load()


@pytest.fixture
def northwind(tmp_path):
    d = tmp_path / "nw"
    shutil.copytree(PORTFOLIO / "northwind", d)
    return d


def load(d):
    return load_customer(d, CAT)[0]


def set_interactions(d, rows):
    (d / "interactions.csv").write_text("date,kind,contact_id,summary,next_step,next_due\n" + "".join(r + "\n" for r in rows))


def test_tiers_map_to_cadence_and_can_be_overridden(northwind):
    d = load(northwind)
    assert rhythm.tier_class("Elite") == "top" and rhythm.tier_class("premium") == "mid" and rhythm.tier_class("growth") == "other" and rhythm.tier_class("") == "other"
    assert rhythm.cadence_days(d) == 14                      # the example is "enterprise", a mid tier
    toml = (northwind / "customer.toml").read_text()
    (northwind / "customer.toml").write_text(toml.replace("[settings]", "[settings]\ncadence_days = 10") if "[settings]" in toml else toml + "\n[settings]\ncadence_days = 10\n")
    assert rhythm.cadence_days(load(northwind)) == 10


def test_touch_state_follows_the_log_and_the_cadence(northwind):
    as_of = load(northwind).as_of
    day = lambda n: (as_of - timedelta(days=n)).isoformat()      # noqa: E731
    (northwind / "contacts.csv").write_text("id,name,role,team,influence,last_contact,credibility,reliability,intimacy,self_orientation\n")
    (northwind / "commitments.csv").write_text("id,contact_id,description,promised_on,due_on,done_on\n")
    for days, state in ((1, "ok"), (13, "due_soon"), (15, "overdue"), (60, "overdue")):
        set_interactions(northwind, [f"{day(days)},call,,x,,"])
        t = rhythm.touch_status(load(northwind))
        assert t["state"] == state and t["days_since"] == days, (days, t)
    (northwind / "interactions.csv").unlink()
    assert rhythm.touch_status(load(northwind))["state"] == "never"


def test_only_the_latest_next_step_is_open_and_it_can_be_overdue(northwind):
    d0 = load(northwind)
    day = lambda n: (d0.as_of + timedelta(days=n)).isoformat()   # noqa: E731
    set_interactions(northwind, [f"{day(-20)},call,,old,Send the old thing,{day(-15)}", f"{day(-3)},call,,new,Send the list,{day(-1)}"])
    fu = rhythm.touch_status(load(northwind))["follow_up"]
    assert fu["step"] == "Send the list" and fu["overdue"] is True
    set_interactions(northwind, [f"{day(-3)},call,,new,Send the list,{day(5)}"])
    assert rhythm.touch_status(load(northwind))["follow_up"]["overdue"] is False


def test_the_log_is_validated_like_every_other_file(northwind):
    d0 = load(northwind)
    for row, needle in ((f"{(d0.as_of + timedelta(days=1)).isoformat()},call,,x,,", "after as_of"), (f"{d0.as_of},chat,,x,,", "kind"), (f"{d0.as_of},call,nobody,x,,", "contact_id"), ("tomorrow,call,,x,,", "date")):
        set_interactions(northwind, [row])
        with pytest.raises(DataError, match=needle):
            load(northwind)


def test_the_log_is_personal_so_it_is_hashed_but_flagged():
    from beyond90.connect.pipeline import PERSONAL
    from beyond90.provenance import INPUT_FILES
    assert "interactions.csv" in INPUT_FILES and "interactions.csv" in PERSONAL


def test_expansion_is_gated_by_trust():
    nw = analyze(str(PORTFOLIO / "northwind"))["dashboard"]["rhythm"]["expansion"]
    assert nw["gate"]["ready"] is False and nw["say"].startswith("Not yet") and nw["signals"]
    co = analyze(str(PORTFOLIO / "contoso-bank"))["dashboard"]["rhythm"]["expansion"]
    assert co["gate"]["ready"] is True and "questions and outcomes" in co["say"]


def test_a_capacity_signal_needs_real_pressure_on_the_licence(northwind):
    (northwind / "entitlements.csv").write_text("unit,licensed,used\nsensors,1000,950\ncode_seats,300,100\n")
    ex = analyze(str(northwind))["dashboard"]["rhythm"]["expansion"]["signals"]
    cap = [s for s in ex if s["kind"] == "capacity"]
    assert len(cap) == 1 and "sensors" in cap[0]["title"]


def test_the_brief_starts_with_what_we_owe_and_invents_nothing():
    rh = analyze(str(PORTFOLIO / "northwind"), since=str(ROOT / "examples" / "history" / "northwind-2026-09"), advisories=FEED)["dashboard"]["rhythm"]
    items = rh["prep"]["items"]
    assert items[0]["id"] == "owed" and any("Introduce the cloud detection specialist" in p for p in items[0]["points"])
    assert [i["id"] for i in items][:3] == ["owed", "changed", "news"]
    md = rh["prep_markdown"]
    assert md.startswith("# Call prep: Northwind") and "Derived from the customer's files" in md
    text = json.dumps(items)
    for fact in ("MOCK-2026-001", "Yield moved +5.2"):
        assert fact in text


def test_advisories_are_matched_with_the_same_numbers_as_the_radar():
    from beyond90.radar import threat_radar
    d = load(PORTFOLIO / "northwind")
    threats = parse_threats(FEED, CAT)
    mine = {e["id"]: e for e in rhythm.customer_exposures(d, threats, CAT)}
    for rep in threat_radar([(d.name, d)], threats, CAT, as_of=d.as_of):
        for c in rep.customers:
            e = mine[rep.threat.id]
            assert (e["exposed"], e["covered"], e["uncovered"], e["unknown"]) == (c.exposed_accounts, c.covered_accounts, len(c.uncovered_ids), len(c.unknown_ids))


def test_feed_text_is_cleaned_and_only_web_links_survive():
    feed = [{"id": "X-1", "title": "Bad <script>alert(1)</script>\nline|pipe", "severity": "high", "resource_types": ["storage_object"], "mitigated_by": ["posture"],
             "summary": "s‮", "url": "javascript:alert(1)"},
            {"id": "X-2", "title": "ok", "severity": "low", "resource_types": ["storage_object"], "mitigated_by": ["posture"], "url": "https://example.org/a?b=1"}]
    a, b = parse_threats(feed, CAT)
    assert "\n" not in a.title and "|" not in a.title and "‮" not in a.summary
    assert a.url == "" and b.url == "https://example.org/a?b=1"


def test_a_feed_for_another_catalogue_is_skipped_not_fatal_but_a_broken_feed_is():
    r = analyze(str(ROOT / "examples" / "profiles" / "endpoint" / "acme-endpoint"), advisories=FEED)
    assert r["ok"] and any("skipped" in w for w in r["warnings"])
    bad = analyze(str(PORTFOLIO / "northwind"), advisories=[{"id": "", "severity": "meh"}])
    assert bad["ok"] is False and "severity" in " ".join(bad["errors"])


def groups():
    return {d.name: {p.name: p.read_text() for p in d.iterdir() if p.suffix in (".csv", ".toml")} for d in sorted(PORTFOLIO.iterdir()) if d.is_dir()}


def test_the_week_orders_the_book_with_a_reason_for_every_place():
    b = analyze_book(groups(), advisories=FEED, week_hours=30)
    rows = b["week"]["rows"]
    assert [r["priority"] for r in rows] == sorted((r["priority"] for r in rows), reverse=True)
    assert all(r["reasons"] for r in rows) and {r["key"] for r in rows} == set(b["preps"])
    assert rows[0]["name"].startswith("Northwind") and rows[-1]["name"].startswith("Contoso")      # urgent work first, a customer on cadence last
    assert abs(sum(r["hours"] for r in rows) - 30) <= 1.5          # the budget is spent, to the nearest half hour each
    assert b["week_markdown"].startswith("# Your week")


def test_a_budget_that_cannot_cover_the_calls_says_so():
    b = analyze_book(groups(), week_hours=2)
    assert b["week"]["over_budget"] is True and "something has to give" in b["week_markdown"]


def test_the_top_tier_is_weighted_above_the_rest_for_the_same_need():
    from beyond90.models import CustomerData  # noqa: F401
    rows = []
    for tier in ("elite", "premium", "growth"):
        d = load(PORTFOLIO / "contoso-bank")
        d.tier = tier
        rows.append((tier, d))
    from beyond90.scoring import compute_score
    plan = rhythm.week_plan([{"key": t, "name": t, "data": d, "score": compute_score(d, CAT), "renewal": None, "exposures": []} for t, d in rows], 30)
    assert [r["key"] for r in plan["rows"]] == ["elite", "premium", "growth"]
    hours = {r["key"]: r["hours"] for r in plan["rows"]}
    assert hours["elite"] >= hours["premium"] >= hours["growth"]
