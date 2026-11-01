# Landscape: what already exists, and what Beyond 90 takes from it

Compiled 1 Nov 2026 from public pages. Everything below is paraphrased; follow the links for the originals. Nothing here is a claim about how any product performs, only about what its public material says it does.

## 1. Customer-success platforms: health scorecards

Sources: [Gainsight, "Creating a Balanced Scorecard"](https://www.gainsight.com/?p=4548); [Gainsight, "A health score is not an adoption score"](https://www.gainsight.com/blog/modernize-health-scores-in-order-to-monetize-retention-and-expansion/); [Gainsight community, DEAR framework](https://communities.gainsight.com/predictive-health-scoring-321/build-a-foundational-health-scoring-framework-using-dear-26486); [Gainsight community, scorecard overrides](https://communities.gainsight.com/archived-content-217/how-to-use-health-score-to-reduce-risk-24500); [GitLab handbook, customer health scoring](https://handbook.gitlab.com/handbook/customer-success/customer-health-scoring/).

What they do:

- A scorecard is several **measures grouped by dimension** (product usage, support, sentiment, implementation, company risk), not one number. Bands (green, yellow, red) come from fixed point thresholds.
- Adoption is **one input, not the whole**. A common warning in this material: structuring health purely on adoption misses the picture, and low adoption predicts churn more reliably than the reverse. Sentiment should not be mixed with adoption or the same signal counts twice.
- **Overrides**: a critical risk (a lost stakeholder, a product left unused) can force the overall status regardless of the rest.
- **Outcomes** are tracked in a structure such as DEAR (deployment, engagement, adoption, return on investment); GitLab separates a platform-level adoption score from **a scorecard per use case**, so the conversation is about outcomes the customer bought the product for.
- Scores are tied to **playbooks** and **success plans**: a threshold crossing triggers a defined action.

What Beyond 90 already did: adoption separated from relationship and kept apart from health; playbooks per gap; candor ledger instead of a flattering score.

What it takes: **use-case adoption** (section 4 below), **dimension status with an override rule** (the rubric), and a **success plan document**.

What it declines: a single weighted "health score". The weights are an opinion that decides who gets attention; Beyond 90 shows dimensions and lets the lowest one speak.

## 2. Engineering scorecards: levels with gating

Sources: [OpsLevel, service maturity rubric](https://www.opslevel.com/resources/how-to-set-up-your-service-maturity-rubric); [Port, promote scorecards](https://docs.getport.io/promote-scorecards); [Cortex, create a scorecard](https://docs.cortex.io/scorecards/create); [Backstage-style scorecards via Port](https://docs.backstage-plugin.port.io/features/scorecards).

What they do: a set of **checks** grouped into **levels** (commonly basic, bronze, silver, gold). An entity reaches a level only when it passes **all** checks at that level and below; passing every gold check but one leaves it at silver. Level names are standardised across scorecards so results are comparable. Each check is a plain, testable statement. A **campaign** gives teams a deadline to reach a level.

Why it matters here: percentages hide a failing important check behind a good average, and people remember "we are Silver, here is the one thing between us and Gold".

What it takes: a **maturity rubric** with gating: bronze, silver and gold checks for adoption, outcomes, relationship and data quality; the customer's level; and the **next checks to pass** with the action that closes each. Level names are fixed across customers and profiles so that a portfolio compares like with like. The checks themselves are editable per profile.

## 3. A supply-chain example: OpenSSF Scorecard

Sources: [OpenSSF Scorecard](https://securityscorecards.dev); [OpenSSF, structured results](https://openssf.org/?p=5890).

What it does: independent automated checks, each scored 0 to 10 with a **risk weight**, combined into an aggregate, with a **remediation hint** per check. Its own authors say the scoring policy is opinionated and publish **structured results** so that consumers can write their own policy on the raw data points. Commentary around it repeats that a good average can hide a failing high-risk check.

What it takes: every rubric check carries its **evidence** and **the action that fixes it**; the JSON output exposes each check's measured value, so a customer or a vendor can apply a different policy; a check's **risk weight is the level it sits at**: a check that must never fail (a critical finding with no owner) goes at bronze, so failing it leaves the customer below bronze however high the rest is.

## 4. Frameworks the customer already speaks

Sources: [NIST CSF 2.0 overview](https://www.casrai.org/guides/nist-cybersecurity-framework-2-0); [Cisco, CSF 2.0 mapping](https://www.cisco.com/c/en/us/products/collateral/security/nist-csf-sb.html); [Kaseya, CSF 2.0 practical guide](https://www.kaseya.com/blog/nist-cybersecurity-framework/); [ATT&CK Navigator layers](https://attack.mitre.org:443/docs/Comparing_Layers_in_Navigator.pdf).

- Security vendors routinely map their capabilities to the six CSF 2.0 functions (govern, identify, protect, detect, respond, recover). The same material warns that **Govern and much of Identify are organisational work, not something software satisfies**, and that the common imbalance is heavy Protect with thin Detect and Respond.
- ATT&CK Navigator layers are JSON files that colour techniques by coverage score, useful to detection-heavy products but requiring **technique-level evidence** that adoption data does not contain.

What it takes: modules tagged with the CSF function they serve, and a **coverage by function** view that shows the imbalance in adoption terms (switched-on capability against capability that applies). It says plainly that this is not compliance.

What it declines: ATT&CK layers (no technique-level data to fill them honestly), and any claim of framework compliance.

## 5. Onboarding and renewal: leading indicators

Sources: [Pedowitz Group, onboarding success criteria](https://www.pedowitzgroup.com/how-do-you-define-success-criteria-for-onboarding); [Pedowitz Group, onboarding and renewal likelihood](https://www.pedowitzgroup.com/how-does-onboarding-influence-renewal-likelihood?hsLang=en); [Partenero, time to value](https://partenero.com/en/blog/time-to-value-leading-indicator); [Gainsight, health scorecard guide](https://www.gainsight.com/guides/customer-health-score/).

What this material agrees on: churn is usually decided early; useful **leading indicators** are time to first value, activation of the capabilities tied to the success plan, breadth of engaged users, executive-sponsor engagement, outcomes against plan, and open friction; a **documented success plan with owners and dates** is the working artefact; renewals should be forecast from these signals months ahead rather than at quote time, and signals should be checked against cohorts before being trusted.

What it takes: **renewal readiness** (a checklist of those leading indicators, with the date and the ARR on the line) and a **success plan** document (objectives, measurable results, owners, dates, risks). It does not predict: with no history of renewals, any probability would be invented. It lists evidence.

## 6. What stays unique

No tool found combines these: denominators from independent sources, a moving bar with exact attribution, a plan that shows the dip before it happens, the hidden-unit estimate, and a candor ledger, all reproducible from files with a fingerprint on every number. The additions above are borrowed on purpose where an existing product has a clearly better answer.

## 7. Decisions

| Idea | Decision |
|---|---|
| Multi-dimension scorecard | Take, as dimension status; no weighted total |
| Overrides | Take, as caps on the level |
| Levels with gating (bronze, silver, gold) | Take |
| Use-case scorecards | Take |
| Check-level evidence and remediation | Take |
| Structured results | Take (already in JSON; extended) |
| CSF function coverage | Take, labelled as not compliance |
| Renewal readiness and success plan | Take |
| Single weighted health score | Decline |
| Churn probability | Decline (no renewal history to ground it) |
| ATT&CK Navigator layers | Decline (needs technique-level data) |
| Sentiment surveys | Out of scope; relationship ratings stay the TAM's own judgement |
