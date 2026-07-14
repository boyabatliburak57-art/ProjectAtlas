# Project Atlas v0.4.2 — Scanner Runtime Milestone Remediation Plan

**Durum:** Zorunlu  
**Kaynak:** Scanner Runtime milestone audit  
**Karar:** NO-GO  
**Geçiş hedefi:** TASK-030 re-audit öncesi F-001, D-001 ve D-002 bulgularını kapatmak

## 1. Doğrulanan başarılı alanlar

Milestone audit aşağıdaki alanları doğrulamıştır:

- Runtime testleri: 206/206
- PostgreSQL/Redis integration: 24/24
- Playwright hazır/özel tarama: 2/2
- IDOR kapıları
- Duplicate run/result koruması
- Retry
- Cancellation
- Progress
- Secret scan
- Dependency audit
- Lint
- Typecheck
- Production build

Bu başarılı alanlar korunmalıdır. Remediation çalışması bu davranışları bozacak geniş refactor içermemelidir.

## 2. Açık bulgular

### F-001 — Scanner formatting

`pnpm format:check`, sekiz scanner dosyasında başarısızdır.

- Formatter kapsamı daraltılmaz.
- Dosyalar ignore listesine eklenmez.
- İçerik anlamı değiştirilmez.
- Format farkları açık diff ile doğrulanır.

### D-001 — Performance baseline eksikliği

Scanner Runtime için ölçülebilir performans baseline'ı ve kabul eşiği bulunmamaktadır.

Ölçülecek temel senaryolar:

- küçük senkron tarama,
- yaklaşık tam BIST evreni,
- orta karmaşıklık,
- result pagination,
- progress polling,
- idempotent replay.

### D-002 — Custom scan AST round-trip eksikliği

Mevcut Playwright custom scan testi, UI'dan üretilen AST'nin gerçek HTTP request payload'ına doğru yazıldığını ve backend normalization sonrasında semantiğini koruduğunu doğrulamamaktadır.

## 3. Uygulama sırası

1. `TASK-030A-Scanner-Formatting-Remediation.md`
2. `TASK-030B-Scanner-Performance-Baseline.md`
3. `TASK-030C-Custom-Scan-AST-Roundtrip-E2E.md`
4. `TASK-030D-Scanner-Runtime-Reaudit.md`

## 4. Geçiş koşulu

```text
Decision: GO
Failed: 0
Critical deviations: 0
pnpm format:check: PASS
Performance baseline: ESTABLISHED
Performance thresholds: PASS
Custom scan AST round-trip E2E: PASS
```

## 5. Yasak yöntemler

- Format kapsamını daraltmak
- Scanner dosyalarını formatter ignore listesine eklemek
- Performans testini mock/no-op runtime üzerinde çalıştırmak
- Gerçek PostgreSQL/Redis/worker yolunu atlamak
- E2E testte API validation'ı bypass etmek
- Threshold'ları yalnız testi geçirmek için yükseltmek
