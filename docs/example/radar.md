# Radar

## Threats: who is exposed and uncovered

### MOCK-2026-002: Public object storage holding sensitive data (mock)

Severity critical, published 2026-10-30 (1 days ago). Affects storage_object; mitigated by data_security, posture. Source: mock feed.

| Customer | ARR | Exposed accounts | Covered | Uncovered | Unknown | Yield if mitigated |
|---|---|---|---|---|---|---|
| Contoso Bank (mock) | 1,250,000 | 215 | 215 | 0 | 0 | +0.0 pts |
| Northwind (mock) | 480,000 | 108 | 108 | 0 | 1 | +0.0 pts |
| Fabrikam Labs (mock) | 96,000 | 22 | 22 | 0 | 0 | +0.0 pts |

Unknown means the affected resource type was never inventoried on that account: the exposure cannot be ruled out. Fix the inventory gap first.

### MOCK-2026-001: Registry credentials exposed in CI logs (mock)

Severity high, published 2026-10-27 (4 days ago). Affects container_registry, kubernetes; mitigated by container_security, runtime_sensor. Source: mock feed.

| Customer | ARR | Exposed accounts | Covered | Uncovered | Unknown | Yield if mitigated |
|---|---|---|---|---|---|---|
| Fabrikam Labs (mock) | 96,000 | 22 | 19 | 3 | 0 | +0.8 pts |
| Northwind (mock) | 480,000 | 109 | 108 | 1 | 0 | +0.1 pts |
| Contoso Bank (mock) | 1,250,000 | 215 | 215 | 0 | 0 | +0.0 pts |

Unknown means the affected resource type was never inventoried on that account: the exposure cannot be ruled out. Fix the inventory gap first.

Start with Fabrikam Labs (mock): enable container_security on aws-010, aws-013, aws-014.

### MOCK-2026-003: Over-privileged workload identities (mock)

Severity medium, published 2026-09-14 (47 days ago). Affects identity; mitigated by identity_analysis. Source: mock feed.

| Customer | ARR | Exposed accounts | Covered | Uncovered | Unknown | Yield if mitigated |
|---|---|---|---|---|---|---|
| Fabrikam Labs (mock) | 96,000 | 22 | 18 | 4 | 0 | +1.0 pts |
| Northwind (mock) | 480,000 | 108 | 106 | 2 | 1 | +0.1 pts |
| Contoso Bank (mock) | 1,250,000 | 215 | 215 | 0 | 0 | +0.0 pts |

Unknown means the affected resource type was never inventoried on that account: the exposure cannot be ruled out. Fix the inventory gap first.

Start with Fabrikam Labs (mock): enable identity_analysis on aws-010, gcp-004, gcp-005, gcp-006.

