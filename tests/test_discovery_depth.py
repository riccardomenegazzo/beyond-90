"""How to ask a discovery question: who to ask, the few not to leave the first meeting without, what to listen for,
and the follow-up that goes one level deeper. The infrastructure lines carry all of it."""
import json

import pytest

from beyond90.catalogue import ROLES, Catalogue, read_discovery
from beyond90.estate import workshop_catalog
from test_story import INFRA


@pytest.mark.parametrize("profile", INFRA)
def test_every_infrastructure_question_says_who_to_ask_what_to_listen_for_and_what_to_ask_next(profile):
    qs = Catalogue.load(profile=profile).discovery
    assert len(qs) >= 11, profile
    for q in qs:
        assert q.get("role") in ROLES and q.get("listen") and q.get("probe", "").endswith("?"), q["q"]
        assert q["probe"] != q["q"] and len(q["listen"]) <= 240, q["q"]
    core = [q for q in qs if q.get("core")]
    # the first meeting: a handful per line, value first, never the whole list
    assert 5 <= len(core) <= 8, (profile, len(core))
    assert any(q["stage"] == "value" for q in core), profile
    # more than one person in the room: the questions are spread across roles
    assert len({q["role"] for q in qs}) >= 3, profile


def test_the_page_gets_how_to_ask_each_question():
    lines = workshop_catalog()["lines"]
    q = lines["hci"]["questions"][0]
    assert q["role"] == "executive" and q["core"] is True and q["listen"] and q["probe"].endswith("?")
    # a question that is not core does not carry the key at all
    assert all("core" not in x for x in lines["hci"]["questions"] if not x.get("core"))


@pytest.mark.parametrize("bad", [{"role": "ceo"}, {"core": "yes"}, {"ahead": "yes"}, {"listen": ""}, {"listen": "x" * 241}, {"probe": "And then"}, {"probe": 3}])
def test_a_question_that_breaks_the_rules_is_refused(tmp_path, bad):
    f = tmp_path / "discovery.json"
    f.write_text(json.dumps({"questions": [{"stage": "L1", "q": "How many clusters are there?", "why": "", **bad}]}), encoding="utf-8")
    with pytest.raises(ValueError):
        read_discovery(f)


def test_a_question_without_the_new_fields_still_reads():
    qs = Catalogue.load(profile="siem").discovery
    assert qs and all(set(q) <= {"stage", "q", "why", "need", "how", "role", "core", "ahead", "listen", "probe"} for q in qs)


def test_every_line_has_a_few_questions_to_send_ahead_each_for_someone():
    lines = workshop_catalog()["lines"]
    for profile, line in lines.items():
        ahead = [q for q in line["questions"] if q.get("ahead")]
        # a short note, not a questionnaire: the meeting is still where the pain is heard
        assert 2 <= len(ahead) <= 5, (profile, len(ahead))
        assert all(q.get("role") and q["q"].endswith("?") for q in ahead), profile
    assert all("ahead" not in x for x in lines["hci"]["questions"] if not x.get("ahead"))
