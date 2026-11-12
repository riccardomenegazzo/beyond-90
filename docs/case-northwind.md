# A worked case: "we are at 92%"

This is one customer, Northwind, told start to finish. It is invented, but the numbers come straight from the example data in this repository, so you can open it and follow along.

## The opening

On the quarterly call the security lead says: "We're at about 92% coverage. We're in good shape."

That 92% is the legacy metric: the share of the accounts that were planned for onboarding which are connected. It is a real number. It just is not the whole picture, because it ignores accounts nobody planned for and everything after the connection.

## What I found

I loaded the same estate and let the tool measure the whole path, not only the first step:

| Stage | What it asks | Result |
|---|---|---|
| L1 | Is the account connected? | 90.1% (109 of 121) |
| L2 | Are its assets seen? | 97.3% |
| L3 | Are the capabilities switched on? | 92.7% |
| L4 | Do findings have an owner and a decision? | 89.4% |

Each stage looks fine alone. They multiply: that gives a Yield of 72.6%, about twenty points under the number the customer quoted. Nobody was lying. Each team was looking at its own step.

## What I would say

Not "your number is wrong". I would say: "Your 92% is right for what it measures. I'd like to show you the rest of the path, because that's where the next improvement is."

Then I would show the first screen. It says, in one sentence, where they stand, and lists three actions.

## The three things I would do first

They are ranked by how many points each one adds:

1. **Give 13 findings an owner and a decision** (about 4 points, around 5 hours). These sit past the triage window with nobody on them.
2. **Record a decision on 8 findings that already have an owner** (about 2.5 points, about 2 hours). This is nearly free.
3. **Connect the six accounts that belong to two named teams** (about 2 points each, 3 hours each). It needs a conversation with the owners, so I would book it first.

The tool says these effects are estimates, good for ranking and not for adding up. I say so out loud too. It earns more trust than a promise of "+10 points".

## The questions I expect

- *"Why does my number differ from yours?"* Because we count different things. Show the four stages and let them find the difference themselves.
- *"Isn't this just making the platform look worse?"* No: the numbers that improve are the customer's. I report their progress separately from any change in how we measure.
- *"Who owns the 13 findings?"* That is the point. The next step is a name, not a tool.

## What I would send afterwards

A short note: where they stood, the three actions with owners and dates, and what I'm committing to on my side. The tool drafts it and keeps my promise in a ledger, so a late one shows on my first screen.

## What this case does not show

It is invented data. It does not prove that any real customer behaves like this, and the ranking of actions is a judgement, not a measurement. The value is in the method: count the whole path, show it plainly, and agree who does what by when.
