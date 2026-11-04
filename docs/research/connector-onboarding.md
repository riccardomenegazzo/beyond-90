# Research notes: connector onboarding

Notes behind `onboarding.py` and the connector catalogue, in our own words. The sources are listed at the end; nothing is quoted from them.

## What makes onboarding slow

- Onboarding a cloud account is, in practice, three separate agreements: an identity the platform can use (a role, an application, a service account), permissions for it, and a scope (which accounts, regions, projects or subscriptions). Most failures sit at one of these three, and each belongs to a different team: identity, IAM or the cloud platform team.
- Automated, organization-level deployment through infrastructure as code (stack sets, management group role assignments, organization bindings, a chart in the cluster pipeline) is the recommended path in the CSPM literature because it is repeatable and covers new accounts by default. Per-account onboarding drifts.
- Least privilege applies to the connector as much as to people: read-only by default, with any remediation rights separated and opt-in.
- Container and cluster onboarding adds network reachability (private API servers, egress), cluster authorization (RBAC), and admission control: the runtime sensor needs privileges that pod security levels and policy engines are designed to refuse, so an explicit, narrow exception is the honest answer.
- eBPF-based sensors depend on the kernel: recent versions, type information, and capabilities that hardening profiles may drop.

## The connector as an attack surface

Threat modelling each element of the data flow, STRIDE per element, gives the review in `security_review`:

- Spoofing: a long-lived secret can be stolen and replayed; an AWS role trusted without an external ID lets anyone who can make the vendor assume roles reach it (the confused deputy).
- Tampering and elevation of privilege: a connector with write or administrative rights turns a read-only integration into a path to change every account.
- Information disclosure: agentless scanning copies disk snapshots, so key policies and where the copies live matter.
- Denial of service: throttling from scanners that collide with other tools.

## Measuring onboarding

- Treat the connector's history as a log of events (deployed, first scan, last success) and derive the stage from it, rather than storing a status that drifts from the facts.
- Time to connect and time to first scan are the onboarding counterpart of time to value; medians and a high percentile say more than averages.
- A stage that has not moved for a week is the signal to act on, not the stage itself.

## Sources

- Q. Nomani, J. Davila, R. Khan, *Mastering Cloud Security Posture Management (CSPM)*, Packt, 2024: deployment models and methods, onboarding cloud accounts and containers.
- L. Rice, *Container Security*, 2nd ed., O'Reilly, 2025: capabilities, eBPF, isolation.
- A. Martin, M. Hausenblas, *Hacking Kubernetes*, O'Reilly, 2021: RBAC, admission control, pod security, threat-driven defence.
- A. Shostack, *Threat Modeling: Designing for Security*, Wiley: STRIDE and STRIDE per element.
- M. Kleppmann, C. Riccomini, *Designing Data-Intensive Applications*, 2nd ed., O'Reilly, 2026: event logs and derived state.
