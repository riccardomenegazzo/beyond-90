# Security policy

Beyond 90 runs locally and sends no telemetry. The scoring engine makes no network calls; only the connectors you configure (`beyond90 sync`, `run`) and the news collector (`beyond90 feeds`, public sources only) reach the network, over https to the hosts you allow. History is stored in a local SQLite file you choose.

The browser app does the same inside your tab: files are read in memory, the page's Content Security Policy allows requests to its own origin only and enforces Trusted Types, the engine's worker inherits that policy, and a button in the footer tests it. Saved snapshots live in your browser's IndexedDB on that device (contacts, commitments and interactions only if you ask) and can be sealed with a passphrase (AES-256-GCM, key from PBKDF2-SHA-256 with 600,000 rounds, locked after 15 idle minutes); with one set, exported workspaces are sealed too. The page will not run inside another site's frame. The browser extension is the same page with no permissions, no content scripts and no network beyond its own files (`docs/extension.md`). The full threat model is in `docs/threat-model.md`.

The inputs it reads (billing exports, account lists, findings) can be sensitive. Treat the data directory and the database like the source systems they came from: do not commit them, and do not attach them to public issues.

To report a vulnerability, open a private security advisory on the GitHub repository (Security tab) rather than a public issue. Include the version, the command you ran and a minimal mock input.
