# TASK-011C — Secret Scanning and CI Gate

**Durum:** Tamamlandı
**Bağımlılık:** TASK-011B

## Amaç

Repository ve git geçmişi için dedicated secret scanning eklemek ve CI merge kapısı haline getirmek.

## Gereksinimler

- yaygın, sürdürülebilir bir secret scanner seç
- sürümü sabitle
- local script ekle
- GitHub Actions workflow ekle
- pull request ve main push üzerinde çalıştır
- mümkünse git history scan
- scanner unavailable ise fail
- suppression dosyası merkezi ve gerekçeli
- test fixture ile detection doğrula
- gerçek secret fixture commit etme.

## Güvenlik

Test için gerçek credential kullanılmaz.

Synthetic örnek scanner'ın önerdiği güvenli fixture yaklaşımıyla oluşturulur.

## Kabul kriterleri

- local secret scan başarılı
- synthetic secret fixture testte yakalanıyor
- CI workflow syntax geçerli
- workflow scanner'ı pinlenmiş sürümle kullanıyor
- failure merge'i engelliyor
- false positive suppression belgeli
- mevcut repository temiz veya bulgular açıkça remediate edilmiş.

## T3 Code prompt

```text
TASK-011C görevini uygula.

DOC-006 ve DOC-010 belgelerini oku.
Dedicated secret scanner seç, sürümünü sabitle, local komut ve GitHub Actions workflow ekle.
Pull request ve main push üzerinde çalıştır.
Scanner kurulu değilse veya çalışmazsa job fail etsin.
Gerçek secret kullanmadan synthetic detection testi ekle.
Mevcut repository ve mümkünse git geçmişini tara.
Bulguları raporla; secret değerlerini çıktıda gösterme.
```

## Tamamlanma notu

- **Tarih:** 2026-07-12
- **Durum:** Tamamlandı
- **Scanner:** Gitleaks v8.30.1; Darwin/Linux x64/arm64 release checksum'ları sabit.
- **Local:** Çalışma ağacı ve Git geçmişi fail-closed taranır.
- **CI:** Pull request, main push ve workflow dispatch üzerinde full-history scan çalışır.
- **Test:** Gerçek credential içermeyen runtime synthetic finding beklenen exit code ile yakalandı;
  finding içeriği rapora yazılmadı.
- **Suppression:** Merkezi `.gitleaksignore` ve gerekçeli review politikası belgelendi.
- **Sonraki görev:** TASK-011D
