# Value, teams and the recap

Three questions that come after the work: what was it worth, who on the customer's side has to move next, and what did we just agree.

## Value receipt

A customer remembers the last problem, not the last forty fixes. The receipt compares two snapshots of the same customer and lists what moved between the two dates:

- accounts connected, with the monthly spend they bring under watch, and any that were lost;
- inventory units gained or lost;
- capability activations, by module;
- findings closed, by severity, and findings that gained an owner and a decision;
- the change in Yield split exactly into the customer's own work and the bar moving (new capabilities released), as in the attribution;
- the change weighted by spend and exposure;
- our promises: delivered, and delivered on time.

Each touch logged in `interactions.csv` is listed next to the outcomes of the same kind (connections, findings, capabilities, coverage) dated within 21 days after it. The page says "followed", never "caused": a timeline is evidence for a conversation, not proof. It ends with what did not move, because a receipt that hides the gaps reads as a sales sheet.

```
beyond90 receipt examples/portfolio/northwind --since examples/history/northwind-2026-09 --format html > receipt.html
```

In the browser, choose an earlier snapshot in "Compare with" and open **Value receipt**. Automated runs write `value-receipt.html` whenever a previous snapshot exists. The HTML is self-contained: no script, no network, everything escaped.

## Team digests

A champion cannot fix everything, and one list for everyone gets forwarded to no one. The digests split the estate by the owner team of each account (`accounts.csv`, `teams.csv`) and rank the teams by what is at stake on their side: the share of spend not connected, critical findings, blocked connectors and findings past the triage window. Each digest has the team's accounts, blockers with their cause in plain words, findings, dated events from the outlook, at most three asks, and a message addressed to the team's contact from `contacts.csv` (matched by team). Messages use no internal metric names. A team with nothing to do is thanked.

```
beyond90 teams examples/portfolio/northwind
```

## Recap after the call

In **Prep a call**, the recap card drafts the follow-up email: what was covered (the agenda), what was agreed (typed one per line as `what | who | by when`) and what the customer will get from us (the promises we owe). Copy or download it; nothing is sent from the app.
