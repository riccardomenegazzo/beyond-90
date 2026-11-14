# Why multiply, and what the product is not

Beyond 90 reports two numbers for the same path. They answer different questions, and the difference matters.

## Yield: how much of the work is done

Each stage is a ratio on its own unit:

| Stage | Counts | Unit |
|---|---|---|
| L1 Connected | accounts the platform reaches | accounts in scope |
| L2 Seen | expected asset types inventoried | pairs of connected account and asset type |
| L3 Switched on | relevant capabilities active | pairs of connected account and capability |
| L4 Decided | findings past triage with an owner and a decision | findings |

Yield is L1 × L2 × L3 × L4. Each stage is measured only on what passed the one before it: L2 and L3 look at connected accounts only. So a gap at any stage caps the whole, and one excellent stage cannot hide a poor one. An average would let it.

Because the units differ, Yield is **not** the share of accounts that make it all the way. It is a product of completion rates. It gives partial credit: an account with nine of ten asset types seen still adds 90% of its pairs to L2. The stages are also not independent in a statistical sense, and the product does not assume they are; it is a chain of conditional ratios, not a probability.

## End to end: how many accounts are fully done

The second number uses one unit and no partial credit. An account passes when:

1. it is connected,
2. every asset type expected for its provider is inventoried,
3. every capability relevant to it is on,
4. none of its findings past triage lacks an owner or a decision.

Each account that fails is counted once, at the first stage where it stops. On the example customer:

```
Yield        90.1% × 97.3% × 92.7% × 89.4% = 72.6%
End to end   29 of 121 accounts pass every stage (24.0%)
             the others stop first at L1 12, L2 29, L3 42, L4 9
```

Both are true. Yield says most of the work is done. End to end says few accounts are finished: the gaps are spread thinly across many accounts rather than concentrated in a few. That changes the plan. Thin, spread gaps call for a change applied everywhere (an auto-enable rule, a default owner), not for a list of accounts to chase.

A stage with no data (no inventory file, no activations file) is not measured and stops nobody; the result lists which stages were measured.

## Where to look

- `beyond90 score <customer>` prints both.
- In the browser app, Today shows the end-to-end bar under "Where it leaks".
- The JSON score carries it as `end_to_end`: `total`, `through`, `value`, `measured`, `first_break` and up to five `examples` per stage.

## Known limits

- An account with no expected asset types for its provider passes L2 trivially.
- One stray finding without an owner sends an account to L4, however many are fine. That is deliberate: "done" means done.
- Neither number weighs accounts by spend or exposure. The reach and weighted views in the report do.
