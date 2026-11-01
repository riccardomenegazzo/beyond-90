# The trust layer

Adoption numbers say what the customer did. They do not say whether the customer will listen when you tell them what to do next. Version 0.5 adds a small, honest model of the relationship, built on ideas from *The Trusted Advisor* (Maister, Green and Galford, 2000). The book is paraphrased here, never reproduced; read it for the full argument. Chapters 8, 9, 20, 21 and 22 informed this release.

## What the book gives the code

| Idea in the book | Where it lives | Notes |
|---|---|---|
| Trust grows with credibility, reliability and intimacy and shrinks with self-orientation: `T = (C + R + I) / S` | `relationship.trust_index`, per contact, in `contacts.csv` | Ratings are 1 to 10 and are *your* judgement. The model does not hide that. The book's worked examples (1.25 and 5.0) are in the test suite. |
| Bands of trust | `relationship.band` | At or above 4 strong, at or above 2 developing, below 2 fragile. These are working thresholds, not the book's. |
| Work on the weakest lever first | `relationship.limiting_factor` | Where one extra point (or one fewer for self-orientation) raises T the most. Usually self-orientation, because it is the denominator. |
| Reliability is promises kept | `commitments.csv`, measured | The rate is on-time over due in the last 90 days. Late and still-open promises are listed by name. |
| One contact is not a relationship | gaps in `compute_relationship` | No executive sponsor, key contacts not spoken to for 90 days, single-threaded, teams that own assets but have no contact, weak component per person. |
| Selling is earned by trust: Expand, Broaden, Diversify | `trust.classify` | A new offer to people you know is *expand*. A new offer to people you do not know is *diversify*. The same offer to new people is *broaden*. "Know" means at least half of the owners have a contact on that team. Without `contacts.csv` the type is left blank. |
| Say the uncomfortable thing first | `candor.py` | See below. |
| A review is a conversation, not a presentation | `qbr.py` | Five stages: engage, listen, frame, envision, commit. |

## Candor ledger

`candor_items` looks at the score, the plan, the forecast and the attribution, and lists what a trusted advisor would say before the customer finds it. Each item has what to say, the evidence, and why it helps. Triggers:

- the legacy adoption figure overstates the true one (both numbers shown)
- licences paid for and unused, merged into one item that mentions paying for less
- accounts nobody has seen (capture-recapture estimate)
- the J-curve: connecting accounts lowers Yield first
- L2 or L3 not measured because a file is missing
- severity downgrades near SLA deadlines
- zero critical is far away
- the bar moved, so a good quarter looks flat
- overdue commitments
- modules we are *not* recommending because the estate has no resource of that type

An account with nothing to confess produces an empty ledger. The QBR shows the five most important; the report shows all of them.

## The QBR

The draft is shaped as five stages and ends with a part marked **For you only: remove before sharing**: the relationship read, the typed expansion opportunities and a short list of what to do before walking in. The customer-facing part includes an agenda to send in advance, a "Listen first" list of open questions drawn from the playbooks, and "What we commit to", the promises that will go into `commitments.csv` next time.

## Limits

- Trust ratings are subjective and a model of a relationship is not a relationship. The numbers are a prompt for a conversation with yourself.
- The equation is the book's heuristic, not a measured law. The bands are working thresholds.
- Nothing is sent anywhere. Contacts and commitments stay in the data directory you control; keep personal data out of a repository that will be public.
