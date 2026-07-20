# DOC-039 — Backup, Disaster Recovery and Retention

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Veritabanı, object/file artifacts, configuration ve kritik operasyon verilerinin kaybına karşı doğrulanmış recovery sağlar.

## 2. Veri sınıfları

- PostgreSQL transactional data,
- Redis ephemeral data,
- exports/import artifacts,
- reports/series artifacts,
- deployment configuration,
- audit/release records.

Redis tek doğruluk kaynağı değildir ve restore zorunluluğu farklı olabilir.

## 3. Başlangıç hedefleri

Önerilen production hedefleri:

```text
RPO ≤ 15 dakika
RTO ≤ 2 saat
```

Gerçek altyapı kapasitesine göre ADR ile kesinleştirilir.

## 4. PostgreSQL backup

- encrypted automated backup,
- point-in-time recovery,
- retention policy,
- separate failure domain,
- backup monitoring,
- restore credentials separation.

## 5. Restore test

Backup başarısı yalnız job status ile kanıtlanmaz.

Düzenli restore testi:

- isolated environment,
- integrity queries,
- row counts,
- key business invariants,
- migration/version compatibility,
- application smoke

içerir.

## 6. Object/artifact backup

Export veya büyük backtest series object storage'da ise:

- versioning,
- lifecycle,
- encryption,
- checksum,
- restore test,
- orphan cleanup

uygulanır.

## 7. Disaster scenarios

- accidental delete,
- bad migration,
- database corruption,
- region/zone outage,
- Redis loss,
- queue loss,
- secret compromise,
- object storage deletion,
- application release failure.

## 8. Restore order

Önerilen:

1. secrets/config,
2. PostgreSQL,
3. application compatible version,
4. workers,
5. object artifacts,
6. reconciliation jobs,
7. cache rebuild,
8. synthetic validation.

## 9. Data retention

Plan ve veri türüne göre:

- audit logs,
- notifications,
- scan/backtest detailed results,
- exports/import files,
- incident records,
- deleted user data

retention policy taşır.

Retention job:

- idempotent,
- legal/security hold aware,
- auditli,
- batch-limited

olmalıdır.

## 10. User deletion

Hesap silme:

- soft-disable,
- grace period,
- async purge,
- related private resources,
- export artifacts,
- audit-safe tombstone

policy'si taşır.

## 11. Kabul kriterleri

- PITR veya eşdeğer backup yapılandırılır.
- Restore rehearsal geçer.
- RPO/RTO ölçülür.
- Redis loss sonrası reconciliation geçer.
- Retention ve deletion testlidir.
- Backup secret/log güvenliği doğrulanır.
