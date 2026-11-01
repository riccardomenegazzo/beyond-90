"""Plain data classes for the inputs of the score. No behaviour lives here."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

SEVERITIES = ("critical", "high", "medium", "low")
EXPOSURES = ("internet", "internal")
DECISIONS = ("fix", "accepted_risk", "exception", "false_positive")
ACCOUNT_STATUSES = ("active", "decommissioned")
UNIVERSE_SOURCES = ("billing", "org", "sso", "manual", "plan")


@dataclass(frozen=True)
class Account:
    id: str
    provider: str
    sources: tuple[str, ...]
    connected: bool
    owner: str = ""
    last_spend: float = 0.0
    status: str = "active"
    in_plan: bool = False  # part of the onboarding plan the legacy metric is computed on
    created_at: Optional[date] = None


@dataclass(frozen=True)
class InventoryRow:
    account_id: str
    resource_type: str
    count: int
    inventoried: bool


@dataclass(frozen=True)
class Activation:
    account_id: str
    module_id: str
    active: bool


@dataclass(frozen=True)
class Finding:
    id: str
    account_id: str
    severity: str
    exposure: str
    opened_at: date
    closed_at: Optional[date] = None
    owner: str = ""
    decision: str = ""
    decision_reason: str = ""
    expiry: Optional[date] = None
    previous_severity: str = ""
    severity_changed_at: Optional[date] = None


@dataclass(frozen=True)
class Team:
    id: str
    name: str
    has_assets: bool
    active_users: int
    sso: bool
    role_scoped: bool
    last_access_review: Optional[date] = None


@dataclass(frozen=True)
class Entitlement:
    unit: str
    licensed: float
    used: float


CONTACT_ROLES = ("executive_sponsor", "security_leader", "champion", "procurement", "practitioner", "skeptic")
DEFAULT_INFLUENCE = {"executive_sponsor": 3, "security_leader": 3, "champion": 2, "procurement": 2, "skeptic": 2, "practitioner": 1}


@dataclass(frozen=True)
class Contact:
    """A person at the customer. Ratings are the TAM's honest 1-10 view (blank = not rated)."""
    id: str
    name: str
    role: str
    team: str = ""
    influence: int = 1
    last_contact: Optional[date] = None
    credibility: Optional[float] = None
    reliability: Optional[float] = None
    intimacy: Optional[float] = None
    self_orientation: Optional[float] = None


@dataclass(frozen=True)
class Commitment:
    """Something promised to the customer. Reliability is measured from these, not rated."""
    id: str
    description: str
    due_on: date
    contact_id: str = ""
    promised_on: Optional[date] = None
    done_on: Optional[date] = None


@dataclass
class Settings:
    ceiling_version: str = "2026.4"
    baseline_ceiling: str = "2026.1"
    triage_window_days: int = 7
    new_account_days: int = 30
    access_review_days: int = 90
    contact_stale_days: int = 90
    commitment_lookback_days: int = 90
    downgrade_window_days: int = 3
    mttr_lookback_days: int = 90
    entitlement_target: float = 0.8
    sla_days: dict[str, int] = field(
        default_factory=lambda: {"critical": 7, "high": 30, "medium": 90, "low": 180}
    )


@dataclass
class CustomerData:
    name: str
    tier: str
    arr: float
    as_of: date
    settings: Settings
    accounts: list[Account] = field(default_factory=list)
    inventory: list[InventoryRow] = field(default_factory=list)
    activations: list[Activation] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    teams: list[Team] = field(default_factory=list)
    entitlements: list[Entitlement] = field(default_factory=list)
    contacts: list[Contact] = field(default_factory=list)
    commitments: list[Commitment] = field(default_factory=list)
    inputs: dict[str, str] = field(default_factory=dict)      # file name -> fingerprint, set by the loader
    schema_version: int = 1
