# TASK-011B — ADR Identifier Remediation

**Durum:** Hazır  
**Bağımlılık:** TASK-011A

## Amaç

Aynı `ADR-004` kimliğini kullanan kabul edilmiş belgeleri benzersiz hale getirmek ve kalıcı ADR doğrulaması eklemek.

## Kapsam

- tüm ADR dosyalarını tarama
- duplicate kimliği belirleme
- daha sonra eklenen belgeyi bir sonraki boş kimliğe taşıma
- dosya adı ve başlık güncelleme
- tüm repository referanslarını güncelleme
- `architecture/ADR_INDEX.md` güncelleme
- duplicate validation script
- CI veya root validation komutuna bağlama
- test.

## Kritik kural

ADR içeriği veya karar anlamı değiştirilmez.

## Kabul kriterleri

- tüm ADR kimlikleri benzersiz
- dosya adı ve H1 kimliği uyumlu
- tüm doküman referansları güncel
- ADR index güncel
- duplicate checker başarısız örnek fixture'da hata veriyor
- mevcut repository'de doğrulama başarılı.

## T3 Code prompt

```text
TASK-011B görevini uygula.

Repository'deki tüm ADR dosyalarını ve referanslarını incele.
İki ADR-004 çakışmasını içerik kaybetmeden düzelt.
Daha sonra oluşturulan veya index dışı kalan belgeyi bir sonraki boş kimliğe taşı.
Dosya adını, H1 başlığını, ATLAS_INDEX ve tüm referansları güncelle.
Duplicate ADR identifier kontrol script'i ekle ve test et.
Karar metinlerinin anlamını değiştirme.
```
