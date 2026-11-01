# Quarterly business review: Northwind (mock), Q4 2026

_As of 2026-10-31, ceiling 2026.4. Draft generated from the score; add the customer's goals and wins before presenting. The last section is for you alone: remove it before sharing._

## Agenda to share in advance

1. Your priorities, and what has changed on your side since we last met (your items first)
2. Where adoption really stands, and why it moved
3. What we should say plainly
4. Where we are aiming, and how we will know we got there
5. Decisions, and who does what by when

Your items to add: ______________________________

## Listen first

Questions to ask before presenting anything (open ones; let them answer in their own terms):

- What has changed on your side that I should know about, and what would make this review worth your time?
- When a finding has no obvious owner, who ends up deciding, and how?  _(on: Give unowned findings an owner and a decision)_
- Which decisions are slow because people lack information, and which because of priorities?  _(on: Record a decision on owned findings)_
- Where in your estate would you most want this capability, and what would it have to prove to earn its place?  _(on: Adopt Workflow and remediation automation on 31 account(s))_
- Which of these accounts matter most to your business this quarter, and what has made them hard to connect so far?  _(on: Connect 3 account(s) owned by bu-retail)_

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

## What we should say plainly

Each of these is supported by the data. Saying them first, before the customer finds them, is what lowers self-orientation.

1. **The figure we have been reporting, 92%, overstates adoption. The real figure is 72.6%.**
   - Evidence: The legacy figure counts only accounts that were in the onboarding plan. The full universe is 121 accounts, and gaps in inventory, controls and findings come on top.
   - Why say it: Volunteering a worse number than the one on the dashboard is the clearest sign you are not managing their impression of you.
2. **You are using 540 of 1000 sensors (54%); 180 of 300 code_seats (60%); 2100 of 3000 defend_gb (70%). Either we help you put the rest to work, or you may want to pay for less.**
   - Evidence: Utilization against targets of 80%.
   - Why say it: Naming the option of a smaller purchase shows your attention is on their outcome, not on your revenue.
3. **We think around 6 account(s) are known to none of our lists. If they are unconnected, the real L1 is 85.8%.**
   - Evidence: 32 of 121 known accounts appear in only one of billing, the organization and SSO (Chao 1987 incidence lower bound).
   - Why say it: Saying what you cannot see is part of credibility; the alternative is a number that looks more certain than it is.
4. **Around week 3 the score will dip by about 1.1 points before it recovers. Newly connected accounts enter it with nothing covered yet.**
   - Evidence: 4 account(s) connected: they enter L2 and L3 with nothing covered yet, so Yield dips before it recovers.
   - Why say it: Bad news given in advance is reliability; the same news explained afterwards sounds like an excuse.
5. **3 severity downgrade(s) landed within days of an SLA deadline. Until we understand why, remediation times may look better than they are.**
   - Evidence: Findings: F-00360, F-00361, F-00362.
   - Why say it: Questioning your own good numbers before the customer does is what makes the rest of your numbers believable.

(3 more in the full report. In a review, five is plenty.)

## Where we are aiming

- **What we are aiming for:** 90.0% this period, with 90% as the next checkpoint. Ninety is a checkpoint, not the finish: the denominators grow as you grow and as the product ships.
- **What it will look like:** every account you pay for is connected, every resource type is visible, the relevant controls are on, and every finding has an owner and a decision.
- **How we will know:** the same four pass rates, on the same independent denominators, each quarter, with the change split between what you did and what the product added.

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

## Decisions we need today

- Name an owner and a date for: Give unowned findings an owner and a decision (13).
- Name an owner and a date for: Connect 3 account(s) owned by bu-retail.
- Name an owner and a date for: Adopt Workflow and remediation automation on 31 account(s).

## What we commit to

Small, specific, on time:

- We will send the findings without an owner, with owners suggested from tags and code ownership, within two working days.
- We will prepare the list of undecided findings for your next security sync.
- We will send a one-page brief on what shipped and why it matters here, and offer a demo within 30 days.
- We will send you a written recap within two working days, and tell you early if any date is going to move.

---

## For you only: remove before sharing

### The relationship

Influence-weighted trust index 4.3 (strong). It is a prompt for a conversation with a colleague, not a measurement: you are a poor judge of your own self-orientation.
Reliability, measured: 3 of 6 promises due in the last period were kept on time (50%); 2 are overdue.
- No executive sponsor is on record.
- Key contacts you have not spoken to recently: Marco Bellini.
- Teams with cloud assets and no contact: payments, bu-retail, ml-research, team-09, team-10, team-11.
- Weakest lever for Marco Bellini, Tom Walker, Dana Okafor: self orientation.

### Expansion, as a trusted advisor

Each of these is an expansion of some kind. They feel different to the customer, so they are approached differently (EXPAND: new capability, people who trust you; BROADEN: same service, new people; DIVERSIFY: new capability and new people).

- **EXPAND**: Adopt Workflow and remediation automation on 31 account(s).
  A new capability for people who already trust you. Present it through them, tied to a problem they have named, and do your homework before bringing in a colleague; do not just hand over a business card.
- **BROADEN**: Connect 3 account(s) owned by bu-retail.
  The same service for people who do not know you. Trust does not travel from your champion to them. Ask for an introduction, say what is in it for them and for the champion, and arrive having learned about the team on your own time.
- **EXPAND**: Adopt External attack surface on 26 account(s).
- **BROADEN**: Connect 1 account(s) owned by ml-research.
- **BROADEN**: Connect 1 account(s) owned by payments.
- **DIVERSIFY**: Enable Runtime sensor on 9 account(s).
  A new capability for new people: two new relationships at once, and the lowest trust you will start from. Build the relationship first, give something useful before asking, and do not treat the institutional relationship as if it carried over.
- **EXPAND**: Enable Code and pipeline scanning on 6 account(s).
- **DIVERSIFY**: Enable AI services posture on 5 account(s).

### Before you walk in

- Send the agenda in advance and ask them to add to it. Start the meeting by reading it back.
- Listen and say back what you heard until they say 'yes, exactly'. Only then frame.
- Take a point of view and say it plainly, as a proposal, not a verdict.
- Give away at least one idea that has nothing to do with renewal or expansion.
- Say 'I don't know' quickly when you do not.
