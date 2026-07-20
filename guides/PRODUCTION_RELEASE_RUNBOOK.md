# Production Release Runbook

## Ön kontrol

- change review
- release notes
- migrations
- feature flags
- backup/PITR status
- security scans
- test/performance
- on-call availability

## Staging

1. immutable image deploy
2. migration dry-run/apply
3. health checks
4. synthetic journeys
5. load smoke
6. observability verification
7. rollback rehearsal, release class'a göre

## Production

1. release record create
2. backup status verify
3. migration compatibility
4. controlled rollout
5. readiness and error budget
6. synthetic tests
7. queue/worker validation
8. data freshness
9. feature flag rollout
10. completion record

## Rollback triggerleri

- critical health failure
- error rate spike
- latency threshold breach
- migration issue
- queue failure
- data correctness/security issue

## Incident

- stop rollout
- enable kill switch
- notify owner
- incident record
- rollback/mitigation
- validate recovery

## Post-release

- 30/60 minute checks
- next-day review
- cleanup old image/flag plan
- follow-up issues
