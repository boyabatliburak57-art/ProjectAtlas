# TASK-011C — Secret Scanning and CI Gate

**Durum:** Hazır  
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
