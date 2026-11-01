# Beyond 90: specification v0.7

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

## 11. Building the universe from native exports

`beyond90 import` reads the native export of each independent list (`aws organizations list-accounts`, `az account list`, `gcloud projects list`, billing and SSO CSVs, the platform's connected-account list) and merges it into `accounts.csv` by account id. It adds the source, never loses one, reports disagreements (provider, status) instead of guessing, normalizes ids (12-digit AWS ids keep their leading zeros, Azure ids are lower-cased) and is idempotent: importing the same file twice changes nothing. A connected-account list can be authoritative, so accounts missing from it become unconnected. `beyond90 reconcile` shows how the lists overlap and flags accounts billed but absent from the organization hierarchy (likely shadow accounts) and accounts in the organization with no billing line.

When no inventory or no module activations are provided, L2 and L3 are reported as *not measured* (and count as 100% with a note), not as zero: a missing file is missing data, not a finding.

## 12. Planning a whole book

`beyond90 book` runs the planner for every customer under one budget of hours per week. Each customer is a stepping engine that can say what its best next job is and how much Yield it adds when it is done. Every hour goes to the job with the highest `weight x gain / remaining hours`, where the weight is the customer's share of ARR (or equal). The objective is therefore the ARR-weighted Yield of the book. The result is compared with an equal split of hours and a split proportional to ARR, each run as independent plans, so the value of choosing is a number. With enough hours every rule ends at the same place, and the report says so.

## 13. Radar: releases and threats

`beyond90 radar` answers "who should hear about this?" for a portfolio.

* **Releases.** For modules released at a version (or after each customer's baseline): customers where the module is relevant and off, how many accounts, and the exact Yield each would gain by switching it on. Ranked by ARR x gain.
* **Threats.** From a JSON feed you provide (nothing is fetched): per customer, accounts with inventoried resources of the affected types, how many already have a mitigating module active (any of `mitigated_by`), how many are uncovered, and how many are *unknown* because the affected type was never inventoried. Ranked by `severity weight x ARR x uncovered share`. An L2 leak is also a threat blind spot, and the report says to fix it first.

## 14. Portfolio

`beyond90 portfolio ROOT` scores every customer directory under ROOT, reports the ARR-weighted Yield and lists patterns that recur across customers. Recurring patterns are the candidates for one-to-many work (a shared playbook, a webinar, a knowledge article), the proactive half of scaled customer success.

## 15. QBR draft

`beyond90 qbr DIR` writes a Markdown review with the Pyramid Principle: the answer first (real adoption against the legacy number, what changed and why, the roadmap and the dip to expect, a caveat on hidden accounts), three reasons grouped by leak, the evidence beneath, the plan and the decisions asked of the customer. The TAM adds the customer's own goals and wins.

## 15b. Relationship layer (0.5)

Optional inputs: contacts and commitments. For a contact with credibility C, reliability R, intimacy I and self-orientation S (each 1 to 10), the trust index is T = (C + R + I) / S. Bands: strong at T >= 4, developing at T >= 2, otherwise fragile. The account value is the mean of T weighted by influence (1 to 3), over rated contacts only. The limiting factor is the component whose one-point improvement (one point lower for S, floored at 1) raises T the most; ties resolve by a fixed component order.

Measured reliability is on-time / due over the commitment lookback window. A commitment is on time when `done_on <= due_on`. Open commitments past `due_on` are overdue. Gaps: no executive sponsor, key contacts (influence >= 2) not contacted within `contact_stale_days`, single-threaded (fewer than two contacts within that window), teams with assets and no contact, and the weak component per contact. With neither file, the layer is absent and nothing else changes.

Cross-sell type for an action: offer new or same, people known (at least half of the owners have a contact on that team) or new. New offer to known people is expand; new offer to new people is diversify; same offer to new people is broaden. Without contacts the type is empty.

Candor items are derived only from fields already computed; each carries its evidence. The QBR is arranged as agenda, listen, answer, reasons, evidence, candor, aims, plan, decisions, commitments, then a private section.

## 15c. Browser app (0.6)

The app is a client-side wrapper. It must never send input data off the page, must load nothing from a third party and must produce the same numbers as the CLI for the same files; the first two are enforced by the page's Content Security Policy and the build test, the third by `tests/test_web.py`.

## 15d. Provenance, compatibility and the workspace (0.7)

**Fingerprint.** For each input file (`customer.toml`, `accounts.csv`, `inventory.csv`, `activations.csv`, `findings.csv`, `teams.csv`, `entitlements.csv`, `contacts.csv`, `commitments.csv`) the file hash is SHA-256 of its bytes after removing a leading byte-order mark and turning CRLF and CR into LF. The input hash is SHA-256 of the UTF-8 text made of `<name>\t<file hash>\n` for each present file, sorted by name. Files that are not in the list never contribute. `Score.provenance` holds: engine version, schema version, input hash, per-file hashes, catalogue hash, ceiling and baseline.

**Compatibility.** `customer.schema_version` (default 1). A value above the engine's is an error; unknown keys in `[customer]` and `[settings]` and unknown CSV columns are warnings with the nearest known name when one is close.

**Percentiles.** Nearest rank: the value at position ceil(n·q/100) of the sorted sample. Time to remediate reports the median and the 90th percentile per severity (and per severity and exposure), plus the mean and n.

**Workspace file (browser).** `{format: "beyond90-workspace", version: 1, exported_with, snapshots: [...]}` plus any unknown fields. A snapshot is `{id, customer, as_of, personal_excluded, saved_on, files}` plus unknown fields; `id` is the input hash of `files`. Importing refuses a newer major version, rejects a snapshot whose `id` is not the hash of its `files`, and merges by union on `id` (earliest `saved_on`; a deterministic choice among conflicting unknown values). Deletion does not propagate.

## 16. Positioning against the platform's own views

Platforms such as Wiz already ship an adoption and maturity view (the Champion Center) and an ownership model. Beyond 90 does not replace them: it measures what the platform cannot see (the true account universe, across a whole portfolio) and reads ownership and decisions rather than rebuilding routing. See `docs/research-wiz-tam.md`.

## 17. Not yet

- Live connectors to platform APIs. They need a real tenant to verify and will be separate optional modules.
- Weighting by asset criticality.
- Health scoring. Adoption is one input to a customer health view, not health.

## 18. Roadmap

1. 0.2: engine, CLI, report, history, portfolio, QBR, validation, tests.
2. 0.3: simulator and planner with the J-curve, exact attribution, universe estimate, zero-critical forecast.
3. 0.4: importers and reconciliation, book planner, radar for releases and threats, performance on large estates.
4. 0.5: relationship layer, candor ledger, typed expansion, five-stage QBR.
5. 0.6: browser app on GitHub Pages.
6. 0.7 (this): provenance, tolerant reader, percentiles, local-first workspace, offline.
7. 0.8: connector interface and a first verified connector against a real tenant.
8. 0.9: criticality weighting; readiness checklist import; per-finding ownership sources.

## References

- C. Dotson, *Practical Cloud Security*, O'Reilly, 2019: ch. 3 (pipeline, four leaks, tagging), ch. 4 (access life cycle), ch. 5 (vulnerability metrics, anti-gaming warning), ch. 7 (response metrics).
- `docs/research-wiz-tam.md`, `docs/reading-list.md`, `docs/design.md`.
