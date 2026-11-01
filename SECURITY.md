# Security policy

Beyond 90 runs locally. It makes no network calls, sends no telemetry, and stores its history in a local SQLite file you choose.

The inputs it reads (billing exports, account lists, findings) can be sensitive. Treat the data directory and the database like the source systems they came from: do not commit them, and do not attach them to public issues.

To report a vulnerability, open a private security advisory on the GitHub repository (Security tab) rather than a public issue. Include the version, the command you ran and a minimal mock input.
