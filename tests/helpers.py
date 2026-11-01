"""Small builders so each test states only what it cares about."""
from datetime import date

from beyond90.models import Account, CustomerData, Finding, InventoryRow, Settings

AS_OF = date(2026, 10, 31)


def account(id="a1", provider="aws", connected=True, **kw):
    kw.setdefault("sources", ("billing",))
    return Account(id=id, provider=provider, connected=connected, **kw)


def finding(id="f1", account_id="a1", severity="medium", opened_days_ago=30, **kw):
    from datetime import timedelta
    kw.setdefault("exposure", "internal")
    closed_after = kw.pop("closed_after", None)
    opened = AS_OF - timedelta(days=opened_days_ago)
    closed = opened + timedelta(days=closed_after) if closed_after is not None else None
    return Finding(id=id, account_id=account_id, severity=severity, opened_at=opened, closed_at=closed, **kw)


def data(accounts=(), inventory=(), activations=(), findings=(), teams=(), entitlements=(), contacts=(), commitments=(), **settings):
    return CustomerData(
        name="Test", tier="", arr=100.0, as_of=AS_OF, settings=Settings(**settings),
        accounts=list(accounts), inventory=list(inventory), activations=list(activations),
        findings=list(findings), teams=list(teams), entitlements=list(entitlements),
        contacts=list(contacts), commitments=list(commitments),
    )


def full_inventory(account_id, provider="aws", skip=()):
    from beyond90.catalogue import Catalogue
    cat = Catalogue.load()
    return [InventoryRow(account_id, t, 5, True) for t in cat.expected_types(provider) if t not in skip]
