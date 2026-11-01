# Changelog

All notable changes. Versions follow semantic versioning while below 1.0: minor versions may change formats, and the changelog says so.

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
