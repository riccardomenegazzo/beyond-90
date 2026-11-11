# Views for the people who use this

Every customer opens on **Today**: the score, one sentence on where they stand, the three things to do first and the one thing to watch. The full overview is one click away.

The page keeps every view. A role only decides which ones sit first and which go under "More views". Pick yours in the box at the top of the workspace ("I work as"); the choice is kept in this browser.

| Role | What it puts first |
|---|---|
| Technical account manager | Today, overview, risk burn-down, accounts, findings, onboarding, actions, promises, asks, renewal, handoff |
| Solutions architect | Today, overview, connections, accounts, onboarding, maturity, plan, what-if, proof of value, burn-down |
| Sales engineer | Proof of value, overview, maturity, what-if, connections, burn-down, one-pager, call |

"Show everything" is the default and keeps the full list.

## What each one is for

**Risk burn-down.** Is risk going away? Critical and high findings open, how old they are against a target age, how long fixes took (only when at least three closed in the last 90 days), the last six months of opened and closed, and whether the customer is at zero criticals now and since when. The target ages are a default (7, 30, 90, 180 days). Replace them with the customer's own before quoting a figure; the view says so while the default is in use. It reads the `opened_at` and `closed_at` columns of the findings file, so it is only as good as those dates.

In book mode the same idea is a table across customers: critical and high open, findings older than target, the oldest urgent one, findings with no owner and who is at zero criticals, most critical first.

The target ages are the customer's own, kept in `customer.toml` (`settings.sla_days`) and shared with the score; the card on this view edits them. Below the table, "From raised to confirmed" counts critical and high findings from raised to closed and, when the findings file has `verified_at` and `reopened`, how many fixes held.

**Posture scorecard.** One page for a customer to show their own buyers: Yield, stages, risk, how fixes held, and a fingerprint of the input files. It is not an audit. Paste a fingerprint from a scorecard you were given to see whether it matches the data loaded now.

**Proof of value.** A plan for an evaluation, written before it starts: who sponsors it, who champions it, the window, success criteria with how each will be judged, a readiness checklist (access agreed, accounts listed, security and procurement steps known), and five questions asked before the first session: is the problem stated, are the criteria signed off with a way to tell, are a sponsor and a champion named, is the window realistic for the number of criteria (5 to 60 days, at most one criterion per two days), is what is out of scope written down. It says "ready to start" only when all five are answered, and names what to fix otherwise. Record the day the customer first saw something useful and the result states the days from the start to it. During it, mark each criterion (not yet tried, met, partly, not met, dropped) and write what was seen. The result says "all criteria met" only when every counted criterion is; "mostly met" needs no failures and at least three quarters met. It ends with what carries into the rollout, what is still open, and what the result does not show: one environment, one window, the evaluator's own judgement.

**Asks.** What customers asked the vendor for: a feature, an adoption blocker, an escalation, each with a figure you type for what is at stake (a renewal amount, say; the page does not measure it). The digest groups the same ask across customers, counts each customer's figure once, and lists escalations oldest first, ready to paste for a product team. Nothing is sent anywhere.

## Where the data lives

Proofs of value and asks are kept in this browser like promises: sealed with your passphrase if you set one, erased with the customer, and passed through the sharing gate (the customer name and people can be replaced by aliases) when you copy or download. They travel in an exported workspace file (sealed with the file, if you seal it), so moving to another device keeps them.

## Importing exports from other tools

The importer recognises more column names: cloud platform, widely internet exposed, created date, resolved date, closed date. It still asks you to confirm the mapping, and it skips a row it cannot read rather than guessing.

## Limits

Everything here was tested on made-up data. Nothing has been checked against a real customer's export. A burn-down needs honest dates; a proof of value records judgement, not measurement.
