"""Words for the unit of coverage.

The engine's text says "account" because that is the unit a cloud platform connects. Another product connects
something else (a site, a tenant, an organization), and its catalogue says so under ``terms``. Text the engine
writes itself goes through ``say`` so that a report for an endpoint customer talks about sites.

``say`` is only ever applied to strings the engine wrote, never to a customer's own text, so an id such as
``account-12`` is never touched. The file name ``accounts.csv`` is a format name and is left alone.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

_PLURAL = re.compile(r"\b(accounts)\b(?!\.csv)", re.IGNORECASE)
_SINGULAR = re.compile(r"\b(account)\b", re.IGNORECASE)


def _like(word: str, original: str) -> str:
    return word.capitalize() if original[:1].isupper() else word


def say(text: str, terms: Mapping[str, str]) -> str:
    unit, units = terms.get("unit", "account"), terms.get("units", "accounts")
    if unit == "account" and units == "accounts":
        return text
    text = _PLURAL.sub(lambda m: _like(units, m.group(1)), text)
    return _SINGULAR.sub(lambda m: _like(unit, m.group(1)), text)
