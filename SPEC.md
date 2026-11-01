# Beyond 90: specification v0.3

An adoption engine for Technical Account Managers. It measures how much of a customer's cloud estate is really covered and operated through a security platform, and turns every gap into an action. The bar keeps moving: when a customer grows or the product ships something, the denominators grow with it.

This document is the contract for the code. A formula changes only together with a test and a note here.

## 1. Problem

Adoption is usually reported as `connected accounts / accounts in the onboarding plan`. That reaches 90% and the account looks finished while it quietly excludes accounts nobody planned for, resource types that are connected but never inventoried, modules the customer could use and does not, and findings with no owner.

## 2. The pipeline

From the asset-management pipeline in *Practical Cloud Security* (Dotson, 2019, ch. 3): assets flow from cloud providers towards security tooling and can leak at four points. Each leak is a stage.

| Stage | Leak | Question |
|---|---|---|
| L1 Procurement | An account is never connected | Do we know the true universe? |
| L2 Processing | Connected, but a resource type is not inventoried | Do we see every kind of asset? |
| L3 Tooling | Asset known, but a relevant module is off | Is every relevant control on? |
| L4 Findings | Findings with no owner or decision | Does a finding lead to a decision? |

```
Yield = L1 x L2 x L3 x L4
```

Stages are sequential, so a leak upstream hides what is downstream. Missing data never lowers the score silently: a stage with an empty denominator counts as 100% and says so in the report notes.

## 3. Stage definitions (as implemented)

**L1.** `connected active accounts / active accounts`. The universe comes from billing, the organization hierarchy and SSO, never from the platform. `decommissioned` accounts are excluded. Leaks are listed by last spend.

**L2.** Over connected active accounts and the resource types the catalogue expects for their provider: `(account, type) pairs inventoried / pairs expected`. A pair is inventoried only if a row says the platform looked at it. A type with zero resources is fine if it was inventoried. (A weighting by asset count is a possible later option; pairs are used because they cannot hide a blind spot behind a large type.)

**L3.** Over connected active accounts and the modules in the catalogue with `since <= ceiling`: `(account, module) pairs active / pairs relevant`. A module is relevant when the provider is supported and, if the module needs resource types, the account has an inventoried resource of one of them. A new release adds to the denominator, so L3 can fall with no change at the customer. Modules released after the baseline are marked `new_since_baseline` and routed to a separate playbook.

**L4.** Over open findings older than `triage_window_days`: `findings with an owner and a valid decision / findings past triage`. A decision is `fix`, `accepted_risk`, `exception` or `false_positive`. An accepted risk needs a future expiry; one with no expiry, or an expired one, counts as a leak. Accepting a risk consciously is not a leak; ignoring it without review is.

## 4. Reported next to Yield

**Naive (legacy) score.** `connected / accounts flagged in_plan`. Shown beside Yield; the gap is the story.

**Reach.** Mean of four shares over teams that own cloud assets: with an active user, behind SSO, using a scoped role, access reviewed in the last `access_review_days`. Reported next to Yield, not inside it.

**Entitlement utilization.** `used / licensed` per unit (workloads, sensors, code seats, log GB). A unit below `entitlement_target` produces an action. It does not depend on any customer-side data source.

**Outcomes.** Critical findings open (false positives excluded) and zero-critical status; mean time to remediate by severity and exposure over `mttr_lookback_days`; MTTR streak (consecutive most recent critical fixes within SLA); open findings past SLA by severity. Time to zero critical comes from stored history.

**Anti-gaming.** A severity downgrade within `downgrade_window_days` of the original SLA deadline is flagged as a reclassification suspect and produces an action. Alert counts can fall because of generous ignore rules; this check exists so the metric does not reward that.

## 5. The moving bar

- **Floor, not target.** `next target = max(90%, yield + 5 points)` while Yield < 98%, capped at 100%; from 98% the mode is `hold`.
- **Ceiling versions.** Catalogue versions look like `2026.4`. Every report states the ceiling and shows Yield against today's ceiling and against the frozen `baseline_ceiling`, so customers see real progress and real new headroom.
- **Naive next to real** in every report.

## 6. Actions

Each gap becomes an action tied to a playbook in `playbooks.json`, with steps, a success signal, a due date, an effort in hours, the `ops` it performs and an estimated effect. The effect is `100 x (units / stage denominator) x product of the other stages`: it ranks actions, it does not promise the result. L1 actions are grouped by account owner; L2 by provider and resource type; L3 by module; L4 by kind of leak.

## 7. Simulation and roadmap

An action carries `ops`, the concrete changes it makes to the data (connect accounts, inventory a type, enable a module, assign owners, record decisions, set an expiry). `simulate.py` applies ops to a copy of the data and rescores, so the effect is exact, not isolated.

**The J-curve.** Connecting an account raises L1 immediately but adds that account to the denominators of L2 and L3 with nothing covered: Yield dips before it recovers. The simulator models the ramp: inventory completes after `inventory_lag_weeks` (default 2) and modules marked `on_connect` in the catalogue (the agentless ones) switch on with it; every other module stays off until someone enables it. Newly inventoried types are assumed to hold at least one resource, which can only make L3 look worse.

**The planner** (`beyond90 plan`) is greedy on exact steady-state gain per hour. For each candidate action it simulates the converged estate and rescores everything, takes the best, spends a weekly hour budget on it (effort = `base + per_unit x units`, from the playbook catalogue), applies the change with its ramp, regenerates the actions from the new state, and repeats. Follow-up work appears by itself. Units that fail are assumed blocked (`realization`, default 90%): they never succeed in the plan and are reported as a residual that needs escalation, so the projection plateaus instead of reaching 100%. Output: weekly Yield, checkpoint weeks, the dips and their causes, the jobs.

The projection is a model: it rests on the effort figures, the ramp and the realization rate. It is deterministic for given inputs.

## 8. Attribution: the customer or the bar?

`beyond90 explain` decomposes the change in Yield between two dates exactly with the log-mean Divisia index: `contribution_k = L(Y1, Y0) x ln(r_k)`, where `r_k` is the ratio of a factor's new to old value and `L` is the logarithmic mean. The contributions sum to `Y1 - Y0` with no residual, also when large gains and losses cancel. L3 is split in two: its change at the previous ceiling (the customer's doing) and the change caused by capabilities released since (the bar). A drop caused by a release is headroom, not a regression, and the report says so with numbers.

## 9. How complete is the universe?

L1 is measured against the accounts you know. `beyond90 universe` estimates how many no source has seen, with the capture-recapture lower bound of Chao (1987), using billing, the organization hierarchy and SSO as sources: with `T` sources, `Q1` accounts seen by exactly one and `Q2` by exactly two, `unseen = ((T-1)/T) x Q1^2 / (2 x Q2)` (bias-corrected when `Q2 = 0`). It reports completeness, a pessimistic L1 (if the hidden accounts are unconnected) and warnings when the assumptions fail: a source that lists every account is not independent, and when most accounts are seen by only one source the sources need reconciling before any adoption number is trusted. It is a prompt to look, not a count.

## 10. Zero-critical forecast

`beyond90 forecast` runs a seeded Monte Carlo of the critical-finding queue, learned from the customer's own history: open findings get a residual time from the empirical close times longer than their age (findings older than anything ever closed are counted as `stuck_beyond_history` and modelled with an exponential residual whose mean is their age); new criticals arrive as a Poisson process at the recent rate. It reports the median and 90th percentile days to zero, the probability of zero within 30, 60 and 90 days, and, when already at zero, the probability that a new critical breaks it. Without closed critical findings it says so and does not guess.

## 11. Portfolio

`beyond90 portfolio ROOT` scores every customer directory under ROOT, reports the ARR-weighted Yield and lists patterns that recur across customers. Recurring patterns are the candidates for one-to-many work (a shared playbook, a webinar, a knowledge article), the proactive half of scaled customer success.

## 12. QBR draft

`beyond90 qbr DIR` writes a Markdown review with the Pyramid Principle: the answer first (real adoption against the legacy number, what changed and why, the roadmap and the dip to expect, a caveat on hidden accounts), three reasons grouped by leak, the evidence beneath, the plan and the decisions asked of the customer. The TAM adds the customer's own goals and wins.

## 13. Positioning against the platform's own views

Platforms such as Wiz already ship an adoption and maturity view (the Champion Center) and an ownership model. Beyond 90 does not replace them: it measures what the platform cannot see (the true account universe, across a whole portfolio) and reads ownership and decisions rather than rebuilding routing. See `docs/research-wiz-tam.md`.

## 14. Not yet

- Portfolio-level planning across customers with a shared hour budget.
- Live connectors to platform APIs. They need a real tenant to verify and will be separate optional modules.
- Weighting by asset criticality.
- Health scoring. Adoption is one input to a customer health view, not health.

## 15. Roadmap

1. 0.2: engine, CLI, report, history, portfolio, QBR, validation, tests.
2. 0.3 (this): simulator and planner with the J-curve, exact attribution, universe estimate, zero-critical forecast.
3. 0.4: connector interface and a first verified connector; CSV export templates per platform.
4. 0.5: threat-to-adoption feed (map a new threat or release to customers and unused capabilities); readiness checklist import.
5. 0.6: criticality weighting; portfolio-level planning (one team, many customers, one hour budget).

## References

- C. Dotson, *Practical Cloud Security*, O'Reilly, 2019: ch. 3 (pipeline, four leaks, tagging), ch. 4 (access life cycle), ch. 5 (vulnerability metrics, anti-gaming warning), ch. 7 (response metrics).
- `docs/research-wiz-tam.md`, `docs/reading-list.md`, `docs/design.md`.
