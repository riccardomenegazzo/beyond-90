# Changelog

All notable changes. Versions follow semantic versioning while below 1.0: minor versions may change formats, and the changelog says so.

## 0.27.0

Closer to the work a TAM does every week.

- **Actions as a CSV.** Every open action, one per row, with the columns a ticket tracker recognises on import (summary, description, assignee, due date, priority, labels). Every cell is written so that a spreadsheet cannot read it as a formula. `beyond90 actions --format csv`, and a view in the page.
- **A one-page summary for the CISO.** Coverage in the four parts a customer recognises, what is exposed, what happens if nothing changes, the next three actions and the decisions needed, on a single printable A4 page. No stage names, no maturity labels. `beyond90 onepager`, and a view in the page.
- **Map an export.** Drop a CSV whose columns are named your way: the page guesses which column is which, you confirm, and it writes `accounts.csv` or `findings.csv` with values normalised (severities, providers, yes/no, dates). Rows it cannot read are skipped and counted, an ambiguous date order is reported, and an account list with no connection column says so instead of assuming.
- **Customer health.** Adoption, outcomes, relationship and trajectory in one 0 to 100 indicator, with the weights and the reason for every part shown. A part that cannot be measured is left out and said so, and the band follows the weakest part. Offered as a hypothesis to discuss: it has not been validated against real renewals.

## 0.26.0

Anyone, on any device.

- **Installs as an app** on phones, tablets and computers: a web app manifest and icons drawn from source; Help offers the browser's install prompt and explains iPhone, Android and Firefox. Chromium's installability check passes in e2e.
- **Made for the phone too.** The places move to a bar at the bottom, the customer's views scroll in a strip under the header, tables read as cards, the map scrolls and pinches with a finger and a tap still selects. e2e checks a phone: no view wider than the screen.
- **Excel in.** Drop a workbook instead of CSV files: by file name, or one sheet per file, with a two-column `customer` sheet; dates become dates and text stays text. A reader written with the standard library, size and cell caps, hostile workbooks refused, fuzzed.
- **Start from a form.** No exports needed: describe the customer and its accounts, and the two files are made in the page, to analyse or download.
- **Another device.** Saved shows a QR code that opens the app on a phone (an encoder written here, checked with an independent decoder), and sends everything saved as one file sealed with the passphrase through the system share sheet; without a passphrase nothing is sent.
- **Run it anywhere.** `beyond90 app` serves the site from a folder or the new signed `beyond90-site.zip`: read-only, policy as a header, anti-framing, DNS-rebinding protection, loopback by default. A Dockerfile runs it as an unprivileged user; CI builds and probes the image. See `docs/self-hosting.md`.

## 0.25.0

The patterns behind a book, the quarter as slides, and a build anyone can verify.

- **Shared patterns across the book.** A new book view that links every customer to the security stories, onboarding blockers and missing capabilities it shares with others, and names the work that serves several at once: one fix guide (and product feedback) for a blocker three customers hit, one campaign for a story that leaves two customers exposed, one enablement session for the capability that would cover them, and the customer to start with. A click opens that customer's own map.
- **The map over time.** Compared with an earlier snapshot, Connections says which accounts were cleared, improved, became visible or got worse, which patterns appeared or were resolved, and highlights what is new on the map.
- **The executive review as PowerPoint.** Six slides written by the engine in the browser with the standard library: the summary, coverage then and now, what the quarter delivered, exposure, the two futures and the decisions to ask for. Also `exec-qbr --format pptx`.
- **A verifiable build.** Every build publishes `SHA256SUMS` and `build.json`; a separate least-privilege job signs them, and the extension packages, with build provenance. Help → "This build" shows the version and source commit and fingerprints every running file against the manifest; the extension carries its own.
- **Fuzzing.** New seeded fuzzing of every reader of outside data (news parsers, advisories, the browser analysis), alongside the existing loader fuzzing. It found and fixed three crashes: advisory entries that are not objects, list fields holding non-text values, and XML declaring an unknown encoding. DOCTYPE is now refused anywhere in a document, and parsers make links safe themselves.
- **OpenSSF Scorecard** on every push and weekly, with a public badge; SECURITY.md lists the repository settings that protect the account that publishes the code.

## 0.24.2

Layout that holds at every width, from a phone to a wide screen.

- **Charts are drawn at the size they are shown**, so their labels stay as large as the text around them instead of shrinking with a narrow column; they redraw when the space changes.
- **Columns follow the space the content actually has**, not the window: with the side rail open on a small laptop or a phone in desktop mode, cards stack instead of squeezing. Nothing overflows its card or the page (checked for every view at 390, 768, 1040 and 1440 pixels).
- **The overview reads top to bottom**: the score; what needs attention, as a grid of cards; where Yield is lost next to the same by stake; the plan next to the outlook if nothing is done; the biggest opportunities across the full width. The headline numbers sit in one row and wrap evenly.

## 0.24.1

- **Updates reach you.** The app used to keep serving the cached version until every tab of it was closed, so a reload showed the old interface. A new version is now downloaded in the background and offered at the top of the page; **Update now** switches every open tab to it at once, and the old copy is deleted. The browser checks for a new version each time the tab comes back into view. Tested end to end.

## 0.24.0

Where the problems meet, and the app in the browser toolbar.

- **Connections.** A new view that puts a customer's separate problems on one interactive map: the security stories that reach them, the protections that are off, the onboarding blockers, the accounts, their worst findings and the teams that own them. Beside it, in plain words, the few patterns worth a conversation: the capability that would close the most exposures, the stories nobody can check because the accounts are not connected, the team holding most of the risk, the single change that unblocks a group of accounts, and the accounts where several problems converge. Click an insight to light up its part of the map; click or press Enter on anything to see what it touches and jump to its view; drag, zoom, hide kinds. Same data, same picture. Built in `correlate.py`, drawn without a library.
- **Browser extension** for Chrome, Edge and Firefox (Manifest V3). The same app, opened from the toolbar, fully offline. No permissions, no content scripts, no network beyond its own files; the page's Content Security Policy is the manifest policy. The engine starts from the extension's own worker file, through the same Trusted Types policy, narrowed to that one file. Built reproducibly by `site/build_extension.py`, tested end to end in Chromium on every deploy, offered for download from Help. See `docs/extension.md`.

## 0.23.0

A new interface: easier to find your way, and it explains itself.

- **Four places, always in the same spot.** Start, the open customer (or your book), Saved and Help, in a sidebar. The customer's views are grouped by the question you are asking: where do they stand, what should I do, what do I say, and documents to share. Each view opens with one sentence on what it is for. The top bar shows who is open, with their Yield as a ring, and the date of their data.
- **Start** shows the three steps (choose the data, analyse, act), the examples, today's security news, and the customers you analysed before, one click each. The analyse button names what it will analyse.
- **Tooltips everywhere.** Every view, button, setting and number says what it does on hover or keyboard focus; screen readers hear the same text. Question marks next to numbers such as Yield open their definition.
- **Help.** Questions people ask, answered in plain words and searchable; a glossary of every term on screen; the keyboard; the privacy check.
- **A one-minute tour** after the first analysis, and any time from Help. Search (Ctrl or Cmd + K) also finds answers and terms.
- **Saved** gathers the history, protection with a passphrase, what is kept and moving between devices; a saved snapshot opens in one click.
- A typeface chosen for legibility (Atkinson Hyperlegible Next), served with the page; a cooler, quieter palette with one accent; the stylesheet rewritten as one file. Accessibility is audited on every place, the tooltip and the tour, in both themes.

## 0.22.0

Hardening: the data, the code and the supply chain.

- **Data.** With a passphrase, exported workspaces are sealed too (AES-256-GCM with the vault's key derivation); a sealed file opens on another device only with that passphrase and fails if altered. The page says how many snapshots are stored unencrypted until a passphrase is set. The app refuses to run inside another site's frame.
- **Correctness.** Account sources are validated; `platform` (the platform itself lists the account) is now documented, since the importers write it. Unused code removed: a configuration flag that did nothing, dead helpers, constants duplicated across modules, unused CSS and a sparkline nothing drew. The basic maturity level has its own badge colour.
- **Code quality.** mypy runs in strict mode on the whole package; Ruff adds the security (`S`), comprehension, simplification and Ruff-specific rules, with each security exception written on its line with its reason; ESLint lints the browser app and forbids `eval` and every HTML sink.
- **Supply chain.** Every workflow starts with no permissions and each job asks only for what it needs; checkouts keep no credentials; no event data is expanded into a script; Python tools are installed from lock files with hashes (`requirements/`), releases are built without fetching a build backend and published from a separate job; `zizmor` audits the workflows on every push. Tests pin all of this.
- **Docs.** Research notes about one vendor removed from the repository; screenshots retaken from the current app, with new ones for cloud news and the executive QBR; the security policy and threat model describe the collector, sealed exports, framing and the supply chain.

## 0.21.0

The customer's history, and the executive QBR built from it.

- **A history that keeps itself.** Every analysis of a customer is added to its history in the browser (on by default, one switch to turn it off). Input files only, the same data once, contacts and interactions only if you choose, sealed with the passphrase when one is set. The demo's earlier snapshot can be added at any time.
- **Executive QBR on demand.** Pick a quarter or custom dates: the period is compared with the last snapshot before it, and the review is written for a CISO: effective coverage and its four parts (connected, visible, protected, handled) with the trend, what the quarter delivered, the work done together, exposure today and the threats that touched the customer, what happens if nothing is done, next quarter's priorities and the decisions needed. No internal score or stage names. Preview in a sandbox, download as HTML (prints one page per section) or Markdown. Also `beyond90 exec-qbr DIR...`.
- The history's trend chart is redrawn reliably after an interrupted refresh.

## 0.20.0

Always aligned on cloud security news.

- **A daily feed from public sources.** `beyond90 feeds` reads the Kubernetes official CVE feed, AWS and GKE security bulletins, the Open Cloud Vulnerability Database, the Microsoft security update guide and the catalogue of known exploited vulnerabilities, plus any RSS, Atom or JSON Feed you add (`--sources`). It keeps what is about the cloud and recent, merges items that share a CVE into one story with every source, adds the exploit probability (EPSS), and gives every story a severity with its reason: known exploited is critical. The result is an advisory feed every other command already reads.
- **Published with the site.** The Pages workflow collects it every morning and publishes it next to the app; "Use today's cloud news" loads it and keeps it current. Same origin, same strict policy; customer data never leaves the browser.
- **Matched to the right estates.** A story about one provider's service touches only that provider's accounts; a Kubernetes CVE touches every cluster, wherever it runs.
- **For one customer:** badges (known exploited, EPSS, new, ransomware), sources, and a **security briefing** ready to send, without internal scores; also written by automated runs as `security-briefing.md`.
- **For the book:** a "Cloud news" view with every story against every customer, ranked by known exploitation and by customers left uncovered, with filters by provider, exploited, uncovered and new.
- A known exploited story on uncovered accounts moves the customer up the week, leads the news part of the call, and raises one alert in automated runs.
- Each source reports what it read, kept and dropped, and the newest date it saw, in the feed and on the command line.
- Safe reading: https only, redirects only to configured hosts, size and time caps, XML with entity declarations refused, everything reduced to plain text.

## 0.19.0

What the work was worth, who has to move, and what was agreed.

- **Value receipt.** With an earlier snapshot, one page of what moved between the two dates: accounts connected and the monthly spend they bring under watch, findings closed by severity, findings that gained an owner and a decision, capability activations, the points earned by the customer's own work kept apart from the bar moving, promises kept. Each logged touch is listed with the outcomes of the same kind in the 21 days after it: followed, not caused. And it ends with what did not move. In the browser, from `beyond90 receipt DIR --since OLD --format html|markdown|json`, and written by every automated run that has a previous snapshot as `value-receipt.html`. In the demo: 7 accounts connected, 37 findings closed (4 critical).
- **Team digests.** The estate split by the customer's own teams and ranked by what is at stake on their side (spend not connected, critical findings, blocked connectors): their accounts, blockers with causes in plain words, their findings, their dated events, at most three asks, and a message addressed to their contact, with no internal scores. A champion forwards one note per team instead of one list for everyone. In the browser and from `beyond90 teams DIR`.
- **Recap after the call.** In "Prep a call", the follow-up email is drafted from the agenda, the promises we owe and the next steps typed in (what, who, by when). Copy or download; nothing is sent.
- Automated runs skip an output that is empty (for example the receipt on the first run) instead of writing an empty file.

## 0.18.0

Two questions most tools leave to intuition.

- **If nothing is done.** The estate is scored again on future dates with only what the data already dates: secrets that expire, accepted risks that reach their review date, unowned findings that age into the triage window, deadlines, promises, the cadence, the renewal. Every event has a date, whose move it is, and, where the score moves, its exact effect in points (the day before against the day itself). A 90-day curve, the level at 30, 60 and 90 days, one sentence for the call, a CSV and a calendar file. It invents nothing: it is the floor of what waiting costs.
- **Weighted by what is at stake.** Yield again, with accounts weighted by spend and findings by severity and exposure, next to the count. In the demo, 90% of accounts but 79% of spend are connected: the production accounts held back are few and expensive.
- Both reach the overview, the call brief ("What breaks if we wait", "Where the gap matters"), the week plan (points lost within seven days), the book (90 days if idle, per customer) and the customer's status page ("Coming up if nothing changes").
- The demo's held-back production accounts now carry production-sized spend; nothing else in the examples changes.

## 0.17.0

Onboarding, for the call with the customer.

- **Commands to check.** Every cause in the connector catalogue now has read-only commands (`aws`, `az`, `gcloud`, `kubectl`) the customer can run to confirm it, shown in each wave and in the error explainer, ready to copy. Known values such as the account are filled in; anything that is not a plain identifier stays a placeholder, so nothing in the data can turn into shell syntax. A test refuses any command that could change something.
- **Progress since last time.** With an earlier snapshot, onboarding shows how many accounts completed, moved forward or went back, which causes were fixed and which appeared, which connectors broke, the completions per week, and the date everything is complete at that pace.
- **A status page for the customer.** A self-contained HTML page (or Markdown, or text to paste in an email): what is done, what waits on which of their teams with the steps and the commands to check, what is on the vendor's side, credentials to rotate, recommendations for the connectors. No internal scores. From the view, from `beyond90 onboarding DIR --customer-page --since OLD --format html`, and written by every automated run as `onboarding-status.html`.
- The earlier example snapshot has its own connector history, so the demo shows real progress.

## 0.16.0

Onboarding: where connectors stall, why, and what unblocks them.

- **Stages.** A new optional file, `connectors.csv`, places every account on a stage: discovered, connector deployed, signs in, can read, first scan done, complete and fresh. Without it, onboarding is read from the account list.
- **Causes.** A catalogue of about thirty causes for AWS, Azure, Google Cloud, Kubernetes clusters and runtime sensors (guardrails, external IDs, consent, conditional access, management group scope, disabled APIs, organization policies, service perimeters, opt-in regions, customer-managed keys, private API servers, RBAC, pod security and admission policies, egress proxies, image pulls, kernels), each with an owner, steps and a way to verify.
- **Unblock in this order.** Blocked accounts grouped by cause and ordered by accounts unblocked per hour; organization-level fixes counted once; several undeployed accounts become one organization-level deployment. Each wave copies as a ticket.
- **Healthy versus counted.** The connectors that actually work, next to what L1 counts, and the accounts in between.
- **Time to connect**, stuck accounts, **expiring secrets**, and a **security review of the connectors** themselves with STRIDE labels.
- **Explain a connector error**: paste a message, get the cause and the fix, in the page or with `beyond90 triage`.
- **Pre-flight checklist** for a kickoff, in the page or with `beyond90 preflight`.
- **Book mode**: onboarding for every customer and the causes they share. The call brief, the week plan and the alerts take onboarding into account; `connectors` is a target for automation; `beyond90 onboarding DIR` prints the plan.

## 0.15.1

A visual pass on the browser app. No change to any number.

- **First impression.** A landing with a live preview of the dashboard, four short reasons to use it, and the three examples as cards instead of buttons.
- **App shell.** A result header with the customer, level and confidence; a left rail with icons and groups (Customer, Plan and review, Documents; Your book) that becomes a scrolling bar on small screens; a softer, deeper palette with a gradient button, glow and shadows.
- **Motion.** Cards rise in, the stage bars grow, the examples pulse while the engine loads; all of it off when the system asks for reduced motion.
- **Icons.** A small line-icon set built without parsing HTML, so Trusted Types still hold.
- **Accessibility.** One h1 per screen with a real heading order, and every selected control above 4.5:1 contrast, checked in light and dark on every view.

## 0.15.0

For a TAM with a book to run every week, and a browser app that is harder to attack.

- **Tiers and cadence.** `tier` classes top, mid and other (default every 7, 14 and 30 days; `cadence_days` overrides). A new personal file, `interactions.csv`, logs calls, meetings, emails and advisories with a next step; the cadence is measured against it.
- **This week.** In book mode, the customers in the order the week needs them, each with a day, the hours it deserves, and the plain-sum reasons for its place; the week says so when it does not fit.
- **Prep a call.** An agenda in the order that earns attention (what we owe, what changed, news, leaks, questions, renewal, growth, next steps), copy or download as Markdown; **Log a touch** adds a line to the log and re-runs.
- **News.** Add a JSON advisory feed and each advisory is matched to what the customer has inventoried: exposed, covered, not covered and cannot be assessed, with a plain-words note to send. Feeds that do not fit a catalogue are skipped with a warning.
- **Growth only when earned.** Capacity, expand, broaden, diversify and threat signals appear as questions; a trust gate says why a commercial conversation is not yet appropriate.
- **Automation.** `[advisories] path` in `beyond90.toml` loads the feed on every run, and a run writes `call-prep.md`.
- **Security.** Trusted Types are enforced and every `innerHTML` is gone, with a test that fails on any new unsafe sink; optional passphrase protection of saved data (PBKDF2-SHA-256 with 600,000 rounds, AES-256-GCM per snapshot, key in memory only, locked after 15 idle minutes); actions pinned to commit SHAs, Dependabot, CodeQL, an npm lock file with integrity hashes installed by `npm ci --ignore-scripts`, and releases with an SBOM, checksums and a signed provenance attestation. `docs/threat-model.md`.

## 0.14.0

A new browser app. The report is still there; the app is now a dashboard you work in.

- **Overview.** A Yield gauge with the legacy figure marked on it and the checkpoints at 90, 95 and 98; a waterfall of what each stage costs; a "needs attention" list drawn from the data (critical findings and the pace of closing them, renewal, units no source has seen, severity downgrades near a deadline, under-used licences); the five best opportunities; the planned curve.
- **Explorers.** Actions (search, stage filter, steps, "copy as ticket"), accounts (provider, owner, gaps, not connected, critical findings; what is not inventoried and which capabilities are off) and open findings (severity, status, owner, decision), each sortable, paged and exportable as CSV. Exported cells that start with `=`, `+`, `-` or `@` are prefixed so a spreadsheet cannot run them.
- **Plan and what-if.** Sliders for hours, horizon and realization recompute the plan in the engine, against the original as a dashed line, with a timeline of what gets done and when and what the plan cannot close.
- **Maturity, renewal and trust, changes.** The ladder with every check, adoption by use case and framework function, renewal signals, licences, the universe estimate, contacts, and a contribution chart that sums exactly to the change since an earlier snapshot.
- **Portfolio map.** In book mode, a heat map of every customer by stage with ARR, plan and level, and where to look first.
- **Command palette** (Ctrl or Cmd + K), number keys for views, a five-line summary to paste into chat, print styles, and a light, dark or system theme.
- **Engine.** `analyze` returns a structured `dashboard` (plan by week, per-account and per-finding rows with the gaps behind them, attribution, renewal, ladder, forecast, drift, candor items) and a `plan` call serves the sliders. Lists are capped and say so.
- **Quality.** Browser tests drive every view, a hostile customer name is checked in each, and the accessibility audit passes in light and dark. Python tests tie the dashboard to the score it was drawn from.

## 0.13.0

Hardening: no new features, a lot fewer ways to fall over.

- **Files from any program.** CSV and TOML are read as UTF-8, UTF-8 with a byte-order mark or UTF-16; a file that is not valid UTF-8 is read as Windows-1252 with a warning instead of a traceback; NUL bytes, oversized fields and malformed CSV are errors with a file and line. `NaN`, `inf` and huge numbers are refused as numbers. A `[customer]` or `[settings]` that is not a table is an error.
- **Fetching.** Truncated bodies, dropped connections, non-HTTP answers, absurdly nested JSON, cursors that are not text and odd `Retry-After` values end in a `FetchError` naming the source, never a traceback.
- **Pipeline operations.** One run at a time per state directory (a lock that a crashed run cannot leave behind for good); a damaged cache, run log or snapshot folder is ignored instead of stopping the run; the cache and the dated output folder are written whole or not at all; `[state] keep_snapshots` and `keep_outputs` prune old folders (history and run log are kept); unwritable or full disks give a message that says what to check.
- **Browser app.** A workspace file is refused above 1000 snapshots; snapshots with wrongly typed fields are rejected, not half trusted; a `__proto__` key cannot change a merged object; a crashed engine is replaced by the next request; a full browser store says so in words.
- **Tests.** Seeded fuzzing of the inputs (300 cases by default, `B90_FUZZ_CASES=6000` for more; none crashed after the fixes), network chaos tests, a differential test of L1 to L4 against an independent reimplementation that reads the raw CSV, lock and retention tests, release checks (versions agree; the wheel carries the data files and installs and runs on its own).
- **Documented limit.** Planning is quadratic in the size of the estate: about 15 s at 500 accounts and 5,000 findings, about 3 minutes at 5,000 accounts and 50,000 findings. See `docs/operations.md`.

## 0.12.0

Automation: no one has to export a file.

- **Connectors.** `beyond90.toml` declares sources (REST APIs, cloud CLIs, drop folders) and how each record maps to the columns the engine reads; a new vendor needs a mapping, not code. Presets for the AWS, Azure and GCP CLIs. Four pagination styles, token from an environment variable, host allow-list including redirects, https, no shell, size, time and page caps, retries with `Retry-After`.
- **`sync`.** Merges lists by id keeping every source tag, a last good copy per source when one fails (reported stale with its age), failure when a required column reads nothing, orphan rows dropped and counted, hand-kept rows in `state/manual`, atomic writes.
- **`run`.** The whole pipeline: collect, score, compare with the previous snapshot found by itself, write the report, QBR, success plan, summary, roadmap and JSON, keep history, export a workspace file the browser app imports, alert on what changed, notify a webhook.
- **Alerts** only when something changed or needs a person.
- **`schedule`** prints a GitHub Actions workflow, a cron line or systemd units; `check-config` validates without touching anything.
- Tests against a local fake API: pagination, auth, retries, redirects, outages, merging, alerts, webhook, secrets never in output, no shell injection, workspace accepted by the browser's own checks.
- Not verified against any real vendor API or CLI; said in the docs.

## 0.11.0

- **Path to the next level.** The ladder now says when: the first week from which the stage checks for the next level keep passing, and the hours spent to get there, from the roadmap (dip included). Checks the roadmap cannot move (findings past their deadline, licence use, relationships) are listed as outside it.
- **Input drift.** With `--since`, the report says whether the two exports differ in ways that look like artefacts: units that vanished without being decommissioned, a much smaller inventory, open findings that disappeared, a comparison that is not older. Check them before presenting a change.
- Both appear in the report, the QBR and the browser app.

## 0.10.0

Informed by a survey of existing products (`docs/research/landscape.md`).

- **Maturity ladder.** Bronze, silver and gold from checks; a customer is at a level only when every check at that level and below passes; the next checks to pass are listed with the action that closes each; unmeasured checks neither pass nor block and mark the level provisional. Shipped rubric in `data/rubric.json`, replaceable per profile; level names are fixed. Shown in reports, the QBR, the portfolio table and the browser app.
- **Adoption by use case and by NIST CSF 2.0 function.** Modules carry `use_case` and `csf` tags (both profiles). Not compliance: stated in the output.
- **Renewal readiness.** `renewal_date` and `renewal_window_days`; a checklist of leading indicators with evidence, ARR on the line, and expansion headroom; a Renewals section in the portfolio with revenue at risk. No predicted probability.
- **Success plan.** `beyond90 successplan`: outcomes, measures, milestones, owners, decisions, commitments, risks, signatures. Nothing private. A tab in the browser app.
- Example customers gain invented renewal dates; the QBR gains a use-case section and a ladder sentence.
- Tests: ladder gating and validation, view arithmetic, renewal bands, success plan privacy, plus properties on random estates.

## 0.9.0

Vendor-neutral by design: one engine, a catalogue profile per kind of security product.

- **Profiles.** `cnapp` (the default, unchanged) and a new `endpoint` profile for endpoint protection, with its own asset types, capabilities, playbook overrides and words ("site", "endpoint assets"). Choose with `--profile` or `profile = "..."` in `customer.toml`; `beyond90 profiles` lists them; `--catalogue-dir` still loads your own. A mismatch between a flag and the file is an error, a mixed-profile portfolio or book is refused, and every score records its profile and catalogue hash.
- **Terms.** Text the engine writes follows the profile's words for the unit of coverage; a customer's own text is never rewritten. Cloud output is byte-for-byte unchanged apart from the provenance line.
- **Browser app.** Reads the profile from the data, shows it, and has an endpoint demo.
- **Docs.** `docs/profiles.md` (shipped profiles, how to write one, how identity, SIEM, email, vulnerability, network and application security map). Vendor research moved to `docs/research/` as a case study; vendor names removed from the product's own docs, interface and code comments.
- Example: `examples/profiles/endpoint/acme-endpoint` (invented, generated).

## 0.8.1

Found by an audit of the whole project.

- **An estate with no active account is refused** by `score`, `report`, `qbr`, `plan`, `explain`, `universe`, `forecast`, `book`, `portfolio` and the browser app, with an explanation. Before, it scored 100% on every stage. `validate` and `init` still accept it. **Behaviour change.**
- **Free text is cleaned on load**: line breaks, control characters and direction-changing characters become spaces, and `|` becomes `¦`, so a name can no longer split a Markdown table or inject a heading. A warning counts the values adjusted.
- **Attribution is exact when a stage is zero.** The two parts used to miss the total by up to half a point in that case; they are now scaled to add up exactly, with a note that the split is approximate.
- Python 3.11 compatibility restored (an f-string reused its own quote character).
- "1 customers" corrected.
- New tests: seeded random estates (bounds, determinism, row order, plan, attribution), hostile input (parsed HTML audit, Markdown tables), the browser's rendering of hostile text, the empty-estate refusal.
- `THIRD_PARTY.md` for the software bundled in the browser app; README status, limits and guide brought up to date.

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
