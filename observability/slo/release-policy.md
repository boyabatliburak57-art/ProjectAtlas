# Error Budget and Release Policy

Policy version: `slo-v1`.

- Remaining budget above 50% and no fast-burn alert: normal controlled rollout.
- Remaining budget 25–50%: reliability review and reduced blast radius.
- Remaining budget below 25% or warning burn: reliability-only changes unless an audited exception is approved.
- Exhausted budget, critical fast burn, data correctness or security alert: release freeze, incident record and rollback/mitigation review.
- Planned maintenance is excluded only when pre-announced and audit-labelled.
- Sampling never changes SLI counters. Existing milestone performance thresholds remain release gates and cannot be relaxed by this policy.
