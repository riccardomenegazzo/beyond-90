import json
import shutil
from datetime import timedelta
from pathlib import Path

import pytest

from beyond90 import onboarding as o
from beyond90.loader import DataError, load_customer
from beyond90.web import analyze

ROOT = Path(__file__).resolve().parent.parent
NW = ROOT / "examples" / "portfolio" / "northwind"
HEADER = "account_id,kind,status,name,error,deployed_at,first_scan_at,last_success_at,scope,regions_expected,regions_scanned,permissions_missing,auth,secret_expires_on,privilege\n"


@pytest.fixture
def nw(tmp_path):
    d = tmp_path / "nw"
    shutil.copytree(NW, d)
    return d


def data(d):
    return load_customer(d)[0]


@pytest.mark.parametrize("text, provider, kind, expected", [
    ("is not authorized to perform: ec2:DescribeInstances with an explicit deny in a service control policy", "aws", "", "aws_scp_deny"),
    ("AccessDenied when calling AssumeRole: external ID does not match", "aws", "", "aws_external_id"),
    ("An error occurred (AccessDenied) when calling the AssumeRole operation: not authorized to perform: sts:AssumeRole", "aws", "", "aws_assume_role"),
    ("StackSet instance CREATE_FAILED in account 111", "aws", "", "aws_stackset"),
    ("OptInRequired: the account is not subscribed to region me-central-1", "aws", "", "aws_region_optin"),
    ("Skipped volumes: KMSKeyNotAccessible", "aws", "", "aws_kms"),
    ("The security token included in the request is expired", "aws", "", "aws_static_keys"),
    ("AADSTS65001: The user or administrator has not consented to use the application", "azure", "", "az_consent"),
    ("AADSTS7000222: The provided client secret keys are expired", "azure", "", "az_secret"),
    ("AADSTS53003: Access has been blocked by Conditional Access policies", "azure", "", "az_conditional_access"),
    ("The client does not have authorization to perform action Microsoft.Resources/subscriptions/read", "azure", "", "az_scope"),
    ("Cloud Asset API has not been used in project 1 before or it is disabled. Enable it", "gcp", "", "gcp_api_disabled"),
    ("constraints/iam.allowedPolicyMemberDomains does not allow", "gcp", "", "gcp_org_policy"),
    ("Request is prohibited by organization's policy. vpcServiceControlsUniqueIdentifier: x", "gcp", "", "gcp_vpc_sc"),
    ("PERMISSION_DENIED: caller does not have permission", "gcp", "", "gcp_permission"),
    ("pods is forbidden: violates PodSecurity \"restricted:latest\"", "", "sensor", "k8s_admission"),
    ("admission webhook \"validation.gatekeeper.sh\" denied the request", "", "kubernetes", "k8s_admission"),
    ("pods is forbidden: User \"system:serviceaccount:sec:agent\" cannot list resource \"pods\"", "", "kubernetes", "k8s_rbac"),
    ("dial tcp 10.0.0.1:443: i/o timeout", "", "kubernetes", "k8s_unreachable"),
    ("x509: certificate signed by unknown authority", "", "sensor", "k8s_egress"),
    ("Back-off pulling image: ImagePullBackOff", "", "sensor", "k8s_image_pull"),
    ("failed to load eBPF program: kernel 4.14 not supported", "", "sensor", "sensor_kernel"),
    ("Rate exceeded", "aws", "", "api_throttling"),
])
def test_the_catalogue_names_the_cause(text, provider, kind, expected):
    m = o.triage(text, provider, kind)["match"]
    assert m and m["id"] == expected, (text, m and m["id"])
    assert m["steps"] and m["verify"] and m["owner"]


def test_unknown_or_empty_messages_say_so_and_a_wrong_provider_guess_is_forgiven():
    assert o.triage("", "aws")["match"] is None and o.triage("something odd happened")["match"] is None
    assert o.triage("AADSTS65001 consent", "aws")["match"]["id"] == "az_consent"
    assert o.triage("x" * 100_000)["match"] is None                       # long input is cut, not choked on


def test_every_catalogue_entry_is_complete_and_its_patterns_compile():
    stages = set(o.STAGES)
    ids = set()
    for it in o.catalogue()["issues"]:
        assert it["id"] not in ids
        ids.add(it["id"])
        assert it["stage"] in stages and it["scope"] in ("org", "account") and it["hours"] > 0
        assert it["title"] and it["why"] and it["steps"] and it["verify"] and it["patterns"]


def test_the_examples_show_every_stage_and_the_gap_between_counted_and_healthy():
    d = o.diagnose(data(NW))
    stages = {r["stage"] for r in d["accounts"]}
    assert {"discovered", "deployed", "authenticated", "authorized", "scanning", "complete"} >= stages and len(stages) >= 5
    reached = [f["reached"] for f in d["funnel"]]
    assert reached == sorted(reached, reverse=True) and reached[0] == len(d["accounts"])
    assert d["healthy_l1"] < d["listed_l1"] and d["listed_but_broken"] == ["azure-001"]
    assert d["listed_l1"] == pytest.approx(json.loads(analyze(str(NW))["score_json"])["stages"]["L1"]["value"])


def test_waves_put_one_fix_for_many_first_and_cover_every_blocked_account():
    d = o.diagnose(data(NW))
    blocked = {r["id"] for r in d["accounts"] if r["issue"] and r["stage"] != "complete"}
    in_waves = {a for w in d["waves"] for a in w["accounts"]}
    assert blocked <= in_waves
    assert [w["per_hour"] for w in d["waves"]] == sorted((w["per_hour"] for w in d["waves"]), reverse=True)
    scp = next(w for w in d["waves"] if w["issue"] == "aws_scp_deny")
    assert scp["once"] and scp["hours"] == 2 and scp["count"] == 3          # fixed once for the organization, not per account


def test_several_undeployed_accounts_of_a_provider_become_one_organization_deployment(nw):
    (nw / "connectors.csv").write_text(HEADER + "aws-001,cloud,ok,,,2026-01-01,2026-01-02,2026-10-31,,,,,role_external_id,,readonly\n")
    d = o.diagnose(data(nw))
    org = [w for w in d["waves"] if w["issue"] == "deploy_org"]
    assert org and all(w["once"] for w in org)


def test_stage_rules_on_hand_made_rows(nw):
    as_of = data(nw).as_of
    day = lambda n: (as_of - timedelta(days=n)).isoformat()   # noqa: E731
    rows = [
        f"aws-001,cloud,ok,,,{day(30)},{day(29)},{day(0)},,17,17,,role_external_id,,readonly",            # complete
        f"aws-002,cloud,ok,,,{day(30)},{day(29)},{day(9)},,17,17,,role_external_id,,readonly",            # stale
        f"aws-003,cloud,partial,,,{day(30)},{day(29)},{day(0)},,17,15,,role_external_id,,readonly",       # regions
        f"aws-004,cloud,pending,,,{day(1)},,,,,,,role_external_id,,readonly",                              # just deployed
        f"aws-005,cloud,pending,,,{day(9)},,,,,,,role_external_id,,readonly",                              # never scanned
        f"aws-006,cloud,ok,,,{day(30)},{day(29)},{day(0)},,17,17,s3:GetBucketPolicy;ecr:Describe*,role_external_id,,readonly",
        f"aws-007,cloud,disabled,,,{day(30)},{day(29)},{day(20)},,,,,role_external_id,,readonly",
        f"aws-008,cloud,error,,Something nobody has seen,{day(30)},,,,,,,role_external_id,,readonly",
    ]
    (nw / "connectors.csv").write_text(HEADER + "\n".join(rows) + "\n")
    by = {r["id"]: r for r in o.diagnose(data(nw))["accounts"]}
    assert (by["aws-001"]["stage"], by["aws-001"]["issue"]) == ("complete", None)
    assert (by["aws-002"]["stage"], by["aws-002"]["issue"]) == ("scanning", "stale")
    assert (by["aws-003"]["stage"], by["aws-003"]["issue"]) == ("scanning", "regions_partial")
    assert (by["aws-004"]["stage"], by["aws-004"]["issue"]) == ("authorized", None)
    assert (by["aws-005"]["stage"], by["aws-005"]["issue"]) == ("authorized", "never_scanned")
    assert (by["aws-006"]["stage"], by["aws-006"]["issue"]) == ("authenticated", "permissions_missing")
    assert (by["aws-007"]["stage"], by["aws-007"]["issue"]) == ("discovered", "disabled")
    assert (by["aws-008"]["stage"], by["aws-008"]["issue"]) == ("deployed", "unclassified")


def test_the_connectors_themselves_are_reviewed(nw):
    as_of = data(nw).as_of
    rows = [
        "aws-001,cloud,ok,,,,,,organization,,,,role_external_id,,admin",
        "aws-002,cloud,ok,,,,,,account,,,,role,,readonly",
        "azure-001,cloud,ok,,,,,,,,,,sp_secret," + (as_of + timedelta(days=10)).isoformat() + ",readonly",
        "gcp-001,cloud,ok,,,,,,,,,,sa_impersonation,,readonly",
    ]
    (nw / "connectors.csv").write_text(HEADER + "\n".join(rows) + "\n")
    d = o.diagnose(data(nw))
    titles = {(x["connector"], x["severity"], x["stride"]) for x in d["security"]}
    assert ("aws-001", "critical", "Elevation of privilege") in titles
    assert ("aws-002", "high", "Spoofing (confused deputy)") in titles
    assert ("azure-001", "medium", "Spoofing") in titles
    assert not any(x["connector"] == "gcp-001" for x in d["security"])
    assert [(s["connector"], s["days_left"]) for s in d["secrets"]] == [("azure-001", 10)]


def test_without_connectors_csv_onboarding_falls_back_to_the_account_list(nw):
    (nw / "connectors.csv").unlink()
    d = o.diagnose(data(nw))
    assert d["has_detail"] is False and not d["security"] and not d["secrets"]
    assert {r["stage"] for r in d["accounts"]} == {"complete", "discovered"}
    assert d["healthy_l1"] == pytest.approx(d["listed_l1"])


@pytest.mark.parametrize("row, needle", [
    ("nope,cloud,ok", "not in accounts.csv"),
    ("aws-001,robot,ok", "kind"),
    ("aws-001,cloud,maybe", "status"),
    ("aws-001,cloud,ok,,,2030-01-01", "after as_of"),
    ("aws-001,cloud,ok,,,2026-10-01,2026-09-01", "before deployed_at"),
    ("aws-001,cloud,ok,,,,,,,3,5", "larger than"),
    ("aws-001,cloud,ok,,,,,,,,,,password", "auth"),
])
def test_connectors_csv_is_validated(nw, row, needle):
    (nw / "connectors.csv").write_text(HEADER + row + "\n")
    with pytest.raises(DataError, match=needle):
        data(nw)


def test_the_preflight_follows_the_answers():
    base = o.preflight({"providers": ["aws"]})
    text = base["markdown"]
    assert text.startswith("# Onboarding pre-flight checklist") and "stack sets" in text and "Kubernetes" not in text and "Azure: admin consent" not in text
    full = o.preflight({"providers": ["aws", "azure", "gcp"], "kubernetes": True, "sensor": True, "pod_security": True, "proxy": True, "private_clusters": True,
                        "guardrails": True, "cmk": True})["markdown"]
    for needle in ("admin consent", "federation", "privileged level", "proxy", "dials out", "customer-managed keys", "kernel"):
        assert needle in full, needle
    per_acct = o.preflight({"providers": ["aws"], "org": False})["markdown"]
    assert "in each account" in per_acct


def test_onboarding_reaches_the_brief_the_week_and_the_alerts():
    from beyond90.alerts import compute_alerts
    r = analyze(str(NW))
    items = r["dashboard"]["rhythm"]["prep"]["items"]
    assert any(i["id"] == "onboarding" for i in items)
    onb = r["dashboard"]["onboarding"]

    class S:
        rubric, yield_, quality = {}, 0.7, {}

    alerts = compute_alerts(score=S(), metrics={}, previous=None, sync_problems=[], drift=None, renewal=None, onboarding=onb)
    keys = {a["key"] for a in alerts}
    assert {"connectors", "secrets", "connector_security"} <= keys
    again = compute_alerts(score=S(), metrics={}, previous={"broken_connectors": onb["listed_but_broken"], "connector_critical": 1}, sync_problems=[], drift=None, renewal=None, onboarding=onb)
    assert "connectors" not in {a["key"] for a in again} and "connector_security" not in {a["key"] for a in again}


def test_the_cli_explains_an_error_and_returns_3_when_it_cannot(capsys):
    from beyond90.cli import main
    assert main(["triage", "AADSTS65001: not consented", "--provider", "azure"]) == 0
    assert "Admin consent" in capsys.readouterr().out
    assert main(["triage", "nothing we know"]) == 3
    assert main(["onboarding", str(NW)]) == 0 and "Unblock in this order" in capsys.readouterr().out
    assert main(["preflight", "--providers", "gcp", "--kubernetes"]) == 0 and "Google Cloud" in capsys.readouterr().out
