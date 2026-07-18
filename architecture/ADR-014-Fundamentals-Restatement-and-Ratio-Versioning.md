# ADR-014 — Fundamentals Restatement Revision ve Ratio Formula Versioning

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Finansal tablo provider'ları aynı şirket, statement type ve mali dönem için sonradan düzeltilmiş
veri yayımlayabilir. Mevcut snapshot'ı overwrite etmek, daha önce gösterilen veya hesaplanan oranın
hangi kaynak değerlerden üretildiğini kaybettirir. Derived ratio'lar ayrıca denominator politikası,
unit/currency normalization, TTM inşası ve piyasa cutoff seçimine bağlıdır.

Provider alanlarını doğrudan domain veya UI modeline taşımak provider değişimini ürün
sözleşmesine sızdırır ve missing alanların yanlışlıkla sıfır kabul edilmesi riskini artırır.

## Karar

Her financial statement ingest'i provider adapter tarafından normalize edilir ve şu immutable
identity ile snapshot revision olarak saklanır:

```text
instrument + provider + statementType
+ fiscalYear + fiscalPeriod + providerRevision
```

Bir restatement mevcut kaydı overwrite etmez; yeni `providerRevision`, source timestamp,
published time ve quality metadata ile ayrı revision oluşturur. Önceki revision audit ve yeniden
hesaplama için korunur. Latest seçimi açık application policy ile yapılır; revision geçmişi
silinmez veya sessizce yeniden anlamlandırılmaz.

Provider raw payload'u normalize adapter sınırının dışına çıkmaz. Domain metric snapshot'ları ve UI
response'ları yalnız allowlist edilmiş normalize alanları, source/revision metadata'sını ve güvenli
quality durumunu taşır; raw provider verisi veya provider hata gövdesi domain ya da UI'ya doğrudan
bağlanmaz.

Her derived ratio `formulaVersion` taşır. Formula version; input metric seçimlerini,
denominator zero/negative davranışını, unit/currency normalization, TTM yeterlilik kuralını ve
rounding/presentation sınırını tanımlar. Market-price kullanan ratio ayrıca
`marketDataCutoffAt` taşır; financial period ile market cutoff tek tarih gibi sunulmaz.

Missing input sıfır kabul edilmez. Hesaplanamayan ratio `value: null`, status, reason code,
observation period, formula version, input revisions ve warning ile döner. Public sonuçlarda NaN
veya Infinity bulunmaz.

## Gerekçe

- Immutable revision geçmiş finansal açıklamaların audit izini korur.
- Formula version aynı input'un hangi kuralla hesaplandığını yeniden üretilebilir yapar.
- Normalize adapter provider bağımlılığını domain ve UI sözleşmesinden ayırır.
- Financial period ve market cutoff ayrımı valuation zamanı ile raporlama dönemini karıştırmaz.
- Metric-level status, missing veya geçersiz denominator durumunda sahte sıfır üretimini engeller.

## Sonuçlar

### Olumlu

- Restatement öncesi ve sonrası statement/ratio sonuçları karşılaştırılabilir kalır.
- Ratio hesapları input revision ve formula version üzerinden açıklanabilir olur.
- Provider değişimi normalize domain sözleşmesini doğrudan bozmaz.
- TTM, missing input ve denominator edge-case davranışları deterministik test edilebilir.
- Cache ve snapshot invalidation revision/formula değişimine bağlanabilir.

### Olumsuz

- Revision saklama veri hacmini ve latest-selection sorgularını artırır.
- Restatement, etkilenen ratio ve trend cache'lerinin yeniden hesaplanmasını gerektirir.
- Formula migration'larında birden fazla version'ın eşzamanlı sunumu gerekebilir.
- Provider revision kalitesi ve unit/currency dönüşümü için ek reconciliation gerekir.

## Değerlendirilen alternatifler

Son provider kaydıyla overwrite, yalnız normalized latest satırı saklama ve versionlanmamış ratio
formülleri değerlendirilmiştir. Bu yaklaşımlar audit geçmişini veya hesap açıklanabilirliğini
kaybettirdiği için reddedilmiştir. Raw provider payload'unu doğrudan UI'ya taşımak da güvenlik,
lisans ve sözleşme bağımlılığı nedeniyle reddedilmiştir.
