# TASK-073 — Deployment, IaC and CI/CD

**Bağımlılık:** TASK-072

## Amaç

Provider-neutral veya seçilmiş platforma açıkça adapte edilmiş staging/production deployment ve CI/CD pipeline oluşturmak.

## Kapsam

- production container images
- pinned base image
- multi-stage build
- non-root runtime
- health checks
- graceful shutdown
- API/worker process roles
- IaC/manifests
- environment config schema
- secret injection interface
- migration job
- immutable image digest
- SBOM
- image scan
- staging deploy
- controlled production workflow
- rollback
- release records

## Kabul

- local/staging manifests validate
- image starts non-root
- startup/readiness/liveness pass
- worker drain/requeue test
- migration dry-run
- artifact digest/SBOM
- secret absent
- rollback rehearsal
- CI protected gates

Gerçek production deploy'i kullanıcı onayı olmadan başlatma.
