# Automation: from your sources to a finished review, with no exporting

Beyond 90 does not need anyone to export a file. A configuration file says where each list lives and how a record maps to the columns the engine reads; `beyond90 run` then collects, merges, scores, compares with the last run, writes the reports, keeps a history and tells you only what deserves attention. Put it on a schedule and the review is waiting for you.

```
beyond90 check-config beyond90.toml     # validate; show what it will read and which hosts it may reach; touches nothing
beyond90 sync beyond90.toml             # collect the sources and rebuild the data directory
beyond90 run beyond90.toml              # the whole pipeline
beyond90 schedule github beyond90.toml  # the file that makes it run by itself
```

## Try it in a minute

```
python examples/automation/mock_vendor_api.py 8765 &         # a fake vendor API with paginated data and a token
export VENDOR_TOKEN=demo-token
beyond90 run examples/automation/beyond90.toml
```

The example is invented end to end. Real products have different URLs and field names; the `map` tables are the only thing that changes, never code.

## The configuration

```toml
[customer]                 # who this is; as_of is the day of each run
name = "Acme"
arr = 480000
profile = "cnapp"          # or endpoint, see docs/profiles.md
renewal_date = 2027-03-31

[settings]                 # same keys as customer.toml [settings]
ceiling_version = "2026.4"

[security]
allow_hosts = ["api.vendor.example"]   # the only hosts a run may contact
max_bytes = 20000000
timeout_seconds = 30
retries = 2

[state]
dir = "state"              # holds customer data: keep it private

[outputs]
make = ["report", "qbr", "successplan", "summary", "roadmap", "json"]
hours_per_week = 8

[notify]                   # optional
webhook_env = "SLACK_WEBHOOK"   # the variable holds the URL; the URL is a secret
format = "slack"                # or "json"
always = false                  # true: also send "nothing needs attention"

[export]
workspace = true           # write workspace.json for the browser app
include_personal = false   # contacts and commitments stay out unless you say so

[[source]]                 # as many as you like
name = "tenants"
type = "http"              # http, command or file
url = "https://api.vendor.example/v1/tenants"
target = "accounts"        # accounts, inventory, activations, findings, teams, entitlements, contacts, commitments
tag = "org"                # for accounts: where this list comes from (billing, org, sso, manual, plan)
records = "data"           # where the list is in the response ("" for the root)
[source.auth]
header = "Authorization"
env = "VENDOR_TOKEN"       # the NAME of the variable; the token never goes in the file
prefix = "Bearer "
[source.pagination]
type = "cursor"            # cursor, page, offset or link_header
cursor_path = "next"
cursor_param = "cursor"
[source.map]               # column = a path, or a small table
id = "tenant_id"
provider = "platform"
owner = "owner_team"
connected = { path = "agent_connected", transform = "bool" }
status = { path = "state", map = { enabled = "active", disabled = "decommissioned" }, default = "active" }
```

### Mapping

A column is a **path** into the record (`Id`, `a.b.0.c`), or a table with `path` or `const`, optionally `map` (with `_default`), `default` and `transform`. Transforms are a closed list: `lower upper strip bool date int float join first`. Nothing is evaluated. A column must exist in the target file (the check suggests the nearest name), and the target's required columns must be supplied.

### Sources

| Type | Reads | Notes |
|---|---|---|
| `http` | A REST API with GET | https only (plain http to localhost for testing); the host must be in `allow_hosts`, and so must every redirect; token from an environment variable; four pagination styles; response size and time capped; read failures retried with back-off |
| `command` | The output of a program | An argument list, never a shell; only the environment variables the source names are passed on |
| `file` | A path or glob, csv or json | For exports another system drops in a folder |

Presets (`preset = "aws-org"`, `"azure-accounts"`, `"gcp-projects"`) fill in the command, the mapping and the environment for the three cloud CLIs; anything in the source overrides them.

### Several lists for one target

Accounts from several sources are merged by id: the first value stays, every `tag` is kept (that is what lets the hidden-account estimate work), and `connected_if_listed = true` marks everything a source lists as connected. Other targets are merged by their key (inventory by account and type, activations by account and module) and later sources win. Rows in `state/manual/<target>.csv` are merged last and win; a target no source feeds (contacts and commitments are usually kept by hand) is taken from there whole. Rows for accounts nobody listed are dropped and counted, and the run says so.

## What a run does, in order

1. **Collect.** Each source is fetched and mapped. A source that fails does **not** empty the data: its last good copy is used and the source is reported as stale with its age. A required column that comes out empty for every record is a failure (the path is wrong), not an empty file. No accounts at all is an error.
2. **Build** the data directory atomically (a new directory is swapped in; a crash never leaves a half-written customer).
3. **Score** it and find the previous run's snapshot on its own, so the change is explained and the inputs are checked for export artefacts without anyone passing `--since`.
4. **Write** the outputs to `state/out/<date>/` and `state/out/latest/`, with `sync.json` (how each source went) and `alerts.json`.
5. **Remember**: history database, a snapshot of the inputs, one line per run in `runs.jsonl`.
6. **Alert**, only when something changed or needs a person: a source could not be read, the level moved, Yield moved two points or more, a critical finding has no owner, a renewal turned risky or is a month away, rows were dropped, the inputs look different in a suspicious way, the inputs became weak.
7. **Notify**, if configured and there is something to say.

Exit codes: 0 done; 1 error; 2 `--fail-under` not met; 3 `--fail-on-alert` and a warning was raised.

## Scheduling

```
beyond90 schedule github beyond90.toml --at 05:17 --every day \
  --install-from "beyond90 @ git+https://github.com/OWNER/beyond-90@v0.12.0" --out .github/workflows/beyond90.yml
beyond90 schedule cron beyond90.toml
beyond90 schedule systemd beyond90.toml --every week --at 03:00
```

The templates hold no secret; they list the environment variables the configuration needs (in GitHub, as `secrets.NAME`). The GitHub workflow keeps the state in the Actions cache so each run can compare with the one before. **The state is customer data**: use a private repository and treat the artifact the same way.

## The browser app

The browser app stays file-based on purpose: a page cannot hold a vendor token safely, and most vendor APIs do not allow calls from a web page. The two meet through the workspace file. Every run writes `state/out/latest/workspace.json`, a snapshot the app imports as it is (the same content-hash check applies), so the history your scheduled runs build is browsable and comparable there.

## Safety model

| Risk | What stops it |
|---|---|
| A token in the file or the logs | Tokens are environment variables only; headers that look secret are refused in `[source.headers]`; messages never show a token or a query string |
| A run reaching somewhere unexpected | `allow_hosts`, https, redirect checks, no shell, a named environment for commands |
| A hostile or broken response | Size and time caps, a page cap, cursor loop detection, JSON that must be JSON; every value passes the loader's cleaning |
| An outage emptying the data | Last good copy per source, atomic writes |
| A wrong path producing blanks | A required column empty for every record fails the source |
| Noise | Alerts only on change or need |

## Limits, honestly

- Verified against a local fake API, fake commands and files: pagination, auth, retries, redirects, outages, merging, alerts and the webhook are tested end to end. **Not verified against any real vendor's API or CLI**; the cloud presets use field names from public CLI documentation and should be checked against your own output with `beyond90 sync`.
- Authentication is a bearer token or API key from an environment variable. There is no interactive OAuth flow.
- It reads; it never writes to a vendor.
- Rate limits are handled by honouring `Retry-After` on retry, not by throttling ahead of time.
