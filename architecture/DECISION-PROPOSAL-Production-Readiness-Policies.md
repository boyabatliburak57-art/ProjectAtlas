# Decision Proposal — Production Readiness Policies

Bu belge henüz ADR değildir.

TASK-072 sırasında repository'deki sonraki boş ve benzersiz ADR kimlikleri kullanılarak ayrı kararlar oluşturulmalıdır.

## Öneri 1 — Deployment

Provider-neutral container deployment ve managed PostgreSQL/Redis/object storage yaklaşımı.

Kesin platform repository ve kullanıcı altyapısına göre seçilir.

## Öneri 2 — Release

Immutable image digest, migration compatibility ve controlled rollout.

## Öneri 3 — SLO

Başlangıç API availability hedefi rolling 30 gün için 99.9%; mevcut feature performance threshold'ları alt SLI olarak korunur.

## Öneri 4 — Backup

PITR ile RPO ≤ 15 dakika, RTO ≤ 2 saat hedefi; düzenli restore rehearsal zorunlu.

## Öneri 5 — Feature flags

PostgreSQL authoritative, cached deterministic evaluation ve audited admin changes.

## Öneri 6 — Operational safety

Kill switch, queue pause/resume ve release rollback işlemleri admin scope ve audit gerektirir.
