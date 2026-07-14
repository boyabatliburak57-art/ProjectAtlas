# TASK-009 — BIST Instrument Import Pipeline

**Durum:** Hazır  
**Bağımlılık:** TASK-008

## Amaç

Provider adapter'dan gelen BIST instrument listesini normalize edip veritabanına idempotent şekilde yazan application service ve worker job'ı oluşturmak.

## Kapsam

- symbol normalization
- provider mapping upsert
- instrument create/update
- deactivation preview
- ingestion run kaydı
- dry-run
- metrics/logs
- fake provider integration test

## Kritik kural

Provider listesinde bulunmayan mevcut instrument otomatik olarak silinmez.

Deactivation ayrı onay veya güvenli politika gerektirir.

## Edge case

- sembol değişikliği
- duplicate provider symbol
- eksik şirket adı
- aynı ISIN farklı sembol
- provider geçici eksik liste
- invalid character
- suspended instrument

## Kabul kriterleri

- tekrar çalıştırma duplicate üretmez
- dry-run veritabanını değiştirmez
- mapping doğru oluşur
- şüpheli silme/deactivation raporlanır
- ingestion run sonucu saklanır
- integration test geçer

## T3 Code prompt

```text
TASK-009 görevini uygula.
ARCH-002 ve DB-002 belgelerini oku.
Fake provider kullanarak BIST instrument import application service ve worker job'ı oluştur.
İşlemi idempotent yap.
Provider listesinden kaybolan enstrümanı otomatik silme; yalnızca raporla.
Dry-run ve integration test ekle.
```
