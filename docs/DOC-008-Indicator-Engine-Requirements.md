# DOC-008 — Indicator Engine Requirements

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Indicator Engine, normalize edilmiş OHLCV serilerinden deterministik, test edilebilir ve yeniden üretilebilir teknik indikatör sonuçları üretir. Motor; formüllerin yanında parametre doğrulama, warm-up, eksik veri, açık/kapalı bar, sonuç meta verisi, sürümleme, batch çalışma ve cache kurallarını standartlaştırır.

## 2. İlk çekirdek indikatör seti

### Fiyat ve ortalamalar

- SMA
- EMA
- WMA
- ROC
- Momentum

### Momentum

- RSI
- Stochastic
- Stochastic RSI
- CCI
- Williams %R

### Trend ve volatilite

- MACD
- ATR
- ADX
- DMI
- Supertrend
- Parabolic SAR
- Bollinger Bands
- Donchian Channel
- Keltner Channel

### Hacim

- OBV
- CMF
- MFI
- Volume SMA
- Relative Volume

VWAP, Ichimoku, HMA ve ileri göstergeler sonraki sürümlere bırakılabilir.

## 3. Zorunlu ilkeler

- Aynı veri, parametre, indikatör sürümü ve hesap politikası aynı sonucu üretmelidir.
- Hesaplama fonksiyonları veritabanı, Redis, HTTP veya kullanıcı oturumuna bağlı olmamalıdır.
- Eksik veri sessizce sıfıra çevrilmemelidir.
- Public çıktıda `NaN` veya `Infinity` bulunmamalıdır.
- Aynı isimli formül davranışı değişirse indikatör sürümü artırılmalıdır.
- Açık barla hesaplanan değerler kapalı bar değerlerinden ayırt edilmelidir.

## 4. Girdi sözleşmesi

```typescript
interface PriceSeries {
  instrumentId: string;
  timeframe: Timeframe;
  bars: readonly PriceBar[];
  adjustmentMode: AdjustmentMode;
  dataCutoffAt: Date;
}
```

Bar sırası eski tarihten yeni tarihe olmalıdır. Motor sırasız zaman damgalarını, duplicate barları ve uyumsuz dizi uzunluklarını reddeder.

## 5. Definition sözleşmesi

Her indikatör aşağıdaki bilgileri sunar:

- code
- version
- display name
- category
- required input fields
- parameter schema
- output schema
- warm-up calculator
- calculate function
- documentation reference

## 6. Çıktı türleri

### Scalar series

```typescript
type ScalarSeries = readonly (number | null)[];
```

### Multi-output series

```typescript
interface MultiSeriesResult {
  outputs: Record<string, readonly (number | null)[]>;
}
```

Çıktı dizileri input ile aynı uzunlukta olur; warm-up bölgesi `null` ile temsil edilir.

## 7. Warm-up

Her definition:

- minimum input bar sayısını,
- önerilen warm-up sayısını,
- ilk geçerli output indexini

bildirmelidir. Seed yöntemi formülün parçası kabul edilir ve sürümlenir.

## 8. Parametre doğrulama

Örnek:

```json
{
  "period": {
    "type": "integer",
    "minimum": 2,
    "maximum": 500,
    "default": 14
  }
}
```

Geçersiz parametre hesaplamaya ulaşmaz.

## 9. Sayısal doğruluk

- Database `numeric` değerleri kontrollü biçimde hesaplama tipine çevrilir.
- Test toleransı indikatör bazında açıkça tanımlanır.
- Sıfıra bölme kontrollü ele alınır.
- Farklı seed veya smoothing yaklaşımı yeni version gerektirir.
- Sabit seri ve sıfır hacim edge case olarak test edilir.

## 10. Registry ve katalog

Indicator Registry:

- desteklenen definition'ları listeler,
- code/version çözer,
- duplicate kayıtları engeller,
- UI ve Scanner için katalog meta verisi üretir.

Runtime plugin yükleme ilk sürüm kapsamı değildir. Yeni indikatör codebase'e açık bir modül olarak eklenir.

## 11. Batch execution

Batch executor:

1. Talepleri normalize eder.
2. Aynı code/version/params talebini tekilleştirir.
3. Warm-up ihtiyacını hesaplar.
4. Cache kontrolü yapar.
5. Sonuçları request bazında döndürür.

Tek indikatör hatası diğer batch sonuçlarını zorunlu olarak düşürmez.

## 12. Cache anahtarı

En az şu bileşenleri içermelidir:

- indicator code/version
- parameters hash
- instrument
- timeframe
- adjustment mode
- data cutoff
- closed/open bar policy

## 13. Hata kodları

- `INDICATOR_NOT_FOUND`
- `INDICATOR_VERSION_NOT_FOUND`
- `INDICATOR_PARAMETERS_INVALID`
- `INDICATOR_INPUT_TOO_SHORT`
- `INDICATOR_INPUT_INVALID`
- `INDICATOR_CALCULATION_FAILED`
- `INDICATOR_OUTPUT_INVALID`

## 14. Test zorunlulukları

Her indikatör için:

- referans fixture
- insufficient input
- constant series
- eksik veri
- extreme values
- first valid index
- output length
- NaN/Infinity kontrolü
- zero-range veya zero-volume, ilgiliyse

zorunludur.

## 15. Kabul kriterleri

- Ortak indicator contract uygulanmış.
- Parametre ve output şemaları doğrulanıyor.
- Warm-up açıkça hesaplanıyor.
- Referans fixture testleri mevcut.
- Registry katalog üretiyor.
- Batch executor duplicate hesaplamayı önlüyor.
- Cache key sürüm ve data cutoff içeriyor.
