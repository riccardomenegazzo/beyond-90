# Data format

A customer is a directory. `beyond90 init DIR` creates it with empty files and the right headers; `beyond90 validate DIR` reports every problem with file and line.

```
customer.toml        required
accounts.csv         required
inventory.csv        optional
activations.csv      optional
findings.csv         optional
teams.csv            optional
entitlements.csv     optional
```

Booleans are `true`/`false` (also `yes`/`no`, `1`/`0`). Dates are `YYYY-MM-DD`. Empty optional cells are fine. A missing optional file means that part of the score is simply not measured.

## customer.toml

`schema_version = 1` under `[customer]` is optional. A file marked with a newer format than the engine reads is refused with advice; unknown keys and unknown CSV columns are ignored with a warning (and the nearest known name when it looks like a typo), never silently.

```toml
[customer]
name = "Northwind"
tier = "enterprise"      # free text
arr = 480000             # used for the portfolio weighting
as_of = 2026-10-31       # the date the data describes; snapshots are keyed by it
renewal_date = 2027-03-31  # optional: turns on the renewal readiness checklist

[settings]
ceiling_version = "2026.4"      # catalogue version the score is measured against
baseline_ceiling = "2026.1"     # frozen baseline, see "The moving bar" in SPEC.md
triage_window_days = 7          # findings younger than this are not counted in L4
new_account_days = 30
access_review_days = 90
downgrade_window_days = 3       # anti-gaming window around an SLA deadline
mttr_lookback_days = 90
entitlement_target = 0.8
renewal_window_days = 180       # a renewal this close, with a risk signal, puts its ARR "at risk"
cadence_days = 0                # how often to be in touch; 0 means the default for the tier (see docs/rhythm.md)
connector_stale_days = 2        # a connector with no success for longer is stale
onboarding_stall_days = 7       # an account stuck at one stage for longer is stalled

[settings.sla_days]
critical = 7
high = 30
medium = 90
low = 180
```

## accounts.csv (the true universe)

One row per cloud account, subscription or project. List each account once.

| Column | Meaning |
|---|---|
| `id` | Account identifier |
| `provider` | `aws`, `azure`, `gcp`, `oci`, `kubernetes` (others are accepted and skipped by L2 with a note) |
| `sources` | Where you learned it exists, separated by `;`: `billing`, `org`, `sso`, `manual`, `plan`, `platform` (the platform itself lists it). Only `billing`, `org` and `sso` count as independent sources in the hidden-accounts estimate |
| `connected` | Is it connected to the platform today? |
| `owner` | Spend or technical owner (used to group actions) |
| `last_spend` | Last period's spend, for ranking |
| `status` | `active` (default) or `decommissioned` (excluded from everything) |
| `in_plan` | Was it part of the onboarding plan the legacy metric is computed on? |
| `created_at` | Used to detect new, unconnected accounts |

The universe must come from somewhere other than the platform itself: billing exports, the organization hierarchy (AWS Organizations, Azure management groups, GCP folders), SSO application assignments. If you only list what the platform already knows, L1 is 100% by construction.

## inventory.csv

| Column | Meaning |
|---|---|
| `account_id` | Must exist in accounts.csv |
| `resource_type` | A type from the catalogue (`beyond90 catalogue`) |
| `count` | Number of resources found |
| `inventoried` | Did the platform actually look at this type (permissions and scopes in place)? |

`count = 0` with `inventoried = true` is fine: there is simply nothing there. `inventoried = false` is a blind spot (L2 leak). A type with no row at all is also a leak.

## activations.csv

`account_id, module_id, active`. A module is *relevant* to an account when the provider is supported and, if the module needs a resource type, the account has at least one inventoried resource of that type. Only relevant modules count in L3.

## findings.csv

| Column | Meaning |
|---|---|
| `id`, `account_id` | |
| `severity` | `critical`, `high`, `medium`, `low` |
| `exposure` | `internet` or `internal` (default) |
| `opened_at`, `closed_at` | Open findings have no `closed_at` |
| `owner` | Empty means unowned |
| `decision` | `fix`, `accepted_risk`, `exception`, `false_positive` |
| `decision_reason`, `expiry` | An accepted risk needs a future `expiry` |
| `previous_severity`, `severity_changed_at` | Set when severity was changed; feeds the anti-gaming check |

## teams.csv

`id, name, has_assets, active_users, sso, role_scoped, last_access_review`. Only teams with `has_assets = true` count in Reach.

## entitlements.csv

`unit, licensed, used`. Units used by the playbooks and labels: `workloads`, `sensors`, `code_seats`, `defend_gb`. Any other unit name works; it is reported as given.

## contacts.csv (optional)

`id, role` are required. `name, team, influence, last_contact, credibility, reliability, intimacy, self_orientation` are optional. Roles: `executive_sponsor`, `security_leader`, `champion`, `procurement`, `practitioner`, `skeptic`. `influence` is 1 to 3 and defaults from the role. The four ratings are 1 to 10, your own judgement, and are used for the trust index (see `docs/trust.md`). `team` should match a team id so coverage can be checked. Contains personal data: do not publish it.

## commitments.csv (optional)

`id, due_on` are required. `description, contact_id, promised_on, done_on` are optional. `contact_id` must exist in `contacts.csv`. Reliability is measured from this file over the last `commitment_lookback_days` (default 90). `contact_stale_days` (default 90) sets when a contact counts as not spoken to.

## interactions.csv (optional)

`date, kind` are required. `contact_id, summary, next_step, next_due` are optional. Kinds: `call`, `meeting`, `email`, `qbr`, `workshop`, `support`, `advisory`, `escalation`, `other`. `contact_id` must exist in `contacts.csv`; `date` cannot be after `as_of`. This log is what the cadence is measured against; see [rhythm.md](rhythm.md). Contains personal data: do not publish it.

## connectors.csv (optional)

`account_id, kind, status` are required; see [onboarding.md](onboarding.md) for every column. One row per connector as the platform reports it, including the error text as shown. It drives the onboarding diagnosis and never changes Yield.

## Where to get the data

These are suggestions; nothing in the tool calls any of these systems.

| File | Typical source |
|---|---|
| accounts.csv | Cloud billing export, organization account lists, SSO application assignments, the platform's connected-account list |
| inventory.csv | Platform resource export grouped by account and type, with the permission status of each connector |
| activations.csv | Platform module and sensor settings per account |
| findings.csv | Platform issue export plus ticketing system fields for owner and decision |
| teams.csv | Platform projects and user lists, identity provider groups |
| entitlements.csv | Contract and the platform's usage view |

Live connectors are not part of 0.2. They need a real tenant to verify and will arrive as separate, optional modules.

## Catalogues

`src/beyond90/data/` holds `resource_types.json`, `modules.json` and `playbooks.json`. In `modules.json`, `on_connect` marks the modules that switch on by themselves when an account is connected (agentless ones); the planner uses it. In `playbooks.json`, `effort` gives `base` and `per_unit` hours; the planner uses it too. Point `--catalogue-dir` at a copy to change the expected resource types, add modules (with a `since` version) or rewrite playbooks. A module released after `baseline_ceiling` is reported as new headroom, not as a regression.
