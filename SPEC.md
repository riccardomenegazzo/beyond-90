# Beyond 90: specification v0.42

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

## 15e. Input quality (0.8)

`quality.assess` returns checks with status `ok`, `note` or `weak` and a confidence: `low` with any weak check, `medium` with any note, otherwise `high`. Checks: independent sources present among billing, org and SSO (none is weak, one is a note); share of connected accounts with inventory rows and with activation rows (below 50% weak, below 90% note, none at all weak); newest finding event older than 21 days (note) or 63 days (weak); at least five open findings past the triage window with neither owner nor decision (weak); fewer than eight accounts (note); many unconnected accounts with no owner and no spend (note). Confidence describes the inputs only.

## 15f. Profiles (0.9)

A profile is a catalogue (`resource_types.json`, `modules.json`, optional `playbooks.json`) for one kind of security product. `cnapp` is the default; `endpoint` ships with it; `--catalogue-dir` loads your own. A customer selects one with `[customer] profile = "name"`; the CLI and the browser app read it, a `--profile` that contradicts it is an error, and a portfolio or book of mixed profiles is refused. A profile's `playbooks.json` overrides the generic playbooks by id, field by field. `terms` (`estate`, `unit`, `units`) set the words the engine uses for the unit of coverage and the estate; text the engine writes passes through them, a customer's own text never does. The stages, formulas, checks and every other rule in this document are the same for every profile, and each score records its profile and catalogue hash in its provenance. See `docs/profiles.md`.

## 15g. Maturity ladder (0.10)

A rubric is a list of checks `{id, level, title, metric, op, value, playbooks}` with level in bronze, silver, gold, an operator in `>= > <= < ==` and a numeric value, over these metrics: `independent_sources`, `l1`..`l4`, `yield`, `unseen_share` (1 minus universe completeness), `critical_open`, `critical_unowned`, `critical_overdue` (open criticals older than the critical SLA), `mttr_p90_ratio` (90th percentile of critical time to remediate over the SLA), `downgrade_suspects`, `min_utilization`, `reach`, `quality_weak`, `sponsor` (1 or 0), `reliability_rate`, `overdue_commitments`. A metric that cannot be measured is `None` and its check is `not_measured`. The level is the highest of basic, bronze, silver, gold such that no check at that level or any lower level fails. `blocking` lists the failing checks at the next level; the level is `provisional` when any not-measured check sits at or below the next level (or anywhere, at gold). A check's risk weight is the level it sits at. Level names are fixed; checks and thresholds come from `rubric.json` (the shared default, or a profile's own) and are validated at load. Each result carries the measured value and target.

## 15h. Views (0.10)

Each module carries a `use_case` and a list `csf` of NIST CSF 2.0 functions. From the L3 pairs (an active, connected unit and a module that applies to it): per use case, active over applicable, a state (`not started` at 0, `early` below 50%, `partial` below 90%, `deep`) and the module with the most inactive pairs; per function, the same counts (a module serving two functions counts in both) and a note when the best and worst function differ by 25 points or more. Functions with no applicable module are reported as such, not as zero. Govern is not measured. The view says it is not a compliance statement.

## 15i. Renewal readiness (0.10)

With `customer.renewal_date`, signals are evaluated with a status of ok, watch, risk or not measured: adoption level (basic risk, bronze watch), least-used licence (below half the target risk, below target watch), executive sponsor (absent risk), single-threaded (watch), promises (rate below 50% risk, any overdue watch), key contacts stale (watch), critical findings past deadline (watch), direction of travel against a previous snapshot (a fall of 5 points risk, 2 watch), weak input checks (watch). The status is the worst measured signal: ready, watch or at_risk. `arr_at_risk` is the customer's ARR when the status is at_risk and the date is within `renewal_window_days` (or passed). Headroom lists use cases that are not started or early. There is no probability: without a renewal history it would be invented.

## 15j. Success plan (0.10)

`successplan` renders outcomes (the three thinnest use cases and the weakest stage, with targets of 90% and 95%), measures (Yield, ladder level, the next checks, the four stages), 30, 60 and 90 day milestones from the roadmap, the eight highest-ranked actions with owners and due dates, the decisions needed, the commitments, the risks (the J-curve dip, assumed-blocked work, hidden units, weak inputs) and signature lines. It never includes relationship ratings or renewal signals.

## 15k. Path to the next level (0.11)

The roadmap records the four stage values every week. The checks that block the next level and use `l1`, `l2`, `l3`, `l4` or `yield` can therefore be followed through it: the answer is the first week from which all of them pass until the end of the roadmap (a pass followed by a fall during a dip does not count), and the hours spent up to and including that week. Blocking checks on any other metric are reported as outside the roadmap, because the simulation does not move them. The text says so; it never claims the plan covers them.

## 15l. Input drift (0.11)

With a comparison file (`--since`), the two sets of inputs are compared for signs of an export artefact: active units missing now without being marked decommissioned (a warning from 10% of the earlier total, and at least 3; otherwise a note), new units (a note), inventory or activation files more than 25% smaller, open findings that vanished from the file without being closed (a warning from 10% and at least 3), findings with a different opening date, and a comparison dated no earlier than the current file (a warning). These are notes to check before presenting a change, not errors.

## 15m. Automatic collection and the pipeline (0.12)

A configuration (`beyond90.toml`) declares `[[source]]` entries: `type` (`http`, `command`, `file`), `target` (a data file), `map` (column to path or table), and for accounts a `tag`. `sync` fetches each source, maps it, merges by key and writes a data directory atomically; a failing source falls back to its last good rows (reported `stale` with its age), a required column empty for every record fails the source, rows referring to unlisted accounts are dropped and counted, and no accounts at all is an error. `run` then scores the directory, takes the latest earlier snapshot under `state/snapshots/` as the comparison, writes the outputs, appends a record to `runs.jsonl`, saves a snapshot and the history, writes a browser-compatible workspace file (its id is the input hash of the files kept, personal files only if configured), computes alerts and posts a webhook if one is configured and there is something to say. Alert rules: a source stale or failed, level change (warn on a fall), Yield moved by 2 points or more, an increase in open critical findings without an owner, a renewal at risk that is new or within 30 days, drift warnings, dropped rows, input quality turning weak. Safety rules: tokens only from environment variables, https (plain http to localhost only), host and redirect allow-list, no shell, named environment for commands, size, time and page caps. See `docs/automation.md`.

## 15n. Operating rules (0.13)

Input: text files are decoded as UTF-8 (with or without a byte-order mark) or UTF-16; invalid UTF-8 is read as Windows-1252 and warned about; NUL bytes make a file unreadable; non-finite numbers are rejected; malformed CSV is a `DataError`, never an exception of another type. The loader raises `DataError` or returns data, for every input. Pipeline: `run` takes `state/run.lock` (stale after six hours or when its process is gone), writes outputs to a hidden folder and renames it into place, and prunes dated snapshots and outputs beyond `[state] keep_snapshots` (default 180) and `keep_outputs` (default 30). Workspace: at most 1000 snapshots per file. See `docs/operations.md`.

## 15o. The weekly rhythm (0.15)

`tier` classes (top, mid, other) set a default cadence of 7, 14 and 30 days, overridden by `settings.cadence_days`. A touch is a line of `interactions.csv` (personal; date not after `as_of`; kinds fixed) or a contact's `last_contact`; the state is on cadence, due soon (two days or fewer), overdue or none. Only the latest line's `next_step` is open. `week_plan` orders a book by a printed sum of points (touch state, overdue follow-up, overdue promises, renewal, uncovered advisories, critical findings without an owner) scaled by tier, and splits the weekly hours after preparation and calls. The call brief is built from existing results in a fixed order: what we owe, what changed, news, leaks, questions, renewal, growth, next steps. Advisories use the threat radar's matching; a feed for another catalogue is skipped with a warning; text is cleaned and only http(s) links are kept. Expansion signals (capacity above 90% of a licence, cross-sell actions, uncovered advisories) are shown as questions, and marked as not yet when the trust gate is closed: Yield below 75%, an overdue promise, a critical finding without an owner, or a fragile relationship. See `docs/rhythm.md`.

## 15p. Onboarding (0.16)

`connectors.csv` (optional) lists connectors with kind, status, the platform's error text, dates, scope, region counts, missing permissions, authentication and privilege. Each active account is placed on the first stage it has not passed: discovered, deployed, authenticated, authorized, scanning, complete. An error is classified by the first matching entry of `data/connector_issues.json` (provider and kind filtered); the account reached the stage before the cause's stage. Stale (no success for `connector_stale_days`), partial scope, missing permissions, never scanned, disabled and expired secrets are recognised from the columns. Waves group blocked accounts by cause; a cause with organization scope costs its hours once; three or more undeployed accounts of a provider become one organization-level deployment; waves are ordered by accounts per hour. The security review flags administrative privilege (critical at organization or management group scope), long-lived secrets and AWS roles without an external ID, labelled with STRIDE. Healthy rate counts complete accounts (and partial scope) over active accounts; it does not replace L1. Each cause carries read-only `checks` (aws, az, gcloud, kubectl; read verbs only, `az rest` only with GET); values are filled only when they match a safe pattern, otherwise a `<placeholder>` remains. With an earlier snapshot, `delta` lists accounts that moved forward or back, causes fixed and new, connectors newly broken, completions per week and a forecast date (remaining divided by the recent pace; "stalled" without progress). The customer status page lists what waits on the customer's teams, what is on the vendor's side, credentials to rotate and connector recommendations, without scores. See `docs/onboarding.md`.

## 15q. Outlook and stake (0.18)

`outlook(data, horizon=90)` lists events dated within the horizon: connector secret expiry (the day after), acceptance expiry (the day after), findings without owner or decision entering the triage window (grouped by day), critical and high findings passing `sla_days` (the day after), open commitments falling due, the cadence running out, the renewal date. `project(data, day)` returns the estate on `day` with `as_of = day` and cloud connectors whose secret expires on or after today and before `day` counted as not connected; nothing else changes. For each day with a score-moving event (secret, acceptance, triage), the effect is Yield on that day minus Yield the day before, in points. The curve is scored at 0, 7, 14, 30, 60 and 90 days, with the maturity level at 0, 30, 60 and 90.

`weighted(data, score)` computes L1 to L3 with each active account weighted by `last_spend` (equal when all are zero), L2 and L3 as the spend-weighted mean of each connected account's own pass rate, and L4 with triaged open findings weighted 8, 4, 2, 1 by severity and doubled for internet exposure. It reports the weighted Yield next to Yield and the heaviest gaps. See `docs/outlook.md`.

## 15r. Value receipt and team digests (0.19)

`receipt(old, new)` compares two snapshots of the same customer: accounts active and connected in `new` but not in `old` (with their `last_spend`), and the reverse; inventory units gained and lost; capability activations gained, by module; findings open in `old` and closed in `new`, by severity and with critical internet-exposed counted apart; findings that gained an owner or a decision; exact attribution (customer points against bar points); weighted Yield before and after; commitments delivered and delivered on time. Each interaction in the window is matched by topic (connections, findings, capabilities, coverage) to the outcomes of the same topic dated within 21 days after it; the wording is "followed", never "caused". `remaining` names what did not move. The HTML is self-contained, escaped, with a CSP that allows no script and no network.

`digests(data)` groups accounts by owner team: accounts, spend share, unconnected accounts and spend, blocked connectors with their cause, gaps, findings not ok past the triage window, outlook events on their accounts, and contacts from `contacts.csv` whose team matches. Stake is 100 × unconnected spend share + 5 per critical finding + 2 per blocked connector + 0.5 per finding. At most three asks; the message uses no internal metric names. See `docs/value.md`.

## 15s. Cloud news (0.20)

`collect(sources)` reads each source (kinds `jsonfeed`, `xml` for RSS 2.0 and Atom, `kev` for the exploited catalogue) with https only, redirects to configured hosts only, 16 MB and 25 s per source, at most 300 items per source. XML declaring a DOCTYPE or an entity is refused. Text is plain; links are http(s) only. An item is kept when it is within the window and its source is marked cloud, its text names a provider, or the source keeps by type and the text names a resource type. At most the newest 300 kept items per source, within a 60-day window by default; each source reports what it dropped and why. Providers and resource types come from whole-word terms (`data/cloud_terms.json`) and the source's defaults. Matching providers are the providers named in the text, or else the source's, minus Kubernetes; a story keeps them only if every item agrees, otherwise it matches every provider. Items sharing a CVE, a link or a title of 24 characters or more form one story. Severity: KEV critical; EPSS ≥ 0.9 critical, ≥ 0.5 at least high; otherwise the first severity term found (critical, high, low), default medium. Mitigations: catalogue modules whose `requires_any` meets the types; posture for techniques, changes and stories without a CVE; detection for exploited, incidents and techniques; vulnerability scanning first for CVEs on compute, registries or serverless. Stories without a known resource type go to `general`. `first_seen` carries over from the previous feed. Ranking: KEV, severity, newest, EPSS.

In the book, each story is matched to every customer (the threat radar) and ranked by KEV, customers with uncovered accounts, severity and ARR at stake. The customer briefing lists at most five stories touching the customer, KEV and uncovered first, without scores. Automated runs alert once per KEV or critical story with uncovered accounts. See `docs/news.md`.

## 15t. History and the executive QBR (0.21)

Each single-customer analysis is saved as a snapshot (input files only, content-addressed, personal files excluded unless chosen) unless the user turns it off. `build(snapshots, start, end)` keeps one snapshot per date (the later save wins), defaults to the quarter of the latest snapshot, takes as baseline the last snapshot before `start` (else the first inside), and as final the last inside. It reports a series of points (coverage, weighted coverage, the four parts, critical findings open and internet-exposed, accounts connected) for the baseline and every snapshot inside; the value receipt between baseline and final; interactions and commitments of the final snapshot within the period; exposure, the outlook in plain words, the threats touching the final estate; four priorities ranked by effect per hour; and at most four decisions (unconnected spend of 5% or more, critical findings without an owner, the two largest onboarding waves, slipped commitments). The rendering uses no internal stage names, maturity labels or Yield. See `docs/exec-qbr.md`.

## 15u. Connections (0.24)

For each active account, signals from the other analyses: not connected (5), onboarding blocked (2), exposed to a story without its mitigating capability (the story's severity weight, doubled when exploited), unable to be assessed for a story because the account is not connected, critical findings open to the internet (3 each) and high ones while the account is not healthy (1 each), protections off where they apply (1 each). Each signal belongs to a dimension: visibility, threat, findings or protection. An account *converges* when at least two of visibility, threat and findings meet on it; a protection that is off is detail, not a problem of its own. The graph keeps the 28 accounts ranked by convergence then weight, the 8 top stories, the 6 capabilities that matter, the causes that block the drawn accounts, their 16 worst findings and their teams; blind links are capped at 12 per story. Insights, at most six, ranked: convergence, leverage (a capability closing exposures from two or more stories), concentration (a team holding at least a quarter of the drawn accounts and three or more), blind spot (a story with two or more accounts nobody can assess) and root cause (the top onboarding wave with two or more accounts). Each says what it means, what to do, who should do it and which items to highlight. The page lays the graph out in columns ordered by barycentre sweeps, so the same data always draws the same picture.

## 15v. Shared patterns, the map over time, slides (0.25)

`book(customers)` takes, per customer, its matched exposures and onboarding causes. Stories are kept when they leave accounts uncovered or unknown at a customer (top 8, by customers exposed, exploited, severity), causes by customers then accounts (top 8), capabilities that mitigate a kept story and are missing on its uncovered accounts (top 6). A customer node is drawn when at least one of those touches it. Insights: a cause at two customers or more (one fix guide, product feedback); a story leaving two or more customers exposed (one campaign); a story nobody can assess at two or more; a capability covering exposures at two or more (one enablement session); and the customer carrying 30% more of the shared load than the next (start here).

`compare(before, now, since)` works on every account's problem kinds, not only the drawn ones: cleared (no problem left), improved (problems gone, none added), visible (a visibility problem gone and others now shown: progress), worse (problems added otherwise), new (no problem before); insights that appeared or were resolved; drawn nodes that are new.

`render_pptx(review)` writes six slides with the standard library (`slides.py`): cover and summary, the four parts then and now, delivered, exposure, the two futures, decisions; no stage names, maturity labels or Yield.

## 15w. Actions as CSV, a one-page summary, mapped exports, health (0.27)

`actions_csv` writes one row per open action in plan order: Summary, Description (detail, steps, the question to ask, what we commit to), Assignee, Due date, Priority (the first three High, the next five Medium, the rest Low), Labels (single words), Customer, expected effect, effort, done-when and the action id. A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe.

`render_onepager` takes the executive review of the current data and draws one A4 page: effective coverage and its four parts, what is exposed (critical findings, those exposed to the internet, unconnected spend share, accounts connected), the outlook in plain words, the first three priorities and the first three decisions. It carries a policy that allows no script and no outside request.

`mapping` reads delimited text (comma, semicolon or tab, with or without a byte-order mark; at most 200,000 rows), guesses a column for each field of `accounts.csv` or `findings.csv` from a list of common names, and converts with the confirmed mapping. Severities, providers, booleans, exposure and decisions are normalised from common spellings; dates are read as ISO, or day/month/year unless the column proves month/day; a value that cannot be read skips its row and is counted. An unmapped connection column makes every account not connected and says so.

`health.compute` gives a 0 to 100 indicator: adoption 40% (70% effective coverage, 30% coverage weighted by spend and exposure), outcomes 20% (critical findings open, 15 points each when exposed to the internet up to 60, 5 each otherwise up to 25), relationship 25% (the sponsor, threads, promises and contact signals of the renewal view: ok 1, watch 0.5, risk 0), trajectory 15% (100 minus four times the points coverage loses in 90 days if nothing is done). Parts that cannot be measured are dropped and the other weights renormalised. The band is the worse of the band by score (75 and 55) and the band by the weakest part (below 50 watch, below 30 at risk). It is a hypothesis for a conversation: it is not validated against real renewals.

## 15x. Renewal outcomes, calibration, the call (0.28)

An outcome is `(customer, decided_on, outcome, note, reading)` with `outcome` one of renewed, expanded, reduced or churned, and `reading` the health score and the four part values (0 to 100 or empty) of the analysis on screen when it was recorded. Its identity is `customer|decided_on`; two copies merge by set union, the later recording winning, then a fixed order, so devices agree in any order. The page refuses an outcome whose fields are not exactly what it would have written, and a workspace holding more than 2,000.

`calibrate.report` groups outcomes into stayed (renewed, expanded) and left (reduced, churned). A part is compared only when at least 3 customers on each side were measured on it: it reports the mean on each side, the gap and the counts. The score gets a concordance (the share of stayed/left pairs in which the one that stayed scored higher; 50% is chance), reported only when both sides have 3. Weights are suggested only when some part has a gap: each measured part's share becomes half of what its positive gap earns among the measured parts plus half of its current share, with a floor of 5%, then normalised. A part pointing the wrong way earns nothing. The result always carries its counts and says it is a hint, not proof. `health.compute` accepts a complete set of positive weights and reports whether it used the defaults or the applied ones.

`callOutput` turns a call (agenda items covered or not with private notes, what was agreed, what we owe) into the recap (covered titles and agreed items only), a CSV of agreed and owed actions and the interactions line (first agreed item as next step). Notes appear in none of them.

## 15y. What-if, the path to a target, the MCP server (0.29)

A scenario is `{name, steps}`; a step is `connect_all`, `connect` (accounts), `enable_module` (module, optional accounts), `enable_all` or `fix_findings` (leak: all, unowned, no_decision, accepted_without_expiry, expired_acceptance). Each step is translated, against the data as it stands after the previous one, into the operations of `simulate.apply_ops`; enabling covers only active, connected accounts whose provider the module supports and that do not have it on. Every scenario is applied twice to copies: with the inventory lag (the reading right after) and in steady state (everything settled). `dip` is true when the reading right after is more than 0.05 points below today. A scenario file holds at most 20 scenarios of at most 50 steps; the input is never modified.

`reach` repeats: among the candidates (connect the rest, enable each module where eligible, repair each kind of finding leak) pick the one with the largest steady-state gain, apply it, stop at the target, when nothing gains, or after 30 steps. It reports the path, the Yield after each step and the assumptions; it estimates no effort and claims no optimality.

`mcp_server.Server` speaks JSON-RPC 2.0 over lines of text on standard input and output (protocol versions 2025-06-18, 2025-03-26, 2024-11-05; batches are refused). Five tools, all declared read-only: `list_customers`, `score`, `actions`, `what_if`, `path_to_target`. A customer is a folder name resolved to a real path whose parent must be the root; names with a path separator, a leading dot or a null byte, and links leaving the root, are refused. A message over 1 MiB is dropped with an error; an exception in a tool becomes an error result and the session continues. The module imports no network or process facility.

## 15z. Criticality (0.30)

`accounts.csv` may carry a `criticality` column: `critical`, `high`, `medium`, `low` or empty (any other value is a loading error). It is optional, and the importer writes the column back only once some account has a value. `stake.weighted` multiplies an account's weight (its last spend, or 1 when no spend is known) by 4, 2, 1 or 0.5 (empty counts as 1), and weighs a finding's severity and exposure by the factor of the account it sits in. Yield, its stages and every other reading are untouched. With no criticality anywhere the output is what it was, plus `criticality_known: false`.

## 15za. Promises and the handoff note (0.31)

A **commitment** is `{id, customer, what (<=300), who (<=100), due (date or empty), status (open|done|dropped), source (call|ours|manual), created_on, updated_on, closed_on}`; `id` is `customer|created_on|suffix` with a 6 to 12 character lowercase suffix. `closed_on` is empty exactly when the status is open. It is validated field by field wherever it comes from outside (storage, an imported workspace), at most 5,000 are accepted, and the copies of one id merge to the one updated later (ties: the one that sorts first), so devices converge in any order. Commitments live in their own store in the browser, sealed with the passphrase like snapshots, and travel in an exported workspace under `commitments`.

`fromCall` makes commitments from a finished call: each agreed item (with its person and date, if valid) and each thing we owe (person "us"), skipping any whose words equal an open commitment of the same customer. `ledger(list, today)` groups the open ones into late (due before today, most late first), due within 7 days, later, and undated, lists the ones closed within 30 days, and counts them per customer. Nothing reads a clock: today is passed in.

The **handoff note** is Markdown built by `buildHandoff` from the reading, renewal, contacts, ledger, saved readings and renewal outcomes already on the page: in short, where adoption stands (and the three best actions), what has been promised, renewal and people, how Yield has moved, risks, earlier renewals, and what to check before relying on it. It contains no private call notes, because those are never stored. It is text for the person to read, edit and send; nothing is sent.

## 15zb. Sharing with pseudonyms, retention and erasure (0.32)

`identifiers.collect(data)` lists, by kind, the strings that identify a customer or a person: the customer's name; owners of accounts and findings and the contacts' names (`person`); team names; account ids and connector names (`account`). Values are trimmed, at least 3 characters, distinct, longest first, at most 2,000 per kind. The engine returns them as `identifiers` (and `identifiers_by_customer` for a book).

The page has three **sharing levels**: `full` (nothing replaced), `people` (kind `person`), `pseudonym` (all four kinds). Every text that leaves the page by copy or download passes one gate. At a level other than `full` it replaces each known identifier, whole words only and case-insensitively, longest first and in a single pass (an alias is never replaced again), with a stable alias (`Customer A`, `Person 1`, `Team 1`, `Account 1`); in a file name the alias is written as a slug. It then shows a preview with how many names were replaced and what the page can still see (identifiers the level does not cover, and anything shaped like an email address), and nothing leaves until the person confirms. A binary file (a presentation) cannot be searched, so at a level other than `full` it is refused. Not gated, on purpose: the sealed workspace backup, and the source files the person creates for their own use (the starter files, `interactions.csv`).

The **alias table** (original, alias, kind, customer) lives in the browser only, sealed like any customer fact, so aliases stay the same from one share to the next and a pasted text with aliases can be turned back into real names. It is not part of an exported workspace.

**Retention**: an optional keep-until date per customer; the page lists customers past it and those within 30 days. It never deletes by itself. **Erasure** removes, for one customer, its snapshots, recorded outcomes, promises, retention date, alias entries and entries of the export log, then reads the stores again and reports how many records for that customer it can still read (it refuses while sealed data is locked, because it could not see what to remove). The **export log** notes each time something left the page for the open customer (date, file or copy, level, file name); it is sealed with the other facts. The **erasure record** is a text the page writes about itself: what it removed, the second look, and the list of copies it cannot reach. It is not stored and is not independent proof.

Sealed customer facts (outcomes, promises, retention, export log) are stored under a random 96-bit slot, not under their own id (which contains the customer's name); records made before 0.32 are moved to a slot the first time the data is unlocked. The database is version 5.

## 15zc. Burn-down, proof of value, asks and roles (0.34)

`burndown.build(data, sla=None)` reads findings only. Severities are critical, high, medium, low; `DEFAULT_SLA` is 7, 30, 90 and 180 days and `sla_is_default` is true until the caller passes their own. A finding is open when it has no close date on or before the as-of date. Age is as-of minus opened. Mean days to fix is reported only with at least `MTTR_MIN` (3) findings closed in the last `MTTR_WINDOW_DAYS` (90). The flow lists the last six calendar months with opened, closed and the critical and high counts open at the month's end. `zero_critical` says whether none is open now, since when, and the last day there was none.

A proof of value (`site/pov.js`) has a sponsor, a champion, a window, criteria (status open, met, partly, not_met, dropped; evidence up to 300 characters), at most 20 working sessions and a readiness list. Records merge by id, the later `updated_on` wins, and anything that fails validation is rejected whole. The verdict is "in progress" while any counted criterion is open; otherwise "all criteria met" when all are met, "mostly met" when none failed and at least 75% are met, else "not met". The result text always includes what the result does not show.

An ask (`site/asks.js`) has a kind (feature, blocker, escalation), a status (open, shared, done, declined) and an integer `at_stake` typed by the user. The digest groups open asks by normalised title, counts each customer's figure once per group, and lists escalations apart, oldest first.

In book mode `analyze_book` adds `burndown`, keyed by customer: open critical and high, findings past target, unowned urgent findings, the zero-critical state, the age of the oldest urgent finding and the mean days to fix critical ones. It uses the same default target ages.

The burn-down reads its target ages from `settings.sla_days` of the customer (the same table the score uses); `sla_is_default` is true when they equal 7, 30, 90 and 180. `closure` counts critical and high findings raised in the last 180 days (or still open): with an owner, with a decision, closed and, only when any finding carries `verified_at` or `reopened`, confirmed and reopened, with `recurrence_rate` = closed findings that came back / closed findings. `verified_at` must not precede `closed_at` and needs a close date.

The scorecard (`site/scorecard.js`) is text built from the reading, the burn-down and the first 16 hex characters of the input fingerprint. `matches` compares a pasted fingerprint of at least 12 characters with the loaded one. It shows that numbers came from those inputs, not that the inputs are true.

Roles (`site/roles.js`) only order and group the navigation; every view stays reachable and the palette and shortcuts use the full list.

## 16. Positioning against the platform's own views

Security platforms commonly ship their own adoption or maturity views and an ownership model. Beyond 90 does not replace them: it measures what a platform cannot see about itself (the true universe of units to cover, across a whole portfolio) and reads ownership and decisions rather than rebuilding routing. The research behind this is in `docs/research/`.

## 17. Not yet

- Verification against real vendor APIs and CLIs. Collection is configuration-driven and tested against fake services; each real source must be checked with `sync` before it is trusted. No interactive OAuth flow.
- Criticality per resource: it is per account for now, because that is the unit the customer lists. The customer has to say it; nothing infers it.
- Validation of the health indicator against real renewals: the page can now record outcomes and compare, but nothing has been learnt from real customers yet, and its weights are still a judgement.

## 18. Roadmap

1. 0.2: engine, CLI, report, history, portfolio, QBR, validation, tests.
2. 0.3: simulator and planner with the J-curve, exact attribution, universe estimate, zero-critical forecast.
3. 0.4: importers and reconciliation, book planner, radar for releases and threats, performance on large estates.
4. 0.5: relationship layer, candor ledger, typed expansion, five-stage QBR.
5. 0.6: browser app on GitHub Pages.
6. 0.7: provenance, tolerant reader, percentiles, local-first workspace, offline.
7. 0.8: input quality, whole-book mode in the browser.
8. 0.9: profiles (cloud and endpoint), vendor-neutral terms.
9. 0.10: maturity ladder, use-case and framework views, renewal readiness, success plan.
10. 0.11: path to the next level, input drift.
11. 0.12: automatic collection, pipeline, alerts, schedules.
12. 0.13: hardening: encodings, hostile inputs, network chaos, run lock, retention, workspace limits.
13. 0.14: a native dashboard in the browser app: explorer tables, what-if planning, portfolio map, command palette, themes.
14. 0.15: the weekly rhythm for a book (tiers, cadence, call prep, advisories, trust-gated expansion) and a hardened browser app (Trusted Types, sealed storage, pinned supply chain).
15. 0.16: onboarding diagnosis: connector stages, a catalogue of causes, waves, connector security review, pre-flight.
16. 0.17: read-only check commands per cause, onboarding progress and forecast, a status page for the customer.
17. 0.18: the outlook if nothing is done, and coverage weighted by what is at stake.
18. 0.19: the value receipt, team digests and the recap after the call.
19. 0.20: the daily cloud security news, merged, ranked and matched to every customer.
20. 0.21: the customer's history kept automatically, and an executive QBR built from it on demand.
21. 0.22: sealed exports, strict typing and security lint, a least-privilege, hash-locked supply chain.
22. 0.23: an interface organised by places and questions, with tooltips, plain-language help and a tour.
23. 0.24: the connections map, where a customer's separate problems meet, and the app as a browser extension.
24. 0.25: shared patterns across a book, the map over time, the executive review as slides, a verifiable build, fuzzing and Scorecard.
25. 0.26: installable on any device, phone-first layout, Excel and a form as inputs, sealed transfer between devices, self-hosting.
26. 0.27: actions as CSV, the CISO one-pager, mapped exports, customer health.
27. 0.28 (this): renewal outcomes and calibration of the health reading, the call screen.
28. 1.0: connector interface and a first verified connector against a real tenant; criticality weighting; readiness checklist import; per-finding ownership sources.

## References

- C. Dotson, *Practical Cloud Security*, O'Reilly, 2019: ch. 3 (pipeline, four leaks, tagging), ch. 4 (access life cycle), ch. 5 (vulnerability metrics, anti-gaming warning), ch. 7 (response metrics).
- `docs/research/`, `docs/profiles.md`, `docs/design.md`.
