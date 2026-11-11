"""Plain data classes for the inputs of the score. No behaviour lives here."""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

SEVERITIES = ("critical", "high", "medium", "low")
EXPOSURES = ("internet", "internal")
DECISIONS = ("fix", "accepted_risk", "exception", "false_positive")
CLOSED_BY = ("manual", "assisted", "automated")
ACCOUNT_STATUSES = ("active", "decommissioned")
CRITICALITIES = ("critical", "high", "medium", "low")
UNIVERSE_SOURCES = ("billing", "org", "sso", "manual", "plan", "platform")
INDEPENDENT_SOURCES = ("billing", "org", "sso")        # each one finds accounts the others miss


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
    criticality: str = ""  # how much the customer depends on what runs there; empty = not said


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
    verified_at: Optional[date] = None      # the date a later scan confirmed the fix, when the customer records it
    reopened: int = 0                       # how many times the finding came back after being closed
    closed_by: str = ""                     # how it was closed: manual, assisted or automated; empty when not recorded


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


CONNECTOR_KINDS = ("cloud", "kubernetes", "sensor", "registry", "code", "logs")
CONNECTOR_STATUSES = ("ok", "partial", "pending", "error", "disabled")
CONNECTOR_AUTH = ("role", "role_external_id", "access_key", "sp_secret", "sp_certificate", "federated", "sa_key", "sa_impersonation", "token", "agent")
CONNECTOR_PRIVILEGE = ("readonly", "custom", "admin")
CONNECTOR_SCOPES = ("account", "organization", "management_group", "folder", "project", "cluster")
INTERACTION_KINDS = ("call", "meeting", "email", "qbr", "workshop", "support", "advisory", "escalation", "other")
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


@dataclass(frozen=True)
class Interaction:
    """One touch with the customer: a call, a message, a review. The log is what a cadence is measured against."""
    date: _dt.date
    kind: str
    summary: str = ""
    contact_id: str = ""
    next_step: str = ""
    next_due: Optional[_dt.date] = None


@dataclass(frozen=True)
class Connector:
    """How the platform reaches one account or cluster, as the platform reports it. Optional: without it, onboarding is
    read from accounts.csv alone."""
    account_id: str
    kind: str
    status: str
    name: str = ""
    error: str = ""
    deployed_at: Optional[_dt.date] = None
    first_scan_at: Optional[_dt.date] = None
    last_success_at: Optional[_dt.date] = None
    scope: str = ""
    regions_expected: int = 0
    regions_scanned: int = 0
    permissions_missing: tuple[str, ...] = ()
    auth: str = ""
    secret_expires_on: Optional[_dt.date] = None
    privilege: str = ""


@dataclass
class Settings:
    ceiling_version: str = "2026.4"
    baseline_ceiling: str = "2026.1"
    triage_window_days: int = 7
    new_account_days: int = 30
    access_review_days: int = 90
    contact_stale_days: int = 90
    commitment_lookback_days: int = 90
    renewal_window_days: int = 180
    cadence_days: int = 0                   # 0 = the default for the tier (see rhythm.py)
    connector_stale_days: int = 2           # a connector with no success for longer is stale
    onboarding_stall_days: int = 7          # an account stuck at one stage for longer is stalled
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
    interactions: list[Interaction] = field(default_factory=list)
    connectors: list[Connector] = field(default_factory=list)
    inputs: dict[str, str] = field(default_factory=dict)      # file name -> fingerprint, set by the loader
    schema_version: int = 1
    renewal_date: Optional[date] = None
