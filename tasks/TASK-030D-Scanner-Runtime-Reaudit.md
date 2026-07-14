# TASK-030D — Scanner Runtime Milestone Re-Audit

**Durum:** Hazır  
**Bağımlılık:** TASK-030A, TASK-030B, TASK-030C

## Amaç

F-001, D-001 ve D-002 kapatıldıktan sonra Scanner Runtime milestone'unu tam kalite kapılarıyla yeniden doğrulamak.

## Zorunlu kontroller

- format check
- ADR validation
- lint
- typecheck
- unit/runtime tests
- PostgreSQL/Redis integration
- Playwright preset/custom
- custom AST round-trip E2E
- performance baseline
- performance thresholds
- duplicate run/result
- retry
- cancellation
- progress
- IDOR
- secret scan
- dependency audit
- production build
- skip/only scan

## Regresyon tabanı

- Runtime testleri: en az 206
- PostgreSQL/Redis integration: en az 24
- Mevcut Playwright hazır/özel tarama: en az 2
- Yeni AST round-trip E2E: ayrıca PASS

Test sayısı düşerse gerekçesiz kabul edilmez.

## Çıktı

`reports/scanner-runtime-milestone-reaudit.md`

## GO koşulları

- failed: 0
- critical deviation: 0
- `pnpm format:check`: PASS
- performance baseline: ESTABLISHED
- mandatory thresholds: PASS
- AST round-trip E2E: PASS
- security not-verifiable: 0
- runtime/integration/E2E regression: 0

## T3 Code prompt

```text
TASK-030D görevini uygula.

İlk Scanner Runtime milestone audit raporunu ve TASK-030A/B/C değişikliklerini incele.

Bütün kalite kapılarını gerçek komutlarla yeniden çalıştır.

Ayrı başlıklarla raporla:
- pnpm format:check
- performance scenario ve threshold sonuçları
- custom scan AST request round-trip E2E
- önceki test sayılarıyla regresyon karşılaştırması

reports/scanner-runtime-milestone-reaudit.md oluştur.

Raporun başında GO veya NO-GO yaz.
GO değilse sonraki pakete geçilmesini önerme.
```
