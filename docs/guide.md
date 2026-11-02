# A TAM's guide to Beyond 90

How the pieces fit into a working month. Every command runs locally on files you control. The outputs referred to below are committed in [docs/example](example/) so you can read them without installing anything.

## Or let it do all of this by itself

Everything below can be automated: describe your sources once in `beyond90.toml` and `beyond90 run` collects them, builds the data, scores, compares with the previous run and tells you what changed. See [automation.md](automation.md). The manual steps remain for sources that have no API.

## Day 0: build the universe

Adoption is measured against the accounts you know, so start there. For each independent list you can get, import its native export:

```
beyond90 init acme --name "Acme"
beyond90 import aws-org  aws-organizations.json  --into acme     # aws organizations list-accounts
beyond90 import azure    azure-accounts.json     --into acme     # az account list
beyond90 import gcp      gcp-projects.json       --into acme     # gcloud projects list --format=json
beyond90 import csv billing.csv --into acme --source billing --id-column "Linked Account" --provider aws --spend-column "Unblended Cost"
beyond90 import csv sso.csv     --into acme --source sso     --id-column "Account Id"     --provider aws
beyond90 import csv connected.csv --into acme --connected --authoritative --id-column account_id
beyond90 reconcile acme
```

`reconcile` shows how the lists overlap. Accounts that are billed but missing from the organization are the most likely shadow accounts; start your first conversation with the customer there. Then add `inventory.csv`, `activations.csv`, `findings.csv`, `teams.csv` and `entitlements.csv` as you get them (see [data-format.md](data-format.md)). Until inventory and activations exist, L2 and L3 are reported as not measured, not as zero.

```
beyond90 validate acme
beyond90 universe acme        # how many accounts does no source see?
```

## Without installing anything

The same engine runs in a browser tab (see [app.md](app.md)): drop a customer folder, or a folder of customer folders for a whole book, and nothing leaves your machine. It saves snapshots of your inputs locally and compares them, so the weekly rhythm below also works there.

## Every week or two: score, explain, forecast

```
beyond90 score acme --store history.db --format markdown
beyond90 explain acme --store history.db      # what the customer did, what the bar did
beyond90 forecast acme                        # zero critical: when, and how likely to break
```

Read `explain` before you read the new number. A quarter in which Yield fell 2 points because three modules shipped can be a good quarter; [the example](example/northwind-report.html) shows the customer up 6.8 points and the bar down 1.7.

## Planning your time

For one customer:

```
beyond90 plan acme --hours 8 --weeks 26
```

The roadmap includes the J-curve: connecting new accounts lowers Yield for a few weeks before it recovers. Tell the customer in advance ([example](example/northwind-plan.md)).

For your whole book, with one budget of hours:

```
beyond90 book customers/ --hours 30
```

It spends each hour where the ARR-weighted gain per hour is highest and shows how much that beats an equal split and an ARR-proportional split. With generous hours every rule ends up at the same place and the report says so ([example](example/book.md)).

Effort figures live in `playbooks.json`; change them to match how long things really take you, and use `--catalogue-dir` to point at your copy.

## Staying ahead: radar

```
beyond90 radar customers/                                    # modules released after each customer's baseline
beyond90 radar customers/ --release 2026.3
beyond90 radar customers/ --threats threats.json
```

The release radar says who should hear about a new capability and what it is worth; the threat radar says who is exposed and uncovered, and who is *unknown* because the affected type was never inventoried ([example](example/radar.md)).

A threat feed is a JSON file you maintain from the sources you follow. Nothing is fetched:

```json
{
  "threats": [
    {
      "id": "T-2026-001",
      "title": "Short description",
      "severity": "high",
      "published": "2026-10-27",
      "resource_types": ["container_registry", "kubernetes"],
      "providers": ["aws", "azure"],
      "mitigated_by": ["container_security", "runtime_sensor"],
      "source": "where you read it"
    }
  ]
}
```

`resource_types` come from `beyond90 catalogue`; `mitigated_by` are module ids (any one active counts as covered); `providers` is optional.

## Every quarter: the review

```
beyond90 qbr acme --since last-quarter-dir --quarter "Q4 2026" --out qbr.md
beyond90 report acme --since last-quarter-dir --out acme.html
```

Before you present it, read the sections the customer will not see: the relationship read (who you know, who you do not, which promises are overdue), the expansion types, and the short list of what to do before you walk in ([trust.md](trust.md) explains where they come from). The "How far to trust this number" section in the report tells you which files to improve first.

The QBR draft leads with the answer (real adoption against the legacy number, what changed and why, the roadmap and the dip to expect), gives three reasons, the evidence, and the decisions you need from the customer ([example](example/northwind-qbr.md)). Add the customer's own goals and wins before presenting it.

## Before you present a change

With `--since`, read "Did the inputs change since ...?" first. A quarter that looks like a jump is sometimes a narrower export, and no one wants to defend an artefact. The maturity section then tells you the week the next level could be reached at your hours, and which checks no amount of hours will move.

## Renewals and the success plan

Set `renewal_date` in `customer.toml` and every report gets a renewal readiness checklist: licences in use, executive sponsor, more than one relationship, promises kept, critical findings, direction of travel and confidence in the numbers, each with its evidence, and the revenue that is on the line. It is a checklist, not a prediction. The portfolio command lists renewals by date with the ARR at risk. For the customer, `beyond90 successplan acme --owner "Your Name"` drafts a plan they can sign: outcomes by use case, measures, 30, 60 and 90 day milestones, who does what, what you need from them and what you commit to. It contains nothing private.

## What to be careful about

- The plan, the forecast and the hidden-accounts estimate are models. Each report says what it rests on.
- Do not put customer data in issues or pull requests. Treat data directories and history databases like the systems they came from.
- Adoption is one input to a customer health view, not the whole of it.
- Every score carries the hash of the inputs it came from (`beyond90 fingerprint acme` prints it). When a number is questioned, that hash and the engine version are how you show what it was computed from.
- A spreadsheet export can add columns or rename them. Unknown columns are ignored with a warning and a suggestion; read the warnings.
