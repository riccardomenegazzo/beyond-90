"""Pins the numbers of the committed mock customers so formula changes are deliberate."""
from pathlib import Path

import pytest

from beyond90.catalogue import Catalogue
from beyond90.loader import load_customer
from beyond90.scoring import compute_score

ROOT = Path(__file__).parent.parent / "examples" / "portfolio"
CAT = Catalogue.load()


def score(name):
    d, warnings = load_customer(ROOT / name, CAT)
    assert warnings == []
    return compute_score(d, CAT)


def test_northwind_headline_numbers():
    s = score("northwind")
    assert s.naive == pytest.approx(0.92)
    assert (s.stages["L1"].numerator, s.stages["L1"].denominator) == (109, 121)
    assert s.yield_ == pytest.approx(0.726, abs=0.001)
    assert s.baseline["yield"] > s.yield_
    assert s.outcomes["reclassification_suspects"]


@pytest.mark.parametrize("name", ["northwind", "contoso-bank", "fabrikam-labs"])
def test_every_example_is_valid_and_below_the_legacy_number(name):
    s = score(name)
    assert s.yield_ < s.naive


def test_example_customers_are_ordered_as_designed():
    assert score("contoso-bank").yield_ > score("northwind").yield_ > score("fabrikam-labs").yield_
