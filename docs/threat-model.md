# Threat model

What Beyond 90 protects, from whom, and what it does not claim. It covers the browser app, the automation, the news collector and the project's own supply chain; the scoring engine itself has no network access and no dependencies.

## What is sensitive

Customer inventories and findings (which accounts exist, which controls are off, which findings are open) are a map of a customer's weaknesses. Contacts, commitments and interactions are personal data. Webhook URLs and API tokens are secrets.

## Browser app

| Threat | Control | Checked by |
|---|---|---|
| Data leaves the page | CSP `default-src 'none'`, `connect-src 'self'`; the engine runs in a blob-URL worker that inherits it; a footer self-check tries to reach another site from the page and from the worker | `tests/test_security.py`, e2e self-check |
| A customer's file injects script (XSS) | Text is always set as text; no `innerHTML`, `eval` or `document.write` anywhere; **Trusted Types** are enforced, so the only string-to-HTML sink is the sandboxed report frame, which has no scripts and no access to the page | e2e with hostile names in every view; a test that fails on any new unsafe sink |
| A spreadsheet formula in an export | CSV cells starting with `=`, `+`, `-`, `@` are prefixed | Node test |
| A crafted workspace file | Refused above 1000 snapshots; every snapshot's name must match the hash of its content; wrongly typed fields rejected; `__proto__` ignored | Node tests |
| Outcomes smuggled in through a workspace file | Each recorded renewal outcome is checked field by field against exactly what the page writes (types, enumerations, ranges, id equal to customer and date, text lengths) and a file with more than 2,000 is cut and reported; outcomes are sealed in the device store and in exports like snapshots, and the numbers they feed into the weights are validated again by the engine | Node tests, pytest, e2e |
| Promises smuggled in through a workspace file, or read from the device | Each commitment is checked field by field against exactly what the page writes (types, enumerations, dates, id equal to customer, date and suffix, `closed_on` empty exactly when open, text lengths) and a file with more than 5,000 is cut off; refused ones are counted and shown, never stored. Stored promises are sealed with the passphrase like snapshots. The handoff note is built from data already on the page, contains no private call notes, and is only shown or copied on request | `site/test/commitments.test.mjs`, `site/test/handoff.test.mjs`, e2e (export, forget, import) |
| Customer names leaving the page in a shared text, file name or copy | One gate for every copy and download replaces known identifiers with stable aliases (whole words, longest first, one pass), shows a preview with what is still visible, and waits for confirmation. It cannot find a name it was never told (free-text notes) and a pseudonym is not anonymity; the preview says so | `site/test/aliases.test.mjs`, `tests/test_identifiers.py`, e2e (preview, file name, restore) |
| A customer's records outliving the need for them, or a deletion that is claimed but not done | Per-customer keep-until date (the page reminds, never deletes by itself); erasure removes every store's records for one customer, reads again, and reports what it can still read. The record lists exports beyond its reach and says it is not independent proof. The browser may keep traces of deleted data until it compacts its database; the page cannot force that | `site/test/erasure.test.mjs`, e2e (set date, erase, second look, record) |
| Sealed records revealing who the customer is through their storage keys | Sealed outcomes, promises, retention dates and the export log are stored under random 96-bit slots, not their own ids (which held the customer's name); older records are moved when the data is unlocked | e2e (the stores hold no customer name, not even in keys) |
| A connected assistant reads or changes more than intended (local MCP server) | Five tools, all read-only; a customer is a folder name resolved to a real path directly under the one root given at start-up (paths, leading dots, null bytes and links out of the root are refused); messages over 1 MiB refused; no listener, no network or process module imported. **Not covered:** the model sees whatever the tools return, and text in customer files can carry instructions meant for it; the documentation says to connect only a model you may show the data to | pytest (traversal, symlink, no-write snapshot, size limit, import check) |
| Saved data read from the device | A passphrase (the page says how many snapshots are stored unencrypted until one is set): PBKDF2-SHA-256 (600,000 rounds, random salt), AES-256-GCM per snapshot with a fresh nonce and the id as associated data, key in memory only, locked after 15 idle minutes, wrong guesses slowed | Node tests, e2e (the raw store holds nothing readable) |
| A workspace file copied off the device | With a passphrase, the export is sealed the same way (the vault's salt and iterations travel with it), so only that passphrase opens it on another device; a tampered file fails authentication | Node test, e2e (the file holds nothing readable; a wrong passphrase is refused) |
| Clickjacking: another site frames the page and steers clicks | The app runs only as the top-level page; framed, it stops before reading or offering anything (Pages cannot send `frame-ancestors`) | e2e |
| Links leak where they came from | `referrer` is `no-referrer`; external links open with `noopener noreferrer` and only for https | e2e, ESLint rules |
| A self-hosted copy misused | `beyond90 app` is read-only (GET and HEAD), confines paths to the site, refuses unknown host names (DNS rebinding), sends the policy, `frame-ancestors 'none'`, `nosniff`, `no-referrer` and isolation headers, listens on loopback by default; the container runs as an unprivileged user | `tests/test_serve.py`, CI container job |
| A hostile Excel workbook | Size caps on the archive and each part, a cell cap, DOCTYPE and entities refused, sheet paths confined to the workbook, damage reported as an error; values become text, never formulas | `tests/test_xlsx.py`, fuzzing |
| Work moved to another device in the clear | "Send my work" refuses without a passphrase; the file is sealed (AES-256-GCM) before it reaches the share sheet | e2e |
| The browser extension oversteps | Manifest V3 with no permissions, no host access, no content scripts and no web-accessible resources; the manifest policy is the page's policy without `blob:`, enforced on every extension page and worker; the engine starts only from the extension's own `worker.js`; the background script only opens the app in a tab | `tests/test_extension.py`, `site/e2e_extension.py` |
| A tampered or stale build served from cache | The service worker's cache name is the hash of every file in the build | build test |
| A modified copy of the site (a mirror, a proxy, a changed deploy) | Every build publishes `SHA256SUMS` and `build.json` (version, source commit, digest); the Pages workflow signs `SHA256SUMS` and the extension packages with build provenance in a separate job; Help → "This build" fingerprints every running file against the manifest; `gh attestation verify SHA256SUMS --repo riccardomenegazzo/beyond-90` proves who built it | unit test, e2e (site and extension) |
| Hostile or broken input files | Every reader answers with its own error: seeded fuzzing of the loader, scoring and renderers (`tests/test_fuzz.py`) and of the news parsers, advisories and the browser analysis (`tests/test_fuzz_readers.py`; `FUZZ_ROUNDS` runs longer) | pytest |
| A compromised dependency | Pyodide is the only shipped third-party software, served from the same origin, pinned in `site/npm/package-lock.json` with integrity hashes and installed with `npm ci --ignore-scripts`; the engine has no runtime dependencies; an SBOM is published with each release | `tests/test_security.py` |

Not covered: malware or a hostile extension on the device, a person with the unlocked page open, data saved before a passphrase was set and an export made without one (both said on the page), and other pages published under the same `github.io` origin, which share its storage: publish only this app there, serve it from its own domain, or use the browser extension, whose origin no website shares. A forgotten passphrase cannot be recovered.

## Automation

| Threat | Control |
|---|---|
| SSRF or exfiltration through a source | https only (plain http to localhost), host allow-list that is also applied to every redirect, GET only |
| Secrets in files or logs | Tokens and webhook URLs only from named environment variables; never written to state, outputs or messages (the URL is never printed) |
| Command injection | `command` sources run an argv list with no shell and a named environment |
| A hostile or broken API | Size, time and page caps; truncated bodies, nesting bombs, odd cursors and `Retry-After` handled; a failed source falls back to its last good copy and says so |
| Two runs corrupting state | Run lock with stale detection; cache and output folders written whole or not at all |
| State directory read by others | It holds customer data: keep it private; files are created with the process's umask |

## Cloud news collection

`beyond90 feeds` and the daily site build read public sources over the internet; this is the only part of the project that does so on its own.

| Threat | Control |
|---|---|
| A source redirecting elsewhere | https only; a redirect is followed only to https on a configured host |
| Entity expansion or external entities in XML | A document that declares a DOCTYPE or an entity is refused before it is parsed |
| Script or markup in a story reaching a page | Every field is reduced to plain text without control or direction characters; links kept only if http(s), and the app opens only https links, with `noopener` |
| A huge or slow source | 16 MB and 25 s per source, 300 items per source, 400 stories in a feed |
| One source down or hostile | Each source is read on its own and reported in the feed; if every source fails, nothing is written and the site keeps no feed rather than an empty one |
| The feed changing the page's policy | It is published on the same origin and read with `connect-src 'self'`; the page's policy is unchanged and nothing else is fetched |
| Customer data leaving | The collector never sees customer data: matching happens in the browser or in your own pipeline |

## Supply chain

| Threat | Control |
|---|---|
| A compromised or moved action | Every action is pinned to a commit SHA and kept current by Dependabot; `zizmor` audits the workflows on every push |
| A workflow token used beyond its job | `permissions: {}` at the top of every workflow, the least each job needs below it; checkouts do not persist credentials; nothing from an event is expanded into a script |
| A compromised build or test tool | Python tools installed from lock files with hashes (`pip --require-hashes`), npm from its lock file with `--ignore-scripts` |
| Unsafe code merged | Ruff with the security rules, strict mypy, ESLint forbidding `eval` and HTML sinks, CodeQL (`security-extended`) on Python and JavaScript |
| A tampered release | Built in a job without write access, then published with signed build provenance, an SBOM and checksums |
| Practices drifting | OpenSSF Scorecard runs on every push and weekly; its findings go to code scanning and its score is public (badge in the README) |
| A stolen maintainer account | Outside the code: see "Repository settings" in SECURITY.md |

The package has no runtime dependencies to compromise.

## Reporting

See SECURITY.md.
