# ADR-017 — Point-in-Time Data ve Survivorship-Bias Politikası

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Bugünkü enstrüman, endeks üyeliği veya finansal tablo görünümünü geçmiş bir tarihe uygulamak,
geçmişte bilinmeyen bilgiyi backtest'e taşır. Özellikle yalnız bugün aktif hisselerden oluşturulan
bir tarihsel evren; delist edilmiş, işlem durumu değişmiş veya geçmişte endekste bulunmuş sembolleri
dışlayarak survivorship bias üretir.

Finansal tablolarda fiscal period end tarihi verinin piyasaya açık olduğu tarih değildir. Sonraki
restatement revision'ını ilk publication date öncesindeki sinyale vermek de look-ahead bias
oluşturur. Corporate action ve düzeltilmiş fiyat revision'ları benzer biçimde etkinlik ve erişim
zamanı gerektirir.

## Karar

Backtest engine bütün veri seçimlerini event zamanı için point-in-time olarak yapar. Historical
universe en az listing, delisting, trading status, index/watchlist membership effective interval ve
universe policy version üzerinden çözülür. **Bugünkü aktif hisseler geçmiş evrene uygulanamaz.**

Finansal veri yalnız şu koşullar birlikte sağlandığında kullanılabilir:

```text
publicationDate <= eventTime
revisionAvailableAt <= eventTime
```

Fiscal period, publication date, provider revision ve revision availability ayrı metadata olarak
korunur. Sonradan yayımlanan restatement önceki event zamanlarında görünmez; mevcut revision
overwrite edilmez. Corporate action verisi effective/ex/payment tarihleri ve source revision
availability ile seçilir. Fiyat/bar düzeltmeleri adjustment mode, source revision ve data cutoff ile
snapshot'lanır.

Run identity ve audit metadata'sı en az universe version, membership snapshot hash, market data
snapshot/cutoff, financial revision set, corporate action policy/revision ve missing-data policy
taşır. Point-in-time kapsam bulunamadığında sistem güncel veriye sessizce düşmez; ilgili input'u
excluded, partial veya notEvaluable yapar ve coverage warning üretir. Missing finansal veya piyasa
verisi sıfır kabul edilmez.

Provider ham verisi normalize adapter sınırından geçer; domain ve araştırma sonuçları provider raw
payload'una doğrudan bağlanmaz.

## Gerekçe

- Effective-date universe çözümü survivorship bias'ı ölçülebilir ve test edilebilir hale getirir.
- Publication ve revision availability gelecekte açıklanan finansal bilginin geçmişe sızmasını
  engeller.
- Versioned snapshot/hash aynı çalışmanın hangi tarihsel veri görünümüyle üretildiğini kanıtlar.
- Missing coverage'ı görünür tutmak iyimser ve açıklanamayan sonuçları önler.

## Sonuçlar

### Olumlu

- Delist edilmiş ve üyeliği değişmiş enstrümanlar doğru tarih aralığında evrene dahil edilir.
- Restatement ve corporate action revision geçmişi yeniden üretilebilir kalır.
- Look-ahead ve survivorship riskleri quality metadata ve fixture'larla doğrulanabilir.
- Aynı point-in-time snapshot aynı input setini üretir.

### Olumsuz

- Tarihsel membership, publication ve revision metadata'sının saklanması veri hacmini artırır.
- Provider coverage eksikleri daha fazla partial/notEvaluable çalışma üretebilir.
- Snapshot reconciliation ve revision invalidation operasyonel maliyet getirir.
- Eski dönemlerde tam point-in-time kapsam sağlamak tüm semboller için mümkün olmayabilir.

## Değerlendirilen alternatifler

Bugünkü aktif evreni geçmişe uygulama, yalnız fiscal period end ile finansal veri seçme ve her zaman
latest restatement kullanma değerlendirilmiştir. Üç yaklaşım da geçmişte erişilemeyen bilgiyi
backtest'e taşıdığı ve sonucu iyimserleştirdiği için reddedilmiştir.
