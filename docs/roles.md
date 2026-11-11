# Views for the people who use this

The page keeps every view. A role only decides which ones sit first and which go under "More views". Pick yours in the box at the top of the workspace ("I work as"); the choice is kept in this browser.

| Role | What it puts first |
|---|---|
| Technical account manager | Overview, risk burn-down, accounts, findings, onboarding, actions, promises, asks, renewal, handoff |
| Solutions architect | Overview, connections, accounts, onboarding, maturity, plan, what-if, proof of value, burn-down |
| Sales engineer | Proof of value, overview, maturity, what-if, connections, burn-down, one-pager, call |

"Show everything" is the default and keeps the full list.

## What each one is for

**Risk burn-down.** Is risk going away? Critical and high findings open, how old they are against a target age, how long fixes took (only when at least three closed in the last 90 days), the last six months of opened and closed, and whether the customer is at zero criticals now and since when. The target ages are a default (7, 30, 90, 180 days). Replace them with the customer's own before quoting a figure; the view says so while the default is in use. It reads the `opened_at` and `closed_at` columns of the findings file, so it is only as good as those dates.

**Proof of value.** A plan for an evaluation, written before it starts: who sponsors it, who champions it, the window, success criteria with how each will be judged, and a readiness checklist (access agreed, accounts listed, security and procurement steps known). During it, mark each criterion (not yet tried, met, partly, not met, dropped) and write what was seen. The result says "all criteria met" only when every counted criterion is; "mostly met" needs no failures and at least three quarters met. It ends with what carries into the rollout, what is still open, and what the result does not show: one environment, one window, the evaluator's own judgement.

**Asks.** What customers asked the vendor for: a feature, an adoption blocker, an escalation, each with a figure you type for what is at stake (a renewal amount, say; the page does not measure it). The digest groups the same ask across customers, counts each customer's figure once, and lists escalations oldest first, ready to paste for a product team. Nothing is sent anywhere.

## Where the data lives

Proofs of value and asks are kept in this browser like promises: sealed with your passphrase if you set one, erased with the customer, and passed through the sharing gate (the customer name and people can be replaced by aliases) when you copy or download. They are not part of an exported workspace file, so moving to another device means copying their text.

## Importing exports from other tools

The importer recognises more column names: cloud platform, widely internet exposed, created date, resolved date, closed date. It still asks you to confirm the mapping, and it skips a row it cannot read rather than guessing.

## Limits

Everything here was tested on made-up data. Nothing has been checked against a real customer's export. A burn-down needs honest dates; a proof of value records judgement, not measurement.
