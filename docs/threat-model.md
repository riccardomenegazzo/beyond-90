# Threat model

What Beyond 90 protects, from whom, and what it does not claim. It covers the browser app and the automation; the scoring engine itself has no network access and no dependencies.

## What is sensitive

Customer inventories and findings (which accounts exist, which controls are off, which findings are open) are a map of a customer's weaknesses. Contacts, commitments and interactions are personal data. Webhook URLs and API tokens are secrets.

## Browser app

| Threat | Control | Checked by |
|---|---|---|
| Data leaves the page | CSP `default-src 'none'`, `connect-src 'self'`; the engine runs in a blob-URL worker that inherits it; a footer self-check tries to reach another site from the page and from the worker | `tests/test_security.py`, e2e self-check |
| A customer's file injects script (XSS) | Text is always set as text; no `innerHTML`, `eval` or `document.write` anywhere; **Trusted Types** are enforced, so the only string-to-HTML sink is the sandboxed report frame, which has no scripts and no access to the page | e2e with hostile names in every view; a test that fails on any new unsafe sink |
| A spreadsheet formula in an export | CSV cells starting with `=`, `+`, `-`, `@` are prefixed | Node test |
| A crafted workspace file | Refused above 1000 snapshots; every snapshot's name must match the hash of its content; wrongly typed fields rejected; `__proto__` ignored | Node tests |
| Saved data read from the device | Optional passphrase: PBKDF2-SHA-256 (600,000 rounds, random salt), AES-256-GCM per snapshot with a fresh nonce and the id as associated data, key in memory only, locked after 15 idle minutes, wrong guesses slowed | Node tests, e2e (the raw store holds nothing readable) |
| A tampered or stale build served from cache | The service worker's cache name is the hash of every file in the build | build test |
| A compromised dependency | Pyodide is the only shipped third-party software, served from the same origin, pinned in `site/npm/package-lock.json` with integrity hashes and installed with `npm ci --ignore-scripts`; the engine has no runtime dependencies; an SBOM is published with each release | `tests/test_security.py` |

Not covered: malware or a hostile extension on the device, a person with the unlocked page open, and an exported workspace file (it is not encrypted and the page says so). A forgotten passphrase cannot be recovered.

## Automation

| Threat | Control |
|---|---|
| SSRF or exfiltration through a source | https only (plain http to localhost), host allow-list that is also applied to every redirect, GET only |
| Secrets in files or logs | Tokens and webhook URLs only from named environment variables; never written to state, outputs or messages (the URL is never printed) |
| Command injection | `command` sources run an argv list with no shell and a named environment |
| A hostile or broken API | Size, time and page caps; truncated bodies, nesting bombs, odd cursors and `Retry-After` handled; a failed source falls back to its last good copy and says so |
| Two runs corrupting state | Run lock with stale detection; cache and output folders written whole or not at all |
| State directory read by others | It holds customer data: keep it private; files are created with the process's umask |

## Supply chain

GitHub Actions are pinned to commit SHAs and kept current by Dependabot; every workflow declares minimal permissions and none uses `pull_request_target`; CodeQL scans Python and JavaScript on every push and weekly; releases carry a signed build provenance attestation, an SBOM and checksums. The package has no runtime dependencies to compromise.

## Reporting

See SECURITY.md.
