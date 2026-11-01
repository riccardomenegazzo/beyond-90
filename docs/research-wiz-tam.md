# How Wiz runs Technical Account Management: research notes

Compiled 1 Nov 2026 from public sources only (job postings, Wiz web pages and blog, marketplace listings, press). Nothing here comes from inside Wiz. Where a source was only seen as a search snippet, or two sources disagree, it is flagged.

## 1. Company context

- Google completed the acquisition of Wiz on 11 March 2026 (about $32B, all cash). Wiz joins Google Cloud, keeps its brand and states it will keep supporting all major clouds. [S1, S2]
- Reported figures: more than $1B ARR in 2025, about 1,800 employees, customers include about half of the Fortune 100. [S2, S3]
- Implication for a TAM: the multicloud promise is part of the story customers will test. Beyond 90 should stay provider-neutral and treat the cloud mix as data, not as a default.

## 2. What the TAM role is, according to the postings

Same core text across US, UK, EMEA and APAC postings. [S4, S5, S6, S7]

| Area | What the postings say |
|---|---|
| Mission | Plan and execute strategies that drive adoption and use of the platform; value realization; satisfaction |
| Lifecycle | Onboarding, operationalization, renewal and expansion |
| Success plans | Plans with measurable goals tied to the customer's security and compliance objectives |
| Programs | Help customers project-manage adoption across business units and stakeholders |
| Escalations | Primary Wiz liaison for technical questions; program-manage escalations with Support and Engineering |
| Product | Capture feature requests and adoption blockers; inform customers on new features; liaise with Product |
| Commercial | Work with Sales and Renewals on renewals; identify expansion across the customer organization |
| Book of business | 5 to 10+ customers in the senior US postings; experience asked ranges from 3+ to 8+ years of technical customer-facing work depending on region and level |
| Learning | Monitor emerging cloud threats, stay current on platform features |
| Executive layer | Executive communications; the EMEA manager role adds at-scale programs with Operations, Sales, Renewals and Marketing |

### Scaled customer success (Associate TAM posting) [S8]

Two workflows run side by side:

1. Reactive, one to one. Monitor dashboards for risk signals, intervene case by case, run sessions on adoption barriers and targeted training, collect feature requests, analyse usage patterns, coordinate support.
2. Proactive, one to many. Spot patterns across customers, build solutions that serve several accounts at once, publish standard resources and community content (knowledge articles, webinars) before problems appear. The posting describes this as something to develop over time.

Other signals from the same posting: help establish a Wiz Center of Excellence at the customer, and the accounts covered represent a significant share of ARR.

### Surrounding roles

Customer Success Manager (technical onboarding, deployment and operationalization), Customer Success Architects, pre-sales Solution Engineers, Support, Product Management, Regional Director of Customer Success, Community Manager (programs for onboarding, adoption, peer help, feedback). [S9, S10, S11]

### Support tiers (verify before using)

The customer success page lists Free (24x5), Enterprise (24/7/365, tailored proactive engagement) and Elite (same plus SLAs under 30 minutes). [S12] A search snippet of an older version of the page mentioned Base and Premium; treat the current names as unconfirmed until checked on the live page.

## 3. What Wiz already measures and publishes about adoption

This is the most important section for positioning Beyond 90.

| Wiz feature | What it does | Source |
|---|---|---|
| Champion Center (announced Nov 2024) | Hub for security leaders: Wiz Security Score (customizable to a framework, with trendlines), MTTR for critical Issues, compliance benchmarks, adoption view (active users, enabled integrations, projects, usage trends), flags missing integrations, goals and deadlines per module champion, Business Value Calculator | [S13] |
| Zero Critical Club | Customers with no critical Issues. Share of customers reported at different times: over 30% (older snapshot of the customer success page, seen as a snippet), 40% (blog), over 50% (current customer success page and Zero Critical Club post) | [S12, S14, S15] |
| Badges and MTTR streaks | Example badges: Vulnerability Vanquisher (no vulnerabilities tied to critical Issues), Identity Investigator (no roles with excessive admin privileges). MTTR streaks track fast remediation of new critical Issues | [S15] |
| All-Stars Club | Next milestone after Zero Critical, for sustaining outcomes | [S15] |
| Projects, RBAC, WIN | Scope each team's view to its own risks and deliver Issues into existing ticketing and chat (R1 case) | [S15] |
| Ownership model | Service ownership (Service Catalog, Backstage), project ownership (can sync from ServiceNow CMDB), resource-level ownership (cloud tags, tag rules), code ownership (CODEOWNERS, git blame, code-to-cloud mapping). Green Agent suggests the owner on each Issue | [S16] |
| Workflows and Agents (launched July 2026) | Drag-and-drop orchestration from detection to ownership to remediation; Red (offensive validation), Blue (investigation), Green (remediation) agents | [S17, S18] |
| AI Threat Readiness Framework | Four pillars, two variables (speed of action, breadth of visibility), 20-point checklist with readiness tiers; reports on scan coverage, detections, PRs opened, issue age and SLA adherence | [S19, S20] |
| Integrations | 200+ via Wiz Integration Network (Jira, ServiceNow, Slack, SIEMs, cloud queues); GraphQL API; report export to S3 and Blob | [S21, S22] |
| Dashboards | Coverage, scan results, risk posture, compliance, number of Issues, runtime sensor results | [S22] |

Customer benchmarks worth reusing as reference points: Schibsted went from 150 criticals to 8 within 90 days of implementation and then to zero; R1 reached zero in under a month; Sitecore started in early 2024 and reached zero by December 2024 starting with production. [S14, S15]

## 4. Licensing units (entitlement versus consumption)

Public marketplace listings show that the platform is sold in blocks: workloads (Cloud), sensors (runtime), code licenses or active developers (Code), and log ingestion in GB per month (Defend). The Wiz Go bundle lists 300 Cloud Advanced workloads, 150 GB Defend ingestion, 100 runtime sensors and 50 Code developers. [S23, S24]

Implication: every one of these has a licensed number and a used number. The gap between them is an adoption signal that does not depend on any customer-side data source. Beyond 90 should carry it as an explicit metric (see section 6).

## 5. Customer success practice outside Wiz (for the method)

- A health score is not an adoption score. Adoption is one input next to sentiment, relationship and commercial signals. [S25]
- Common health score inputs: product adoption, satisfaction, account growth, community participation. [S26]
- GitLab publishes a use-case adoption model with red/yellow/green roll-ups into a platform adoption score. [S27]
- Pooled and scaled CS: group one-to-many, system-triggered one-to-one, named humans only for the strategic tier. [S28, S29]
- QBRs work best when they are built from the success plan agreed at the start, report the change in the agreed KPIs, and end with decisions someone owns. [S30, S31]
- Cloud security metrics: coverage of the asset inventory and attack-path density are named next to MTTR for critical risks. [S32] Alert fatigue stalls MTTR; one practitioner quote notes alert counts often fall only because of generous ignore rules, which supports the anti-gaming check already in the spec. [S33, S34]

## 6. What this changes in Beyond 90

1. **Positioning.** The Champion Center measures adoption inside what Wiz can see. Beyond 90 measures what Wiz cannot see yet (the true account universe from billing, organization hierarchy and SSO) and it measures it across a whole portfolio. One line: the Champion Center answers "how are we doing with what is connected", Beyond 90 answers "what is not connected yet, and what do we do about it".
2. **Do not rebuild ownership.** Wiz already has an ownership model, suggested owners and Workflows. L4 should read ownership and decision state through the API and report coverage, not route issues. Rename the Ownership Router idea to Ownership Coverage.
3. **Speak the Zero Critical language.** Add time-to-zero, zero-critical status, and MTTR streak as reported fields, and use the customer benchmarks above as reference points. "Beyond 90" lines up with Wiz's own "beyond Zero Critical" step (All-Stars).
4. **Add a one-to-many mode.** Portfolio patterns (the same L1 leak at five customers) become shared playbooks, webinars and knowledge articles. This is the proactive workflow in the Associate TAM posting.
5. **Entitlement versus consumption.** New L3 sub-metric: licensed sensors, code seats, workloads and log GB against what is deployed and active.
6. **Health is wider than adoption.** Export Beyond 90 as one input to a customer health view; do not present it as health.
7. **Threat-to-Adoption.** Map the four AI Threat Readiness pillars to modules and to the readiness checklist, so a new threat points at a specific unused capability.
8. **Reach to Champion Center.** Align Reach metrics (active users, enabled integrations, projects) with the fields the Champion Center already exposes so numbers can be cross-checked.

## 7. Open questions for the interviews

- What does a TAM at Wiz use day to day for account health (internal dashboards, Champion Center, a CS platform)?
- How is a book split between one-to-one and pooled accounts in EMEA?
- How much of success planning is templated?
- How is the Google integration changing the customer journey and the support tiers?
- Which expansion signals does Wiz already trust?

## Sources

- S1 Google Cloud press corner, "Google Completes Acquisition of Wiz": https://www.googlecloudpresscorner.com/2026-03-11-Google-Completes-Acquisition-of-Wiz
- S2 Cleary Gottlieb note on closing: https://www.clearygottlieb.com/news-and-insights/news-listing/google-completes-32-billion-acquisition-of-wiz
- S3 Tech Insider analysis (ARR, headcount; secondary source): https://tech-insider.org/google-wiz-acquisition-cloud-security-2026/
- S4 Wiz TAM posting (Mid-Atlantic) via Jobgether: https://jobgether.com/offer/6a2d859a63c956434a767949-technical-account-manager-mid-atlantic
- S5 Wiz TAM posting (Northeast): https://www.builtinla.com/job/technical-account-manager-northeast/10526932
- S6 Wiz TAM posting (West) via Jobgether: https://jobgether.com/offer/6a4540a1ac00a71a5a74a119-technical-account-manager-west
- S7 Wiz TAM posting (UK/I): https://builtinbristol.uk/job/technical-account-manager-uki/3183959
- S8 Wiz Associate TAM posting: https://refresh.cv/jobs/wiz/aa57771f-5b40-473e-b104-77bf33455a8d?lang=ja
- S9 Wiz Customer Success Manager posting: https://jobify360.co.il/jobs/3785566800-in
- S10 Wiz Manager, Technical Account Management (EMEA): https://builtin.com/job/manager-technical-account-management/3599443
- S11 Wiz Community Manager posting: https://www.builtinsf.com/job/community-manager/11254503
- S12 Wiz customer success and support page: https://wiz.io/customer-success
- S13 Wiz blog, Champion Center: https://www.wiz.io/blog/introducing-wiz-champion-center
- S14 Wiz blog, three companies reach zero critical: https://www.wiz.io/fr-fr/blog/how-three-companies-achieved-zero-critical-issues-in-the-cloud
- S15 Wiz blog, Zero Critical Club: https://www.wiz.io/blog/celebrating-customers-in-zero-critical-club
- S16 Wiz blog, AI Threat Readiness Pillar 2 (ownership): https://www.wiz.io/pt-br/blog/ai-threat-readiness-pillar-2
- S17 Wiz blog, Agents and Workflows: https://wiz.io/blog/introducing-wiz-agents
- S18 Wiz blog, Green Agent: https://wiz.io/blog/introducing-wiz-green-agent
- S19 Wiz, AI Threat Readiness page: https://www.wiz.io/platform/ai-threat-readiness
- S20 Wiz blog, AI Threat Readiness operating model: https://www.wiz.io/blog/wiz-ai-threat-readiness-operating-model
- S21 Wiz integrations page: https://www.wiz.io/fr-fr/integrations
- S22 UK G-Cloud service listing for Wiz (dashboards, API): https://www.applytosupply.digitalmarketplace.service.gov.uk/g-cloud/services/261321224745537
- S23 AWS Marketplace, Wiz platform listing: https://aws.amazon.com/marketplace/pp/prodview-5geds7fc2wk7m
- S24 AWS Marketplace, Wiz Go: https://aws.amazon.com/marketplace/pp/prodview-vbf35nay6mnuy
- S25 Gainsight, "Modernize Health Scores": https://www.gainsight.com/blog/modernize-health-scores-in-order-to-monetize-retention-and-expansion/
- S26 Forrester, customer health scores: https://www.forrester.com/blogs/customer-health-scores
- S27 GitLab handbook, customer health scoring: https://handbook.gitlab.com/handbook/customer-success/customer-health-scoring/
- S28 Gainsight, pooled CSM: https://www.gainsight.com/blog/pooled-customer-success-management-the-waters-fine/
- S29 Scaled (pooled) CS model overview: https://successanywhere.substack.com/p/building-a-scaled-pooled-customer
- S30 Vitally, QBR essentials: https://vitally.io/post/quarterly-business-review-essentials-how-to-conduct-a-qbr
- S31 Sentra, QBR template: https://www.sentra.app/articles/qbr-template
- S32 CyCognito, five cloud security metrics: https://www.cycognito.com/documents/briefs/CyCognito-QuickTake-Five-Security-Metics-That-Matter.pdf
- S33 Tamnoon, CNAPP alert fatigue and MTTR: https://resources.tamnoon.io/blog/cnapp-alert-fatigue-is-killing-your-mttr-here-is-how-to-fix-it
- S34 Tamnoon (quote on ignore rules): https://tamnoon.io/?p=5473
