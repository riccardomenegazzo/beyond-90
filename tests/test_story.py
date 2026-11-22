"""How each infrastructure line is told and challenged (story.json), and that the profiles stay vendor-neutral."""

from __future__ import annotations

import json
import re

import pytest

from beyond90.catalogue import PROFILES_DIR, Catalogue, read_story
from beyond90.estate import FAMILIES, workshop_catalog

INFRA = FAMILIES["infrastructure"]


@pytest.mark.parametrize("profile", INFRA)
def test_every_infrastructure_line_is_told_to_three_audiences_with_people_and_objections(profile):
    story = Catalogue.load(profile=profile).story
    assert set(story["audiences"]) == {"executive", "technical", "financial"}
    assert 3 <= len(story["people"]) <= 6
    assert 3 <= len(story["objections"]) <= 8
    for o in story["objections"]:
        # the question comes before the answer, and every answer can be proven in a test
        assert o["clarify"].endswith("?"), o["clarify"]
        assert len(o["prove"]) <= 200 and not o["prove"].endswith("?")
        assert o["says"] != o["answer"]


def test_the_page_gets_each_story_with_its_line():
    cat = workshop_catalog()
    for p in INFRA:
        assert cat["lines"][p]["story"]["objections"], p
    assert cat["lines"]["cnapp"]["story"]["objections"], "cloud security, the first line, is told too"


@pytest.mark.parametrize("bad", [
    {"audiences": {"board": "x"}},
    {"audiences": {"executive": ""}},
    {"people": ["x"] * 7},
    {"objections": [{"says": "a", "clarify": "b?", "answer": "c"}]},
    {"objections": [{"says": "a", "clarify": "b?", "answer": "c", "prove": "d", "extra": "e"}]},
    {"objections": [{"says": "a", "clarify": "b?", "answer": "c", "prove": "x" * 201}]},
    {"objections": [{"says": "a", "clarify": "b?", "answer": "c", "prove": "d"}] * 9},
])
def test_a_story_that_breaks_the_rules_is_refused(tmp_path, bad):
    f = tmp_path / "story.json"
    f.write_text(json.dumps(bad))
    with pytest.raises(ValueError):
        read_story(f)


# Names of vendors and products the infrastructure profiles must never carry: they describe kinds of product.
NAMES = re.compile(r"\b(nutanix|vmware|broadcom|vsphere|esxi|vsan|ahv|prism|acropolis|nc2|ndb|nkp|nus|flow virtual|"
                   r"dell|powerflex|powerstore|netapp|ontap|pure storage|everpure|flasharray|hpe|cisco|lenovo|supermicro|"
                   r"nvidia|hgx|aws|azure|google cloud|gcp|oracle cloud|openai|anthropic|rvtools|citrix|omnissa|horizon|red hat|openshift|rancher|tanzu)\b", re.I)


@pytest.mark.parametrize("profile", INFRA)
def test_infrastructure_profiles_name_no_vendor_or_product(profile):
    for f in sorted((PROFILES_DIR / profile).glob("*.json")):
        found = NAMES.findall(f.read_text(encoding="utf-8"))
        assert not found, f"{f.name}: {sorted({x.lower() for x in found})}"


SECURITY_TOLD = ["cnapp", "siem", "identity", "endpoint", "saas", "ai"]


@pytest.mark.parametrize("profile", SECURITY_TOLD)
def test_the_security_lines_are_told_and_challenged_too(profile):
    story = Catalogue.load(profile=profile).story
    assert set(story["audiences"]) == {"executive", "technical", "financial"}
    assert 3 <= len(story["people"]) <= 6
    assert 3 <= len(story["objections"]) <= 8
    for o in story["objections"]:
        assert o["clarify"].endswith("?"), o["clarify"]
        assert len(o["prove"]) <= 200 and not o["prove"].endswith("?")
    text = ((PROFILES_DIR / profile) if profile != "cnapp" else PROFILES_DIR.parent).joinpath("story.json").read_text(encoding="utf-8")
    assert not NAMES.search(text), NAMES.search(text)
    assert workshop_catalog()["lines"][profile]["story"]["objections"]



@pytest.mark.parametrize("profile", SECURITY_TOLD)
def test_the_security_questions_say_how_to_ask_them_and_their_proofs_have_criteria(profile):
    cat = Catalogue.load(profile=profile)
    assert all(q.get("role") and q.get("listen") and q.get("probe") for q in cat.discovery), profile
    assert 3 <= sum(1 for q in cat.discovery if q.get("core")) <= 6, "a few essential questions, not all"
    assert len(cat.pov_criteria) >= 5 and 4 <= len(cat.pov_readiness) <= 10
    for f in ("discovery.json", "pov.json"):
        text = ((PROFILES_DIR / profile) if profile != "cnapp" else PROFILES_DIR.parent).joinpath(f).read_text(encoding="utf-8")
        assert not NAMES.search(text), (f, NAMES.search(text))
