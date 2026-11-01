# Beyond 90

**An adoption score that cannot be flattered, a roadmap that tells you the dip before it happens, and an honest answer to "did the customer improve, or did the bar move?"**

Most adoption reporting stops at "90% of accounts connected". That number leaves out accounts nobody planned for, resource types the platform never inventoried, controls that are switched off and findings nobody owns. Beyond 90 measures the whole pipeline against independent denominators, turns every gap into an action, and then goes further than a dashboard can.

![Beyond 90 report](docs/img/report-light.png)

*Mock customer. The legacy metric says 92%; the real score is 73%.*

## What is different

**1. It simulates the plan, and shows the J-curve.** Connecting an account makes Yield *fall* first: the new account enters L2 and L3 with nothing covered. Beyond 90 applies every action to a copy of the estate, with the ramp real connections need, and projects Yield week by week for the hours you actually have. You can tell the customer about the dip before it happens instead of explaining it afterwards.

![Roadmap with the J-curve](docs/img/report-roadmap.png)

**2. It separates what the customer did from what the bar did.** When a release adds capabilities, a good quarter can look like a bad one. `beyond90 explain` decomposes the change in Yield exactly (log-mean Divisia index, no residual) and splits L3 into "controls the customer switched on" and "capabilities that shipped since".

![What changed](docs/img/report-changed.png)

**3. It estimates the accounts nobody has seen.** Every adoption number is measured against the accounts you know. Billing, the organization hierarchy and SSO each miss some; how often accounts are seen by exactly one source versus two tells you how many are probably seen by none (capture-recapture, Chao 1987). The report gives a pessimistic L1 and says when the method's assumptions fail.

**4. It forecasts zero critical, and how likely it is to break.** A seeded Monte Carlo of the critical-finding queue, learned from the customer's own history. It flags findings older than anything ever closed instead of assuming they are about to be.

**5. It plans your whole book.** One budget of hours across all your customers, spent where the ARR-weighted gain per hour is highest, compared with an equal split and an ARR-proportional split, so the value of choosing is a number.

**6. It starts from the exports you already have.** `import` reads `aws organizations list-accounts`, `az account list`, `gcloud projects list`, billing and SSO CSVs and the platform's connected list, merges them by account id, and `reconcile` shows who is billed but not in the organization.

**7. A radar for releases and threats.** Which customers should hear about a new capability, and which are exposed and uncovered (or unknown) for a threat from a feed you provide.

**8. A trust layer from *The Trusted Advisor*.** Per-contact trust index, reliability measured from the promises you made, relationship gaps (no sponsor, single-threaded, teams nobody knows), expansion typed as Expand, Broaden or Diversify, a candor ledger of what to say plainly before the customer finds it, and a QBR built as a conversation in five stages. See [docs/trust.md](docs/trust.md).

**9. It says how far to trust the number.** Independent denominators, inventory and activation coverage, stale exports and empty columns are checked and summarised as a confidence level next to the score.

**10. It runs in a browser tab, local-first.** [docs/app.md](docs/app.md): the same engine compiled to WebAssembly, served from GitHub Pages, nothing uploaded. Drop a folder or try the demo. Save snapshots of your inputs in the browser, compare with the previous quarter, export and merge between devices, work offline. Every number carries the hash of the inputs it came from. Drop a whole folder of customers to plan one budget of hours across the book.

![The browser app](docs/img/app-results.png)

Plus: ranked actions from a playbook catalogue, a moving bar (the score against today's ceiling and a frozen baseline), Reach, licensed-versus-used, an anti-gaming check for severity downgrades before SLA deadlines, history in SQLite, an ARR-weighted portfolio view that finds patterns worth one-to-many work, and a QBR draft written with the Pyramid Principle.

It runs locally, has no runtime dependencies (Python 3.11+ standard library), makes no network calls and sends no telemetry.

## Quick start

```
pip install .            # or: pip install -e ".[dev]" for development
beyond90 score examples/portfolio/northwind
beyond90 plan examples/portfolio/northwind --hours 8
beyond90 explain examples/portfolio/northwind --since examples/history/northwind-2026-09
beyond90 universe examples/portfolio/northwind
beyond90 forecast examples/portfolio/northwind
beyond90 report examples/portfolio/northwind --since examples/history/northwind-2026-09 --out northwind.html
beyond90 qbr examples/portfolio/northwind --since examples/history/northwind-2026-09 --quarter "Q4 2026"
beyond90 portfolio examples/portfolio
beyond90 book examples/portfolio --hours 8 --weeks 12
beyond90 radar examples/portfolio --threats examples/threats.json
```

Ready-made outputs from these commands are in [docs/example](docs/example/), generated by the code and checked by a test.

Your own customer:

```
beyond90 init acme --name "Acme"      # scaffolds customer.toml and empty CSVs
# fill in accounts.csv etc., see docs/data-format.md
beyond90 validate acme                # every problem, with file and line
beyond90 score acme --store history.db --format markdown
beyond90 explain acme --store history.db   # what changed since the last stored snapshot
```

`beyond90 score --fail-under 0.9` exits with code 2 when Yield is below the threshold, so it can gate a CI job or a scheduled check.

## Commands

| Command | Purpose |
|---|---|
| `init`, `validate` | Scaffold a data directory; check inputs and report every error |
| `import`, `reconcile` | Merge native exports into `accounts.csv`; see how the lists overlap |
| `score` | Text, JSON, Markdown or HTML; `--store` keeps history |
| `plan` | Week-by-week roadmap with the J-curve, for your hours and horizon |
| `explain` | Exact attribution of a change in Yield: customer versus bar |
| `universe` | Estimate of accounts no source has seen, and a pessimistic L1 |
| `forecast` | Monte Carlo of reaching zero critical and of breaking it |
| `report` | Self-contained HTML report (light and dark, no JavaScript, a table view for every chart) |
| `actions` | Ranked actions, by leak, with playbook steps and effort |
| `qbr` | Quarterly business review draft |
| `history` | Stored snapshots, time to zero critical |
| `portfolio` | Many customers, ARR-weighted Yield, shared patterns |
| `book` | One budget of hours across all customers, weighted by ARR |
| `radar` | Who should hear about a release; who is exposed to a threat |
| `catalogue` | Modules and expected resource types at a ceiling version |

## Honest limits

- The plan is a model. It rests on the effort figures in `playbooks.json`, the ramp assumptions in `simulate.py` and the realization rate; change them to match how you work.
- The hidden-accounts estimate is a lower bound that needs independent sources. It tells you when that fails.
- The forecast only learns from the history it is given and cannot see what the customer will decide.
- Live connectors to platform APIs are not included: they need a real tenant to verify. Input is the native exports above, CSV and TOML.
- The book planner needs effort figures that fit you; the defaults are estimates.

## Documents

- [docs/guide.md](docs/guide.md): how it fits into a TAM's month
- [SPEC.md](SPEC.md): formulas and rules; the contract for the code
- [docs/data-format.md](docs/data-format.md): input files
- [docs/research-wiz-tam.md](docs/research-wiz-tam.md): how a vendor TAM motion works and what platforms already measure
- [docs/architecture.md](docs/architecture.md): how the data is treated (system of record, snapshots, compatibility, sync)
- [docs/app.md](docs/app.md): the browser app and how to publish it on GitHub Pages
- [docs/trust.md](docs/trust.md): the relationship layer and what it takes from the book
- [docs/reading-list.md](docs/reading-list.md)
- [docs/design.md](docs/design.md): visual direction and validated palette

## Status

Version 0.4, alpha. 140 tests on Python 3.11 to 3.13 (`python -m pytest`). All example data is invented and generated by `examples/generate_examples.py`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never include customer data in issues or pull requests.

## License

Apache License 2.0. See [LICENSE](LICENSE).
