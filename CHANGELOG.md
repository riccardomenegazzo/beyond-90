# Changelog

All notable changes. Versions follow semantic versioning while below 1.0: minor versions may change formats, and the changelog says so.

## 0.8.0

- **How far to trust this number.** `Score.quality`: checks on the inputs (independence of the account list, inventory and activation coverage, freshness of the findings export, empty owner and decision columns, very few accounts, forgotten accounts) and an overall confidence of high, medium or low. Shown in the report and in the browser app. It never changes Yield.
- **Browser app: a whole book.** Drop a folder of customer folders (or try the book demo): portfolio table, shared patterns, and one budget of hours spent where it adds the most weighted Yield. "Open" jumps to a customer's own report.
- Accessibility: axe-core runs in the browser test in light and dark with no violations; contrast, labels and landmarks fixed.
- Screenshots of the app in `docs/img/`.

## 0.7.0

Structure, from *Designing Data-Intensive Applications* (see `docs/architecture.md`).

- **Provenance.** Every score carries the hash of its inputs, the engine version, the catalogue hash and the ceiling; reports print it. New command `fingerprint`.
- **Tolerant reader.** Unknown CSV columns and `customer.toml` keys are ignored with a warning and a "did you mean". `schema_version` in `customer.toml`: newer formats are refused with advice.
- **Percentiles.** Time to remediate is reported as median and 90th percentile (mean kept in the JSON). The QBR line changed accordingly. **Behaviour change in the report text.**
- **Browser app, local-first.** The engine runs in a worker (cancel, restart, no frozen page). Snapshots of the inputs can be saved in the browser (IndexedDB), compared with an earlier snapshot, exported and imported. Merge is set union and idempotent; imports are verified against their content hash; unknown fields survive. Contacts and commitments are left out unless you opt in.
- **Offline.** A service worker caches the whole app per build; a new build waits for old tabs to close.
- **Self-check.** A button that proves the page and the worker cannot reach another site.
- Tests: Node tests for the workspace model, a cross-language fingerprint check, and a larger browser test (offline, cancel, persistence, import/export, tampering).

## 0.6.0

- Browser app (`site/`): the engine runs in the page through Pyodide; drop a folder or try the demo, get the report, QBR, roadmap and JSON. Nothing is uploaded; a strict Content Security Policy allows the page's own origin only.
- `beyond90.web`: one call that returns every output for a directory or a mapping of files.
- GitHub Pages workflow: builds the site, runs a Chromium smoke test, deploys. See `docs/app.md`.
- Error messages from the browser path name files, not temporary folders.

## 0.5.0

- Relationship layer: optional `contacts.csv` and `commitments.csv`; trust index per contact, band, limiting factor, reliability measured from promises, coverage and gaps.
- Candor ledger: what to say plainly, with evidence; shown in the report and the five most important in the QBR.
- Expansion typed as Expand, Broaden or Diversify from who you know on each team.
- Playbooks gain an offer, an opening question and a commitment; new relationship playbooks (find a sponsor, reconnect, widen, introduce, close commitments, improve a component).
- QBR rewritten as engage, listen, frame, envision, commit, with a private "for you only" section.
- Settings `contact_stale_days` and `commitment_lookback_days`. No behaviour change when the new files are absent.

## 0.4.0

- `import` (aws-org, azure, gcp, csv) and `reconcile`: build `accounts.csv` from native exports, union by account id, report conflicts, idempotent.
- `book`: one budget of hours across many customers, compared with an equal split and an ARR-proportional split.
- `radar`: customers that should hear about a release; exposure and coverage for threats from a JSON feed.
- Missing `inventory.csv` or `activations.csv` now means "not measured" for L2 and L3 instead of zero. **Behaviour change.**
- Planner: large actions are planned in weekly batches; cached stage ratios; a 500-account customer plans in about 5 seconds.
- `py.typed`, mypy and ruff clean, tests run on Python 3.11, 3.12 and 3.13.

## 0.3.0

- Simulator and week-by-week planner that shows the J-curve of connecting new accounts.
- Exact attribution of a change in Yield: customer versus bar (log-mean Divisia index).
- Estimate of accounts no source has seen (Chao 1987 lower bound) and a pessimistic L1.
- Monte Carlo forecast of reaching zero critical and of breaking it.
- Commands `plan`, `explain`, `universe`, `forecast`.

## 0.2.0

- Scoring engine (L1 to L4, Reach, entitlements, outcomes, anti-gaming check), validated CSV/TOML loader, versioned catalogues.
- Ranked actions from a playbook catalogue, SQLite history, portfolio view, QBR draft, self-contained HTML report.
