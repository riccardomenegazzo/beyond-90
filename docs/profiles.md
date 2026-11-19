# Profiles: one engine for any security product

Beyond 90 measures how much of a security product a customer has actually put to work. That question has the same shape for any product that has to be connected to an estate, sees assets, offers capabilities to switch on, and produces findings that someone must act on. The engine therefore knows nothing about any one vendor. What differs between products lives in a **profile**: three small JSON files.

| File | What it says |
|---|---|
| `resource_types.json` | The asset types the product should see, per platform it covers (`expected`), a short description, and the words it uses (`terms`) |
| `modules.json` | The capabilities the product ships, each with the release it appeared in (`since`), the platforms it applies to, and the asset types it needs |
| `playbooks.json` | Optional. Playbooks that override the generic ones by id (title, why, steps, success); anything not overridden is inherited |
| `rubric.json` | Optional. The maturity ladder: checks at bronze, silver and gold. Defaults to the shared one; a profile may replace it (level names are fixed, checks and thresholds are yours) |

## Shipped profiles

```
beyond90 profiles
```

| Profile | For | Unit of coverage | Platforms | Assets (L2) | Capabilities (L3) |
|---|---|---|---|---|---|
| `cnapp` (default) | Cloud security platforms | cloud account, subscription, project | aws, azure, gcp, oci, kubernetes | compute, storage, network, serverless, registries, Kubernetes, databases, identities, AI services | posture, vulnerability scanning, identity analysis, data security, container security, runtime sensor, detection, code scanning, AI posture, attack surface, workflow automation |
| `endpoint` | Endpoint protection (EPP, EDR, XDR) | site, tenant or device group | windows, macos, linux, mobile | workstations, servers, VDI, container hosts, mobile, identity stores | prevention, EDR, ransomware protection, vulnerability assessment, host firewall, device control, identity threat detection, mobile defense, container runtime, managed detection, AI triage, automated response |
| `saas` | SaaS security posture | tenant | microsoft365, google_workspace, crm, collaboration, code_hosting | users, privileged roles, third-party apps, external shares, mailboxes, integration tokens | strong sign-in, role review, app governance, sharing controls, data loss prevention, drift, session anomalies, token hygiene, automated response |
| `ai` | AI security | environment | hosted_models, self_hosted_models, agents, coding_assistants | models, endpoints, agents, tool connections, vector stores, datasets, keys | inventory, guardrails, prompt logging, data leak prevention, tool scoping, key management, model supply chain, adversarial testing |
| `identity` | Identity and access security | directory | directory, identity_provider, privileged_access, cloud_iam | people accounts, service accounts, privileged accounts, groups, applications, vaulted secrets | MFA, single sign-on, vaulting, just-in-time access, access reviews, lifecycle automation, service account governance, identity threat detection, automated response |
| `siem` | Security monitoring (SIEM and SOC) | environment | cloud, on_premises, saas, managed_service | cloud, endpoint, network, identity and application log sources, detection rules | source onboarding, parsing, detection content, enrichment, retention, case management, automated playbooks, source health |
| `hci` | Hyperconverged infrastructure and private cloud | cluster | on_premises, remote_office, hybrid_cloud, edge | hosts, virtual machines, volume groups, file shares, Kubernetes clusters, networks | health monitoring, snapshot schedules, replication and recovery, immutable snapshots, microsegmentation, encryption at rest, lifecycle upgrades, capacity runway, self-service |
| `object-storage` | S3-compatible object storage | tenant | public_region, on_premises_gateway, backup_repository, geo_distributed | buckets, access keys, lifecycle rules, gateways, backup jobs | usage metering, versioning, object lock, replication, data residency, customer-managed keys, scoped keys, access logging, lifecycle tiering, restore testing |
| `dbaas` | Database platform as a service | database environment | on_premises, hybrid_cloud, remote_office | database instances and clusters, clones, backup policies, software profiles | fleet inventory, self-service provisioning, fleet patching, point-in-time recovery, high availability, masked clones, replication, access control, monitoring |
| `file-storage` | Scale-out file storage | file server | on_premises, remote_office, hybrid_cloud | SMB shares, NFS exports, snapshot policies, quotas, home directories | monitoring, scheduled snapshots, self-service restore, ransomware detection, file audit, permission review, quotas, tiering, replication |
| `kubernetes-platform` | Managed Kubernetes platform | cluster | on_premises, hybrid_cloud, edge, public_cloud | node pools, namespaces, workloads, volumes, ingress | fleet management, rolling upgrades, autoscaling, workload backup, admission policy, observability, GitOps, secrets, cost per team |
| `dr-backup` | Disaster recovery and backup | site | primary_site, secondary_site, branch, cloud_site | protected VMs, recovery plans, replication targets, backup jobs, immutable copies | objectives per workload, replication to the recovery point, recovery plans, scheduled test failover, immutable and isolated copies, orchestrated failover, alerts, audit reports |
| `platform-migration` | Moving off a virtualisation platform | site | primary_dc, secondary_dc, branch, cloud | source VMs, application groups, waves, runbooks, target clusters | discovery and owners, dependency mapping, wave planning, test migration, automated cutover, tested rollback, backup and monitoring carried over, the old platform switched off |
| `private-ai` | AI on your own infrastructure | AI cluster | datacenter, edge, sovereign_cloud | GPU nodes, model endpoints, retrieval indexes, agents, usage policies | GPU inventory, approved model catalogue, shared endpoints with quotas, permission-aware retrieval, access control, prompt logging, agent guardrails, usage metering, GPU utilisation |
| `hybrid-cloud` | Hybrid and sovereign cloud | cloud cluster | datacenter, public_cloud, sovereign_cloud, edge | cloud clusters, replication, network links, landing zones, cost policies | one management for data centre and cloud, landing zones, workload mobility, recovery to the cloud, hibernation, data residency, network extension, consistent security, cloud cost |
| `euc` | Virtual desktops and applications | desktop pool | datacenter, branch, public_cloud | desktops, published apps, golden images, profiles, gateways | pool inventory, image management, profiles, experience monitoring, secure access, data kept in the data centre, autoscaling, burst to cloud, app delivery |
| `microsegmentation` | Network microsegmentation | environment | datacenter, cloud, branch | labelled machines, application policies, isolation policies, quarantine policies, traffic views | traffic visibility, labels, environment isolation, policies watched then enforced, quarantine with a forensic option, policies that follow workloads, evidence for auditors, a feed to the security team's tools |
| `cloud-operations` | Cloud operations and self-service | site | datacenter, cloud, branch | capacity plans, anomaly alerts, runbooks, catalog items, cost models, posture baselines | one management plane, capacity forecast with a run-out date, anomaly detection, automated runbooks, self-service catalog with quotas, cost per team, posture checked against a baseline |
| `edge-sites` | Edge and branch sites | site | branch, datacenter, cloud | small clusters at the site, central views, remote upgrades, local copies, copies at the core, edge applications | central management, zero-touch deployment, remote upgrades in waves, local copies restorable without the link, replication to the core, applications and AI at the site |
| `service-provider-cloud` | Multi-tenant cloud for service providers | region | datacenter, cloud | tenants, tenant networks, tenant identity, metering, onboarding flows, service offers | one provider plane, tenant isolation, tenant networks with overlapping addresses, tenant self-service within quotas, automated onboarding, metering to billing, services beyond machines |

Choose one with `--profile endpoint` or put `profile = "endpoint"` under `[customer]` in `customer.toml`; the file wins when no flag is given, and a flag that contradicts the file is refused. Every report and score records which profile and catalogue it used (`beyond90 fingerprint`, and the footer). A portfolio or a book compares like with like, so a folder that mixes profiles is refused: score each profile separately.

Example customers for `saas`, `ai`, `identity`, `siem`, `hci`, `object-storage`, `dbaas`, `file-storage`, `kubernetes-platform`, `dr-backup`, `platform-migration`, `private-ai`, `hybrid-cloud`, `euc`, `microsegmentation`, `cloud-operations`, `edge-sites` and `service-provider-cloud` are in `examples/profiles/<profile>/` (generated by `examples/generate_profile_examples.py`; everything is invented), and the browser app has a button for each under "Other kinds of product".

An example endpoint customer is in `examples/profiles/endpoint/acme-endpoint` (generated by `examples/generate_endpoint_example.py`; everything is invented), and the browser app has a demo button for it.

## What stays the same everywhere

The four stages and every formula in [SPEC.md](../SPEC.md): coverage of the units you know against independent lists (L1), assets seen against assets expected (L2), relevant capabilities switched on against those available at the ceiling (L3), findings with an owner and a decision (L4), the moving bar, the J-curve, the plan, the attribution, the hidden-unit estimate, the trust layer and the confidence checks.

## Words

The engine's code and the CSV names say **account** for the unit of coverage, because that is what a cloud platform connects. A profile can say what its product calls it:

```json
"terms": { "estate": "endpoint", "unit": "site", "units": "sites" }
```

Text the engine writes (action titles, report lines, the QBR) then says "site(s)" and "endpoint assets". The file is still called `accounts.csv`, the column `provider` holds the platform, and the playbook JSON can use the tokens `{unit}`, `{units}`, `{Unit}`, `{Units}` and `{estate}`. A customer's own text (names, ids, owners) is never rewritten. An optional `menu` term gives a shorter word for the side menu when `units` is long, for example `"menu": "Databases"` for database environments.

## Mapping other products (on paper, not built)

These are starting points for a profile of your own, not shipped profiles. They say how each stage maps, so you can judge whether the model fits before writing JSON.

| Product category | Unit you must connect (L1) | Assets to see (L2) | Capabilities to switch on (L3) | Findings that need an owner (L4) |
|---|---|---|---|---|
| Email and collaboration security | Domains and mailboxes protected | Mailbox types, shared mailboxes, SaaS collaboration spaces | Impersonation protection, URL rewriting, post-delivery remediation, user reporting | Reported phish and policy exceptions |
| Vulnerability and exposure management | Scan targets, networks, cloud accounts | Asset classes with credentialed scans, agents, authenticated scans | Prioritisation, remediation workflows, ticketing, SLA tracking | Vulnerabilities past SLA |
| Network and SASE | Sites, tunnels and users connected | Traffic classes inspected, apps discovered | TLS inspection, DLP, CASB, ZTNA, sandboxing | Policy violations and blocked-risk reviews |
| Application security | Repositories, pipelines, applications onboarded | Languages, dependencies, images, APIs | SAST, SCA, secrets scanning, IaC scanning, PR gating | Findings past SLA without an owner |

The fit is best where the product has a coverage question (what is connected), a visibility question (what does it see), a capability question (what is on) and a work-queue question (who owns the findings). Where one of them does not exist, the stage reports "not measured" instead of inventing a number.

## Writing your own

1. Copy a shipped profile directory to start from: `src/beyond90/data/` (the `cnapp` files) or `src/beyond90/data/profiles/endpoint/`.
2. Edit `resource_types.json`: your platforms and the asset types each should have, plus `terms`.
3. Edit `modules.json`: one entry per capability, with the release it first shipped in. Keep `since` honest: it is what makes the bar move and what lets the report say "the customer improved, the bar moved too". Give each capability a `use_case` (the outcome the customer buys it for; labels go in the top-level `use_cases` map) and a `csf` list (the NIST CSF 2.0 functions it serves: identify, protect, detect, respond, recover). A test requires both.
4. Override only the playbooks whose wording would be wrong for your product.
5. Run with `--catalogue-dir path/to/your/profile`, check it with `beyond90 catalogue --catalogue-dir ...`, and read `tests/test_profiles.py` for the consistency rules a profile must satisfy.

## Collection

For any product, describe the API or export in `beyond90.toml` (see [automation.md](automation.md)): no code, only a mapping from the product's fields to the columns above.

## Importers

`import aws-org`, `azure` and `gcp` read cloud exports. For any other product use `import csv` with the export your product gives you (a list of tenants, sites or organizations with an id column), and the reconcile command to see how your independent lists overlap.

## Suggested proof of value criteria

A profile may ship `story.json`: how that kind of product is told and challenged.

```json
{
  "audiences": {"executive": "...", "technical": "...", "financial": "..."},
  "people": ["The roles to have in the room"],
  "objections": [{"says": "What the customer says", "clarify": "The question to ask before answering?", "answer": "...", "prove": "How a test would settle it"}]
}
```

Each sentence is at most 240 characters, a proof at most 200 (it becomes a success criterion); at most 6 roles and 8 objections. The discovery workshop shows them under Prepare. Shipped for every infrastructure line; never inherited, and never naming a vendor or a product (a test checks the infrastructure profiles for vendor and product names).

A profile may ship `pov.json`: `{"criteria": [{"text": "...", "how": "..."}]}`, up to 200 characters each. They are tests a sponsor can sign off for that kind of product (for object storage: an object under lock cannot be deleted even by an administrator). The Proof of value view lists the ones not yet in the plan, each with an Add button. A profile does not inherit the base profile's criteria, because another kind of product proves other things. Shipped for `cnapp`, `hci`, `object-storage`, `dbaas`, `file-storage`, `kubernetes-platform`, `dr-backup`, `platform-migration`, `private-ai`, `hybrid-cloud`, `euc` and `microsegmentation`. A profile's `pov.json` may also carry `"readiness": ["..."]`, the checks to settle before the first day of the test (for hyperconverged infrastructure: the addresses per server, DNS and NTP, switch ports, supported hardware); a proof of value started from a workshop lists them first.

## Discovery questions

A profile may ship `discovery.json`: `{"questions": [{"stage": "value|L1|L2|L3|L4", "q": "...?", "why": "...", "need": "...", "how": "..."}]}`. `need` is the condition the question tests, written as something that would be true ("No administrator account can delete the backups"), and `how` the first step towards it; the [discovery workshop](workshop.md) turns them into the journey. Prep a call and `beyond90 discovery` list the questions business value first, then from the customer's weakest stage to the strongest. Not inherited from the base profile. Shipped for every profile.

A question can also say how to ask it: `"role"` (who to ask: `executive`, `architect`, `operations`, `security`, `application`, `data` or `finance`), `"core": true` for the few not to leave a first meeting without, `"listen"` (up to 240 characters: what a strong or a worrying answer sounds like) and `"probe"` (up to 220, a question: the follow-up that goes one level deeper). The workshop narrows its questions by them and the question guide carries them. Every infrastructure question carries all four; anything else is refused when the profile loads. `beyond90 discovery DIR --essential` lists only the essential questions, `--role security` (repeatable) only those for a role, and each question prints who to ask, what to listen for and what to ask next. The account view's "Questions to ask" and the MCP tool `discovery_questions` carry the same. Questions are kept by their position, so new ones go at the end; the workshop shows them in the order of a conversation.

## What else they weigh

`src/beyond90/data/alternatives.json` holds the alternatives a deal is measured against:
- keyed by a family of lines (2 to 8, weighed whatever the line);
- or by a line (1 to 4, particular to it).

Each alternative has:
- an `id`, unique across the file;
- a `name`;
- `why` customers consider it;
- one to three questions to `ask`;
- when the proposal fits (`fits_us`);
- when the other choice is the better one (`fits_them`);
- how to `prove` it.

The file is checked when it is read, and a test keeps vendor names out. They are written to be fair: every alternative says when it wins.
