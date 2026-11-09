"""Which names and ids identify a customer or a person: the list the page uses to pseudonymise and to scan."""
from pathlib import Path

from beyond90 import web
from beyond90.catalogue import Catalogue
from beyond90.identifiers import KINDS, MIN_LENGTH, collect
from beyond90.loader import load_customer

DIR = Path(__file__).parent.parent / "examples" / "portfolio" / "northwind"


def load():
    return load_customer(str(DIR), Catalogue.for_directory(str(DIR)), require_accounts=True)[0]


def test_every_kind_is_present_and_the_customer_is_listed():
    data = load()
    got = collect(data)
    assert tuple(got) == KINDS
    assert data.name in got["customer"]
    assert got["account"], "accounts carry ids"


def test_values_are_distinct_long_enough_and_longest_first():
    for values in collect(load()).values():
        assert len(values) == len(set(values))
        assert all(len(v) >= MIN_LENGTH for v in values)
        assert [len(v) for v in values] == sorted((len(v) for v in values), reverse=True)


def test_people_come_from_owners_and_contacts():
    data = load()
    people = set(collect(data)["person"])
    for a in data.accounts:
        if len(a.owner) >= MIN_LENGTH:
            assert a.owner in people
    for c in data.contacts:
        if len(c.name) >= MIN_LENGTH:
            assert c.name in people


def test_the_browser_result_carries_them():
    r = web.analyze(str(DIR))
    assert r["ok"] and r["identifiers"] == collect(load())
