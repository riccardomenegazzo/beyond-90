# Portfolio

ARR-weighted Yield: **83.3%** across 3 customer(s).

| Customer | ARR | Yield | Legacy | L1 | L2 | L3 | L4 | Change | Top action |
|---|---|---|---|---|---|---|---|---|---|
| Contoso Bank (mock) | 1,250,000 | 91.0% | 98.6% | 97.7% | 99.7% | 96.6% | 96.7% | - | Adopt Workflow and remediation automation on 35 account(s) |
| Northwind (mock) | 480,000 | 72.6% | 92.0% | 90.1% | 97.3% | 92.7% | 89.4% | - | Give unowned findings an owner and a decision (13) |
| Fabrikam Labs (mock) | 96,000 | 37.7% | 90.0% | 81.5% | 94.1% | 64.9% | 75.7% | - | Give unowned findings an owner and a decision (11) |

## Patterns across customers (one-to-many candidates)

| Pattern | Leak | Customers | Who |
|---|---|---|---|
| l1_auto_onboarding | L1 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l1_connect_account | L1 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l2_enable_inventory:aws:container_registry | L2 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l2_enable_inventory:gcp:container_registry | L2 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_enable_module:ai_posture | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_enable_module:code_scanning | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_enable_module:container_security | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_enable_module:data_security | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_enable_module:runtime_sensor | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_new_release_adoption:attack_surface | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l3_new_release_adoption:workflow_automation | L3 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l4_assign_owners:unowned | L4 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l4_record_decisions:no_decision | L4 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| l4_review_accepted_risks:expired_acceptance | L4 | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| reach_access_review:stale_access_review | Reach | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| reach_onboard_team:no_active_user | Reach | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| reach_scope_roles:no_scoped_role | Reach | 3 | Contoso Bank (mock), Fabrikam Labs (mock), Northwind (mock) |
| ent_adoption_gap:code_seats | Entitlement | 2 | Fabrikam Labs (mock), Northwind (mock) |
| ent_adoption_gap:defend_gb | Entitlement | 2 | Fabrikam Labs (mock), Northwind (mock) |
| ent_adoption_gap:sensors | Entitlement | 2 | Fabrikam Labs (mock), Northwind (mock) |
| l2_enable_inventory:azure:container_registry | L2 | 2 | Contoso Bank (mock), Northwind (mock) |
| l3_enable_module:identity_analysis | L3 | 2 | Fabrikam Labs (mock), Northwind (mock) |
| l4_review_accepted_risks:accepted_without_expiry | L4 | 2 | Contoso Bank (mock), Northwind (mock) |
| reach_enable_sso:no_sso | Reach | 2 | Fabrikam Labs (mock), Northwind (mock) |
