# TASK-021A — ADR-006 Collision Remediation

**Durum:** Hazır  
**Bağımlılık:** TASK-021 NO-GO raporu

## Amaç

İki kabul edilmiş belgenin kullandığı `ADR-006` çakışmasını içerik kaybetmeden gidermek.

## Uygulama

1. Bütün `ADR-*.md` dosyalarını tara.
2. Dosya adı, H1 ve `ADR_INDEX.md` kayıtlarını karşılaştır.
3. Daha sonra oluşturulan veya index dışında kalan belgeyi sonraki boş ADR kimliğine taşı.
4. Dosya adını, H1'i, `ADR_INDEX.md`, `ATLAS_INDEX.md`, `CHANGELOG.md` ve bütün referansları güncelle.
5. Validation script'ini çalıştır.

## Kurallar

- ADR silinmez.
- Karar anlamı değiştirilmez.
- Duplicate kimlik allowlist'e alınmaz.
- Validation script gevşetilmez.

## Kabul kriterleri

- `pnpm validate:adr` başarılı.
- Bütün ADR kimlikleri benzersiz.
- Dosya adı, H1 ve index uyumlu.
- Eski referanslar doğru belgeye yöneliyor.

## T3 Code prompt

```text
TASK-021A görevini uygula.

Milestone audit raporunu, architecture/ADR_INDEX.md ve DOC-014 belgesini oku.
Repository'deki bütün ADR belgelerini ve çapraz referanslarını tara.
İki ADR-006 çakışmasında daha sonra oluşturulan veya resmi index dışında kalan belgeyi sonraki boş ADR kimliğine taşı.
Dosya adını, H1 başlığını, ADR_INDEX.md, ATLAS_INDEX.md, CHANGELOG.md ve tüm referansları atomik güncelle.
ADR içeriğini silme veya anlamını değiştirme.
Sonunda pnpm validate:adr çalıştır ve sonucu raporla.
```
