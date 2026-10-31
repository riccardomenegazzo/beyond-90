# Beyond 90 — Specification v0.1

An adoption engine for Technical Account Managers. It measures how much of a customer's cloud estate is *really* protected and operated through the platform, and turns every gap into a concrete action. The bar never stops moving: when a customer grows or the product ships something new, the denominator grows with it.

> All data in this repository is mock. No customer or employer data is used.

## 1. Problem

Adoption is usually reported as `connected accounts / accounts known to us`. That number hits 90% and the account looks done, while it quietly excludes:

- cloud accounts nobody told us about,
- resource types that are connected but never inventoried,
- modules the customer could use but doesn't,
- findings that exist but have no owner.

A TAM needs a number that cannot be flattered, and a path from every gap to an action.

## 2. Core idea: the adoption pipeline

Borrowed from the asset-management "pipeline" model in *Practical Cloud Security* (Dotson, O'Reilly 2019, ch. 3): assets flow from the cloud providers towards the security tooling, and can *leak* at four points. Each leak is a stage in the score.

| Stage | Leak | Question it answers |
|---|---|---|
| L1 Procurement | Whole cloud/account/subscription never connected | Do we know the *true* universe? |
| L2 Processing | Connected, but some resource types are not inventoried | Do we see every kind of asset? |
| L3 Tooling | Asset known, but modules/sensors don't check it | Is every relevant control switched on for it? |
| L4 Findings | Issues exist, but nobody reviews or owns them | Does a finding lead to a decision? |

### Yield

Stages are sequential, so a leak upstream hides everything downstream. The score is the product:

```
Yield = L1 × L2 × L3 × L4
```

Reach (section 4) is reported next to Yield, not inside it.

## 3. Stage definitions

The denominator of every stage comes from an independent source, never from the platform's own inventory.

### L1 Procurement
```
L1 = connected_accounts / true_accounts
```
`true_accounts` = union of: cloud billing/invoice lines, the organization hierarchy (AWS Organizations, Azure management groups, GCP folders), SSO application assignments. Output: list of unconnected accounts with owner and last spend.

### L2 Processing
```
L2 = inventoried_resource_types / expected_resource_types   (per provider, weighted by asset count)
```
`expected_resource_types` is a maintained catalogue per provider: compute, storage (including object buckets), network, serverless, containers/registries, managed databases, identities. Typical leak: VMs inventoried, buckets or registries missed.

### L3 Tooling
```
L3 = Σ(asset_i × active_relevant_modules_i) / Σ(asset_i × available_relevant_modules_i)
```
`available_relevant_modules` comes from the **module catalogue** (versioned). A new release that is relevant to a customer's estate adds to the denominator, so L3 can *drop* without anything changing at the customer. That is intended: it is the "do not settle at 90" mechanism. Also tracked: tool coverage per module (book ch. 5: should approach 100% over time, otherwise raise a project or retire the tool).

### L4 Findings
```
L4 = findings_with_owner_and_decision / total_open_findings_past_triage_window
```
A decision is one of: fix, accepted risk (with reason and expiry), exception, false positive. Ignoring a finding without review is the leak; accepting it consciously is not. Supporting metrics, from the book's vulnerability-management chapter:

- mean time to remediate, split by severity and by internet-facing vs internal,
- % of assets with open critical findings (percentage, not absolute count: absolute numbers grow as scope grows),
- false-positive rate and recurrence rate,
- **anti-gaming check**: flag severity reclassifications that cluster just before an SLA deadline.

## 4. Reach (reported alongside Yield)

Adoption also means *who* uses the platform. Based on the access life cycle (request → approve → grant → revalidate):

- teams with cloud assets that have at least one active user / all teams owning cloud assets,
- SSO and role-based access coverage,
- access reviews done in the last 90 days,
- findings routed automatically to owners via tags (tag consistency is its own metric: `ApplicationA` ≠ `applicationA` on most providers).

## 5. The moving bar

- **Floor, not target.** 90% is a checkpoint. Quarterly target = `max(current + 5pp, 90%)` until Yield ≥ 98%, after which the target becomes keeping Reach and L3 ceiling-adjusted.
- **Ceiling versions.** Every report states `ceiling_version` (module catalogue + resource catalogue). Two views are always shown: *against today's ceiling* and *against the frozen baseline*, so customers see real progress and real new headroom.
- **Naive vs real.** Every report shows the legacy metric next to Yield. The gap between the two is the story for the customer.

## 6. Modules and the TAM responsibilities they serve

| Module | Does | TAM responsibility |
|---|---|---|
| Gap → Playbook | Turns each gap into an action (workshop, integration, automation rule, owner request) | Guide customers from onboarding to operationalization; run workshops |
| Feature Radar | On each release, lists customers whose estate benefits and why | Advise on availability of new features |
| Threat-to-Adoption | Maps a new cloud threat to affected customers and to an unused module that addresses it | Keep up with emerging cloud threats |
| Escalation Cockpit | Escalation as a program: timeline, internal owners, status, response-time metrics | Program-manage account escalations |
| Voice of Customer | Aggregates feature requests across accounts, weighted by ARR | Advocate for customers with Product Management |
| Renewal & Expansion Signals | Links Yield/Reach to renewal risk and coverage gaps to expansion | Work with Sales and Renewals; find expansion opportunities |

## 7. Playbooks per leak (v0.1 catalogue)

| Leak | Trigger | Action | Success signal |
|---|---|---|---|
| L1 | Billing shows account X, not connected | Ask spend owner for read-only auditor access (least privilege: metadata only); propose org-level connector | Account appears in inventory in ≤ 7 days |
| L1 | New account created last 30 days | Enable auto-onboarding on the org connector | New accounts connect with no ticket |
| L2 | Provider has a type with 0 inventoried | Check permissions/scopes for that type; add to connector role | Type count > 0 |
| L3 | Module available, 0 activation for relevant assets | Run enablement workshop; start with highest-exposure assets | Active modules per asset ↑ |
| L3 | New release relevant to customer | Feature Radar brief + 30-min demo to the owning team | Adoption of new feature within 60 days |
| L4 | Findings without owner | Ownership routing from tags / CODEOWNERS / team map | Unowned share ↓ |
| L4 | Accepted risks without expiry | Add review date and reason policy | 100% of accepted risks have expiry |
| Reach | Team with assets, no users | Onboard team lead, scoped role, SSO group | Team has weekly active user |

## 8. Data model (sketch)

```
Customer(id, name, arr, tier)
CloudAccount(id, customer_id, provider, source[billing|org|sso], connected, owner, last_spend)
ResourceType(provider, name, expected)            -- catalogue
Inventory(account_id, resource_type, count)
Module(id, name, since_version, relevance_rule)   -- catalogue, versioned
Activation(account_id, module_id, active_since)
Finding(id, asset_id, severity, exposure, owner, decision, decision_reason, expiry, opened_at, closed_at)
Team(id, name, cloud_assets, active_users, sso, role_scoped)
Escalation(id, customer_id, status, owner_internal, opened_at, closed_at, milestones[])
FeatureRequest(id, customer_id, text, arr_weight)
Snapshot(customer_id, date, ceiling_version, L1, L2, L3, L4, yield, reach, naive)
```

## 9. Demo account (mock)

`docs/demo-account.yaml`. Starts at a **naive 92%** (92 of the 100 accounts known at contract signing). Against the true universe:

| Stage | Value | Cause |
|---|---|---|
| L1 | 94.0% (110/117) | 7 accounts created by a new business unit |
| L2 | 96.0% | container registries not inventoried on one provider |
| L3 | 95.0% | two relevant modules inactive |
| L4 | 91.0% | unowned findings after a team reorganization |
| **Yield** | **78.0%** | 0.94 × 0.96 × 0.95 × 0.91 |

Demo storyline: 92% → 78% in one slide, then the playbooks that bring it to 90% in a quarter and the new target after that.

## 10. Roadmap

1. **v0.1** this spec.
2. **v0.2** score engine on mock data (CLI, JSON in/out), tests for each stage formula.
3. **v0.3** dashboard: naive vs real, per-stage waterfall, playbook list, history with ceiling versions.
4. **v0.4** QBR export structured with the Pyramid Principle: answer first, then 3 supporting arguments.
5. **v0.5** Feature Radar and Threat-to-Adoption with a mock release feed.

## 11. Open questions

- Which sources are realistically available to a TAM for the true universe (billing exports, org APIs)?
- How to weight modules by relevance without making L3 arbitrary?
- Privacy: how to keep per-customer data separate if this is ever used beyond the demo.

## References

- C. Dotson, *Practical Cloud Security*, O'Reilly, 2019: ch. 3 (asset management pipeline, four leaks, tagging), ch. 4 (access life cycle), ch. 5 (vulnerability-management metrics, anti-gaming warning), ch. 7 (response metrics).
