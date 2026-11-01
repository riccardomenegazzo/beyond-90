# Success plan: Northwind (mock)

_Draft prepared 2026-10-31, ceiling 2026.4. Owner on our side: Alex Doe. Review: every month. Everything below comes from the data we share; change anything that does not match your priorities before you sign._

## Outcomes we are working toward

1. Bring **Remediation and response automation** from 72% to 90% of the capability that applies (78 of 109 in use today; biggest gap: Workflow and remediation automation).
2. Bring **Exposure management** from 76% to 90% of the capability that applies (83 of 109 in use today; biggest gap: External attack surface).
3. Give every finding an owner and a decision (now 89%, target 95%) (235 of 263).

## How we will measure progress

| Measure | Now | Target |
|---|---|---|
| Yield (real adoption, all four stages) | 72.6% | 97.6% after 14 weeks |
| Maturity level | Bronze | Silver (4 check(s) to pass) |
| At least 95% of known units are connected | 90.1% | >= 95.0% |
| No open critical finding is past its deadline | 11 | <= 0 |
| No severity downgrade lands just before a deadline | 3 | <= 0 |
| Every licensed unit is at least 60% in use | 54.0% | >= 60.0% |
| L1 Procurement | 90.1% | 95.0% |
| L2 Processing | 97.3% | 97.3% |
| L3 Tooling | 92.7% | 95.0% |
| L4 Findings | 89.4% | 95.0% |

The score is measured against accounts and asset types from independent lists, not from the platform's own inventory, and it records the hash of the files it came from.

## Milestones

| By | Expected Yield | What moves |
|---|---|---|
| Day 30 | 82.8% | Connect 1 account(s) owned by retail-it; Connect 1 account(s) owned by security |
| Day 60 | 91.9% | Adopt External attack surface on 26 account(s): first 18 of 26 |
| Day 90 | 96.9% | Adopt Workflow and remediation automation on 11 account(s); Enable AI services posture on 5 account(s) |

A model, not a promise: it rests on the hours available and on each action succeeding as assumed.

## Who does what

| Action | Owner | Due | Effort | Done when |
|---|---|---|---|---|
| Give unowned findings an owner and a decision (13) | unassigned | 2026-11-14 | 5.05 h | Every triaged finding has an owner and a decision. |
| Record a decision on owned findings (8) | unassigned | 2026-11-21 | 2.1 h | Every triaged finding has a decision. |
| Adopt Workflow and remediation automation on 31 account(s) | unassigned | 2026-12-30 | 11.8 h | Capability active within 60 days of release. |
| Connect 3 account(s) owned by bu-retail | bu-retail | 2026-11-14 | 3.25 h | Account is connected and inventoried within 7 days. |
| Connect 3 account(s) owned by platform | platform | 2026-11-14 | 3.25 h | Account is connected and inventoried within 7 days. |
| Fix accepted risks with no or expired review date (6) | unassigned | 2026-11-30 | 1.4 h | All accepted risks have a reason and a future expiry. |
| Adopt External attack surface on 26 account(s) | unassigned | 2026-12-30 | 10.3 h | Capability active within 60 days of release. |
| Inventory container_registry on aws (15 account(s)) | unassigned | 2026-11-21 | 4.75 h | Resource type is marked inventoried on every connected account. |

## What we need from you

- A named owner and a date for: Give unowned findings an owner and a decision (13).
- A named owner and a date for: Record a decision on owned findings (8).
- A named owner and a date for: Adopt Workflow and remediation automation on 31 account(s).
- A named owner and a date for: Connect 3 account(s) owned by bu-retail.

## What we commit to

- We will send the findings without an owner, with owners suggested from tags and code ownership, within two working days.
- We will prepare the list of undecided findings for your next security sync.
- We will send a one-page brief on what shipped and why it matters here, and offer a demo within 30 days.
- We will send a written recap within two working days of every review, and tell you early if a date is going to move.

## What could get in the way

- The score will dip around week 3 (about 1.1 points) because newly connected accounts enter it with nothing covered yet. That is the cost of seeing them.
- Some work is assumed to stay blocked and needs escalation rather than more effort: 2 findings that stayed undecided; 14 module activations that did not happen; 2 inventory gaps that could not be closed; 1 findings that stayed unowned; 1 accepted risks that stayed unreviewed.
- About 6 account(s) may be known to none of our lists; finding them may lower the starting point.

## Agreed

| | Name | Date |
|---|---|---|
| Customer sponsor | | |
| Customer owner | | |
| Alex Doe | | |
