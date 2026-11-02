# Security policy

Beyond 90 runs locally. It makes no network calls, sends no telemetry, and stores its history in a local SQLite file you choose.

The browser app does the same inside your tab: files are read in memory, the page's Content Security Policy allows requests to its own origin only and enforces Trusted Types, the engine's worker inherits that policy, and a button in the footer tests it. Saved snapshots live in your browser's IndexedDB on that device (contacts, commitments and interactions only if you ask) and can be sealed with a passphrase (AES-256-GCM, key from PBKDF2, locked after 15 idle minutes). The full threat model is in `docs/threat-model.md`. An exported workspace file contains your customer data; treat it as you would the source files.

The inputs it reads (billing exports, account lists, findings) can be sensitive. Treat the data directory and the database like the source systems they came from: do not commit them, and do not attach them to public issues.

To report a vulnerability, open a private security advisory on the GitHub repository (Security tab) rather than a public issue. Include the version, the command you ran and a minimal mock input.
