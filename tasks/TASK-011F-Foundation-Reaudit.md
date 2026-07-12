# TASK-011F — Foundation Re-Audit Gate

**Durum:** Tamamlandı
**Bağımlılık:** TASK-011A–TASK-011E

## Amaç

Foundation milestone audit'i tüm remediation görevlerinden sonra yeniden çalıştırmak ve TASK-012 için GO/NO-GO kararı vermek.

## Zorunlu komutlar

- tool/version report
- format check
- lint without cache
- typecheck without cache
- unit tests
- API tests
- database integration
- worker integration
- build without cache
- OpenAPI validation
- Docker health
- HTTP smoke
- secret scan
- dependency audit
- ADR identifier validation
- skip/only scan
- worker queue composition integration.

## Çıktı

`reports/foundation-milestone-reaudit.md`

## GO koşulları

Aşağıdakilerin tamamı sağlanır:

- failed: 0
- kritik deviation: 0
- security not-verifiable: 0
- format başarılı
- Node hedef sürüm
- secret scan başarılı
- ADR validation başarılı
- worker market-data wiring doğrulanmış
- lint/typecheck/test/build başarılı.

## T3 Code prompt

```text
TASK-011F görevini uygula.

İlk foundation milestone audit raporunu ve TASK-011A–TASK-011E değişikliklerini incele.
Tüm kalite kapılarını Node 22.14.0 ortamında cache dışı doğrula.
reports/foundation-milestone-reaudit.md oluştur.
Sonucu GO veya NO-GO olarak açıkça yaz.
Her bulgu için komut, sonuç ve kanıt dosyasını belirt.
GO değilse TASK-012'ye geçilmesini önerme.
```
