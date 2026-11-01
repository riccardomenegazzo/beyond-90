import json
from pathlib import Path

import pytest

from beyond90 import __version__
from beyond90.loader import DataError, load_customer
from beyond90.provenance import SCHEMA_VERSION, describe, file_hash, hash_directory, input_hash
from beyond90.scoring import compute_score, percentile

from helpers import account, data, finding

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "examples" / "portfolio" / "northwind"
PINNED = "ef9ae1d985e6d7509920dfc1ca9e74b51a02d6e05b89a1c1e87e7bb3e73f7316"     # pinned in site/test/ too
PINNED_JS = "9638e700961eabd22e0b9cb2facaa66b42f7195680e19520bb9ed745d4d03afd"
TOML = '[customer]\nname = "T"\nas_of = 2026-10-31\n'
ACCOUNTS = "id,provider,sources,connected\na1,aws,billing;org,true\n"


def write(tmp_path, **files):
    (tmp_path / "customer.toml").write_text(files.pop("toml", TOML))
    (tmp_path / "accounts.csv").write_text(files.pop("accounts", ACCOUNTS))
    for name, text in files.items():
        (tmp_path / f"{name}.csv").write_text(text)
    return tmp_path


# ---- fingerprint
def test_line_endings_and_bom_do_not_change_the_fingerprint_but_content_does():
    a = b"id,provider\na1,aws\n"
    assert file_hash(a) == file_hash(a.replace(b"\n", b"\r\n")) == file_hash(b"\xef\xbb\xbf" + a) == file_hash(a.replace(b"\n", b"\r"))
    assert file_hash(a) != file_hash(a.replace(b"aws", b"aws "))                     # a trailing space is a different input


def test_input_hash_depends_on_names_and_content_not_on_order():
    x = {"accounts.csv": "aa", "customer.toml": "bb"}
    assert input_hash(x) == input_hash(dict(reversed(list(x.items()))))
    assert input_hash(x) != input_hash({"accounts.csv": "bb", "customer.toml": "aa"})
    assert input_hash(x) != input_hash({**x, "findings.csv": "cc"})


def test_known_fingerprint_so_the_other_implementation_can_be_checked():
    # The browser app computes the same value in JavaScript; this constant is pinned in site/test/ as well.
    assert input_hash({"a.csv": file_hash(b"x\n"), "b.csv": file_hash(b"y\n")}) == PINNED
    assert input_hash({"accounts.csv": file_hash(b"y\n"), "customer.toml": file_hash(b"x\n")}) == PINNED_JS
    assert len(input_hash({})) == 64


def test_score_carries_its_provenance_and_it_is_deterministic(tmp_path):
    d1, _ = load_customer(write(tmp_path))
    s1, s2 = compute_score(d1), compute_score(d1)
    p = s1.provenance
    assert p["engine"] == __version__ and p["schema_version"] == SCHEMA_VERSION and p["files"].keys() == {"customer.toml", "accounts.csv"}
    assert p == s2.provenance and p["input_hash"] == hash_and_combine(tmp_path)
    assert "Derived from inputs" in describe(p) and p["input_hash"][:12] in describe(p)
    assert json.loads(json.dumps(s1.to_dict()))["provenance"]["input_hash"] == p["input_hash"]


def hash_and_combine(base):
    return input_hash(hash_directory(base))


def test_changing_one_cell_changes_the_fingerprint_and_nothing_else_about_how_it_is_computed(tmp_path):
    a, _ = load_customer(write(tmp_path))
    (tmp_path / "accounts.csv").write_text(ACCOUNTS.replace("true", "false"))
    b, _ = load_customer(tmp_path)
    assert compute_score(a).provenance["input_hash"] != compute_score(b).provenance["input_hash"]


def test_in_memory_data_has_no_provenance():
    assert compute_score(data(accounts=[account("a")])).provenance == {}


# ---- tolerant reader
def test_the_example_data_produces_no_warnings():
    assert load_customer(DEMO)[1] == []


def test_unknown_columns_are_ignored_with_a_hint_and_never_an_error(tmp_path):
    d, warnings = load_customer(write(tmp_path, accounts="id,provider,sources,connected,ownr,region\na1,aws,billing,true,x,eu\n"))
    assert len(d.accounts) == 1
    msg = next(w for w in warnings if w.startswith("accounts.csv"))
    assert "'ownr' (did you mean 'owner'?)" in msg and "'region'" in msg and "did you mean" not in msg.split("'region'")[1]


def test_unknown_settings_and_customer_keys_warn_with_a_suggestion(tmp_path):
    toml = TOML + 'colour = 1\n[settings]\ntriage_window_dayz = 3\nsla_days = { critical = 5 }\n'
    _, warnings = load_customer(write(tmp_path, toml=toml))
    assert any("'triage_window_dayz' is ignored (did you mean 'triage_window_days'?)" in w for w in warnings)
    assert any("'colour' is ignored" in w for w in warnings)


def test_a_newer_data_format_is_refused_with_advice_and_an_older_or_missing_one_is_read(tmp_path):
    with pytest.raises(DataError) as e:
        load_customer(write(tmp_path, toml=TOML + "schema_version = 99\n"))
    assert "format 99" in str(e.value) and "Upgrade" in str(e.value)
    d, _ = load_customer(write(tmp_path, toml=TOML + "schema_version = 1\n"))
    assert d.schema_version == 1
    with pytest.raises(DataError):
        load_customer(write(tmp_path, toml=TOML + "schema_version = 0\n"))
    assert load_customer(write(tmp_path))[0].schema_version == SCHEMA_VERSION


# ---- percentiles
def test_percentile_is_nearest_rank_and_always_an_observed_value():
    xs = [1, 2, 3, 4, 100]
    assert (percentile(xs, 50), percentile(xs, 90), percentile(xs, 100), percentile([7], 90)) == (3, 100, 100, 7)
    assert percentile(list(range(1, 11)), 90) == 9 and percentile(list(range(1, 11)), 50) == 5


def test_mttr_reports_the_tail_not_just_the_mean():
    fs = [finding(f"f{i}", severity="critical", opened_days_ago=60, closed_after=d, owner="o", decision="fix") for i, d in enumerate([2, 3, 3, 4, 40])]
    m = compute_score(data(accounts=[account("a")], findings=fs)).outcomes["mttr"]["critical"]
    assert (m["median_days"], m["p90_days"], m["n"]) == (3, 40, 5) and m["mean_days"] == pytest.approx(10.4)
