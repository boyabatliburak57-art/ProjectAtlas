# v0.9 Production Readiness Delta Entegrasyonu

## Kopyalama

```bash
cd ~/Documents/project-atlas
cp -R ~/Downloads/project-atlas-blueprint-v0.9-production-readiness-delta/. .
```

## T3 Code entegrasyon promptu

```text
INTEGRATION_INSTRUCTIONS.md ve v0.9 belgelerini oku.

Mevcut README.md, ATLAS_INDEX.md ve CHANGELOG.md içeriklerini silmeden v0.9 Production Readiness, Security Hardening and Operations bölümünü ekle.

Sabit ADR numarası üretme.
TASK-072 sırasında repository'deki sonraki boş ADR kimliklerini kullan.
Mevcut milestone threshold ve baseline'larını değiştirme.
Gerçek production deploy başlatma; yalnız kullanıcı onaylı workflow/manifests oluştur.

Sonunda:
- pnpm format:check
- pnpm validate:adr
- git diff --check

çalıştır.
```

## ATLAS_INDEX önerisi

```markdown
## v0.9 Production Readiness, Security Hardening and Operations

Belgeler:

- DOC-036–DOC-040
- ARCH-016–ARCH-018
- Production Readiness Decision Proposal
- DB-009
- API-009
- Production Security Test Matrix
- Load/Chaos/Resilience Baseline
- Production Release Runbook

Görev sırası: TASK-071 → TASK-080.

TASK-080 GO olmadan v1.0 release candidate oluşturulmaz.
```
