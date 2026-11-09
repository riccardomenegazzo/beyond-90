"""The names and ids in a customer's data that identify a customer or a person.

The page uses this list to replace them when you share something, and to tell you which ones are
still in a text before it leaves. Pure and read-only: it only reads what the loader already parsed.

Kinds, from most to least personal:
  customer  the customer's own name
  person    owners of accounts and findings, and the contacts' names
  team      team names
  account   account ids and connector names (they often carry the customer's own naming)
"""

from __future__ import annotations

from typing import Any

from .models import CustomerData

KINDS = ("customer", "person", "team", "account")
MAX_PER_KIND = 2000
MIN_LENGTH = 3  # shorter strings would match inside ordinary words and make a text unreadable


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def collect(data: CustomerData) -> dict[str, list[str]]:
    """Distinct identifiers by kind, longest first inside each kind (so a longer name is replaced before a name inside it)."""
    found: dict[str, set[str]] = {k: set() for k in KINDS}
    found["customer"].add(_clean(data.name))
    for a in data.accounts:
        found["account"].add(_clean(a.id))
        found["person"].add(_clean(a.owner))
    for f in data.findings:
        found["person"].add(_clean(f.owner))
    for t in data.teams:
        found["team"].add(_clean(t.name))
    for c in data.contacts:
        found["person"].add(_clean(c.name))
    for conn in data.connectors:
        found["account"].add(_clean(conn.name))
    out: dict[str, list[str]] = {}
    for kind, values in found.items():
        keep = [v for v in values if len(v) >= MIN_LENGTH]
        out[kind] = sorted(keep, key=lambda v: (-len(v), v.lower()))[:MAX_PER_KIND]
    return out
