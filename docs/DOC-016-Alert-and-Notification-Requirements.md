# DOC-016 — Alert and Notification Requirements

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Kullanıcıların BIST sembolleri, kayıtlı taramalar ve teknik koşullar için alarm oluşturmasını; koşul gerçekleştiğinde açıklanabilir ve tekrarsız bildirim almasını sağlar.

## 2. İlk sürüm alarm kaynakları

- Saved scan
- Preset scan
- Tek sembol fiyat seviyesi
- Tek sembol yüzde değişim koşulu
- Tek sembol indikatör koşulu
- Watchlist üzerinde kayıtlı tarama

Broker emri ve otomatik alım/satım kapsam dışıdır.

## 3. Tetikleme politikaları

- `anyMatch`
- `newMatch`
- `symbolEntered`
- `symbolExited`
- `thresholdCrossed`

Threshold alarmı geçiş bazlıdır; koşul sürekli true kaldığında her değerlendirmede bildirim üretmez.

## 4. Tekrar politikaları

- `once`
- `oncePerClosedBar`
- `oncePerDay`
- `afterReset`
- `everyNewMatch`

`afterReset`, koşul notMatched olduktan sonra tekrar matched olduğunda tetiklenir.

## 5. Değerlendirme

- Closed-bar alarmı ilgili bar kapandığında değerlendirilir.
- Intrabar alarmı açıkça seçilmelidir.
- Aynı cutoff ve event tekrar işlendiğinde duplicate trigger oluşmaz.
- `notEvaluable` trigger üretmez; reason saklanır.
- Veri zamanı ve stale durumu kullanıcıya gösterilir.

## 6. Deduplication

Dedup key en az:

```text
alertId + alertRevision + triggerType + instrumentId?
+ timeframe + barOpenTime/evaluationWindow + dataCutoffAt
```

bileşenlerini taşır.

## 7. Revision

Koşul, kanal, timeframe veya tekrar politikası değiştiğinde immutable yeni revision oluşur. Geçmiş trigger eski revision ile ilişkilidir.

## 8. Trigger ve delivery ayrımı

Trigger, alarm koşulunun gerçekleştiğini gösterir. Delivery, bunun belirli bir kanala gönderim denemesidir. Kanal hatası trigger kaydını silmez.

## 9. İlk kanallar

- In-app
- E-mail adapter sözleşmesi ve fake adapter

Web push, webhook ve Telegram sonraki sürümdedir.

## 10. Kullanıcı tercihleri

- e-mail alarm açık/kapalı
- quiet hours
- timezone
- günlük özet
- alarm bazında kanal
- throttle

## 11. Güvenlik

- Ownership backend'de doğrulanır.
- Saved scan kaynağı için scan ownership/revision kontrol edilir.
- Provider ham yanıtı notification içine yazılmaz.
- Dry-run gerçek dış bildirim göndermez.

## 12. Gözlemlenebilirlik

- evaluation count/duration
- trigger count
- dedup count
- notEvaluable
- delivery success/failure
- queue lag
- catch-up
- invalid alert count

## 13. Kabul kriterleri

- Aynı event duplicate trigger üretmez.
- `afterReset` ve `newMatch` testlidir.
- Trigger/delivery ayrıdır.
- In-app notification çalışır.
- Fake e-mail adapter retry testlidir.
- Quiet hours ve timezone testlidir.
- IDOR testleri geçer.
