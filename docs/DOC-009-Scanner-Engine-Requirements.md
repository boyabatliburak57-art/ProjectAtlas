# DOC-009 — Scanner Engine Requirements

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Scanner Engine, BIST enstrüman evreninde sürümlü tarama kurallarını doğrular, yürütme planına dönüştürür, gerekli veri ve indikatörleri toplar, koşulları değerlendirir ve açıklanabilir sonuç üretir.

## 2. Tarama türleri

- hazır tarama
- kullanıcı kayıtlı taraması
- tek seferlik özel tarama
- alarm bağlı tarama
- yönetici ön hesaplama taraması

## 3. Rule AST

```json
{
  "version": 1,
  "universe": {
    "market": "BIST",
    "statuses": ["active"],
    "indexCodes": [],
    "sectorIds": []
  },
  "root": {
    "type": "group",
    "operator": "AND",
    "children": []
  }
}
```

Node türleri:

- group
- condition

Operand türleri:

- indicator
- price field
- volume field
- market field
- constant number
- constant boolean

Temel analiz operandları sonraki pakette eklenebilir.

## 4. Mantıksal kurallar

- AND
- OR
- iç içe grup
- boş grup yasak
- stable nodeId
- maksimum derinlik
- maksimum node sayısı
- maksimum complexity score

AST içinde SQL, JavaScript veya çalıştırılabilir expression bulunamaz.

## 5. İlk operatör seti

### Scalar

- EQ
- NE
- GT
- GTE
- LT
- LTE
- BETWEEN
- OUTSIDE

### Geçiş

- CROSSES_ABOVE
- CROSSES_BELOW

### Seri

- HIGHEST_IN_PERIOD
- LOWEST_IN_PERIOD
- INCREASED_BY_PERCENT
- DECREASED_BY_PERCENT
- WITHIN_PERCENT_OF

### Boolean

- IS_TRUE
- IS_FALSE

## 6. Cross semantiği

`left CROSSES_ABOVE right` yalnızca aşağıdaki geçişte eşleşir:

```text
previousLeft <= previousRight
AND currentLeft > currentRight
```

Önceki değer eksikse sonuç `notEvaluable` olur. Cross aynı yönde devam eden her barda true üretmez.

## 7. Üç durumlu değerlendirme

Her node sonucu:

- matched
- notMatched
- notEvaluable

olur.

### AND

- herhangi bir child notMatched ise notMatched
- tüm child matched ise matched
- diğer durumda notEvaluable

### OR

- herhangi bir child matched ise matched
- tüm child notMatched ise notMatched
- diğer durumda notEvaluable

## 8. Execution Planner

Planner:

1. AST doğrular.
2. Universe filtresini çözer.
3. Operand bağımlılıklarını çıkarır.
4. Aynı indikatör taleplerini tekilleştirir.
5. Warm-up ve veri aralığını hesaplar.
6. Complexity score üretir.
7. Senkron/asenkron yürütme kararı verir.
8. Deterministik execution plan üretir.

## 9. Complexity

Maliyet unsurları:

- instrument count
- timeframe count
- unique indicator count
- warm-up length
- group depth
- operator history need
- requested history
- result retention/export.

Kota ve entitlement backend'de uygulanır.

## 10. Run durumu

- queued
- running
- completed
- failed
- cancelled
- expired

Terminal durumdan tekrar running'e geçilemez.

## 11. Sonuç modeli

Her sonuç:

- instrument
- rank
- status
- dataCutoffAt
- ruleVersion
- explanation
- computedValues
- warnings

alanlarını taşıyabilir.

Açıklama `nodeId` bazında oluşturulur.

## 12. Universe snapshot

Tarama çalıştırılırken kullanılan enstrüman listesi veya snapshot referansı run ile ilişkilendirilir. Geçmiş sonuçlar sonradan değişen endeks üyeliğine göre yeniden yorumlanmaz.

## 13. Veri cutoff politikası

Tek run aynı mantıksal cutoff ile değerlendirilmelidir. Gecikmiş semboller warning veya policy sonucu `notEvaluable` olabilir.

## 14. Saved scan revision

Kayıtlı tarama güncellendiğinde revision artar. Eski run eski revision ile kalır.

## 15. Güvenlik

- AST şema doğrulaması zorunlu.
- Serbest kod ve SQL yasak.
- Complexity limit zorunlu.
- Kaynak sahipliği backend'de kontrol edilir.
- Entitlement backend'de uygulanır.
- Export rate limited olur.

## 16. Hata kodları

- `SCAN_RULE_INVALID`
- `SCAN_RULE_VERSION_UNSUPPORTED`
- `SCAN_UNIVERSE_EMPTY`
- `SCAN_TOO_COMPLEX`
- `SCAN_DATA_UNAVAILABLE`
- `SCAN_RUN_NOT_FOUND`
- `SCAN_RUN_ACCESS_DENIED`
- `SCAN_EXECUTION_FAILED`
- `SCAN_RUN_EXPIRED`

## 17. Test zorunlulukları

- nested AND/OR
- cross transition
- notEvaluable propagation
- duplicate indicator elimination
- complexity limit
- stale data
- empty universe
- cancellation
- deterministic plan
- saved scan revision
- access control

## 18. Kabul kriterleri

- AST validation uygulanmış.
- Planner deterministik.
- Cross operatörleri geçiş barında çalışıyor.
- Üç durumlu değerlendirme testli.
- Node bazlı explanation üretilebiliyor.
- Complexity ve entitlement kontrolleri mevcut.
