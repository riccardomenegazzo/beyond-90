from pathlib import Path

import pytest

from beyond90.loader import DataError, load_customer

TOML = '[customer]\nname = "T"\nas_of = 2026-10-31\n'
ACCOUNTS = "id,provider,sources,connected\na1,aws,billing;org,true\na2,azure,billing,false\n"


def write(tmp_path: Path, **files):
    (tmp_path / "customer.toml").write_text(files.pop("toml", TOML))
    (tmp_path / "accounts.csv").write_text(files.pop("accounts", ACCOUNTS))
    for name, text in files.items():
        (tmp_path / f"{name}.csv").write_text(text)
    return tmp_path


def test_minimal_directory_loads(tmp_path):
    d, warnings = load_customer(write(tmp_path))
    assert d.name == "T" and len(d.accounts) == 2 and d.accounts[0].sources == ("billing", "org")
    assert warnings == [] and d.findings == []


def test_errors_are_collected_with_file_and_line(tmp_path):
    write(tmp_path,
          accounts="id,provider,sources,connected\na1,aws,billing,maybe\na1,aws,billing,true\n,aws,billing,true\n",
          findings="id,account_id,severity,opened_at\nf1,nope,high,2026-10-01\nf2,a1,urgent,31-10-2026\n",
          teams="id,has_assets,active_users,sso\nt1,true,1,true\n")
    with pytest.raises(DataError) as exc:
        load_customer(tmp_path)
    text = "\n".join(exc.value.errors)
    assert "accounts.csv:2: connected: expected true/false, got 'maybe'" in text
    assert "appears 2 times" in text
    assert "accounts.csv:4: id: required" in text
    assert "findings.csv:2: account_id 'nope' is not in accounts.csv" in text
    assert "findings.csv:3: severity: 'urgent' is not one of" in text
    assert "findings.csv:3: opened_at: expected YYYY-MM-DD" in text
    assert "teams.csv:1: missing column(s): role_scoped" in text


def test_missing_files_and_bad_toml(tmp_path):
    with pytest.raises(DataError, match=r"customer\.toml"):
        load_customer(tmp_path)
    (tmp_path / "customer.toml").write_text("not = [valid")
    with pytest.raises(DataError, match="invalid TOML"):
        load_customer(tmp_path)
    (tmp_path / "customer.toml").write_text(TOML)
    with pytest.raises(DataError, match=r"accounts\.csv: not found"):
        load_customer(tmp_path)


def test_settings_validation(tmp_path):
    toml = TOML + '[settings]\nceiling_version = "2025.1"\nbaseline_ceiling = "2026.1"\ntriage_window_days = -1\n[settings.sla_days]\ncritical = 0\nweird = 3\n'
    write(tmp_path, toml=toml)
    with pytest.raises(DataError) as exc:
        load_customer(tmp_path)
    text = "\n".join(exc.value.errors)
    assert "baseline_ceiling is newer" in text and "triage_window_days" in text
    assert "sla_days.critical" in text and "sla_days.weird" in text


def test_unknown_catalogue_entries_warn_instead_of_failing(tmp_path):
    write(tmp_path,
          inventory="account_id,resource_type,count,inventoried\na1,teleporter,1,true\na1,compute,2,true\n",
          activations="account_id,module_id,active\na1,time_travel,true\n")
    d, warnings = load_customer(tmp_path)
    assert len(d.inventory) == 1 and d.activations == []
    assert len(warnings) == 2


def test_optional_date_must_still_parse_and_downgrade_needs_a_date(tmp_path):
    write(tmp_path, findings="id,account_id,severity,opened_at,closed_at,previous_severity,severity_changed_at\n"
                             "f1,a1,low,2026-10-01,2026-09-01,high,\n")
    with pytest.raises(DataError) as exc:
        load_customer(tmp_path)
    text = "\n".join(exc.value.errors)
    assert "closed_at is before opened_at" in text and "severity_changed_at is required" in text


def test_contacts_and_commitments_load(tmp_path):
    d, _ = load_customer(write(
        tmp_path,
        contacts="id,name,role,influence,credibility,reliability,intimacy,self_orientation,last_contact\n"
                 "c1,Ana,executive_sponsor,,8,7,6,3,2026-10-01\n",
        commitments="id,description,due_on,contact_id\nk1,send the plan,2026-10-20,c1\n",
    ))
    assert d.contacts[0].influence == 3 and d.contacts[0].credibility == 8       # influence defaults from the role
    assert d.commitments[0].contact_id == "c1"


@pytest.mark.parametrize("contacts,commitments,needle", [
    ("id,role,credibility\nc1,champion,11\n", None, "credibility"),
    ("id,role\nc1,wizard\n", None, "role"),
    ("id,role,influence\nc1,champion,5\n", None, "influence"),
    ("id,role\nc1,champion\n", "id,due_on,contact_id\nk1,2026-10-01,ghost\n", "ghost"),
    ("id,role\nc1,champion\n", "id,due_on,promised_on\nk1,2026-10-01,2026-10-05\n", "promised_on"),
])
def test_relationship_files_are_validated(tmp_path, contacts, commitments, needle):
    files = {"contacts": contacts}
    if commitments:
        files["commitments"] = commitments
    with pytest.raises(DataError) as e:
        load_customer(write(tmp_path, **files))
    assert needle in str(e.value)


def test_an_unknown_account_source_is_named(tmp_path):
    write(tmp_path, accounts="id,provider,sources,connected\na1,aws,billing;rumour,true\n")
    with pytest.raises(DataError) as exc:
        load_customer(tmp_path)
    assert any("rumour is not one of billing;org;sso;manual;plan;platform" in e for e in exc.value.errors)


def test_a_semicolon_separated_file_is_read_and_said(tmp_path):
    d, warnings = load_customer(write(tmp_path, accounts="id;provider;sources;connected;last_spend\na1;aws;billing,org;true;1234,5\na2;azure;billing;false;80\n"))
    assert [a.id for a in d.accounts] == ["a1", "a2"] and d.accounts[0].sources == ("billing", "org")
    assert d.accounts[0].last_spend == 1234.5                  # a decimal comma in a ';' file
    assert any("accounts.csv" in w and "';'" in w for w in warnings)


def test_a_tab_separated_file_is_read(tmp_path):
    d, warnings = load_customer(write(tmp_path, accounts="id\tprovider\tsources\tconnected\na1\taws\tbilling\ttrue\n"))
    assert len(d.accounts) == 1 and any("a tab" in w for w in warnings)


def test_a_comma_file_is_untouched_and_a_decimal_comma_is_not_guessed(tmp_path):
    _, warnings = load_customer(write(tmp_path))
    assert warnings == []
    sub = tmp_path / "x"
    sub.mkdir()
    with pytest.raises(DataError) as e:
        load_customer(write(sub, accounts='id,provider,sources,connected,last_spend\na1,aws,billing,true,"1234,5"\n'))
    assert "expected a number" in str(e.value)


def test_a_semicolon_file_with_a_stray_separator_is_refused_not_truncated(tmp_path):
    with pytest.raises(DataError) as e:
        load_customer(write(tmp_path, accounts="id;provider;sources;connected\na1;aws;billing;org;true\n"))
    assert "more values than columns" in str(e.value)


def test_a_day_first_date_gets_a_hint_not_a_guess(tmp_path):
    with pytest.raises(DataError) as e:
        load_customer(write(tmp_path, toml='[customer]\nname = "T"\nas_of = 2026-10-31\n', accounts=ACCOUNTS, findings="id,account_id,severity,opened_at\nf1,a1,high,31/10/2026\n"))
    assert "save the dates as YYYY-MM-DD" in str(e.value)
