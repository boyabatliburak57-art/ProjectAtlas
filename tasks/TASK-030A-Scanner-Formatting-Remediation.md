# TASK-030A — Scanner Formatting Remediation

**Durum:** Hazır  
**Bağımlılık:** TASK-030 NO-GO raporu

## Amaç

`pnpm format:check` tarafından raporlanan sekiz scanner dosyasındaki format farklarını gidermek.

## Adımlar

1. `pnpm format:check` çalıştır.
2. Başarısız dosyaları tam yollarıyla kaydet.
3. Mevcut formatter sürümü ve config'i doğrula.
4. Yalnız formatter ile düzelt.
5. Semantik değişiklik olmadığını diff ile doğrula.
6. Format ve ilgili scanner testlerini yeniden çalıştır.

## Yasaklar

- Ignore kuralı eklemek
- Format script kapsamını daraltmak
- İş mantığı veya belge anlamı değiştirmek
- CI job'u `continue-on-error` yapmak

## Kabul kriterleri

- `pnpm format:check`: PASS
- `git diff --check`: PASS
- Sekiz dosyanın tamamı düzeltilmiş
- Yeni ignore istisnası yok
- Scanner regresyon testi geçiyor

## T3 Code prompt

```text
TASK-030A görevini uygula.

Scanner Runtime milestone audit raporundaki F-001 bulgusunu oku.

pnpm format:check çalıştır ve başarısız sekiz scanner dosyasını tam yollarıyla listele.
Mevcut formatter config ve sürümünü kullanarak formatla.

Format kapsamını değiştirme.
Ignore kuralı ekleme.
İş mantığı veya belge anlamı değiştirme.

Sonunda:
- pnpm format:check
- git diff --check
- ilgili scanner testleri

komutlarını çalıştır ve sonucu raporla.
```
