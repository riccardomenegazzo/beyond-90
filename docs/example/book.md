# Book plan

8 hours a week for 12 weeks across 3 customers (arr-weighted, 90% of each action assumed to succeed).

**Weighted Yield 83.3% to 93.7%.**

| Allocation rule | Weighted Yield at the horizon |
|---|---|
| Exact gain per hour (this plan) | **93.7%** |
| Equal split of hours | 91.5% |
| Hours proportional to ARR | 91.3% |

| Customer | ARR | Yield | Hours | Share of hours | Jobs |
|---|---|---|---|---|---|
| Contoso Bank (mock) | 1,250,000 | 91.0% to 98.4% | 47.7 | 50% | 12 |
| Northwind (mock) | 480,000 | 72.6% to 88.1% | 34.2 | 36% | 14 |
| Fabrikam Labs (mock) | 96,000 | 37.7% to 60.7% | 14.1 | 15% | 7 |

## First 15 jobs

| Week | Customer | Job | Hours | Effect when settled |
|---|---|---|---|---|
| 1 | Contoso Bank (mock) | Fix accepted risks with no or expired review date (4) | 1.1 | +0.9 pts |
| 1 | Contoso Bank (mock) | Record a decision on owned findings (6) | 1.7 | +1.3 pts |
| 1 | Contoso Bank (mock) | Fix accepted risks with no or expired review date (3) | 0.9 | +0.7 pts |
| 1 | Northwind (mock) | Fix accepted risks with no or expired review date (6) | 1.4 | +1.9 pts |
| 1 | Northwind (mock) | Record a decision on owned findings (8) | 2.1 | +2.5 pts |
| 2 | Northwind (mock) | Give unowned findings an owner and a decision (13) | 5.0 | +4.0 pts |
| 2 | Contoso Bank (mock) | Give unowned findings an owner and a decision (1) | 0.8 | +0.2 pts |
| 2 | Contoso Bank (mock) | Connect 2 account(s) owned by finance-it | 2.5 | +0.6 pts |
| 3 | Contoso Bank (mock) | Connect 2 account(s) owned by retail-it | 2.5 | +0.6 pts |
| 3 | Fabrikam Labs (mock) | Fix accepted risks with no or expired review date (4) | 1.1 | +2.8 pts |
| 3 | Northwind (mock) | Fix accepted risks with no or expired review date (1) | 0.7 | +0.3 pts |
| 3 | Northwind (mock) | Connect 3 account(s) owned by bu-retail | 3.2 | +1.6 pts |
| 4 | Northwind (mock) | Connect 3 account(s) owned by platform | 3.2 | +1.6 pts |
| 4 | Contoso Bank (mock) | Connect 1 account(s) owned by bu-retail | 1.8 | +0.3 pts |
| 5 | Fabrikam Labs (mock) | Give unowned findings an owner and a decision (11) | 4.3 | +7.8 pts |

## Dips to warn customers about

- Contoso Bank (mock): week 2, Yield dips 0.1 pts.
- Northwind (mock): week 3, Yield dips 0.5 pts.

## Needs escalation, not more effort

- Contoso Bank (mock): findings that stayed undecided 1; module activations that did not happen 8.
- Northwind (mock): findings that stayed undecided 2; inventory gaps that could not be closed 2; findings that stayed unowned 1; accepted risks that stayed unreviewed 1.
- Fabrikam Labs (mock): findings that stayed undecided 1; findings that stayed unowned 1.

_Allocating hours by exact gain per hour ends at 93.7% weighted Yield, +2.2 points against the better of an equal split and an ARR-proportional split._
