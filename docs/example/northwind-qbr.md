# Quarterly business review: Northwind (mock), Q4 2026

_As of 2026-10-31, ceiling 2026.4. Draft generated from the score; add the customer's goals and wins before presenting._

## The answer

Real adoption is **72.6%**, not the 92.0% the legacy metric shows.
It moved +5.2 points since 2026-09-30: the customer moved +6.8, the bar moved -1.7 (new capabilities raised the denominator).
At 8 hours a week the plan reaches **97.6%** in 14 weeks, with the 90% checkpoint in week 7.
**Expect a dip first:** in week 3 Yield falls 1.1 points because newly connected accounts enter the score with nothing covered yet. That is the cost of seeing them, not a regression.
One caveat: about 6 account(s) are probably known to no source at all; if they are unconnected, L1 is 85.8%.

## Three reasons

1. **Findings with no owner or decision.** 5 open action(s), worth about 8.7 points.
   - Give unowned findings an owner and a decision (13): 13 finding(s) past the 7-day triage window have no owner.
   - Record a decision on owned findings (8): 8 finding(s) past the 7-day triage window have an owner but no decision.
   - Fix accepted risks with no or expired review date (6): 6 finding(s) past the 7-day triage window are accepted risks with no expiry.
2. **Accounts outside the platform.** 9 open action(s), worth about 8.0 points.
   - Connect 3 account(s) owned by bu-retail: 3 account(s) not connected, last spend 10,871: aws-043, aws-065, aws-039.
   - Connect 3 account(s) owned by platform: 3 account(s) not connected, last spend 14,685: azure-029, azure-009, aws-035.
   - Connect 1 account(s) owned by data: 1 account(s) not connected, last spend 5,532: azure-016.
3. **Controls that are not switched on.** 9 open action(s), worth about 5.7 points.
   - Adopt Workflow and remediation automation on 31 account(s): Workflow and remediation automation (since 2026.3) is relevant on 109 account(s) and inactive on 31: aws-001, aws-005, aws-009, aws-020, aws-021, aws-022, aws-026, aws-028 (+23 more).
   - Adopt External attack surface on 26 account(s): External attack surface (since 2026.2) is relevant on 109 account(s) and inactive on 26: aws-008, aws-010, aws-015, aws-017, aws-018, aws-019, aws-027, aws-037 (+18 more).
   - Enable Runtime sensor on 9 account(s): Runtime sensor (since 2025.1) is relevant on 109 account(s) and inactive on 9: aws-001, aws-013, aws-023, aws-034, azure-011, azure-015, azure-018, azure-021 (+1 more).

## Evidence

| Stage | Pass rate | Count |
|---|---|---|
| L1 Procurement | 90.1% | 109 / 121 |
| L2 Processing | 97.3% | 1061 / 1090 |
| L3 Tooling | 92.7% | 1063 / 1147 |
| L4 Findings | 89.4% | 235 / 263 |
| **Yield** | **72.6%** | |

Against the baseline ceiling (2026.1) Yield is 76.1%. The gap is new capability released since then: more headroom, not a step back.

Critical findings open: 11. Consecutive critical fixes within SLA: 2. Mean time to remediate critical: 11.4 days.

Reach: 66.1% across 14 teams with cloud assets.

Licensed capacity below target: sensors 540/1000 (54%); code_seats 180/300 (60%); defend_gb 2100/3000 (70%).

## Plan for next quarter

| Action | Owner | Due | Done when |
|---|---|---|---|
| Give unowned findings an owner and a decision (13) | unassigned | 2026-11-14 | Every triaged finding has an owner and a decision. |
| Record a decision on owned findings (8) | unassigned | 2026-11-21 | Every triaged finding has a decision. |
| Adopt Workflow and remediation automation on 31 account(s) | unassigned | 2026-12-30 | Capability active within 60 days of release. |
| Connect 3 account(s) owned by bu-retail | bu-retail | 2026-11-14 | Account is connected and inventoried within 7 days. |
| Connect 3 account(s) owned by platform | platform | 2026-11-14 | Account is connected and inventoried within 7 days. |

## Roadmap

8 hours a week for 26 weeks, 90% of each action assumed to succeed. Yield 72.6% to 97.6%.

Checkpoints: 90% in week 7, 95% in week 10, 98% not reached.

- Week 3: Yield dips 1.1 pts. 4 account(s) connected: they enter L2 and L3 with nothing covered yet, so Yield dips before it recovers.

| Weeks | Action | Hours | Effect when settled |
|---|---|---|---|
| 1-1 | Fix accepted risks with no or expired review date (6) | 1.4 | +1.9 pts |
| 1-1 | Record a decision on owned findings (8) | 2.1 | +2.5 pts |
| 1-2 | Give unowned findings an owner and a decision (13) | 5.05 | +4.0 pts |
| 2-2 | Fix accepted risks with no or expired review date (1) | 0.65 | +0.3 pts |
| 2-2 | Connect 3 account(s) owned by bu-retail | 3.25 | +1.6 pts |
| 2-2 | Connect 3 account(s) owned by platform | 3.25 | +1.6 pts |
| 2-3 | Connect 1 account(s) owned by data | 1.75 | +0.5 pts |
| 3-3 | Connect 1 account(s) owned by finance-it | 1.75 | +0.5 pts |
| | 24 more | | |

Assumed blocked, needs escalation: 2 findings that stayed undecided; 14 module activations that did not happen; 2 inventory gaps that could not be closed; 1 findings that stayed unowned; 1 accepted risks that stayed unreviewed.

_No further action improves Yield after week 14; the plan stops there._
_At 90% realization the plan plateaus: the residual needs escalation, not more of the same effort._

## Zero critical

11 critical finding(s) are open and 1.4 new ones arrive per week. Probability of reaching zero within 30 / 60 / 90 days: 0% / 13% / 37% on the current pace.

## Risks

- 3 severity downgrade(s) landed close to an SLA deadline. Until reviewed, remediation times may look better than they are.

## Decisions we need today

- Name an owner and a date for: Give unowned findings an owner and a decision (13).
- Name an owner and a date for: Connect 3 account(s) owned by bu-retail.
- Name an owner and a date for: Adopt Workflow and remediation automation on 31 account(s).
