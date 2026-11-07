# What if, and what it takes

Two questions come up in every review: *if we do this, where does Yield land, and does it dip first?* and *what would it take to reach 90%?* Both are answered on a copy of the data, with the same engine that computes the score. Nothing is written back.

## Try a combination

In the page: **Try a combination**. In a terminal:

```
beyond90 whatif customer-dir --do connect_all,enable_all,fix:unowned
beyond90 whatif customer-dir --scenarios scenarios.json     # several, side by side, best first
```

Steps: `connect_all`, `enable_all`, `enable:<module>`, `fix` (all repairable findings) or `fix:<unowned|no_decision|accepted_without_expiry|expired_acceptance>`. A scenario file is a list of `{"name": ..., "steps": [{"kind": ...}]}`.

Each scenario shows three readings:

- **today**, as scored;
- **right after**, before inventory settles. Connecting an account first lowers Yield, because it enters the denominators of the coverage stages before its resources and modules arrive. This is the dip the roadmap also shows;
- **once settled**, when the inventory is complete and the agentless modules are on.

It also says how many accounts, modules and findings the combination touches.

## What it takes to reach a target

```
beyond90 whatif customer-dir --reach 0.9
```

A greedy sequence: at each step, the change that adds the most at that moment, until the target is reached or nothing modelled gets closer. It is a good order to start in. It is not a proof that the path is the shortest, and it says nothing about effort: a small gain can be hard and a large one easy. For hours and weeks use the roadmap (`beyond90 plan`).

## What it assumes

- After connecting, inventory completes and the agentless modules switch on. Other modules stay off until a step enables them.
- Newly inventoried resource types count as present. This can only make the coverage of modules look worse, never better.
- Repaired findings get an assigned owner, a "fix" decision or a 90-day expiry. The process is repaired; the findings are not closed.
- Effort and calendar time are not estimated.

If the target cannot be reached with what is modelled, it says so and says what is left (modules the customer does not license, accounts that cannot be connected).
