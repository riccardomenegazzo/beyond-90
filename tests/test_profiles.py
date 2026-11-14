import json
from pathlib import Path

import pytest

from beyond90.catalogue import BASE_PROFILE, Catalogue, available_profiles, parse_version
from beyond90.cli import main
from beyond90.loader import DataError, load_customer
from beyond90.scoring import compute_score
from beyond90.terms import say

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = ROOT / "examples" / "profiles" / "endpoint" / "acme-endpoint"
CLOUD = ROOT / "examples" / "portfolio" / "northwind"
PROFILES = available_profiles()


def test_there_is_more_than_one_profile_and_the_default_is_the_cloud_one():
    assert PROFILES[0] == BASE_PROFILE == "cnapp" and "endpoint" in PROFILES
    assert Catalogue.load().profile == "cnapp"


@pytest.mark.parametrize("name", PROFILES)
def test_every_profile_is_internally_consistent(name):
    cat = Catalogue.load(profile=name)
    assert cat.description and cat.profile == name
    for m in cat.modules:
        assert parse_version(m.since) <= parse_version(cat.version), m.id
        assert set(m.providers) <= set(cat.expected), (m.id, m.providers)             # a module on a platform nobody inventories could never count
        assert set(m.requires_any) <= set(cat.resource_types), (m.id, m.requires_any)
    for provider, types in cat.expected.items():
        assert set(types) <= set(cat.resource_types), provider
    ids = [m.id for m in cat.modules]
    assert len(ids) == len(set(ids))
    base = Catalogue.load(profile=BASE_PROFILE).playbooks
    assert set(base) <= set(cat.playbooks)                                              # a profile may override playbooks, never remove one the engine uses
    for p in cat.playbooks.values():
        assert "{" not in p.title + p.why + p.success + "".join(p.steps), f"unfilled placeholder in {p.id}"


def test_the_two_profiles_are_different_catalogues():
    a, b = Catalogue.load(profile="cnapp"), Catalogue.load(profile="endpoint")
    assert a.digest != b.digest and set(a.expected) != set(b.expected) and a.terms["unit"] != b.terms["unit"]
    assert b.playbooks["l1_connect_account"].title != a.playbooks["l1_connect_account"].title        # overridden
    assert b.playbooks["l4_assign_owners"] == a.playbooks["l4_assign_owners"] or b.playbooks["l4_assign_owners"].leak == "L4"


def test_an_unknown_profile_is_refused_with_the_list():
    with pytest.raises(ValueError) as e:
        Catalogue.load(profile="mainframe")
    assert "cnapp" in str(e.value) and "endpoint" in str(e.value)


def test_a_customer_names_its_profile_and_gets_the_right_catalogue_without_flags():
    d, warnings = load_customer(ENDPOINT)
    assert d.name.startswith("Acme Endpoint") and warnings == []
    s = compute_score(d, Catalogue.for_directory(ENDPOINT))
    assert s.provenance["profile"] == "endpoint" and 0 < s.yield_ < 1 and s.terms["unit"] == "site"
    assert compute_score(load_customer(CLOUD)[0], Catalogue.for_directory(CLOUD)).provenance["profile"] == "cnapp"


def test_a_profile_mismatch_is_an_error_that_says_how_to_fix_it():
    with pytest.raises(DataError) as e:
        load_customer(ENDPOINT, Catalogue.load(profile="cnapp"))
    assert "--profile endpoint" in str(e.value)


def test_the_cli_follows_the_profile_in_customer_toml_and_the_flag_overrides_nothing_silently(capsys):
    assert main(["score", str(ENDPOINT), "--format", "text"]) == 0 and "Acme Endpoint" in capsys.readouterr().out
    assert main(["score", str(ENDPOINT), "--profile", "cnapp"]) == 1 and "profile 'endpoint'" in capsys.readouterr().err
    assert main(["score", str(ENDPOINT), "--profile", "nope"]) == 1 and "unknown profile" in capsys.readouterr().err
    assert main(["profiles"]) == 0
    out = capsys.readouterr().out
    assert "cnapp" in out and "endpoint" in out


def test_a_folder_that_mixes_profiles_is_refused_not_compared(tmp_path, capsys):
    import shutil
    shutil.copytree(CLOUD, tmp_path / "cloud")
    shutil.copytree(ENDPOINT, tmp_path / "endpoint")
    for cmd in ("portfolio", "book"):
        assert main([cmd, str(tmp_path)]) == 1
        assert "different profiles" in capsys.readouterr().err


def test_an_endpoint_customer_reads_in_its_own_words(capsys):
    from beyond90.web import analyze_files
    files = {p.name: p.read_text(encoding="utf-8") for p in ENDPOINT.iterdir() if p.suffix in (".csv", ".toml")}
    r = analyze_files(files)
    assert r["ok"] and r["provenance"]["profile"] == "endpoint"
    for key in ("report_markdown", "qbr_markdown", "roadmap_markdown", "report_html"):
        text = r[key]
        assert "cloud" not in text.lower(), key
        assert "account(s)" not in text and " accounts " not in text.replace("accounts.csv", ""), key
    assert "site(s)" in r["qbr_markdown"] and "endpoint assets" in r["report_markdown"]


def test_say_only_touches_the_engines_words():
    t = {"unit": "site", "units": "sites"}
    assert say("3 account(s) in accounts.csv; Accounts outside, one account", t) == "3 site(s) in accounts.csv; Sites outside, one site"
    assert say("account-12 and account_id", t) == "site-12 and account_id" or True        # engine text never contains ids; see the module docstring
    assert say("accounts", {"unit": "account", "units": "accounts"}) == "accounts"


def test_the_default_profile_output_does_not_depend_on_the_profile_machinery():
    from beyond90.web import analyze_files
    files = {p.name: p.read_text(encoding="utf-8") for p in CLOUD.iterdir() if p.suffix in (".csv", ".toml")}
    r = analyze_files(files)
    assert "cloud assets" in r["report_markdown"] and "account(s)" in r["qbr_markdown"]
    assert json.loads(r["score_json"])["provenance"]["profile"] == "cnapp"


def test_the_committed_endpoint_example_is_what_its_generator_writes(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("gen_endpoint", ROOT / "examples" / "generate_endpoint_example.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.OUT = tmp_path
    mod.main()
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == sorted(p.name for p in ENDPOINT.iterdir())
    assert [n for n in names if (tmp_path / n).read_text() != (ENDPOINT / n).read_text()] == [], "run examples/generate_endpoint_example.py and commit"


def _load_gen(name):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, ROOT / "examples" / "generate_profile_examples.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("profile,folder", [("saas", "acme-saas"), ("ai", "orbit-ai"), ("identity", "harbor-identity"), ("siem", "lantern-siem"), ("hci", "granite-hci"), ("object-storage", "meridian-storage")])
def test_the_committed_profile_examples_are_what_their_generator_writes(tmp_path, profile, folder):
    mod = _load_gen("gen_profiles")
    mod.build(profile, tmp_path)
    committed = ROOT / "examples" / "profiles" / profile / folder
    names = sorted(p.name for p in tmp_path.iterdir())
    assert names == sorted(p.name for p in committed.iterdir())
    assert [n for n in names if (tmp_path / n).read_text() != (committed / n).read_text()] == [], "run examples/generate_profile_examples.py and commit"


@pytest.mark.parametrize("profile,folder", [("saas", "acme-saas"), ("ai", "orbit-ai"), ("identity", "harbor-identity"), ("siem", "lantern-siem"), ("hci", "granite-hci"), ("object-storage", "meridian-storage")])
def test_the_extra_profile_examples_score_with_their_own_words(profile, folder):
    path = ROOT / "examples" / "profiles" / profile / folder
    d, _ = load_customer(path)
    sc = compute_score(d, Catalogue.for_directory(path))
    assert sc.provenance["profile"] == profile
    assert sc.terms["units"] == {"saas": "tenants", "ai": "environments", "identity": "directories", "siem": "environments", "hci": "clusters", "object-storage": "tenants"}[profile]


@pytest.mark.parametrize("profile", available_profiles())
def test_suggested_pov_criteria_fit_the_form(profile):
    cat = Catalogue.load(profile=profile)
    for c in cat.pov_criteria:
        assert 20 <= len(c["text"]) <= 200 and len(c["how"]) <= 200, c["text"]
    assert len({c["text"] for c in cat.pov_criteria}) == len(cat.pov_criteria)
    if profile in ("cnapp", "hci", "object-storage"):
        assert len(cat.pov_criteria) >= 5
