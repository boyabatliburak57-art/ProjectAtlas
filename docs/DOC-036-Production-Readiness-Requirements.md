# DOC-036 — Production Readiness Requirements

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Project Atlas'ın staging ve production ortamlarına tekrarlanabilir, geri alınabilir ve doğrulanabilir şekilde dağıtılmasını sağlar.

## 2. Ortamlar

En az:

- local
- test/CI
- staging
- production

Ortamlar arasında:

- aynı container image,
- farklı configuration/secrets,
- versioned migration,
- açık feature flag,
- ayrı veri kaynakları

kullanılmalıdır.

## 3. Artifact bütünlüğü

Her release:

- immutable image tag veya digest,
- source commit SHA,
- build timestamp,
- dependency lockfile,
- SBOM,
- migration set,
- configuration schema version

taşır.

`latest` etiketi tek production referansı olamaz.

## 4. Deployment stratejisi

İlk production stratejisi aşağıdakilerden biri olarak ADR ile sabitlenir:

- rolling deployment,
- blue/green,
- canary.

Minimum gereksinimler:

- readiness/liveness/startup checks,
- zero veya kontrollü downtime,
- graceful shutdown,
- in-flight request drain,
- worker job drain veya safe requeue,
- rollback.

## 5. Database migration

Migration akışı:

1. backup/PITR doğrulaması,
2. compatibility kontrolü,
3. expand phase,
4. application deploy,
5. contract phase, ayrı release olabilir.

Destructive migration aynı release içinde güvenli compatibility kanıtı olmadan uygulanmaz.

Migration:

- lock timeout,
- statement timeout,
- expected duration,
- rollback/forward-fix plan,
- large table strategy

taşır.

## 6. Configuration

- schema-validated environment variables,
- startup fail-fast,
- secret ve non-secret ayrımı,
- default güvenli değerler,
- production debug kapalı,
- configuration drift kontrolü.

## 7. Health endpointleri

- `/health/live`
- `/health/ready`
- `/health/startup`, gerekiyorsa
- `/health/dependencies`, yalnız güvenli/internal kullanım

Health response:

- secret,
- connection string,
- stack trace,
- provider payload

içermez.

Readiness yalnız process'in ayakta olduğunu değil, trafik kabul edebildiğini gösterir.

## 8. Worker lifecycle

Worker deployment:

- graceful shutdown,
- queue pause/drain,
- active job timeout,
- idempotent retry,
- stalled job recovery,
- version compatibility

doğrular.

Eski worker ile yeni job payload uyumsuzluğu versioned job contract ile önlenir.

## 9. Release gates

Production release öncesi:

- full test suite,
- migration dry-run,
- OpenAPI validation,
- secret scan,
- dependency audit,
- container scan,
- SBOM,
- backup restore test,
- load/soak,
- security test,
- rollback rehearsal,
- SLO dashboard ve alert doğrulaması

zorunludur.

## 10. Rollback

Rollback planı:

- application image,
- worker image,
- migration compatibility,
- feature flag,
- data repair,
- cache invalidation

adımlarını içerir.

Destructive migration sonrası yalnız image rollback'in yeterli olduğu varsayılmaz.

## 11. Release kaydı

Her release:

- version,
- commit,
- image digest,
- migrations,
- feature flags,
- operator,
- started/completed time,
- status,
- rollback reason,
- validation summary

taşır.

## 12. Kabul kriterleri

- Staging deployment tekrarlanabilir.
- Production manifest/config provider-neutral veya açıkça belgelenmiş.
- Rollback rehearsal geçer.
- Migration dry-run geçer.
- Worker graceful shutdown testlidir.
- Health endpointleri doğru ve güvenlidir.
- Artifact/SBOM/image scan üretilir.
