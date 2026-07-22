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
2. encrypted backup/PITR status ve ayrı failure domain doğrula
3. son 31 gün içinde geçmiş, cleanup'ı tamamlanmış restore drill ID'sini seç
4. persisted drill RPO <= 15 dakika, RTO <= 120 dakika ve application smoke PASS gate'ini çalıştır
5. migration compatibility
6. controlled rollout
7. readiness and error budget
8. synthetic tests
9. queue/worker validation
10. data freshness
11. feature flag rollout
12. completion record

Restore drill veya backup status geçmezse rollout başlamaz. Runtime database credential'ı restore
credential'ı olarak kullanılamaz. Ayrıntılı prosedür `BACKUP_RESTORE_AND_RETENTION_RUNBOOK.md`
dosyasındadır.

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
