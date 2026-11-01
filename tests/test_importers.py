import json
from datetime import date
from pathlib import Path

import pytest

from beyond90.cli import main
from beyond90.importers import (
    ImportFormatError,
    Record,
    guess_provider,
    merge,
    parse_aws_org,
    parse_azure,
    parse_csv,
    parse_gcp,
    read_accounts,
    reconcile,
    resolve_providers,
    write_accounts,
)

from helpers import account

IMP = Path(__file__).parent.parent / "examples" / "imports"


def text(name):
    return (IMP / name).read_text(encoding="utf-8")


def test_aws_org_parses_status_ids_and_dates():
    recs = {r.id: r for r in parse_aws_org(text("aws-organizations.json"))}
    assert len(recs) == 6 and recs["555555555555"].status == "decommissioned"
    assert "000000666666" in recs and recs["000000666666"].created_at == date(2026, 10, 12)
    assert all(r.provider == "aws" and r.source == "org" for r in recs.values())


def test_aws_org_accepts_a_bare_list_epoch_timestamps_and_pads_short_ids():
    raw = json.dumps([{"Id": "12345", "Status": "ACTIVE", "JoinedTimestamp": 1700000000.0}])
    (r,) = parse_aws_org(raw)
    assert r.id == "000000012345" and r.created_at == date(2023, 11, 14)


def test_azure_ids_are_lowercased_and_disabled_means_decommissioned():
    recs = {r.id: r for r in parse_azure(text("azure-accounts.json"))}
    assert "aaaaaaaa-0000-4000-8000-000000000001" in recs
    assert recs["aaaaaaaa-0000-4000-8000-000000000003"].status == "decommissioned"


def test_gcp_lifecycle_and_owner_labels():
    recs = {r.id: r for r in parse_gcp(text("gcp-projects.json"))}
    assert recs["old-project-2020"].status == "decommissioned"
    assert recs["data-platform-prod"].owner == "data" and recs["ml-experiments"].owner == "ml-research"


@pytest.mark.parametrize("fn,bad,msg", [
    (parse_aws_org, "{not json", "not valid JSON"),
    (parse_aws_org, '{"Accounts": [{"Name": "x"}]}', "no Id"),
    (parse_aws_org, '"nope"', "list-accounts"),
    (parse_azure, '{"a": 1}', "az account list"),
    (parse_gcp, '[{"name": "x"}]', "no projectId"),
])
def test_wrong_formats_fail_with_a_message_that_names_the_command(fn, bad, msg):
    with pytest.raises(ImportFormatError, match=msg):
        fn(bad)


def test_csv_sums_spend_across_rows_and_handles_thousands_separators():
    recs = {r.id: r for r in parse_csv(text("billing-cost-by-account.csv"), source="billing", id_column="Linked Account",
                                       provider="aws", spend_column="Unblended Cost", owner_column="Account Name")}
    assert recs["222222222222"].spend == pytest.approx(15500.75)
    assert recs["333333333333"].spend == pytest.approx(10150.0) and recs["111111111111"].spend == 0.0
    assert recs["777777777777"].owner == "unknown-team-experiments"


def test_csv_errors_are_specific():
    body = "a,b\n1,2\n"
    with pytest.raises(ImportFormatError, match="column 'zzz' not found; the file has: a, b"):
        parse_csv(body, source="billing", id_column="zzz", provider="aws")
    with pytest.raises(ImportFormatError, match="--provider"):
        parse_csv(body, source="billing", id_column="a")
    with pytest.raises(ImportFormatError, match="source must be one of"):
        parse_csv(body, source="vibes", id_column="a", provider="aws")
    with pytest.raises(ImportFormatError, match="not a number"):
        parse_csv("id,cost\nx,abc\n", source="billing", id_column="id", provider="aws", spend_column="cost")


def test_merge_unions_sources_and_is_idempotent():
    org = parse_aws_org(text("aws-organizations.json"))
    bill = parse_csv(text("billing-cost-by-account.csv"), source="billing", id_column="Linked Account", provider="aws", spend_column="Unblended Cost")
    first = merge([], org)
    assert len(first.added) == 6
    second = merge(first.accounts, bill)
    assert "777777777777" in second.added and len(second.updated) == 5
    again = merge(second.accounts, bill)
    assert again.added == [] and again.updated == [] and again.unchanged == len(bill)
    by = {a.id: a for a in second.accounts}
    assert by["222222222222"].sources == ("org", "billing") and by["222222222222"].last_spend == pytest.approx(15500.75)


def test_merge_reports_conflicts_instead_of_guessing():
    existing = [account("x1", provider="aws", status="active")]
    res = merge(existing, [Record("x1", "gcp", "org"), Record("x1", "aws", "billing", status="decommissioned")])
    assert any("provider is 'aws'" in c for c in res.conflicts) and any("status is 'active'" in c for c in res.conflicts)
    assert res.accounts[0].status == "active"                    # existing value kept


def test_connected_list_can_be_authoritative():
    existing = [account("a", connected=True), account("b", connected=True), account("c", connected=False)]
    res = merge(existing, [Record("a", "aws", "platform", connected=True), Record("c", "aws", "platform", connected=True)], authoritative_connected=True)
    state = {a.id: a.connected for a in res.accounts}
    assert state == {"a": True, "b": False, "c": True} and res.newly_unconnected == ["b"]


def test_provider_resolution():
    assert guess_provider("123456789012") == "aws"
    assert guess_provider("AAAAAAAA-0000-4000-8000-000000000001") == "azure"
    assert guess_provider("data-platform-prod") == ""
    existing = [account("data-platform-prod", provider="gcp")]
    recs = resolve_providers([Record("data-platform-prod", "", "platform"), Record("AAAAAAAA-0000-4000-8000-000000000001", "", "platform")], existing)
    assert [(r.id, r.provider) for r in recs] == [("data-platform-prod", "gcp"), ("aaaaaaaa-0000-4000-8000-000000000001", "azure")]
    with pytest.raises(ImportFormatError, match="cannot tell the provider"):
        resolve_providers([Record("mystery-project", "", "platform")], [])


def test_reconcile_finds_shadow_accounts_and_dormant_ones(tmp_path):
    org = parse_aws_org(text("aws-organizations.json"))
    bill = parse_csv(text("billing-cost-by-account.csv"), source="billing", id_column="Linked Account", provider="aws", spend_column="Unblended Cost")
    accounts = merge(merge([], org).accounts, bill).accounts
    path = tmp_path / "accounts.csv"
    write_accounts(path, accounts)
    r = reconcile(read_accounts(path))
    assert r["billed_not_in_org"] == ["777777777777"]
    assert any("shadow" in n for n in r["notes"]) and r["overlap"]["billing+org"] == 5


def test_accounts_csv_roundtrip_keeps_everything(tmp_path):
    path = tmp_path / "accounts.csv"
    original = [account("a", sources=("org", "billing"), owner="x", last_spend=12.5, created_at=date(2025, 1, 2), in_plan=True)]
    write_accounts(path, original)
    assert read_accounts(path) == original


def test_cli_end_to_end_builds_a_valid_directory(tmp_path, capsys):
    d = str(tmp_path / "acme")
    run = lambda *a: (main(list(a)), capsys.readouterr())  # noqa: E731
    assert run("init", d, "--name", "Acme")[0] == 0
    assert run("import", "aws-org", str(IMP / "aws-organizations.json"), "--into", d)[0] == 0
    assert run("import", "azure", str(IMP / "azure-accounts.json"), "--into", d)[0] == 0
    assert run("import", "gcp", str(IMP / "gcp-projects.json"), "--into", d)[0] == 0
    assert run("import", "csv", str(IMP / "billing-cost-by-account.csv"), "--into", d, "--source", "billing",
               "--id-column", "Linked Account", "--provider", "aws", "--spend-column", "Unblended Cost")[0] == 0
    assert run("import", "csv", str(IMP / "sso-assignments.csv"), "--into", d, "--source", "sso", "--id-column", "Account Id", "--provider", "aws")[0] == 0
    code, cap = run("import", "csv", str(IMP / "platform-connected.csv"), "--into", d, "--connected", "--authoritative", "--id-column", "account_id")
    assert code == 0 and "5 updated" in cap.out
    assert run("validate", d)[0] == 0
    code, cap = run("score", d, "--format", "json")
    assert code == 0
    score = json.loads(cap.out)
    assert score["stages"]["L1"]["numerator"] == 5 and score["stages"]["L1"]["denominator"] == 11
    assert score["stages"]["L2"]["has_data"] is False             # no inventory yet: not measured, not zero
    code, cap = run("reconcile", d)
    assert code == 0 and "shadow" in cap.out
    before = (Path(d) / "accounts.csv").read_text()
    code, cap = run("import", "aws-org", str(IMP / "aws-organizations.json"), "--into", d, "--dry-run")
    assert code == 0 and "0 added, 0 updated, 6 unchanged" in cap.out and (Path(d) / "accounts.csv").read_text() == before


def test_cli_import_needs_an_initialised_directory_and_a_good_file(tmp_path, capsys):
    assert main(["import", "gcp", str(IMP / "gcp-projects.json"), "--into", str(tmp_path / "nope")]) == 1
    assert "beyond90 init" in capsys.readouterr().err
    d = str(tmp_path / "acme")
    main(["init", d])
    capsys.readouterr()
    bad = tmp_path / "bad.json"
    bad.write_text("{oops")
    assert main(["import", "aws-org", str(bad), "--into", d]) == 1
    assert "not valid JSON" in capsys.readouterr().err
