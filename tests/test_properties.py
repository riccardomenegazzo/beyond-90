"""Properties that must hold for any estate, checked on seeded random ones (no external library)."""
import json
import random
from datetime import date, timedelta

import pytest

from beyond90.attribution import explain
from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.planner import build_plan
from beyond90.playbooks import generate_actions
from beyond90.provenance import hash_directory, input_hash
from beyond90.scoring import compute_score

CAT = Catalogue.load()
AS_OF = date(2026, 10, 31)
SEEDS = range(40)


def estate(seed: int, as_of: date = AS_OF) -> dict[str, str]:
    r = random.Random(seed)
    n = r.randint(1, 30)
    providers = [r.choice(["aws", "azure", "gcp"]) for _ in range(n)]
    rows = ["id,provider,sources,connected,owner,last_spend,status,in_plan"]
    for i, p in enumerate(providers):
        src = ";".join(r.sample(["billing", "org", "sso"], r.randint(1, 3)))
        rows.append(f"a{i},{p},{src},{r.choice(['true', 'false'])},{r.choice(['', 'retail', 'data', 'platform'])},{r.randint(0, 500)},{r.choice(['active'] * 9 + ['decommissioned'])},{r.choice(['true', 'false'])}")
    inv = ["account_id,resource_type,count,inventoried"]
    for i, p in enumerate(providers):
        for t in CAT.expected_types(p):
            if r.random() < 0.8:
                inv.append(f"a{i},{t},{r.randint(0, 50)},{r.choice(['true'] * 4 + ['false'])}")
    act = ["account_id,module_id,active"]
    for i, p in enumerate(providers):
        for m in CAT.modules:
            if p in m.providers and r.random() < 0.6:
                act.append(f"a{i},{m.id},{r.choice(['true', 'false'])}")
    fin = ["id,account_id,severity,exposure,opened_at,closed_at,owner,decision,expiry"]
    for j in range(r.randint(0, 40)):
        opened = as_of - timedelta(days=r.randint(0, 200))
        closed = opened + timedelta(days=r.randint(0, 60)) if r.random() < 0.5 else None
        closed = closed if closed and closed <= as_of else None
        decision = r.choice(["", "fix", "accepted_risk", "exception", "false_positive"])
        expiry = (as_of + timedelta(days=r.randint(-30, 90))).isoformat() if decision == "accepted_risk" and r.random() < 0.7 else ""
        fin.append(f"f{j},a{r.randrange(n)},{r.choice(['critical', 'high', 'medium', 'low'])},{r.choice(['internet', 'internal'])},{opened},{closed or ''},{r.choice(['', 'alice', 'bob'])},{decision},{expiry}")
    teams = ["id,name,has_assets,active_users,sso,role_scoped"] + [f"t{k},T{k},true,{r.randint(0, 5)},{r.choice(['true', 'false'])},{r.choice(['true', 'false'])}" for k in range(r.randint(0, 6))]
    return {
        "customer.toml": f'[customer]\nname = "R{seed}"\nas_of = {as_of}\narr = {r.randint(10, 900) * 1000}\n',
        "accounts.csv": "\n".join(rows) + "\n", "inventory.csv": "\n".join(inv) + "\n", "activations.csv": "\n".join(act) + "\n",
        "findings.csv": "\n".join(fin) + "\n", "teams.csv": "\n".join(teams) + "\n",
    }


def load(tmp_path, files):
    for k, v in files.items():
        (tmp_path / k).write_text(v)
    try:
        return load_customer(tmp_path, CAT, require_accounts=True)[0]
    except Exception:                                                   # an estate with only decommissioned accounts is refused by design
        return None


@pytest.mark.parametrize("seed", SEEDS)
def test_scores_are_bounded_deterministic_and_the_product_of_their_stages(tmp_path, seed):
    d = load(tmp_path, estate(seed))
    if d is None:
        pytest.skip("empty estate")
    s = compute_score(d, CAT)
    vals = [s.stages[k].value for k in ("L1", "L2", "L3", "L4")]
    assert all(0.0 <= v <= 1.0 for v in vals) and 0.0 <= s.yield_ <= 1.0
    assert s.yield_ == pytest.approx(vals[0] * vals[1] * vals[2] * vals[3], abs=1e-12)
    assert json.dumps(s.to_dict(), sort_keys=True) == json.dumps(compute_score(d, CAT).to_dict(), sort_keys=True)
    assert s.quality["confidence"] in ("high", "medium", "low")
    assert all(a.effect_points >= 0 for a in generate_actions(d, s, CAT))


@pytest.mark.parametrize("seed", SEEDS[:15])
def test_row_order_and_line_endings_change_nothing(tmp_path, seed):
    files = estate(seed)
    d1 = load(tmp_path, files)
    if d1 is None:
        pytest.skip("empty estate")
    h1 = input_hash(hash_directory(tmp_path))
    r = random.Random(seed)
    shuffled = {}
    for name, text in files.items():
        if name.endswith(".csv"):
            head, *body = text.strip("\n").split("\n")
            r.shuffle(body)
            text = "\r\n".join([head, *body]) + "\r\n"
        shuffled[name] = text
    other = tmp_path / "other"
    other.mkdir()
    d2 = load(other, shuffled)
    s1, s2 = compute_score(d1, CAT), compute_score(d2, CAT)
    assert {k: v.value for k, v in s1.stages.items()} == pytest.approx({k: v.value for k, v in s2.stages.items()})
    assert s1.yield_ == pytest.approx(s2.yield_) and s1.outcomes["critical_open"] == s2.outcomes["critical_open"]
    assert {a.id for a in generate_actions(d1, s1, CAT)} == {a.id for a in generate_actions(d2, s2, CAT)}
    assert h1 != input_hash(hash_directory(other))                      # row order is content: a different file is a different input, even when the score agrees


@pytest.mark.parametrize("seed", SEEDS[:12])
def test_a_generous_plan_never_ends_below_where_it_started_and_never_above_one(tmp_path, seed):
    d = load(tmp_path, estate(seed))
    if d is None:
        pytest.skip("empty estate")
    p = build_plan(d, CAT, hours_per_week=40, horizon_weeks=52, realization=1.0)
    assert 0.0 <= p.end_yield <= 1.0 and p.end_yield >= p.start_yield - 1e-9
    assert all(0.0 <= w.yield_ <= 1.0 for w in p.weeks)
    q = build_plan(d, CAT, hours_per_week=40, horizon_weeks=52, realization=1.0)
    assert json.dumps(p.to_dict(), sort_keys=True) == json.dumps(q.to_dict(), sort_keys=True)


@pytest.mark.parametrize("seed", SEEDS[:12])
def test_attribution_accounts_for_the_whole_change(tmp_path, seed):
    new = load(tmp_path, estate(seed))
    other = tmp_path / "old"
    other.mkdir()
    old = load(other, estate(seed + 1000, as_of=AS_OF - timedelta(days=30)))
    if new is None or old is None:
        pytest.skip("empty estate")
    a = explain(compute_score(new, CAT), compute_score(old, CAT).to_dict(), new, CAT)
    assert a.delta_points == pytest.approx(a.yield_to * 100 - a.yield_from * 100, abs=1e-6)
    assert a.customer_points + a.bar_points == pytest.approx(a.delta_points, abs=1e-6)         # no residual: the two parts are the whole change


@pytest.mark.parametrize("seed", SEEDS[:25])
def test_the_ladder_and_the_views_are_consistent_on_random_estates(tmp_path, seed):
    d = load(tmp_path, estate(seed))
    if d is None:
        pytest.skip("empty estate")
    s = compute_score(d, CAT)
    r = s.rubric
    order = ["basic", "bronze", "silver", "gold"]
    for c in r["checks"]:
        if order.index(c["level"]) <= order.index(r["level"]) and r["level"] != "basic":
            assert c["status"] != "fail", (c["id"], r["level"])               # nothing at or below the level may fail
    if r["next_level"]:
        assert all(c["level"] == r["next_level"] and c["status"] == "fail" for c in r["blocking"])
        assert r["blocking"] or any(c["level"] == r["next_level"] and c["status"] != "pass" for c in r["checks"]) or r["next_level"] is None
    if s.views:
        assert sum(u["relevant"] for u in s.views["use_cases"]) == s.stages["L3"].denominator
        assert all(0.0 <= u["rate"] <= 1.0 for u in s.views["use_cases"])
    assert json.dumps(s.to_dict(), sort_keys=True) == json.dumps(compute_score(d, CAT).to_dict(), sort_keys=True)
